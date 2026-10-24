/**
 * dsh-isolation-gate · HOST half（宿主半）
 *
 * 三件事：
 *   ① 把"门禁状态"暴露成本机 HTTP 路由，供 GUI 整页读写；
 *   ② **工具执行门**：`ctx.tools.guard()` —— 模型调用 read/write/edit/bash… 时，
 *      在工具真正执行前按同一套三级判定拦下（2026-10-21 新增，本轮的核心缺口）；
 *   ③ 原生「选择文件夹」桥：把宿主 `directoryPickerController.pick()` 暴露给面板
 *      （查不到就返回 501，面板自动退回"未入名单目录 + 文本框"）。
 *
 *   GET  /__dsh-isolation-gate/ping      插件身份 + 路由清单 + 各级别说明 + 能力
 *   GET  /__dsh-isolation-gate/state     全量状态：名单 / 级别 / 分组 / 磁盘差异 / 审计 / 策略行
 *   POST /__dsh-isolation-gate/level     { name, level }             改一个对象的三级授权
 *   POST /__dsh-isolation-gate/roster    { action, name }            名单增删（先备份；新增自动 deny）
 *   POST /__dsh-isolation-gate/group-level { group, level }          组级一键切
 *   POST /__dsh-isolation-gate/group     { action:'assign'|'delete', name?, group }  归组 / 删组
 *   POST /__dsh-isolation-gate/prune     清理孤儿键
 *   POST /__dsh-isolation-gate/pick      调原生目录选择器（无则 501）
 *   POST /__dsh-isolation-gate/toolcheck { tool, args }              工具门干跑（不执行工具）
 *   POST /__dsh-isolation-gate/check     { name?|path?, op }         受管辖判定（不读任何内容）
 *   GET  /__dsh-isolation-gate/log?limit=  最近审计
 *
 * 服务访问照房规：`tools` 走 `inject` 硬声明；`webServer` / `directoryPickerController`
 * 用 `ctx.get` 这个 cordis 官方安全取用口拿；拿不到就等 / 降级，**绝不探测未声明的服务**。
 * 本包**不声明任何 `@deepseek-ai/dsh*` peer 依赖**（躲开兼容性豁免闸门）。
 *
 * 本宿主半**不会**读 / 写 / 列任何受管对象内部的内容：它只读写两个配置文件
 * （状态 JSON + 名单 TXT）并列出 D 根**一层目录名**（外加对名单里**显式列出的路径**做一次
 * 存在性判定）。受管对象内部的读写是 `bin/gate.mjs` 那条通道的活，那条通道同样受本插件管辖。
 */

import { spawn } from 'node:child_process';
import { registerGateTools } from './gate-tools.js';
import { clearGrant, grantActive, listRequests, markRequest, requestsPathFor, setGrant, readRequests } from './requests.js';
import {
  assignGroup,
  createGroup,
  buildReport,
  check,
  checkTool,
  deleteGroup,
  editRoster,
  levelInfo,
  normalizeConfig,
  pruneOrphans,
  setGroupLevel,
  setLevel,
} from './service.js';
import { clearAudit } from './audit.js';
import { collectTargets } from './toolgate.js';
import { decideWithProfiles, knownDirBindings, loadProfileState, __clearProfileCaches } from './profiles-runtime.js';
import {
  DEFAULT_LEVEL,
  readState,
  writeState,
  withProfile,
  withoutProfile,
  withSessionProfile,
} from './store.js';
import { isValidProfileName, readProfiles } from './profiles.js';

export const name = 'dsh-isolation-gate';
/** `tools` 是硬依赖：工具执行门没有它就不成立。 */
export const inject = ['tools'];

const VERSION = '1.1.0';
const BASE = '/__dsh-isolation-gate';
const MAX_BODY = 256 * 1024;

