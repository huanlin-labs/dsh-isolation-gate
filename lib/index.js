/**
 * dsh-access-gate · HOST half（宿主半）
 *
 * 只做一件事：把"门禁状态"暴露成本机 HTTP 路由，供 GUI 整页读写。
 *
 *   GET  /__dsh-access-gate/ping      插件身份 + 路由清单 + 各级别说明
 *   GET  /__dsh-access-gate/state     全量状态：名单 / 级别 / 磁盘差异 / 审计尾部 / agent 策略行
 *   POST /__dsh-access-gate/level     { name, level }             改一个受管对象的三级授权
 *   POST /__dsh-access-gate/roster    { action, name }            名单增删（**先备份**，新增项自动 deny）
 *   POST /__dsh-access-gate/check     { name?|path?, op }         受管辖通道判定（不读任何内容）
 *   GET  /__dsh-access-gate/log?limit=  最近审计
 *
 * 服务访问照房规：`webServer` 用 `ctx.get` 这个 cordis 官方安全取用口拿；拿不到就
 * `ctx.inject(['webServer'])` 等它，**绝不阻塞、绝不探测未声明的服务** ⇒ 本包
 * `inject = []`、且**不声明任何 `@deepseek-ai/dsh*` peer 依赖**（躲开兼容性豁免闸门）。
 *
 * 本宿主半**不会**读 / 写 / 列任何受管对象内部的内容：它只读写两个配置文件
 * （状态 JSON + 名单 TXT）并列出 D 根**一层目录名**（外加对名单里**显式列出的路径**做一次
 * 存在性判定）。受管对象内部的读写是 `bin/gate.mjs` 的活，那条通道同样被本插件的判定管着。
 */

import { buildReport, check, editRoster, levelInfo, normalizeConfig, setLevel } from './service.js';

export const name = 'dsh-access-gate';
export const inject = [];

const VERSION = '0.1.0';
const BASE = '/__dsh-access-gate';
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
  console.log(`[dsh-access-gate] host half loaded (v${VERSION})`);
  console.log(`[dsh-access-gate] 状态文件：${cfg.statePath}`);
  console.log(`[dsh-access-gate] 名单：${cfg.rosterPath}`);

  const send = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
  };

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
          `POST ${BASE}/level`,
          `POST ${BASE}/roster`,
          `POST ${BASE}/check`,
          `GET ${BASE}/log`,
        ],
        statePath: cfg.statePath,
        rosterPath: cfg.rosterPath,
        root: cfg.root,
        guardChannel: 'dsh-access-gate/bin/gate.mjs',
        ...levelInfo(),
      }),
    },
    {
      method: 'GET',
      path: `${BASE}/state`,
      handler: async (_req, _res, url) => {
        const limit = Number.parseInt(url.searchParams.get('auditLimit') ?? '10', 10);
        return buildReport(cfg, { auditLimit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 10 });
      },
    },
    {
      method: 'POST',
      path: `${BASE}/level`,
      handler: async (req) => {
        const body = await readJsonBody(req);
        const result = setLevel(cfg, { name: body.name, level: body.level, note: body.note, by: 'gui' });
        if (!result.ok) return result;
        console.log(`[dsh-access-gate] ${result.name} → ${result.level}（${result.levelLabel}）`);
        return { ...result, report: buildReport(cfg, { auditLimit: 10 }) };
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
          `[dsh-access-gate] 名单${result.action === 'add' ? '加入' : '移除'} ${result.name}` +
            `（备份：${result.backup ?? '无'}）`,
        );
        return { ...result, report: buildReport(cfg, { auditLimit: 10 }) };
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
      method: 'GET',
      path: `${BASE}/log`,
      handler: async (_req, _res, url) => {
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
        const report = buildReport(cfg, { auditLimit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 20 });
        return { ok: true, audit: report.audit, paths: report.paths };
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
