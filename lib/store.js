/**
 * 门禁 · 状态载体（唯一生效依据）
 *
 * 状态文件：`D:\.agents\门禁-授权.json`
 *
 * 设计要点（对齐 2026-10-08 户主令「授权以 GUI 开关为准」）：
 *   · **唯一真身**：授权状态只存在这一个文件里；插件不保留内存副本、不缓存，
 *     每次读取都重新读盘 ⇒ 面板不可能显示"已授权"而工具侧读到别的。
 *   · **默认禁**：文件不存在 / 解析失败 / 键未列出 ⇒ 一律 deny。
 *     解析失败时**不覆盖**原文件（宁可停在"全禁"，也不拿坏文件换好文件）。
 *   · **无 BOM**：`writeFileSync(path, text, 'utf8')` 不写 BOM；
 *     读取时顺手剥掉可能的 `\uFEFF`（别的工具用 PS 的 `-Encoding UTF8` 写过）。
 *   · **原子替换**：先写 `<file>.tmp-<pid>-<ts>` 再 rename，避免半截 JSON。
 *   · 三级：deny（禁） / read（只读） / full（可读写删）——与规则措辞逐字对齐。
 *
 * 磁盘格式 v2（2026-10-21）：
 *   {
 *     "version": 2,
 *     "groups":  { "<组名>": { "note": "", "updatedAt": "…" } },
 *     "objects": { "<对象键>": { "level": "deny", "note": "", "group": "<组名>", "updatedAt": "…" } }
 *   }
 *   · **组只存在状态文件里**；名单仍是"一行一对象"的极简 TXT。
 *   · v1 的 `harnesses: { key: { level } }` **仍可读**：读入时自动迁移成 `objects`，
 *     且不丢级别；下一次写盘才落成 v2（迁移是"读时兼容 + 写时升级"）。
 *   · `state.harnesses` 保留为**只读别名**（非枚举属性，指向 `objects`）——旧代码/旧测试
 *     读得到，但不会再被写进磁盘。
 *
 * 键空间：名字（D 根一级目录名）与绝对路径是两个键空间，永不互相匹配。
 */

import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { looksLikeAbsolutePath, normalizePathKey } from './roster.js';

/** 状态文件默认落点（户主建议位 · 供 agent / 工具侧读取）。 */
const LEGACY_AGENTS_DIR = 'D:\\\\.agents';
const AGENTS_DIR = process.platform === 'win32' && existsSync(LEGACY_AGENTS_DIR) ? LEGACY_AGENTS_DIR : join(process.env.USERPROFILE || process.env.HOME || ".", '.agents');
export const DEFAULT_STATE_PATH = join(AGENTS_DIR, '门禁-授权.json');

/** 当前磁盘格式代。 */
export const STATE_VERSION = 3;

/** 三级状态，顺序即"由紧到松"，UI 按此顺序排按钮。 */
export const LEVELS = ['deny', 'read', 'full'];

/** 与规则措辞逐字对齐的级别名。 */
export const LEVEL_LABEL = {
  deny: '禁',
  read: '只读',
  full: '可读写删',
};

/** 级别含义（UI 与 CLI 共用同一份文案，避免两边说不一样的话）。 */
export const LEVEL_HINT = {
  deny: '完全不可访问（默认）',
  read: '可读、可比对；不可写 / 删 / 搬 —— 对应户主说法「交叉验证」',
  full: '可进入操作，含删减文件 —— 对应户主说法「可以进去操作 / 删减」',
};

/** 默认级别：未明确授权一律按"默认禁"执行。 */
export const DEFAULT_LEVEL = 'deny';

/** 组名上限（UI 与校验共用）。 */
export const MAX_GROUP_NAME = 40;

const README_LINE =
  '门禁状态 · 唯一生效依据（GUI 侧边栏「门禁」开关写入）。' +
  '未在本文件列出的键一律按 deny；本文件缺省也不代表授权，恰恰等于全禁。';

