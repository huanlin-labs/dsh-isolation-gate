/**
 * 门禁 · 工具执行门（`ctx.tools.guard` 的判定层）
 *
 * 目的：把"受管对象三级"从**通道层**推进到**工具执行层** —— 模型调用
 * `read / write / edit / grep / glob / bash / pwsh …` 时，在工具真正执行前判定。
 *
 * 判定仍是 `guard.checkAccess` 一套（三级 × 四操作），本文件只负责两件事：
 *   ① 从工具名 + 参数里**认出**要碰哪些路径、各是读 / 写 / 删；
 *   ② 把一次工具调用拆成若干 `{ op, path }` 目标（可多目标）。
 *
 * 诚实边界（README 必须同步写）：
 *   · 只覆盖**宿主工具调用**；raw fs / 独立进程 / 其他程序直接读写**拦不住**。
 *   · shell 是**文本启发式**：`cd` + 相对路径、命令替换、变量间接、编码、符号链接
 *     都可能绕过（与同类实现同一层级的已知限制）。
 *   · 认不出的命令**不静默放行**：只要命令文本里出现受管绝对路径，就按"写"判定
 *     （只在 full 级放行）—— 宁可误拒，不可漏放。
 *
 * 纯函数、无 I/O —— 自测可直接调。
 */

import { win32 } from 'node:path';

/** 参数里可能装路径的键（任意嵌套深度都会看，深度上限 8）。 */
export const PATH_KEYS = new Set([
  'path',
  'paths',
  'file',
  'files',
  'file_path',
  'filePath',
  'filename',
  'dir',
  'dirs',
  'directory',
  'directories',
  'cwd',
  'workspace',
  'root',
  'target',
  'targets',
  'output',
  'output_path',
  'outputPath',
  'destination',
  'dest',
  'source',
  'src',
]);

/** 工具名 → 操作（认不出的工具返回 null）。 */
export const TOOL_OP = {
  read: 'read',
  read_image: 'read',
  read_file: 'read',
  list: 'traverse',
  ls: 'traverse',
  view: 'read',
  open: 'read',
  stat: 'read',
  head: 'read',
  tail: 'read',
  cat: 'read',
  grep: 'read',
  glob: 'read',
  find: 'read',
  search: 'read',
  write: 'write',
  write_file: 'write',
  edit: 'write',
  apply_patch: 'write',
  create: 'write',
  create_file: 'write',
  mkdir: 'write',
  move: 'write',
  copy: 'write',
  rename: 'write',
  delete: 'delete',
  remove: 'delete',
  rmdir: 'delete',
  unlink: 'delete',
};

/** 命令词 → 操作。 */
const CMD_OP = {
  // 读
  cat: 'read',
  type: 'read',
  more: 'read',
  less: 'read',
  head: 'read',
  tail: 'read',
  dir: 'read',
  ls: 'read',
  'get-childitem': 'read',
  'get-content': 'read',
  gc: 'read',
  findstr: 'read',
  'select-string': 'read',
  where: 'read',
  'get-item': 'read',
  stat: 'read',
  file: 'read',
  du: 'read',
  tree: 'read',
  cd: 'traverse',
  pushd: 'traverse',
  popd: 'traverse',
  pwd: 'traverse',
  echo: 'read',
  'write-output': 'read',
  // 写
  cp: 'write',
  copy: 'write',
  'copy-item': 'write',
  mv: 'write',
  move: 'write',
  'move-item': 'write',
  ren: 'write',
  rename: 'write',
  'rename-item': 'write',
  mkdir: 'write',
  md: 'write',
  'new-item': 'write',
  ni: 'write',
  touch: 'write',
  'set-content': 'write',
  sc: 'write',
  'out-file': 'write',
  tee: 'write',
  'tee-object': 'write',
  'add-content': 'write',
  ac: 'write',
  robocopy: 'write',
  xcopy: 'write',
  tar: 'write',
  unzip: 'write',
  'expand-archive': 'write',
  sed: 'write',
  perl: 'write',
  // 删
  rm: 'delete',
  del: 'delete',
  erase: 'delete',
  rmdir: 'delete',
  rd: 'delete',
  'remove-item': 'delete',
  ri: 'delete',
  unlink: 'delete',
  'clear-content': 'delete',
  clc: 'delete',
  shred: 'delete',
  format: 'delete',
};

