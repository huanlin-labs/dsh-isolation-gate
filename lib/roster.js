/**
 * 门禁 · 名单读写（受管对象名单）
 *
 * 名单文件：`D:\.agents\门禁-名单.txt`（**体系资产**）。一行一个**受管对象**，
 * `#` 开头为注释。一行可以是两类受管对象：
 *
 *   · `{ kind: 'name' }` —— **名字**（旧行为）：D 根下一级目录名，如 `Zcode`
 *     ⇒ 键 = 名字本身（沿用 `isValidName` 校验）。
 *   · `{ kind: 'path' }` —— **绝对路径**（新能力）：任意绝对路径，如
 *     `D:\Zcode`、`E:\资料\合作档案\某项目`
 *     ⇒ 键 = 归一化绝对路径（`win32.resolve` + 去尾分隔符 + 统一盘符大写）。
 *
 * 判定见 `guard.js`：给 path 时**先按路径段做最长前缀命中**匹配路径对象，
 * 落空才退回"取盘根一级目录名"匹配名字对象。**名字键与路径键是两个键空间，
 * 永不互相匹配**（`store.js` 的级别查询同理）。
 *
 * 纪律：
 *   · **读**名单随时可以；读不到 ⇒ `ok:false`，调用方按"一律拒绝"处理（见 guard 的 fail-closed）。
 *   · **写**名单只允许"界面里已给出差异提示 + 户主点了按钮"这一条路径 ⇒ 本模块
 *     只提供"改哪一行"的纯函数，落盘动作由**宿主半的路由**执行。
 *   · 写之前**必须备份**到 `D:\回收站\`（房规）。备份失败 ⇒ 不写。
 *   · 改名单时**逐行保留原文件**（注释头、行序、空行都不动），只增/删那一行。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';

/** 名单默认落点（唯一权威 · 与规则正本一致）。 */
const LEGACY_AGENTS_DIR = 'D:\\\\.agents';
const AGENTS_DIR = process.platform === 'win32' && existsSync(LEGACY_AGENTS_DIR) ? LEGACY_AGENTS_DIR : join(process.env.USERPROFILE || process.env.HOME || ".", '.agents');
export const DEFAULT_ROSTER_PATH = join(AGENTS_DIR, '门禁-名单.txt');

/** 名单改动前的备份根（房规：一切备份进 `D:\回收站\`）。 */
export const DEFAULT_BACKUP_DIR = 'D:\\回收站\\门禁-名单改前';

/** 两类受管对象。 */
export const OBJECT_KINDS = ['name', 'path'];

/**
 * 合法的名字：D 根下的一级目录名。
 * 拒绝路径分隔符 / 通配符 / 相对名 / 盘符 —— 名字类只该有"纯名字"。
 */
export function isValidName(name) {
  if (typeof name !== 'string') return { ok: false, error: '名字不是字符串' };
  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, error: '名字为空' };
  if (trimmed.length > 64) return { ok: false, error: '名字过长（>64 字符）' };
  if (/[\\/:*?"<>|]/.test(trimmed)) return { ok: false, error: '名字里不允许出现路径分隔符或通配符' };
  if (trimmed === '.' || trimmed === '..') return { ok: false, error: '名字不能是 . 或 ..' };
  if (/[\r\n\t]/.test(trimmed)) return { ok: false, error: '名字里不允许控制字符' };
  return { ok: true, name: trimmed };
}

const DRIVE_ROOT = /^([A-Za-z]):[\\/]*$/;

/**
 * 归一化绝对路径键：`win32.resolve`（顺带展开 `.` / `..`）→ 去尾分隔符 → 盘符大写。
 * **不改路径段本身的大小写**（保留户主写的样子；比较时再忽略大小写）。
 * 非法 / 非绝对 ⇒ 返回 `null`。
 */
export function normalizePathKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || !win32.isAbsolute(trimmed)) return null;
  let resolved = win32.resolve(trimmed);
  const rootHit = DRIVE_ROOT.exec(resolved);
  if (rootHit) return `${rootHit[1].toUpperCase()}:\\`;
  resolved = resolved.replace(/[\\/]+$/, '');
  const drive = /^([A-Za-z]):/.exec(resolved);
  if (drive) resolved = `${drive[1].toUpperCase()}${resolved.slice(1)}`;
  return resolved;
}

/** 这个字符串是不是"绝对路径"形态的键（用于区分两类键空间）。 */
export function looksLikeAbsolutePath(value) {
  return typeof value === 'string' && value.trim() !== '' && win32.isAbsolute(value.trim());
}

/**
 * 合法的路径键：必须是**绝对路径**。
 * 拒绝通配符 / 控制字符；长度上限 320；归一化失败即拒。
 */