function nowIso(now) {
  const value = now instanceof Date ? now : new Date();
  return value.toISOString();
}

/** 空状态：全禁。 */
export function emptyState(now) {
  const state = {
    version: STATE_VERSION,
    _readme: README_LINE,
    defaultLevel: DEFAULT_LEVEL,
    updatedAt: nowIso(now),
    updatedBy: 'unknown',
    groups: {},
    objects: {},
    profiles: {},
    sessionOverrides: {},
  };
  // 旧读法别名：只在内存里，不写盘。
  Object.defineProperty(state, 'harnesses', {
    get() {
      return state.objects;
    },
    enumerable: false,
    configurable: true,
  });
  return state;
}

export function normalizeLevel(level) {
  return typeof level === 'string' && LEVELS.includes(level) ? level : DEFAULT_LEVEL;
}

/** 键的种类：绝对路径 ⇒ `path`，其余 ⇒ `name`。两个键空间**不互相匹配**。 */
export function keyKindOf(value) {
  return looksLikeAbsolutePath(value) ? 'path' : 'name';
}

/**
 * 把键收敛成可比较的规范形：`{ kind, key }`（比较时再忽略大小写）。
 * 空 / 非法 ⇒ `null`。
 */
export function canonicalKey(value) {
  if (typeof value !== 'string') return null;
  const kind = keyKindOf(value);
  if (kind === 'path') {
    const key = normalizePathKey(value);
    return key === null ? null : { kind, key };
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : { kind, key: trimmed };
}

function sameCanonicalKey(a, b) {
  return a.kind === b.kind && a.key.toLowerCase() === b.key.toLowerCase();
}

/** 组名是否合法：非空、≤40 字符、无控制字符。 */
export function isValidGroupName(name) {
  if (typeof name !== 'string') return { ok: false, error: '组名不是字符串' };
  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, error: '组名为空' };
  if (trimmed.length > MAX_GROUP_NAME) return { ok: false, error: `组名过长（>${MAX_GROUP_NAME} 字符）` };
  if (/[\r\n\t]/.test(trimmed)) return { ok: false, error: '组名里不允许控制字符' };
  return { ok: true, name: trimmed };
}

/** 在状态里找**已存的那个键**（保留户主写的大小写 / 形态），未命中返回 null。 */
function objectsOf(state) {
  return state?.objects ?? state?.harnesses ?? {};
}

function findStoredKey(state, value) {
  const want = canonicalKey(value);
  if (want === null) return null;
  for (const key of Object.keys(objectsOf(state))) {
    const have = canonicalKey(key);
    if (have !== null && sameCanonicalKey(have, want)) return key;
  }
  return null;
}

function normalizeGroups(raw) {
  const groups = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return groups;
  for (const [name, cell] of Object.entries(raw)) {
    const valid = isValidGroupName(name);
    if (!valid.ok) continue;
    const entry = cell !== null && typeof cell === 'object' && !Array.isArray(cell) ? cell : {};
    groups[valid.name] = {
      note: typeof entry.note === 'string' ? entry.note : '',
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
    };
  }
  return groups;
}

/**
 * 把任意 JSON 收敛成合法状态（v1 → v2 迁移在这里）。
 * 多出来的字段丢弃，缺的补默认；**不丢级别、不丢组名**。
 */
/** 档（模板）原样保留 —— 深归一化交给 profiles.js 的 normalizeProfile（单一真身）。 */
function copyProfiles(raw) {
  const out = {};
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof key !== 'string' || key.trim() === '') continue;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
      out[key.trim()] = {
        label: typeof value.label === 'string' ? value.label : '',
        mode: typeof value.mode === 'string' ? value.mode : 'sealed',
        allow: Array.isArray(value.allow) ? value.allow.filter((e) => e && typeof e === 'object') : [],
        network: value.network === 'deny' ? 'deny' : 'allow',
        unknownTool: value.unknownTool === 'deny' ? 'deny' : 'allow',
      };
    }
  }
  return out;
}

