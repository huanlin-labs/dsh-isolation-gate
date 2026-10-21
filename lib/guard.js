/**
 * 门禁 · 访问判定（三级 × 四操作）
 *
 * 这是全系统**唯一**决定"能不能进受管对象"的地方：GUI 开关、HTTP 路由、
 * `bin/gate.mjs` 通道都调用这里的 `checkAccess`。
 *
 *   级别        可做的事
 *   deny（禁）   无 —— 默认
 *   read（只读） traverse（列目录名）· read（读文件）
 *   full（可读写删） 以上 + write（写/改）· delete（删）
 *
 * 判定顺序（给的是 path 时）：
 *   ① 算**真身路径**（目标先 realpath，或"最深已存在祖先的 realpath + 剩余片段"），
 *      所以 `D:\管家\某个指向 Zcode 的 junction\x` 也会被认成 `Zcode`，不能绕；
 *   ② 在名单的**路径对象**里找**最长前缀命中** —— 按**路径段**比较（大小写不敏感），
 *      必须整段相等（`D:\a\b` 不会被 `D:\a\bc` 命中）；命中多条取**最长**的那条；
 *   ③ 没命中路径对象 ⇒ 退回旧行为：取"盘根一级目录名"，看它是否在**名字对象**里；
 *   ④ 都没命中 ⇒ `inRoster:false`，放行（语义不变："不属本通道管辖"）。
 *
 * 给的是 name 时：**只在名字对象里匹配**（大小写不敏感），行为与旧版一致。
 *
 * ⚠️ **fail-closed**：名单不可用（`rosterOk === false`，含文件缺失 / 读坏）⇒ **一律拒绝**。
 *    旧版在这种情况下会 `inRoster:false` ⇒ **放行一切**（fail-open，隔离会悄悄失效），
 *    本版按"名单读不到就什么都不放"处理。
 *
 * 安全细节：判定失败（看不懂路径）⇒ **按拒绝**处理，不给"猜一下"留口子。
 */

import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve, win32 } from 'node:path';
import { LEVELS, LEVEL_LABEL, LEVEL_HINT, levelOf, normalizeLevel } from './store.js';
import { normalizePathKey, objectForName, sameObject } from './roster.js';

/** 操作 → 所需最低权限。 */
export const OPS = ['traverse', 'read', 'write', 'delete'];

export const OP_LABEL = {
  traverse: '遍历（列目录名）',
  read: '读取文件内容',
  write: '写入 / 修改',
  delete: '删除',
};

const OP_RANK = { traverse: 1, read: 2, write: 3, delete: 4 };
const LEVEL_RANK = { deny: 0, read: 2, full: 4 };

/** 该级别是否允许该操作。 */
export function levelAllows(level, op) {
  const rank = OP_RANK[op];
  if (rank === undefined) return false;
  return LEVEL_RANK[normalizeLevel(level)] >= rank;
}

/** 该级别允许的操作清单（给 UI 与 agent 读）。 */
export function allowedOps(level) {
  return OPS.filter((op) => levelAllows(level, op));
}

/** 三级一览（UI / CLI 共用同一份说明）。 */
export function levelTable() {
  return LEVELS.map((level) => ({
    level,
    label: LEVEL_LABEL[level],
    hint: LEVEL_HINT[level],
    allowedOps: allowedOps(level),
  }));
}

/**
 * 取路径的**真身路径**与盘根一级目录名。
 *
 * 真身算法：找"最深的已存在祖先"再 realpath，**并把祖先之下的剩余片段接回去**
 * —— 目标本身可能还不存在（例如准备新建），但拼出来的真身路径仍可用于前缀匹配。
 */
export function topSegmentOf(targetPath) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    return { ok: false, error: '路径为空', top: null, realPath: null, root: null };
  }
  const absolute = resolve(targetPath);
  let probe = absolute;
  for (;;) {
    if (existsSync(probe)) break;
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  let real = probe;
  let realAncestor = probe;
  try {
    realAncestor = realpathSync(probe);
  } catch {
    /* realpath 失败就退回字面路径；下面的判定不会因此放宽 */
  }
  const remainder = absolute.slice(probe.length);
  real = `${realAncestor}${remainder}`;
  const parsed = win32.parse(real);
  const relative = real.slice(parsed.root.length);
  const segment = relative.split(/[\\/]+/).filter(Boolean)[0] ?? null;
  return {
    ok: segment !== null,
    top: segment,
    realPath: real,
    root: parsed.root,
    error: segment === null ? `无法从路径解析出盘根一级目录名：${targetPath}` : null,
  };
}

/** 名字是否在名单内（大小写不敏感 · 只比名字）。 */
export function inRoster(rosterNames, name) {
  const want = String(name ?? '').trim().toLowerCase();
  if (want === '') return false;
  return (rosterNames ?? []).some((n) => String(n).toLowerCase() === want);
}

