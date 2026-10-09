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
 * 键空间（2026-10-09 起）：
 *   · 状态里的键既可以是**名字**（D 根一级目录名，如 `Zcode`），也可以是**绝对路径**
 *     （如 `E:\资料\合作档案\某项目`）。
 *   · 比较时：名字忽略大小写；路径先做同样的**归一化**（`win32.resolve` + 去尾分隔符
 *     + 盘符大写）再忽略大小写。
 *   · ⚠️ **名字键与路径键是两个键空间，永不互相匹配**（键的种类由键本身判定）。
 *
 * ⚠️ JSON 里的容器键**仍叫 `harnesses`** —— 这是**磁盘格式**，改它会让既有的
 * `门禁-授权.json` 失效（需要一次迁移）。语义上它就是"受管对象 → 级别"的映射，
 * 与名单里的名字 / 路径对象一一对应。改格式属迁移活，不随本次改名一起动。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { looksLikeAbsolutePath, normalizePathKey } from './roster.js';

/** 状态文件默认落点（户主建议位 · 供 agent / 工具侧读取）。 */
export const DEFAULT_STATE_PATH = 'D:\\.agents\\门禁-授权.json';

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

const README_LINE =
  '门禁状态 · 唯一生效依据（GUI 侧边栏「门禁」开关写入）。' +
  '未在本文件列出的键一律按 deny；本文件缺省也不代表授权，恰恰等于全禁。';

function nowIso(now) {
  const value = now instanceof Date ? now : new Date();
  return value.toISOString();
}

/** 空状态：全禁。 */
export function emptyState(now) {
  return {
    version: 1,
    _readme: README_LINE,
    defaultLevel: DEFAULT_LEVEL,
    updatedAt: nowIso(now),
    updatedBy: 'unknown',
    harnesses: {},
  };
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

/** 在状态里找**已存的那个键**（保留户主写的大小写 / 形态），未命中返回 null。 */
function findStoredKey(state, value) {
  const want = canonicalKey(value);
  if (want === null) return null;
  for (const key of Object.keys(state?.harnesses ?? {})) {
    const have = canonicalKey(key);
    if (have !== null && sameCanonicalKey(have, want)) return key;
  }
  return null;
}

/** 把任意 JSON 收敛成合法状态（多出来的字段丢弃，缺的补默认）。 */
export function normalizeState(raw) {
  const base = emptyState();
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...base, _normalizedFrom: 'not-an-object' };
  }
  const harnesses = {};
  const source = raw.harnesses;
  if (source !== null && typeof source === 'object' && !Array.isArray(source)) {
    for (const [name, entry] of Object.entries(source)) {
      if (typeof name !== 'string' || name.trim() === '') continue;
      const cell = entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
      const rawLevel = typeof cell.level === 'string' ? cell.level : cell.value;
      harnesses[name.trim()] = {
        level: normalizeLevel(rawLevel),
        note: typeof cell.note === 'string' ? cell.note : '',
        updatedAt: typeof cell.updatedAt === 'string' ? cell.updatedAt : '',
      };
    }
  }
  return {
    version: 1,
    _readme: README_LINE,
    defaultLevel: DEFAULT_LEVEL,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : base.updatedAt,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : 'unknown',
    harnesses,
  };
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
    return { ok: true, exists: true, state: normalizeState(JSON.parse(text)), error: null };
  } catch (error) {
    return {
      ok: false,
      exists: true,
      state: emptyState(),
      error: `状态文件不是合法 JSON（按全禁处理，且不覆盖它）：${error?.message ?? String(error)}`,
    };
  }
}

/** 写状态（原子替换 · 无 BOM）。 */
export function writeState(filePath, state, now) {
  const payload = {
    version: 1,
    _readme: README_LINE,
    defaultLevel: DEFAULT_LEVEL,
    updatedAt: nowIso(now),
    updatedBy: typeof state?.updatedBy === 'string' && state.updatedBy !== '' ? state.updatedBy : 'gui',
    harnesses: normalizeState(state).harnesses,
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
  return normalizeLevel(state?.harnesses?.[stored]?.level);
}

/** 返回命中的**存储键**（保留户主写的大小写），未命中返回 null。 */
export function findEntryKey(state, key) {
  return findStoredKey(state, key);
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
  const cell = base.harnesses[stored] ?? {};
  base.harnesses[stored] = {
    level,
    note: typeof options.note === 'string' ? options.note : typeof cell.note === 'string' ? cell.note : '',
    updatedAt: nowIso(options.now),
  };
  base.updatedBy = typeof options.by === 'string' && options.by !== '' ? options.by : 'gui';
  base.updatedAt = nowIso(options.now);
  return { ok: true, state: base, key: stored, level, kind: want.kind };
}

/**
 * 状态里列出的、但不在名单里的键
 * （显示为"状态里有但名单里没有 ⇒ 当前不受管辖"）。
 * @param {object} state
 * @param {Array<{kind:string,key:string}|string>} rosterKeys 名单对象（或键字符串）
 */
export function stateOnlyKeys(state, rosterKeys) {
  const roster = (Array.isArray(rosterKeys) ? rosterKeys : [])
    .map((item) => canonicalKey(typeof item === 'string' ? item : item?.key))
    .filter((item) => item !== null);
  return Object.keys(state?.harnesses ?? {}).filter((key) => {
    const have = canonicalKey(key);
    if (have === null) return true;
    return !roster.some((item) => sameCanonicalKey(item, have));
  });
}

/** 旧名（向后兼容）：语义同 `stateOnlyKeys`。 */
export const stateOnlyNames = stateOnlyKeys;