/** 会话 → 档名 的绑定表（值是档名；空/非法丢弃）。 */
function copySessionOverrides(raw) {
  const out = {};
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof key !== 'string' || key.trim() === '') continue;
      if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim();
    }
  }
  return out;
}

export function normalizeState(raw) {
  const base = emptyState();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    const broken = { ...base, _normalizedFrom: 'not-an-object' };
    Object.defineProperty(broken, 'harnesses', { get: () => broken.objects, enumerable: false });
    return broken;
  }

  const groups = normalizeGroups(raw.groups);
  const objects = {};
  // v2 优先；v1 的容器键叫 harnesses。
  const source =
    raw.objects !== null && typeof raw.objects === 'object' && !Array.isArray(raw.objects)
      ? raw.objects
      : raw.harnesses !== null && typeof raw.harnesses === 'object' && !Array.isArray(raw.harnesses)
        ? raw.harnesses
        : null;

  if (source !== null) {
    for (const [key, entry] of Object.entries(source)) {
      if (typeof key !== 'string' || key.trim() === '') continue;
      const cell = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
      const rawLevel = typeof cell.level === 'string' ? cell.level : cell.value;
      const groupValid = typeof cell.group === 'string' ? isValidGroupName(cell.group) : { ok: false };
      const group = groupValid.ok ? groupValid.name : '';
      if (group !== '' && !groups[group]) {
        // 成员身上写了组、组表里没有 ⇒ 补齐组表（不丢归属）。
        groups[group] = { note: '', updatedAt: '' };
      }
      objects[key.trim()] = {
        level: normalizeLevel(rawLevel),
        note: typeof cell.note === 'string' ? cell.note : '',
        group,
        updatedAt: typeof cell.updatedAt === 'string' ? cell.updatedAt : '',
      };
    }
  }

  const state = {
    version: STATE_VERSION,
    _readme: README_LINE,
    defaultLevel: DEFAULT_LEVEL,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : 'unknown',
    groups,
    objects,
    profiles: copyProfiles(raw.profiles),
    sessionOverrides: copySessionOverrides(raw.sessionOverrides),
  };
  // 迁移痕迹（只读，不写盘）：供 UI 显示"旧格式已自动迁移"。
  if (raw.version !== STATE_VERSION || (raw.objects === undefined && raw.harnesses !== undefined)) {
    Object.defineProperty(state, '_migratedFrom', {
      value: raw.version === undefined ? 'v1' : `v${raw.version}`,
      enumerable: false,
    });
  }
  Object.defineProperty(state, 'harnesses', {
    get() {
      return state.objects;
    },
    enumerable: false,
    configurable: true,
  });
  return state;
}

/**
 * 读状态。**永不抛异常**，把"读不到"如实报成错误 + 全禁。
 * @param {string} filePath 状态文件路径
 */
export function readState(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return { ok: false, exists: false, state: emptyState(), error: '未配置状态文件路径（按全禁处理）' };
  }
  if (!existsSync(filePath)) {
    return { ok: true, exists: false, state: emptyState(), error: null };
  }
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    return { ok: false, exists: true, state: emptyState(), error: `状态文件读取失败：${error?.message ?? String(error)}` };
  }
  // 别的工具可能用带 BOM 的写法写过这个文件。
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.trim() === '') {
    return { ok: true, exists: true, state: emptyState(), error: null };
  }
  try {
    const raw = JSON.parse(text);
    const state = normalizeState(raw);
    return {
      ok: true,
      exists: true,
      state,
      error: null,
      migratedFrom: state._migratedFrom ?? null,
      sourceVersion: typeof raw?.version === 'number' ? raw.version : raw?.version === undefined ? 1 : null,
    };
  } catch (error) {
    return {
      ok: false,
      exists: true,
      state: emptyState(),
      error: `状态文件不是合法 JSON（按全禁处理，且不覆盖它）：${error?.message ?? String(error)}`,
    };
  }
}

