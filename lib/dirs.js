/**
 * 门禁 · 名单 ↔ 磁盘 的差异计算（**只对名字类受管对象**）
 *
 * 🔴 纪律（任务卡 §五 红线，对本模块同样生效）：
 *   本模块**只碰目录名与存在性** —— 对隔离区**永不**读取目录内部内容、不 stat 子项、
 *   不读文件。实现上只有两个动作：
 *     ① `readdirSync(root, { withFileTypes: true })` 取 **D 根一层**目录名（不递归）；
 *     ② 对"符号链接/junction"这类 Dirent 判不出类型的条目，做**一次目录存在性判定**。
 *   ⇒ 面板能报出"名单里有、盘上没"和"盘上有、名单没"，但**没有任何一个字节来自隔离区内部**。
 *
 * 注意：**路径类**受管对象不参与这份"盘根一层目录"比对（它们可以指向任意深度），
 * 由 `service.buildReport` 单独做一次"目录存在 / 不存在"判定。
 *
 * 差异提示口径：
 *   · `roster-missing-dir`  → 「已在名单但目录不存在」（疑似笔误 / 已删 / 盘未挂）
 *   · `dir-not-listed`      → 「目录存在但未入名单」
 *   · `dir-not-listed-suspect` → 同上，且名字**疑似另一个 harness 的家**（命中名谱）
 *   · `ok`                  → 名单与磁盘一致
 *   · `case-mismatch`       → 名字都在，但大小写不一致（名单 `Zcode` / 目录 `zcode`）
 */

import { existsSync, readdirSync, statSync } from 'node:fs';

/** 扫描的盘根默认值。 */
export const DEFAULT_ROOT =
  process.platform === 'win32'
    ? existsSync('D:\\\\.agents')
      ? 'D:\\'
      : (process.env.USERPROFILE ? process.env.USERPROFILE.slice(0, 3) : 'C:\\')
    : '/';


/**
 * 疑似**受管目录**（多半是"别的 harness 的家"）的名字谱（**只比名字，不读内容**）。
 * 用途：把 D 根下"存在但未入名单"的目录里**最可能是新 harness**的那些挑出来置顶，
 * 其余照实列在折叠区里由户主自己认。可经插件 config `harnessVocabulary` 覆盖/追加。
 */
export const HARNESS_VOCABULARY = [
  'zcode',
  'opencode',
  'open-code',
  'pi',
  'codex',
  'claude',
  'claude-code',
  'cursor',
  'windsurf',
  'trae',
  'kiro',
  'cline',
  'roo',
  'roo-code',
  'aider',
  'goose',
  'amp',
  'crush',
  'gemini',
  'gemini-cli',
  'qwen',
  'qwen-code',
  'iflow',
  'continue',
  'copilot',
  'bolt',
  'devin',
  'kilo',
  'void',
  'zed',
  'augment',
  'comate',
  'tongyi',
];

/** 列在"未入名单目录"里但没有信息量的系统条目（不隐藏、只是不置顶）。 */
export const SYSTEM_DIR_HINTS = [
  '$recycle.bin',
  'system volume information',
  'node_modules',
  '.pnpm-store',
  'temp',
  'tmp',
];

function normalizeRoot(root) {
  const value = typeof root === 'string' && root.trim() !== '' ? root.trim() : DEFAULT_ROOT;
  const sep = process.platform === 'win32' ? '\\' : '/';
  return value.endsWith('\\') || value.endsWith('/') ? value : `${value}${sep}`;
}

/**
 * 列出盘根下的**一层**目录名（不递归、不读内容）。
 * @param {string} root 例如 `D:\`
 * @returns {{ok:boolean, root:string, dirs:string[], error:string|null}}
 */
