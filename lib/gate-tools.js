/**
 * 模型可直接调用的门禁工具（2026-10-24 新增）。
 *
 * 为什么要有：户主平时不点面板，只说需求。以前模型只能 shell 出去跑
 * `node bin/gate.mjs ...`，多一层猜；这里把同一套能力注册成工具，
 * 模型像调 `task_board_*` 一样直接调。
 *
 * 权限边界（户主拍板「只能收紧是对的，但用户授权后可以全做」）：
 *   · 查：随时；
 *   · 新增对象：只能按默认 `deny` 加；
 *   · 收紧（改到更严的级别）：随时；
 *   · 放宽：只有户主在面板点了「授权 AI 放宽 N 分钟」的窗口期内才直接生效，
 *     否则写一条待批申请，等户主批准。模型自己不能批。
 */
import { checkTool } from './service.js';
import { readAudit } from './audit.js';
import {
  LEVELS,
  LEVEL_LABEL,
  readState,
  writeState,
  withLevel,
  withGroup,
  findEntryKey,
  levelOf,
  groupsOf,
} from './store.js';
import {
  addRequest,
  grantActive,
  listRequests,
  pendingCount,
  readRequests,
  requestsPathFor,
} from './requests.js';
import { normalizePathKey } from './roster.js';

const OP_LEVEL = { traverse: 0, read: 1, write: 2, delete: 3 };
const OPS = ['traverse', 'read', 'write', 'delete'];

function text(schema) {
  return { type: 'string', description: schema };
}

/** 目标解析：名字（D 盘一级目录）或绝对路径。 */
function resolveTarget(args) {
  if (typeof args.path === 'string' && args.path.trim()) {
    return { target: normalizePathKey(args.path.trim()), kind: 'path' };
  }
  if (typeof args.name === 'string' && args.name.trim()) {
    return { target: args.name.trim(), kind: 'name' };
  }
  throw new Error('必须给 name（D 盘一级目录名）或 path（绝对路径）之一');
}

function rank(level) {
  const i = LEVELS.indexOf(level);
  return i < 0 ? 0 : i;
}

function label(level) {
  return LEVEL_LABEL[level] ?? level;
}

function targetExists(state, key) {
  return findEntryKey(state, key) !== null;
}