/** 轻量同源栅栏：本 API 只给本机 DSH 窗口用。 */
function isLocalRequest(req) {
  const origin = req?.headers?.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  try {
    const url = new URL(origin);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  } catch {
    return false;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${error?.message ?? String(error)}`));
      }
    });
    req.on('error', reject);
  });
}

export function apply(ctx, config) {
  const cfg = normalizeConfig(config);
  console.log(`[dsh-isolation-gate] host half loaded (v${VERSION})`);
  console.log(`[dsh-isolation-gate] 状态文件：${cfg.statePath}`);
  console.log(`[dsh-isolation-gate] 名单：${cfg.rosterPath}`);

  // ---- 工具执行门 -------------------------------------------------------
  // 每次工具调用都重新读盘（与 GUI 一样，不缓存）⇒ 面板一改，下一次工具调用即生效。
  const toolGateDecision = (exec) => {
    const collected = collectTargets(exec?.name, exec?.arguments);

    // ① 策略档（会话覆盖 > 目录 .dsh-gate.json > 默认档）。blocklist 档在这里直接放行。
    const profileDecision = decideWithProfiles(cfg.statePath, {
      sessionId: exec?.agent?.id,
      tool: collected.tool,
      targets: collected.targets,
      shell: collected.shell,
      command: typeof exec?.arguments?.command === 'string' ? exec.arguments.command : undefined,
      known: collected.unknownTool !== true,
    });
    if (!profileDecision.allowed) {
      const where = profileDecision.profile ? `档「${profileDecision.profile}」` : '策略档';
      return `门禁：${where}拒绝工具「${collected.tool}」${profileDecision.matched ? `（${profileDecision.matched}）` : ''}。${profileDecision.reason}`;
    }

    let firstDeny = null;
    let evaluated = 0;
    for (const target of collected.targets) {
      const decision = checkTool(cfg, { path: target.path, op: target.op });
      evaluated += 1;
      if (decision.ok && decision.allowed === false && firstDeny === null) {
        firstDeny = decision;
        break;
      }
      if (decision.ok && decision.inRoster === false) continue;
    }
    if (firstDeny !== null) {
      return (
        `门禁：拒绝工具「${collected.tool}」对「${firstDeny.matchedKey ?? firstDeny.name ?? firstDeny.target}」` +
        `的「${firstDeny.opLabel ?? firstDeny.op}」。${firstDeny.reason}`
      );
    }
    return undefined;
  };

  if (cfg.toolGate !== false) {
    ctx.effect(() =>
      ctx.tools.guard((exec) => {
        try {
          return toolGateDecision(exec);
        } catch (error) {
          // 判定自身出错 ⇒ fail-closed（宁可拒绝，不可放行）。
          return `门禁：工具门判定异常，按拒绝处理 —— ${error?.message ?? String(error)}`;
        }
      }),
    );
    console.log('[dsh-isolation-gate] 工具执行门已挂载（ctx.tools.guard · fail-closed）');
  } else {
    console.log('[dsh-isolation-gate] 工具执行门已关闭（config.toolGate=false，仅通道层生效）');
  }

  // ---- 模型可直接调用的工具（2026-10-24）--------------------------------
  // 户主不点面板、只说需求；模型用 gate_* 工具查/收紧/申请，放宽需户主批准。
  try {
    const info = registerGateTools(ctx, cfg);
    console.log(`[dsh-isolation-gate] 已注册 ${info.count} 个模型工具（gate_*）`);
  } catch (error) {
    // 工具注册失败不能拖垮门禁本体（拦截仍然有效）。
    console.log(`[dsh-isolation-gate] 工具注册失败：${error?.message ?? String(error)}`);
  }

  // ---- 目录选择器（可选能力：优先宿主抽象服务，Windows 上自带原生兜底）--------
  // 契约：capability() 返回 `native`（pick）或 `browse`（list/createDirectory）之一。
  const pickerCapability = (() => {
    try {
      const service = ctx.get('directoryPicker');
      return service ? service.capability() : undefined;
    } catch {
      return undefined;
    }
  })();
  const hostNativePicker =
    pickerCapability && pickerCapability.kind === 'native' && typeof pickerCapability.pick === 'function'
      ? pickerCapability
      : null;
  // 本机（Windows）自带的系统文件夹对话框：宿主未装载选择器实现时用它，效果与系统「选择文件夹」一致。
  const osNativePicker = process.platform === 'win32';
  const pickerReady = Boolean(hostNativePicker) || osNativePicker;
  const pickerKind = hostNativePicker ? 'native' : osNativePicker ? 'native-os' : null;
  if (!pickerReady) {
    console.log('[dsh-isolation-gate] 目录选择器不可用 ⇒ 面板使用"未入名单目录 + 文本框"退路');
  }

  function pickWithWindowsDialog() {
    return new Promise((resolve, reject) => {
      const script = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog;',
        "$d.Description = '选择要加入门禁的目录';",
        '$d.ShowNewFolderButton = $true;',
        "$d.SelectedPath = 'D:\\';",
        'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }',
      ].join(' ');
      const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-WindowStyle', 'Hidden', '-Command', script], {
        windowsHide: true,
      });
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk.toString('utf8');
      });
      child.on('error', reject);
      child.on('close', () => resolve(out.trim() || null));
    });
  }

  const send = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
  };

  const report = (auditLimit = 10) => buildReport(cfg, { auditLimit, picker: pickerReady, pickerKind });

  const routes = [
    {
      method: 'GET',
      path: `${BASE}/ping`,
      handler: async () => ({
        ok: true,
        name,
        version: VERSION,
        routes: [
          `GET ${BASE}/ping`,
          `GET ${BASE}/state`,
          `GET ${BASE}/profiles`,
          `POST ${BASE}/profile/save`,
          `POST ${BASE}/profile/delete`,
          `POST ${BASE}/session-profile`,
          `POST ${BASE}/level`,
          `POST ${BASE}/roster`,
          `POST ${BASE}/group-level`,
          `POST ${BASE}/group`,
          `POST ${BASE}/prune`,
          `POST ${BASE}/pick`,
          `POST ${BASE}/toolcheck`,
          `POST ${BASE}/check`,
          `GET ${BASE}/log`,
          `POST ${BASE}/audit/clear`,
          `GET ${BASE}/requests`,
          `POST ${BASE}/requests-approve`,
          `POST ${BASE}/requests-reject`,
          `POST ${BASE}/grant`,
        ],
        statePath: cfg.statePath,
        rosterPath: cfg.rosterPath,
        root: cfg.root,
        guardChannel: 'dsh-isolation-gate/bin/gate.mjs',
        toolGate: cfg.toolGate !== false,
        picker: pickerReady,
        pickerKind,
        ...levelInfo(),
      }),
    },
    {
      method: 'GET',
      path: `${BASE}/profiles`,
      handler: async (_req, _res, url) => {
        const state = loadProfileState(cfg.statePath)
        const sid = url?.searchParams?.get('sessionId') ?? ''
        const profiles = [...state.profiles.values()].map((profile) => ({
          name: profile.name,
          label: profile.label || profile.name,
          mode: profile.mode,
          allow: profile.allow,
          network: profile.network,
          unknownTool: profile.unknownTool,
          builtin: profile.builtin === true,
          isDefault: profile.name === state.defaultProfile,
        }))
        return {
          ok: true,
          defaultProfile: state.defaultProfile,
          profiles,
          sessionOverrides: state.sessionOverrides,
          currentSessionProfile: sid ? state.sessionOverrides[sid] ?? null : null,
          dirBindings: knownDirBindings(),
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/profile/save`,
      handler: async (req) => {
        const body = await readJsonBody(req)
        const checked = isValidProfileName(body.name)
        if (!checked.ok) return { ok: false, error: checked.reason }
        const allow = Array.isArray(body.allow) ? body.allow : []
        const loaded = readState(cfg.statePath)
        const next = withProfile(loaded.state, checked.name, {
          label: body.label,
          mode: body.mode,
          allow,
          network: body.network,
          unknownTool: body.unknownTool,
        })
        if (body.asDefault === true) next.defaultProfile = checked.name
        writeState(cfg.statePath, next)
        __clearProfileCaches()
        console.log(`[dsh-isolation-gate] 档「${checked.name}」已保存（${allow.length} 条清单）`)
        return { ok: true, name: checked.name, report: report() }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/profile/delete`,
      handler: async (req) => {
        const body = await readJsonBody(req)
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (name === '') return { ok: false, error: '缺少档名' }
        const loaded = readState(cfg.statePath)
        const isBuiltin = loaded.state.profiles[name] === undefined && ['normal', 'strict', 'sealed'].includes(name)
        if (isBuiltin) return { ok: false, error: '内置三档不能删（可以复制一份再改）' }
        const next = withoutProfile(loaded.state, name)
        writeState(cfg.statePath, next)
        __clearProfileCaches()
        console.log(`[dsh-isolation-gate] 档「${name}」已删除（挂在它上面的会话绑定一并清除）`)
        return { ok: true, name, report: report() }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/session-profile`,
      handler: async (req) => {
        const body = await readJsonBody(req)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        if (sessionId === '') return { ok: false, error: '缺少会话 id' }
        const name = typeof body.profile === 'string' ? body.profile.trim() : ''
        const loaded = readState(cfg.statePath)
        if (name !== '') {
          const profiles = readProfiles(loaded.state)
          if (!profiles.profiles.has(name)) return { ok: false, error: `没有这个档：${name}` }
        }
        const next = withSessionProfile(loaded.state, sessionId, name)
        writeState(cfg.statePath, next)
        __clearProfileCaches()
        console.log(`[dsh-isolation-gate] 会话 ${sessionId} → ${name === '' ? '不额外限制（只走全局名单）' : name}`)
        return { ok: true, sessionId, profile: name === '' ? null : name, report: report() }
      },
    },
    {
      method: 'GET',
      path: `${BASE}/state`,
      handler: async (_req, _res, url) => {
        const limit = Number.parseInt(url.searchParams.get('auditLimit') ?? '10', 10);
        return report(Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 10);
      },
    },
    {
      method: 'POST',
      path: `${BASE}/level`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const result = setLevel(cfg, { name: body.name, level: body.level, note: body.note, by: 'gui' });
        if (!result.ok) return result;
        console.log(`[dsh-isolation-gate] ${result.name} → ${result.level}（${result.levelLabel}）`);
        return { ...result, report: report() };
      },
    },
    {
      method: 'POST',
      path: `${BASE}/roster`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const result = editRoster(cfg, { action: body.action, name: body.name });
        if (!result.ok) return result;
        console.log(
          `[dsh-isolation-gate] 名单${result.action === 'add' ? '加入' : '移除'} ${result.name}` +
            `（备份：${result.backup ?? '无'}）`,
        );
        return { ...result, report: report() };
      },
    },
    {
      method: 'POST',
      path: `${BASE}/group-level`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const result = setGroupLevel(cfg, { group: body.group, level: body.level, by: 'gui' });
        if (!result.ok) return result;
        console.log(`[dsh-isolation-gate] 组「${result.group}」→ ${result.level}（${result.count} 个对象）`);
        return { ...result, report: report() };
      },
    },
    {
      method: 'POST',
      path: `${BASE}/group`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const action = body.action;
        const result =
          action === 'create'
            ? createGroup(cfg, { group: body.group, note: body.note })
            : action === 'assign'
              ? assignGroup(cfg, { name: body.name, group: body.group })
              : action === 'delete'
                ? deleteGroup(cfg, { group: body.group })
                : { ok: false, error: `action 只接受 create / assign / delete，收到：${String(action)}` };
        if (!result.ok) return result;
        if (action === 'create') console.log(`[dsh-isolation-gate] 新建分组「${result.group}」（空组）`);
        return { ...result, report: report() };
      },
    },
    {
      method: 'POST',
      path: `${BASE}/prune`,
      handler: async () => {
        const result = pruneOrphans(cfg);
        if (!result.ok) return result;
        console.log(`[dsh-isolation-gate] 清理孤儿键 ${result.removed.length} 个`);
        return { ...result, report: report() };
      },
    },
    {
      method: 'POST',
      path: `${BASE}/pick`,
      handler: async () => {
        if (!pickerReady) {
          return { ok: false, error: '当前宿主没有可用的目录选择器（请用下方"未入名单目录"或手动输入路径）' };
        }
        try {
          const picked = hostNativePicker
            ? await hostNativePicker.pick(new AbortController().signal)
            : await pickWithWindowsDialog();
          if (typeof picked !== 'string' || picked.trim() === '') {
            return { ok: false, canceled: true, error: '已取消选择' };
          }
          return { ok: true, path: picked };
        } catch (error) {
          return { ok: false, error: `目录选择器调用失败：${error?.message ?? String(error)}` };
        }
      },
    },
    {
      method: 'POST',
      path: `${BASE}/toolcheck`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const collected = collectTargets(body.tool, body.args ?? {});
        const decisions = collected.targets.map((target) => {
          const decision = check(cfg, {
            path: target.path,
            op: target.op,
            channel: 'toolcheck',
          });
          return {
            op: target.op,
            path: target.path,
            via: target.via,
            allowed: decision.allowed,
            inRoster: decision.inRoster,
            matchedKey: decision.matchedKey,
            level: decision.level,
            reason: decision.reason,
            error: decision.error,
          };
        });
        const denied = decisions.filter((item) => item.allowed === false);
        return {
          ok: true,
          tool: collected.tool,
          shell: collected.shell,
          unknownTool: collected.unknownTool,
          targets: decisions,
          wouldDeny: denied.length > 0,
          reason: denied[0]?.reason ?? null,
          defaultLevel: DEFAULT_LEVEL,
        };
      },
    },
    {
      method: 'POST',
      path: `${BASE}/check`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        return check(cfg, { name: body.name, path: body.path, op: body.op, channel: 'http' });
      },
    },
    {
      method: 'POST',
      path: `${BASE}/audit/clear`,
      handler: async () => {
        const result = clearAudit(cfg.auditPath)
        if (!result.ok) return result
        console.log(`[dsh-isolation-gate] 审计已清空 ${result.removed} 条（备份：${result.backup}）`)
        return { ...result, report: report() }
      },
    },
    {
      method: 'GET',
      path: `${BASE}/log`,
      handler: async (_req, _res, url) => {
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
        const snapshot = report(Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 20);
        return { ok: true, audit: snapshot.audit, paths: snapshot.paths };
      },
    },
  ];

  const register = (host, targetCtx) => {
    for (const route of routes) {
      targetCtx.effect(() =>
        host.register({
          kind: 'exact',
          path: route.path,
          handler: async (req, res) => {
            let url;
            try {
              url = new URL(req.url ?? route.path, 'http://127.0.0.1');
            } catch {
              send(res, 400, { ok: false, error: '无法解析请求 URL' });
              return;
            }
            if (!isLocalRequest(req)) {
              send(res, 403, { ok: false, error: '只接受本机窗口的请求' });
              return;
            }
            if ((req.method ?? 'GET').toUpperCase() !== route.method) {
              send(res, 405, { ok: false, error: `method not allowed (use ${route.method})` });
              return;
            }
            try {
              const payload = await route.handler(req, res, url);
              const failed = payload !== null && typeof payload === 'object' && payload.ok === false;
              send(res, failed ? 400 : 200, payload);
            } catch (error) {
              send(res, 400, { ok: false, error: error?.message ?? String(error) });
            }
          },
        }),
      );
    }
  };

  // ---- 待批申请 / AI 放宽授权（2026-10-24）------------------------------
  // 批准与授权只走本机面板（HTTP），模型工具里没有"批准"这个动作。
  routes.push(
    {
      method: 'GET',
      path: `${BASE}/requests`,
      handler: async () => {
        const file = requestsPathFor(cfg.statePath);
        return { ok: true, ...listRequests(file) };
      },
    },
    {
      method: 'POST',
      path: `${BASE}/requests-approve`,
      handler: async (req) => {
        const body = await readJson(req);
        const file = requestsPathFor(cfg.statePath);
        const request = readRequests(file).requests.find((item) => item.id === body.id);
        if (!request || request.status !== 'pending') return { ok: false, error: '没有这条待批申请' };
        const state = readState(cfg.statePath);
        const next = withLevel(state, request.target, request.level, { by: 'owner' });
        writeState(cfg.statePath, next);
        markRequest(file, request.id, 'approved');
        return { ok: true, request, level: request.level };
      },
    },
    {
      method: 'POST',
      path: `${BASE}/requests-reject`,
      handler: async (req) => {
        const body = await readJson(req);
        const file = requestsPathFor(cfg.statePath);
        const rejected = markRequest(file, String(body.id), 'rejected');
        return rejected ? { ok: true, request: rejected } : { ok: false, error: '没有这条待批申请' };
      },
    },
    {
      method: 'POST',
      path: `${BASE}/grant`,
      handler: async (req) => {
        const body = await readJson(req);
        const file = requestsPathFor(cfg.statePath);
        const minutes = Number(body.minutes);
        if (minutes === 0) {
          const cleared = clearGrant(file);
          return { ok: true, aiGrantUntil: cleared.aiGrantUntil, grantActive: false };
        }
        const data = setGrant(file, minutes || 30);
        return { ok: true, aiGrantUntil: data.aiGrantUntil, grantActive: grantActive(data) };
      },
    },
  );

  const webServer = ctx.get('webServer');
  if (webServer !== undefined) {
    register(webServer, ctx);
  } else {
    // 没有 web 面的 profile：等它，而不是挂死。
    ctx.inject(['webServer'], (sub) => {
      register(sub.webServer, sub);
    });
  }
}