export function listRootDirs(root = DEFAULT_ROOT) {
  const base = normalizeRoot(root);
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch (error) {
    return { ok: false, root: base, dirs: [], error: `无法列出 ${base}：${error?.message ?? String(error)}` };
  }
  const dirs = [];
  for (const entry of entries) {
    // 只取"是目录"或"是符号链接/junction 但指向目录"的条目 —— 目录名 + 存在性，仅此而已。
    if (entry.isDirectory()) {
      dirs.push(entry.name);
      continue;
    }
    if (entry.isSymbolicLink()) {
      try {
        if (statSync(`${base}${entry.name}`).isDirectory()) dirs.push(entry.name);
      } catch {
        /* 断链的 junction：不算目录 */
      }
    }
  }
  dirs.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  return { ok: true, root: base, dirs, error: null };
}

function hitVocabulary(name, vocabulary) {
  const want = String(name ?? '').toLowerCase();
  return (vocabulary ?? []).some((word) => String(word).toLowerCase() === want);
}

/**
 * 计算差异表。
 * @param {object} input
 * @param {string[]} input.rosterNames 名单里的名字
 * @param {string[]} input.rootDirs 盘根一层目录名
 * @param {string[]} [input.vocabulary] 疑似受管目录名谱
 */
export function diffRoster(input) {
  const rosterNames = Array.isArray(input?.rosterNames) ? input.rosterNames : [];
  const rootDirs = Array.isArray(input?.rootDirs) ? input.rootDirs : [];
  const vocabulary = Array.isArray(input?.vocabulary) && input.vocabulary.length > 0 ? input.vocabulary : HARNESS_VOCABULARY;

  const byLower = new Map();
  for (const dir of rootDirs) byLower.set(dir.toLowerCase(), dir);

  const rows = [];
  const seen = new Set();
  for (const name of rosterNames) {
    const lower = name.toLowerCase();
    seen.add(lower);
    const actual = byLower.get(lower) ?? null;
    let status = 'ok';
    if (actual === null) status = 'roster-missing-dir';
    else if (actual !== name) status = 'case-mismatch';
    rows.push({
      name,
      dirName: actual,
      source: 'roster',
      inRoster: true,
      dirExists: actual !== null,
      suspect: hitVocabulary(name, vocabulary),
      status,
      hint:
        status === 'roster-missing-dir'
          ? '已在名单但目录不存在（疑似笔误 / 已删 / 该盘未挂载）'
          : status === 'case-mismatch'
            ? `名单写的「${name}」，盘上实际是「${actual}」——大小写不一致（不影响生效，Windows 不区分）`
            : '在名单内 · 目录存在',
    });
  }

  const unlisted = [];
  for (const dir of rootDirs) {
    const lower = dir.toLowerCase();
    if (seen.has(lower)) continue;
    const suspect = hitVocabulary(dir, vocabulary);
    unlisted.push({
      name: dir,
      dirName: dir,
      source: 'disk',
      inRoster: false,
      dirExists: true,
      suspect,
      status: suspect ? 'dir-not-listed-suspect' : 'dir-not-listed',
      hint: suspect
        ? '目录存在但未入名单 —— 名字疑似受管目录（多半是另一个 harness 的家）；**未入名单 ⇒ 当前不在受管辖范围内**'
        : '目录存在但未入名单（非受管疑似的普通目录，可忽略）',
    });
  }
  unlisted.sort((a, b) => {
    if (a.suspect !== b.suspect) return a.suspect ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

  const rosterMissingDir = rows.filter((row) => row.status === 'roster-missing-dir').map((row) => row.name);
  const dirNotListedSuspect = unlisted.filter((row) => row.suspect).map((row) => row.name);
  const dirNotListed = unlisted.filter((row) => !row.suspect).map((row) => row.name);
  const caseMismatch = rows.filter((row) => row.status === 'case-mismatch').map((row) => ({
    roster: row.name,
    disk: row.dirName,
  }));

  return {
    rows,
    unlisted,
    summary: {
      rosterCount: rosterNames.length,
      rootDirCount: rootDirs.length,
      rosterMissingDir,
      dirNotListedSuspect,
      dirNotListed,
      caseMismatch,
    },
  };
}