export function isValidPath(value) {
  if (typeof value !== 'string') return { ok: false, error: '路径不是字符串' };
  const trimmed = value.trim();
  if (trimmed === '') return { ok: false, error: '路径为空' };
  if (!win32.isAbsolute(trimmed)) return { ok: false, error: '不是绝对路径（需要形如 <盘符>:\\… ）' };
  if (/[\r\n\t]/.test(trimmed)) return { ok: false, error: '路径里不允许控制字符' };
  if (/[*?"<>|]/.test(trimmed)) return { ok: false, error: '路径里不允许通配符或非法字符（* ? " < > |）' };
  const key = normalizePathKey(trimmed);
  if (key === null) return { ok: false, error: '路径归一化失败' };
  if (key.length > 320) return { ok: false, error: '路径过长（>320 字符）' };
  return { ok: true, key, path: key };
}

/** 名字 → 对象（非法返回 null）。 */
export function objectForName(name) {
  const valid = isValidName(name);
  return valid.ok ? { kind: 'name', key: valid.name, raw: valid.name } : null;
}

/** 路径 → 对象（非法返回 null）。 */
export function objectForPath(value) {
  const valid = isValidPath(value);
  return valid.ok
    ? { kind: 'path', key: valid.key, raw: typeof value === 'string' ? value.trim() : String(value) }
    : null;
}

/** 两个对象是否是同一个受管对象（**同 kind** + 键忽略大小写相等）。 */
export function sameObject(a, b) {
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (typeof a.key !== 'string' || typeof b.key !== 'string') return false;
  return a.key.toLowerCase() === b.key.toLowerCase();
}

/** 对象列表里有没有这一个（同 kind + 键相等）。 */
export function hasObject(objects, candidate) {
  return (Array.isArray(objects) ? objects : []).some((object) => sameObject(object, candidate));
}

function isComment(line) {
  return /^\s*#/.test(line);
}

/** 从"行数组"里取非注释非空行的**原文**（不做种类判定；旧调用方兼容用）。 */
export function namesFromLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .filter((line) => typeof line === 'string' && !isComment(line) && line.trim() !== '')
    .map((line) => line.trim());
}

/**
 * 行数组 → 受管对象数组。
 *
 * 判据（与任务卡一致）：一行若非注释 / 空行 ——
 *   · 含盘符或路径分隔符**且** `win32.isAbsolute()` 为真 ⇒ 路径对象（`isValidPath` 校验）；
 *   · 否则按旧规则当名字（`isValidName` 校验）。
 * 校验不过的行**不静默丢弃** —— 收进 `invalid`，由界面 / CLI 如实报出来。
 */
export function parseRosterLines(lines) {
  const objects = [];
  const invalid = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    if (typeof raw !== 'string' || isComment(raw) || raw.trim() === '') continue;
    const trimmed = raw.trim();
    const pathShaped = /[\\/]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed);
    if (pathShaped && win32.isAbsolute(trimmed)) {
      const valid = isValidPath(trimmed);
      if (!valid.ok) {
        invalid.push({ raw: trimmed, kind: 'path', error: valid.error });
        continue;
      }
      objects.push({ kind: 'path', key: valid.key, raw: trimmed });
      continue;
    }
    const valid = isValidName(trimmed);
    if (!valid.ok) {
      invalid.push({ raw: trimmed, kind: 'name', error: valid.error });
      continue;
    }
    objects.push({ kind: 'name', key: valid.name, raw: trimmed });
  }
  return { objects, invalid };
}

function duplicateKeys(objects) {
  const seen = new Set();
  const duplicates = [];
  for (const object of objects) {
    const id = `${object.kind}:${object.key.toLowerCase()}`;
    if (seen.has(id)) duplicates.push(object.key);
    else seen.add(id);
  }
  return duplicates;
}

/**
 * 读名单。永不抛异常。
 *
 * ⚠️ **fail-closed 的源头**：文件不存在 / 读不动 ⇒ `ok:false`（含 `exists:false`）。
 * 调用方（`guard.checkAccess`）见到 `ok:false` 必须**一律拒绝**，而不是"放行一切"。
 *
 * 返回 `{ ok, exists, lines, names, objects, invalid, duplicates, error }`：
 *   · `names` = **名字类**对象的键数组（向后兼容旧调用方）；
 *   · `objects` = `[{ kind, key, raw }]`（两类都有，权威）。
 */
export function readRoster(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return {
      ok: false,
      exists: false,
      lines: [],
      names: [],
      objects: [],
      invalid: [],
      duplicates: [],
      error: '未配置名单文件路径（按"一律拒绝"处理）',
    };
  }
  if (!existsSync(filePath)) {
    return {
      ok: false,
      exists: false,
      lines: [],
      names: [],
      objects: [],
      invalid: [],
      duplicates: [],
      error: `名单文件不存在：${filePath}（按"一律拒绝"处理，请先恢复名单文件）`,
    };
  }
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      exists: true,
      lines: [],
      names: [],
      objects: [],
      invalid: [],
      duplicates: [],
      error: `名单读取失败：${error?.message ?? String(error)}（按"一律拒绝"处理）`,
    };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  // 末尾换行产生的空串不影响语义，但会干扰"追加位置"，这里去掉尾部空行。
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const { objects, invalid } = parseRosterLines(lines);
  const names = objects.filter((object) => object.kind === 'name').map((object) => object.key);
  return {
    ok: true,
    exists: true,
    lines,
    names,
    objects,
    invalid,
    duplicates: duplicateKeys(objects),
    error: null,
  };
}