/** 管道解释器（`curl x | sh` 的右侧）：把它当执行，按未知命令处理（偏严）。 */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'pwsh', 'powershell', 'cmd', 'node', 'python', 'python3', 'pwsh7']);

/** 我们的受管辖通道：由它自己判定，工具门不重复扫（否则 `gate.mjs read --path …` 会被误杀）。 */
export function isOwnChannelCommand(command) {
  if (typeof command !== 'string') return false;
  if (!/gate\.mjs/i.test(command)) return false;
  return /\b(status|policy|check|traverse|read|write|delete|rmdir|log)\b/i.test(command) || /--help|-h\b/i.test(command);
}

/** 绝对路径判定（Windows 盘符 / UNC）。 */
export function isAbsolutePathToken(token) {
  if (typeof token !== 'string') return false;
  const value = token.trim().replace(/^['"`]|['"`]$/g, '');
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value);
}

function stripQuotes(value) {
  return String(value).replace(/^['"`]|['"`]$/g, '');
}

/** 把 `--path=D:\x` / `-Path:D:\x` 拆成 `D:\x`。 */
function pathFromToken(token) {
  const cleaned = stripQuotes(token);
  const eq = cleaned.indexOf('=');
  if (eq > 0) {
    const right = cleaned.slice(eq + 1);
    if (isAbsolutePathToken(right)) return right;
  }
  const colon = cleaned.indexOf(':');
  if (colon > 1 && isAbsolutePathToken(cleaned.slice(colon + 1))) return cleaned.slice(colon + 1);
  return isAbsolutePathToken(cleaned) ? cleaned : null;
}

/** 简单分词：按空白切，尊重单 / 双引号。 */
export function tokenize(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

/** 按控制符拆段（保留 `|` 的段界；每段独立判定）。 */
export function splitSegments(command) {
  return String(command)
    .split(/\r?\n|&&|\|\||;|\|/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function resolveMaybeRelative(token, cwd) {
  const cleaned = stripQuotes(token);
  if (isAbsolutePathToken(cleaned)) return cleaned;
  if (cwd && /^[^<>|&]+$/.test(cleaned) && !/^-/.test(cleaned) && /[\\/]/.test(cleaned)) {
    return win32.resolve(cwd, cleaned);
  }
  return null;
}

/**
 * 从一条 shell 命令里认出 `{op, path}` 目标。
 * @param {string} command
 * @returns {Array<{op:string,path:string,via:string}>}
 */
export function classifyShell(command) {
  if (typeof command !== 'string' || command.trim() === '') return [];
  if (isOwnChannelCommand(command)) return [];

  const targets = [];
  let cwd = null;
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;

    // 重定向目标 = 写
    for (let i = 0; i < tokens.length; i += 1) {
      if (/^\d?>>?$/.test(tokens[i])) {
        const next = tokens[i + 1];
        const path = next ? pathFromToken(next) ?? resolveMaybeRelative(next, cwd) : null;
        if (path) targets.push({ op: 'write', path, via: 'redirect' });
      }
    }

    let index = 0;
    // 跳过 `sudo` / `&` 之类前缀
    while (index < tokens.length && /^[&]$|^sudo$/i.test(tokens[index])) index += 1;
    const rawCmd = tokens[index] ?? '';
    const cmd = stripQuotes(rawCmd).toLowerCase().replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat|ps1)$/, '');
    if (cmd === '') continue;

    // `bash -c "..."` / `pwsh -Command "..."`：递归看里面的命令
    if (SHELLS.has(cmd)) {
      const cIndex = tokens.findIndex((token) => /^-(c|command)$/i.test(token));
      if (cIndex >= 0 && tokens[cIndex + 1]) {
        targets.push(...classifyShell(tokens.slice(cIndex + 1).join(' ')));
        continue;
      }
    }

    let op = CMD_OP[cmd] ?? null;
    const pathTokens = tokens.slice(index + 1).map(pathFromToken).filter(Boolean);
    const relativePaths = tokens
      .slice(index + 1)
      .map((token) => resolveMaybeRelative(token, cwd))
      .filter(Boolean);

    if (cmd === 'cd' || cmd === 'pushd') {
      const next = pathTokens[0] ?? relativePaths[0] ?? null;
      if (next) {
        cwd = isAbsolutePathToken(next) ? next : win32.resolve(cwd ?? '.', next);
        targets.push({ op: 'traverse', path: cwd, via: 'cd' });
      }
      continue;
    }

    if (cmd === 'echo' && targets.some((t) => t.via === 'redirect')) continue;

    if (op === null) op = 'write'; // 未知命令 + 受管路径 ⇒ 按写处理（偏严）

    for (const path of [...pathTokens, ...relativePaths]) {
      targets.push({ op, path, via: `cmd:${cmd}` });
    }
  }
  return targets;
}

/** 递归收集参数里的路径（按 PATH_KEYS）。 */
export function collectArgumentPaths(value, depth = 0, key = null, out = []) {
  if (depth > 8 || value === null || value === undefined) return out;
  if (typeof value === 'string') {
    if (key !== null && PATH_KEYS.has(key) && value.trim() !== '') out.push(value.trim());
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectArgumentPaths(item, depth + 1, key, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) collectArgumentPaths(child, depth + 1, childKey, out);
  }
  return out;
}

/**
 * 一次工具调用的完整判定输入。
 * @returns {{tool:string, targets:Array<{op:string,path:string,via:string}>, shell:boolean, unknownTool:boolean}}
 */
export function collectTargets(toolName, args) {
  const tool = typeof toolName === 'string' ? toolName : '';
  const shellNames = new Set(['bash', 'pwsh', 'shell', 'terminal', 'run_command', 'exec', 'execute']);
  const shell = shellNames.has(tool);
  const targets = [];

  if (shell) {
    const command =
      args && typeof args === 'object'
        ? args.command ?? args.cmd ?? args.script ?? args.command_line ?? args.commandLine ?? ''
        : '';
    targets.push(...classifyShell(typeof command === 'string' ? command : ''));
    // shell 工具的参数里也可能直接给了 cwd
    for (const path of collectArgumentPaths(args).filter((p) => !targets.some((t) => t.path === p))) {
      targets.push({ op: 'traverse', path, via: 'arg' });
    }
    return { tool, targets: dedupe(targets), shell, unknownTool: false };
  }

  let op = TOOL_OP[tool] ?? null;
  // str_replace_editor 的 command 决定读还是写
  if (tool === 'str_replace_editor' && args && typeof args === 'object') {
    const command = String(args.command ?? '').toLowerCase();
    op = command === 'view' ? 'read' : 'write';
  }
  if (op === null) {
    // 未登记的工具：只要参数里出现受管路径，就按写处理（偏严，避免漏放）
    const paths = collectArgumentPaths(args);
    return {
      tool,
      targets: dedupe(paths.map((path) => ({ op: 'write', path, via: 'unknown-tool' }))),
      shell,
      unknownTool: true,
    };
  }
  for (const path of collectArgumentPaths(args)) targets.push({ op, path, via: 'arg' });
  return { tool, targets: dedupe(targets), shell, unknownTool: false };
}

function dedupe(targets) {
  const seen = new Set();
  const out = [];
  for (const target of targets) {
    const id = `${target.op}|${String(target.path).toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(target);
  }
  return out;
}