/** 写状态（原子替换 · 无 BOM · 只写 v2 形状）。 */
export function writeState(filePath, state, now) {
  const normalized = normalizeState(state);
  const payload = {
    version: STATE_VERSION,
    _readme: README_LINE,
    defaultLevel: DEFAULT_LEVEL,
    updatedAt: nowIso(now),
    updatedBy: typeof state?.updatedBy === 'string' && state.updatedBy !== '' ? state.updatedBy : 'gui',
    groups: normalized.groups,
    objects: normalized.objects,
    profiles: normalized.profiles,
    sessionOverrides: normalized.sessionOverrides,
  };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, filePath);
  return { ok: true, path: filePath, bytes: Buffer.byteLength(text, 'utf8'), state: payload };
}

/** 文件不存在则建一份"全禁"的（幂等 · 失败只报不抛）。 */
export function ensureStateFile(filePath, now) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return { created: false, error: '未配置状态文件路径' };
  }
  if (existsSync(filePath)) return { created: false, error: null };
  try {
    writeState(filePath, emptyState(now), now);
    return { created: true, error: null };
  } catch (error) {
    return { created: false, error: `状态文件创建失败：${error?.message ?? String(error)}` };
  }
}

/**
 * 取某键的级别。**大小写不敏感**（Windows 路径 / 目录名都不区分大小写）。
 * 键可以是**名字**（`Zcode`）也可以是**绝对路径**（`E:\资料\合作档案`）——
 * 路径会先做同样的归一化再比；两类键**不会互相命中**。
 */
export function levelOf(state, key) {
  const stored = findStoredKey(state, key);
  if (stored === null) return normalizeLevel(state?.defaultLevel);
  return normalizeLevel(objectsOf(state)[stored]?.level);
}

/** 返回命中的**存储键**（保留户主写的大小写），未命中返回 null。 */
export function findEntryKey(state, key) {
  return findStoredKey(state, key);
}

/** 取某键的组名（未分组 / 未命中 ⇒ ''）。 */
export function groupOf(state, key) {
  const stored = findStoredKey(state, key);
  if (stored === null) return '';
  const group = objectsOf(state)[stored]?.group;
  return typeof group === 'string' ? group : '';
}

/**
 * 生成改级别后的**新**状态对象（不改原对象；调用方负责落盘）。
 * @param {object} state 当前状态
 * @param {string} key 受管对象键：名字（D 根目录名）或**绝对路径**
 * @param {string} level deny | read | full
 */
export function withLevel(state, key, level, options = {}) {
  const base = normalizeState(state);
  const want = canonicalKey(key);
  if (want === null) {
    return { ok: false, error: '缺少受管对象键（名字或绝对路径）', state: base };
  }
  if (!LEVELS.includes(level)) {
    return { ok: false, error: `级别不合法：${String(level)}（只接受 deny / read / full）`, state: base };
  }
  const stored = findStoredKey(base, key) ?? want.key;
  const cell = base.objects[stored] ?? {};
  base.objects[stored] = {
    level,
    note: typeof options.note === 'string' ? options.note : typeof cell.note === 'string' ? cell.note : '',
    group: typeof cell.group === 'string' ? cell.group : '',
    updatedAt: nowIso(options.now),
  };
  base.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  base.updatedAt = nowIso(options.now);
  return { ok: true, state: base, key: stored, level, kind: want.kind };
}

/**
 * 生成"把对象移到某组"后的新状态（组不存在则自动建）。
 * `group` 传空串 = 取消分组。
 */