/** 名字是否已在名单里（大小写不敏感 · 只比名字）。 */
export function rosterHas(names, name) {
  const want = String(name ?? '').trim().toLowerCase();
  return (names ?? []).some((n) => String(n).toLowerCase() === want);
}

/**
 * 生成"加入一行"后的新行数组（不改原数组；已存在则如实报重复）。
 * 名字与绝对路径都接受（种类由行本身决定）。
 */
export function addObjectToLines(lines, raw) {
  const parsed = parseRosterLines([raw]);
  const candidate = parsed.objects[0];
  if (!candidate) {
    const reason = parsed.invalid[0]?.error ?? '既不是合法的名字，也不是合法的绝对路径';
    return { ok: false, error: `「${String(raw ?? '').trim()}」不合法：${reason}` };
  }
  const current = Array.isArray(lines) ? [...lines] : [];
  if (hasObject(parseRosterLines(current).objects, candidate)) {
    return { ok: false, error: `「${candidate.key}」已在名单里`, lines: current, duplicate: true };
  }
  current.push(raw.trim());
  return { ok: true, lines: current, name: candidate.key, key: candidate.key, kind: candidate.kind, object: candidate };
}

/** 生成"移除一行"后的新行数组（不改原数组；不存在则如实报缺失）。 */
export function removeObjectToLines(lines, raw) {
  const parsed = parseRosterLines([raw]);
  const candidate = parsed.objects[0];
  if (!candidate) {
    const reason = parsed.invalid[0]?.error ?? '既不是合法的名字，也不是合法的绝对路径';
    return { ok: false, error: `「${String(raw ?? '').trim()}」不合法：${reason}` };
  }
  const current = Array.isArray(lines) ? [...lines] : [];
  let removed = false;
  const next = current.filter((line) => {
    if (typeof line !== 'string' || isComment(line) || line.trim() === '') return true;
    if (parseRosterLines([line]).objects.some((object) => sameObject(object, candidate))) {
      removed = true;
      return false;
    }
    return true;
  });
  if (!removed) return { ok: false, error: `「${candidate.key}」不在名单里`, lines: current, missing: true };
  return { ok: true, lines: next, name: candidate.key, key: candidate.key, kind: candidate.kind, object: candidate };
}

/** 名字专用入口（向后兼容：旧调用方只懂名字）。 */
export function addNameToLines(lines, name) {
  const valid = isValidName(name);
  if (!valid.ok) return { ok: false, error: valid.error };
  return addObjectToLines(lines, valid.name);
}

/** 名字专用入口（向后兼容：旧调用方只懂名字）。 */
export function removeNameFromLines(lines, name) {
  const valid = isValidName(name);
  if (!valid.ok) return { ok: false, error: valid.error };
  return removeObjectToLines(lines, valid.name);
}

function stamp(now) {
  const d = now instanceof Date ? now : new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * 备份名单（改前必做）。失败即返回 ok:false，调用方**不得**继续写。
 * @param {string} filePath 源文件
 * @param {string} backupDir 备份目录
 */
export function backupRoster(filePath, backupDir = DEFAULT_BACKUP_DIR, now) {
  if (!existsSync(filePath)) return { ok: true, skipped: true, reason: '原文件不存在（新建即无内容可备份）', backup: null };
  try {
    mkdirSync(backupDir, { recursive: true });
    const backup = join(backupDir, `门禁-名单.${stamp(now)}.txt`);
    copyFileSync(filePath, backup);
    return { ok: true, skipped: false, backup };
  } catch (error) {
    return { ok: false, skipped: false, backup: null, error: `备份失败，已中止改名单：${error?.message ?? String(error)}` };
  }
}

/**
 * 落盘名单：备份 → 原子替换写新内容（无 BOM）。
 * @param {string} filePath 名单路径
 * @param {string[]} lines 完整行数组
 */
export function writeRoster(filePath, lines, options = {}) {
  const backupDir = options.backupDir ?? DEFAULT_BACKUP_DIR;
  const backup = backupRoster(filePath, backupDir, options.now);
  if (!backup.ok) return { ok: false, error: backup.error, backup: null };
  const text = `${(Array.isArray(lines) ? lines : []).join('\r\n')}\r\n`;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    /* 目录已存在或无权创建：交给下面 writeFileSync 报错 */
  }
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, filePath);
  } catch (error) {
    return { ok: false, error: `名单写入失败：${error?.message ?? String(error)}`, backup: backup.backup, bytes: 0 };
  }
  return { ok: true, backup: backup.backup, bytes: Buffer.byteLength(text, 'utf8'), path: filePath };
}