function jsonResult(value) {
  return {
    schema: { type: 'object' },
    render: (_args, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
  };
}

/** 工具返回值必须是 lossless JSON：undefined / NaN / BigInt 会被宿主直接拒收。 */
function plain(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

export function registerGateTools(ctx, cfg) {
  const requestsPath = requestsPathFor(cfg.statePath);
  const register = (definition) => {
    const run = definition.execute;
    const safe = { ...definition, execute: async (args, exec) => plain(await run(args, exec)) };
    return ctx.effect(() => ctx.tools.register(safe), `dsh-isolation-gate: ${definition.name}`);
  };

  // ── 1. 看全量状态 ────────────────────────────────────────────────
  register({
    name: 'gate_status',
    description:
      '查看门禁全量状态：默认级别、所有受管对象及其级别/分组、分组列表、待批申请数、AI 放宽授权是否有效。任何"门禁里现在是什么情况"的问题先调它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: jsonResult(),
    execute: async () => {
      const state = readState(cfg.statePath).state;
      const requests = listRequests(requestsPath);
      const objects = Object.entries(state.objects ?? {}).map(([key, entry]) => ({
        target: key,
        level: entry.level,
        levelLabel: label(entry.level),
        group: entry.group || '',
        note: entry.note || '',
      }));
      return {
        defaultLevel: state.defaultLevel,
        defaultLevelLabel: label(state.defaultLevel),
        objects,
        groups: groupsOf(state),
        profiles: Object.keys(state.profiles ?? {}),
        pendingRequests: requests.requests.length,
        aiGrantUntil: requests.aiGrantUntil,
        aiGrantActive: requests.grantActive,
        auditPath: cfg.auditPath,
      };
    },
  });

  // ── 2. 干跑一次判定 ─────────────────────────────────────────────
  register({
    name: 'gate_check',
    description:
      '干跑判定：给一个路径（或目录名）和一个操作，返回门禁会不会放行、命中哪个对象、理由是什么。不读文件内容、不执行任何东西。动手前先问"这个能不能读/写"时用它。',
    parameters: {
      type: 'object',
      properties: {
        name: text('D 盘一级目录名，如 Zcode'),
        path: text('绝对路径，如 D:\\Zcode\\a.txt'),
        op: { type: 'string', enum: OPS, description: '操作：traverse / read / write / delete' },
      },
      required: ['op'],
      additionalProperties: false,
    },
    output: jsonResult(),
    execute: async (args) => {
      const { target, kind } = resolveTarget(args);
      const op = String(args.op);
      if (!OPS.includes(op)) throw new Error(`未知操作 ${op}`);
      const decision = checkTool(cfg, kind === 'path' ? { path: target, op } : { name: target, op });
      return {
        target,
        kind,
        op,
        allowed: decision.ok ? decision.allowed === true : false,
        reason: decision.reason,
        matched: decision.matchedKey ?? null,
        level: decision.level ?? null,
        inRoster: decision.inRoster ?? null,
        error: decision.ok ? null : decision.reason,
      };
    },
  });

  // ── 3. 新增对象（只能默认禁）─────────────────────────────────────
  register({
    name: 'gate_add',
    description:
      '把目录（或绝对路径）加入受管名单，级别固定为「禁」。加进来只是"开始管它"，不会放行任何东西；要只读/可写必须另外申请并由户主批准。',
    parameters: {
      type: 'object',
      properties: {
        name: text('D 盘一级目录名'),
        path: text('绝对路径'),
        group: text('可选：放进哪个组'),
        note: text('可选：备注'),
      },
      additionalProperties: false,
    },
    output: jsonResult(),
    execute: async (args) => {
      const { target, kind } = resolveTarget(args);
      const state = readState(cfg.statePath).state;
      if (targetExists(state, target)) {
        const current = levelOf(state, target);
        return { ok: true, target, kind, level: current, changed: false, message: `已在名单里，当前「${label(current)}」` };
      }
      let next = withLevel(state, target, 'deny', { by: 'agent' });
      if (args.group) next = withGroup(next, target, String(args.group), { by: 'agent' });
      writeState(cfg.statePath, next);
      return { ok: true, target, kind, level: 'deny', changed: true, message: '已加入名单，级别「禁」' };
    },
  });

  // ── 4. 改级别（默认只允许收紧）──────────────────────────────────
  register({
    name: 'gate_set_level',
    description:
      '改一个受管对象的级别。收紧（往「禁」方向）随时可以；放宽（往「只读 / 可读写删」方向）只有在户主点了「授权 AI 放宽」的窗口期内才直接生效，否则会写一条待批申请并在返回里说明。',
    parameters: {
      type: 'object',
      properties: {
        name: text('D 盘一级目录名'),
        path: text('绝对路径'),
        level: { type: 'string', enum: LEVELS, description: 'deny / read / full' },
        reason: text('可选：为什么要改，写进审计与待批申请'),
      },
      required: ['level'],
      additionalProperties: false,
    },
    output: jsonResult(),
    execute: async (args) => {
      const { target, kind } = resolveTarget(args);
      const want = String(args.level);
      if (!LEVELS.includes(want)) throw new Error(`未知级别 ${want}`);
      const state = readState(cfg.statePath).state;
      if (!targetExists(state, target)) {
        throw new Error(`「${target}」不在名单里；先用 gate_add 加进来（只会是「禁」）`);
      }
      const current = levelOf(state, target);
      if (current === want) {
        return { ok: true, changed: false, target, level: current, message: '已经是这个级别' };
      }
      const tightening = rank(want) < rank(current);
      const requests = readRequests(requestsPath);
      const mayWiden = grantActive(requests);
      if (!tightening && !mayWiden) {
        const request = addRequest(requestsPath, {
          target,
          targetKind: kind,
          level: want,
          fromLevel: current,
          reason: args.reason ?? '',
          requestedBy: 'agent',
        });
        return {
          ok: false,
          changed: false,
          needsApproval: true,
          requestId: request.id,
          target,
          from: current,
          to: want,
          message: `放宽需要户主批准：已在「门禁」面板生成待批申请 ${request.id}。户主点批准后即可生效；不要重复申请。`,
        };
      }
      const next = withLevel(state, target, want, { by: 'agent' });
      writeState(cfg.statePath, next);
      return {
        ok: true,
        changed: true,
        target,
        from: current,
        to: want,
        viaGrant: !tightening && mayWiden,
        message: tightening ? `已收紧到「${label(want)}」` : `已在授权窗口内放宽到「${label(want)}」`,
      };
    },
  });

  // ── 5. 申请放宽 ─────────────────────────────────────────────────
  register({
    name: 'gate_request',
    description:
      '为某个受管对象申请一个更宽的级别（只读 / 可读写删），写进待批列表等户主在面板批准。理由写清楚：为什么要、大概多久。',
    parameters: {
      type: 'object',
      properties: {
        name: text('D 盘一级目录名'),
        path: text('绝对路径'),
        level: { type: 'string', enum: LEVELS },
        reason: text('为什么要放宽（户主看这条决定批不批）'),
      },
      required: ['level', 'reason'],
      additionalProperties: false,
    },
    output: jsonResult(),
    execute: async (args) => {
      const { target, kind } = resolveTarget(args);
      const want = String(args.level);
      if (!LEVELS.includes(want)) throw new Error(`未知级别 ${want}`);
      const state = readState(cfg.statePath).state;
      const current = targetExists(state, target) ? levelOf(state, target) : null;
      if (current === want) return { ok: true, created: false, message: '已经是这个级别，无需申请' };
      const request = addRequest(requestsPath, {
        target,
        targetKind: kind,
        level: want,
        fromLevel: current,
        reason: String(args.reason),
        requestedBy: 'agent',
      });
      return {
        ok: true,
        created: true,
        requestId: request.id,
        target,
        from: current,
        to: want,
        pending: pendingCount(requestsPath),
        message: `已提交待批申请 ${request.id}；户主批准前保持现状。`,
      };
    },
  });

  // ── 6. 看待批 ──────────────────────────────────────────────────
  register({
    name: 'gate_requests',
    description: '列出门禁的待批申请（模型用来看自己提的申请有没有被批准）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: jsonResult(),
    execute: async () => listRequests(requestsPath),
  });

  // ── 7. 看审计 ──────────────────────────────────────────────────
  register({
    name: 'gate_log',
    description: '读门禁最近的决定记录（时间 / 对象 / 级别 / 操作 / 是否放行 / 理由），不读文件内容。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '条数，默认 20，最多 200' } },
      additionalProperties: false,
    },
    output: jsonResult(),
    execute: async (args) => {
      const limit = Math.max(1, Math.min(200, Number(args.limit) || 20));
      return { entries: readAudit(cfg.auditPath, limit) };
    },
  });

  return { count: 7, requestsPath };
}