export function withGroup(state, key, group, options = {}) {
  const base = normalizeState(state);
  const want = canonicalKey(key);
  if (want === null) return { ok: false, error: '缺少受管对象键（名字或绝对路径）', state: base };
  let name = '';
  if (typeof group === 'string' && group.trim() !== '') {
    const valid = isValidGroupName(group);
    if (!valid.ok) return { ok: false, error: valid.error, state: base };
    name = valid.name;
    if (!base.groups[name]) base.groups[name] = { note: '', updatedAt: nowIso(options.now) };
  }
  const stored = findStoredKey(base, key) ?? want.key;
  const cell = base.objects[stored] ?? { level: DEFAULT_LEVEL, note: '', updatedAt: '' };
  base.objects[stored] = { ...cell, group: name, updatedAt: nowIso(options.now) };
  base.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  base.updatedAt = nowIso(options.now);
  return { ok: true, state: base, key: stored, group: name };
}

/**
 * 生成"新建空组"后的新状态（还没有成员；之后用 withGroup 把对象放进去）。
 * 已存在同名组 ⇒ 报错（不静默覆盖备注）。
 */
export function withNewGroup(state, group, options = {}) {
  const base = normalizeState(state);
  const valid = isValidGroupName(group);
  if (!valid.ok) return { ok: false, error: valid.error, state: base };
  if (base.groups[valid.name]) return { ok: false, error: `组「${valid.name}」已存在`, state: base };
  const stamp = nowIso(options.now);
  base.groups[valid.name] = {
    note: typeof options.note === 'string' ? options.note : '',
    updatedAt: stamp,
  };
  base.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  base.updatedAt = stamp;
  return { ok: true, state: base, group: valid.name };
}

/**
 * 组级一键切：把组内所有对象设为同一级。
 * @returns {{ok:boolean,state:object,group:string,level:string,keys:string[],error?:string}}
 */
export function withGroupLevel(state, group, level, options = {}) {
  const base = normalizeState(state);
  const valid = isValidGroupName(group);
  if (!valid.ok) return { ok: false, error: valid.error, state: base, keys: [] };
  if (!LEVELS.includes(level)) {
    return { ok: false, error: `级别不合法：${String(level)}（只接受 deny / read / full）`, state: base, keys: [] };
  }
  const keys = Object.keys(base.objects).filter((key) => base.objects[key]?.group === valid.name);
  if (keys.length === 0) {
    return { ok: false, error: `组「${valid.name}」里没有成员`, state: base, keys: [] };
  }
  const stamp = nowIso(options.now);
  for (const key of keys) base.objects[key] = { ...base.objects[key], level, updatedAt: stamp };
  base.groups[valid.name] = { ...(base.groups[valid.name] ?? { note: '' }), updatedAt: stamp };
  base.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  base.updatedAt = stamp;
  return { ok: true, state: base, group: valid.name, level, keys };
}

/** 生成"删除组"后的新状态：成员保留，只清 group 字段。 */
export function withoutGroup(state, group, options = {}) {
  const base = normalizeState(state);
  const valid = isValidGroupName(group);
  if (!valid.ok) return { ok: false, error: valid.error, state: base, keys: [] };
  if (!base.groups[valid.name]) return { ok: false, error: `组「${valid.name}」不存在`, state: base, keys: [] };
  const keys = [];
  for (const key of Object.keys(base.objects)) {
    if (base.objects[key]?.group === valid.name) {
      base.objects[key] = { ...base.objects[key], group: '', updatedAt: nowIso(options.now) };
      keys.push(key);
    }
  }
  delete base.groups[valid.name];
  base.updatedAt = nowIso(options.now);
  base.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  return { ok: true, state: base, group: valid.name, keys };
}

/** 生成"删掉某个对象条目"后的新状态（名单移除时同步 prune）。 */
export function withoutObject(state, key, options = {}) {
  const base = normalizeState(state);
  const stored = findStoredKey(base, key);
  if (stored === null) return { ok: false, error: `状态里没有「${key}」`, state: base };
  delete base.objects[stored];
  base.updatedAt = nowIso(options.now);
  base.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  return { ok: true, state: base, key: stored };
}