/** 路径段切分（忽略大小写、忽略空段）。 */
function pathSegments(key) {
  return String(key)
    .toLowerCase()
    .split(/[\\/]+/)
    .filter((segment) => segment !== '');
}

/** 前缀是否**按整段**命中目标（`D:\a\b` 命中 `D:\a\b\c`；不命中 `D:\a\bc`）。 */
export function isSegmentPrefix(prefixKey, targetKey) {
  const a = pathSegments(prefixKey);
  const b = pathSegments(targetKey);
  if (a.length === 0 || a.length > b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 在路径对象里找**最长前缀命中**（按路径段数最多者胜；同样多则取字面更长的）。
 * @returns {{kind:'name'|'path',key:string,raw:string}|null}
 */
export function longestPrefixMatch(objects, targetPath) {
  const targetKey = normalizePathKey(targetPath);
  if (targetKey === null) return null;
  let best = null;
  let bestSegments = -1;
  let bestLength = -1;
  for (const object of Array.isArray(objects) ? objects : []) {
    if (!object || object.kind !== 'path' || typeof object.key !== 'string') continue;
    const key = normalizePathKey(object.key);
    if (key === null || !isSegmentPrefix(key, targetKey)) continue;
    const segments = pathSegments(key).length;
    if (segments > bestSegments || (segments === bestSegments && key.length > bestLength)) {
      best = { kind: 'path', key, raw: typeof object.raw === 'string' ? object.raw : key };
      bestSegments = segments;
      bestLength = key.length;
    }
  }
  return best;
}

/** 名字对象命中（大小写不敏感）。 */
export function nameObjectMatch(objects, name) {
  const candidate = objectForName(name);
  if (!candidate) return null;
  const hit = (Array.isArray(objects) ? objects : []).find(
    (object) => object && object.kind === 'name' && sameObject(object, candidate),
  );
  return hit ? { kind: 'name', key: hit.key, raw: typeof hit.raw === 'string' ? hit.raw : hit.key } : null;
}

/**
 * 把调用方给的两套入参收敛成对象数组。
 * 优先 `rosterObjects`（新的、两类都在）；退化到旧的 `rosterNames`（只有名字）。
 */
function objectsFromInput(input) {
  if (Array.isArray(input?.rosterObjects)) {
    return input.rosterObjects.filter(
      (object) => object && (object.kind === 'name' || object.kind === 'path') && typeof object.key === 'string',
    );
  }
  if (Array.isArray(input?.rosterNames)) return input.rosterNames.map(objectForName).filter(Boolean);
  return [];
}

function denyMessage(label, kind, level, op, channel) {
  const kindLabel = kind === 'path' ? '受管路径' : '受管名字';
  return (
    `拒绝：${kindLabel}「${label}」当前授权级别为「${LEVEL_LABEL[level]}」（${level}），` +
    `不允许「${OP_LABEL[op] ?? op}」。` +
    (level === 'deny'
      ? '未明确授权一律按"默认禁"执行 —— 请在 GUI 侧边栏「门禁」开关里授权。'
      : `该级别只允许：${allowedOps(level).map((o) => OP_LABEL[o] ?? o).join(' / ')}。`) +
    `（管辖通道：${channel}）`
  );
}

/** 名单不可用 ⇒ 一律拒绝（fail-closed）。错误文案可直接抄进报告。 */
function rosterUnavailableDecision(input, op, channel) {
  const where = typeof input?.rosterPath === 'string' && input.rosterPath !== '' ? input.rosterPath : '名单文件';
  return {
    ok: true,
    allowed: false,
    op,
    opLabel: OP_LABEL[op],
    name: typeof input?.name === 'string' && input.name !== '' ? input.name : null,
    target: typeof input?.path === 'string' && input.path !== '' ? input.path : null,
    level: null,
    levelLabel: null,
    inRoster: null,
    matchedKey: null,
    matchedKind: null,
    matchedLevel: null,
    rosterUnavailable: true,
    allowedOps: [],
    channel,
    error: null,
    reason: `名单不可用（${where} 缺失或损坏）⇒ 按"一律拒绝"处理，请先恢复名单文件`,
  };
}

/**
 * 授权判定（不碰任何文件内容）。
 *
 * @param {object} input
 * @param {object} input.state 状态对象（store.readState().state）
 * @param {Array<{kind,key,raw}>} [input.rosterObjects] 名单对象（两类都在；优先）
 * @param {string[]} [input.rosterNames] 旧的"只有名字"入参（向后兼容）
 * @param {boolean} [input.rosterOk] 名单是否读得到（`false` ⇒ 一律拒绝）
 * @param {string} [input.rosterPath] 名单路径（只用于拒绝文案）
 * @param {string} [input.name] 直接问某个受管名字
 * @param {string} [input.path] 要访问的路径（与 name 二选一，优先 path）
 * @param {string} input.op traverse | read | write | delete
 * @param {string} [input.channel] 通道名（写进拒绝文案，便于追责）
 */
export function checkAccess(input) {
  const channel = typeof input?.channel === 'string' && input.channel !== '' ? input.channel : 'dsh-isolation-gate';
  const op = input?.op;
  if (!OPS.includes(op)) {
    return {
      ok: false,
      allowed: false,
      op: op ?? null,
      error: `操作名不合法：${String(op)}（只接受 ${OPS.join(' / ')}）`,
    };
  }

  // —— fail-closed：名单不可用 ⇒ 一律拒绝（不再是"放行一切"）——
  if (input?.rosterOk === false) return rosterUnavailableDecision(input, op, channel);

  const objects = objectsFromInput(input);
  const nameObjects = objects.filter((object) => object.kind === 'name');
  const pathObjects = objects.filter((object) => object.kind === 'path');

  let name = null;
  let realPath = null;
  let matched = null;

  if (typeof input?.path === 'string' && input.path.trim() !== '') {
    const resolved = topSegmentOf(input.path);
    realPath = resolved.realPath ?? null;
    name = resolved.ok ? resolved.top : null;
    // ① 路径对象：最长前缀命中（前缀可以比"盘根一级"更深，也可以正好是盘根）
    matched = longestPrefixMatch(pathObjects, realPath ?? input.path);
    // ② 没命中路径对象 ⇒ 退回旧行为：盘根一级目录名 → 名字对象
    if (!matched && name !== null) matched = nameObjectMatch(nameObjects, name);
    if (!matched && name === null) {
      return { ok: false, allowed: false, op, error: resolved.error, target: input.path };
    }
  } else if (typeof input?.name === 'string' && input.name.trim() !== '') {
    name = input.name.trim();
    // 给名字时**只在名字对象里匹配** —— 名字键与路径键是两个键空间。
    matched = nameObjectMatch(nameObjects, name);
  } else {
    return { ok: false, allowed: false, op, error: '需要给 name 或 path 之一' };
  }

  if (!matched) {
    // 不属任何受管对象 ⇒ 本通道不管，照实说明（不冒充"已授权"）。
    return {
      ok: true,
      allowed: true,
      op,
      opLabel: OP_LABEL[op],
      name,
      target: realPath,
      level: null,
      levelLabel: null,
      inRoster: false,
      matchedKey: null,
      matchedKind: null,
      matchedLevel: null,
      allowedOps: [],
      reason:
        name === null
          ? `「${input.path}」不属任何受管对象 ⇒ 本通道放行（本通道只管辖名单内的名字与路径）`
          : `「${name}」不在名单内 ⇒ 不属受管对象，本通道放行（本通道只管辖名单内的名字与路径）`,
      channel,
    };
  }

  const matchedKey = matched.key;
  const level = levelOf(input.state, matchedKey);
  const allowed = levelAllows(level, op);
  return {
    ok: true,
    allowed,
    op,
    opLabel: OP_LABEL[op],
    // 命中时 `name` 以**命中对象**为准（路径命中就报路径键），旧字段语义收敛为"受管对象名"。
    name: matchedKey,
    top: name,
    target: realPath,
    level,
    levelLabel: LEVEL_LABEL[level],
    inRoster: true,
    matchedKey,
    matchedKind: matched.kind,
    matchedLevel: level,
    allowedOps: allowedOps(level),
    reason: allowed
      ? `允许：${matched.kind === 'path' ? '受管路径' : '受管名字'}「${matchedKey}」当前为「${LEVEL_LABEL[level]}」，含「${OP_LABEL[op]}」`
      : denyMessage(matchedKey, matched.kind, level, op, channel),
    channel,
  };
}

/**
 * 给 agent / 工具侧读的紧凑策略块（一句话一行，能直接塞进规则或提示词）。
 * @param {object} state 状态对象
 * @param {Array<{kind,key}>|string[]} rosterKeys 受管对象（或旧的名字数组）
 */
export function policyLines(state, rosterKeys) {
  return (rosterKeys ?? [])
    .map((item) => {
      const object =
        typeof item === 'string'
          ? { kind: 'name', key: item }
          : item && typeof item === 'object'
            ? { kind: item.kind === 'path' ? 'path' : 'name', key: item.key }
            : null;
      if (!object || typeof object.key !== 'string') return null;
      const level = levelOf(state, object.key);
      const tag = object.kind === 'path' ? '[路径] ' : '';
      return `${tag}${object.key} = ${level}（${LEVEL_LABEL[level]}）· 允许：${allowedOps(level).join(',') || '无'}`;
    })
    .filter((line) => line !== null);
}