/**
 * 清理孤儿键：状态里有、名单里没有的条目。
 * @param {Array<{kind:string,key:string}|string>} rosterKeys
 */
export function pruneState(state, rosterKeys, options = {}) {
  const base = normalizeState(state);
  const roster = (Array.isArray(rosterKeys) ? rosterKeys : [])
    .map((item) => canonicalKey(typeof item === 'string' ? item : item?.key))
    .filter((item) => item !== null);
  const removed = [];
  for (const key of Object.keys(base.objects)) {
    const have = canonicalKey(key);
    const hit = have !== null && roster.some((item) => sameCanonicalKey(item, have));
    if (!hit) {
      delete base.objects[key];
      removed.push(key);
    }
  }
  if (removed.length > 0) {
    base.updatedAt = nowIso(options.now);
    base.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  }
  return { ok: true, state: base, removed };
}

/** 组表：名字 + 成员数（给 UI / CLI）。 */
/** 新增/覆盖一个档（模板）。深归一化仍由 profiles.js 负责。 */
export function withProfile(state, name, def, options = {}) {
  const next = normalizeState(state);
  const key = String(name ?? '').trim();
  if (key === '') throw new Error('档名不能为空');
  const src = def !== null && typeof def === 'object' ? def : {};
  next.profiles[key] = {
    label: typeof src.label === 'string' ? src.label : '',
    mode: ['blocklist', 'allowlist', 'sealed'].includes(src.mode) ? src.mode : 'sealed',
    allow: Array.isArray(src.allow) ? src.allow.filter((e) => e && typeof e === 'object') : [],
    network: src.network === 'deny' ? 'deny' : 'allow',
    unknownTool: src.unknownTool === 'deny' ? 'deny' : 'allow',
  };
  next.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  return next;
}

/** 删档，并把挂在它上面的会话绑定一起清掉（避免留下指向空档的绑定）。 */
export function withoutProfile(state, name, options = {}) {
  const next = normalizeState(state);
  const key = String(name ?? '').trim();
  if (key !== '') {
    delete next.profiles[key];
    for (const [sid, bound] of Object.entries(next.sessionOverrides)) {
      if (bound === key) delete next.sessionOverrides[sid];
    }
  }
  next.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  return next;
}

/** 给某个会话挂档；name 为空 = 取消挂载（回到"只走全局名单"）。 */
export function withSessionProfile(state, sessionId, name, options = {}) {
  const next = normalizeState(state);
  const sid = String(sessionId ?? '').trim();
  if (sid === '') throw new Error('缺少会话 id');
  const key = typeof name === 'string' ? name.trim() : '';
  if (key === '') delete next.sessionOverrides[sid];
  else next.sessionOverrides[sid] = key;
  next.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  return next;
}

export function groupsOf(state) {
  const base = normalizeState(state);
  const counts = {};
  for (const cell of Object.values(base.objects)) {
    const group = typeof cell?.group === 'string' ? cell.group : '';
    if (group !== '') counts[group] = (counts[group] ?? 0) + 1;
  }
  return Object.keys(base.groups)
    .map((name) => ({ name, count: counts[name] ?? 0, note: base.groups[name]?.note ?? '', updatedAt: base.groups[name]?.updatedAt ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/**
 * 状态里列出的、但不在名单里的键
 * （显示为"状态里有但名单里没有 ⇒ 当前不受管辖"）。
 */
export function stateOnlyKeys(state, rosterKeys) {
  const roster = (Array.isArray(rosterKeys) ? rosterKeys : [])
    .map((item) => canonicalKey(typeof item === 'string' ? item : item?.key))
    .filter((item) => item !== null);
  return Object.keys(objectsOf(state)).filter((key) => {
    const have = canonicalKey(key);
    if (have === null) return true;
    return !roster.some((item) => sameCanonicalKey(item, have));
  });
}

/** 旧名（向后兼容）：语义同 `stateOnlyKeys`。 */
export const stateOnlyNames = stateOnlyKeys;
