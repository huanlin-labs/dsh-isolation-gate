#!/usr/bin/env node
/**
 * 门禁 · 一键接线器
 *
 *   gate-setup <harness> [--write] [--home <dir>] [--project <dir>] [--backup <dir>]
 *
 * harness：claude | zcode | gemini | opencode | mcp
 * 默认只打印「要写什么、写到哪」（dry-run）；加 --write 才真正落盘。
 * 落盘前会把原文件备份到 --backup 目录（默认 <home>/gate-setup-backup/<时间戳>/）。
 *
 * 设计原则：
 *   - 只合并自己负责的那几个键，其它配置原样保留
 *   - 写 JSON 不带 BOM、先写临时文件再改名（避免写坏）
 *   - 已经配过就不重复追加（幂等）
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const argv0 = process.argv.slice(2);
if (argv0.includes('--version') || argv0.includes('-v')) {
  console.log(`dsh-isolation-gate ${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}`);
  process.exit(0);
}

const SELF = resolve(import.meta.dirname, '..');
const NODE = process.execPath;

function usage() {
  return `用法：gate-setup <claude|zcode|pi|gemini|opencode|mcp> [--write] [--home <dir>] [--project <dir>] [--backup <dir>]

  claude    写 ~/.claude/settings.json 的 hooks.PreToolUse
  gemini    写 ~/.gemini/settings.json 的 hooks.BeforeTool
  opencode  写 ~/.config/opencode/opencode.json 的 plugin 数组
  zcode     写 ~/.zcode/cli/config.json 的 hooks.events.PreToolUse（与 Claude Code 同协议）
  pi        写 ~/.pi/extensions/isolation-gate.js（转发到 gate-plugin-pi.mjs，进程内硬拦）
  doctor    体检：一次看所有 harness 的接线状态
  mcp       写 ~/.cursor/mcp.json 的 mcpServers（Cursor / Windsurf 通用形状）
  codex     写 ~/.codex/config.toml 的 mcp_servers（advisory，不能硬拦）

默认 dry-run：只打印计划，不落盘。加 --write 才写。
加 --verify 只体检：检查目标文件里是否已有本插件的接线（exit 0=全部就绪）。`;
}

export function hookCommand(bin) {
  return `"${NODE}" "${join(SELF, 'bin', bin)}"`;
}

/** 计算每个 harness 的目标文件与「合并函数」 */
export function planFor(harness, options = {}) {
  const home = options.home ?? homedir();
  const project = options.project ?? process.cwd();

  if (harness === 'claude') {
    const file = join(home, '.claude', 'settings.json');
    const entry = {
      matcher: 'Read|Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell',
      hooks: [{ type: 'command', command: hookCommand('gate-hook-claude.mjs') }],
    };
    return {
      harness,
      file,
      describe: 'Claude Code PreToolUse 钩子（硬拦）',
      merge: (data) => {
        const draft = structuredClone(data ?? {});
        draft.hooks = draft.hooks ?? {};
        const list = Array.isArray(draft.hooks.PreToolUse) ? draft.hooks.PreToolUse : [];
        if (!JSON.stringify(list).includes('gate-hook-claude.mjs')) list.push(entry);
        draft.hooks.PreToolUse = list;
        return draft;
      },
    };
  }

  if (harness === 'zcode') {
    const file = join(home, '.zcode', 'cli', 'config.json');
    const entry = {
      matcher: '*',
      hooks: [{ type: 'process', command: NODE, args: [join(SELF, 'bin', 'gate-hook-claude.mjs')], timeoutMs: 10000 }],
    };
    return {
      harness,
      file,
      describe: 'ZCode PreToolUse 钩子（硬拦；与 Claude Code 同协议，复用同一适配器）',
      merge: (data) => {
        const draft = structuredClone(data ?? {});
        draft.hooks = draft.hooks ?? {};
        draft.hooks.enabled = true;
        draft.hooks.events = draft.hooks.events ?? {};
        const list = Array.isArray(draft.hooks.events.PreToolUse) ? draft.hooks.events.PreToolUse : [];
        if (!JSON.stringify(list).includes('gate-hook-claude.mjs')) list.push(entry);
        draft.hooks.events.PreToolUse = list;
        return draft;
      },
    };
  }

  if (harness === 'pi') {
    const file = join(home, '.pi', 'agent', 'extensions', 'isolation-gate.js');
    const adapter = join(SELF, 'bin', 'gate-plugin-pi.mjs').split('\\').join('/');
    const content = [
      '// 门禁 · pi 扩展（由 gate-setup 生成；删除本文件即停用）',
      '// 真正的实现在 dsh-isolation-gate 包内，这里只做转发。',
      '// 注意：必须用动态 import + pathToFileURL —— pi 的加载器会吃掉静态 file:// 前缀（Windows 上会报 protocol d:）。',
      'import { pathToFileURL } from "node:url";',
      `const mod = await import(pathToFileURL("${adapter}").href);`,
      'export default mod.default;',
      '',
    ].join('\n');
    return {
      harness,
      file,
      describe: 'pi 扩展（tool_call 进程内硬拦）',
      raw: content,
    };
  }

  if (harness === 'gemini') {
    const file = join(home, '.gemini', 'settings.json');
    const entry = {
      matcher: 'read_file|read_many_files|list_directory|glob|search_file_content|write_file|replace|run_shell_command',
      hooks: [{ type: 'command', command: hookCommand('gate-hook-gemini.mjs') }],
    };
    return {
      harness,
      file,
      describe: 'Gemini CLI BeforeTool 钩子（硬拦）',
      merge: (data) => {
        const draft = structuredClone(data ?? {});
        draft.hooks = draft.hooks ?? {};
        const list = Array.isArray(draft.hooks.BeforeTool) ? draft.hooks.BeforeTool : [];
        if (!JSON.stringify(list).includes('gate-hook-gemini.mjs')) list.push(entry);
        draft.hooks.BeforeTool = list;
        return draft;
      },
    };
  }

  if (harness === 'opencode') {
    const file = join(home, '.config', 'opencode', 'opencode.json');
    const pluginUrl = `file:///${join(SELF, 'bin', 'gate-plugin-opencode.mjs').replace(/\\/g, '/')}`;
    return {
      harness,
      file,
      describe: 'opencode 插件（硬拦）',
      merge: (data) => {
        const draft = structuredClone(data ?? {});
        const list = Array.isArray(draft.plugin) ? draft.plugin : [];
        if (!list.some((item) => String(item).includes('gate-plugin-opencode.mjs'))) list.push(pluginUrl);
        draft.plugin = list;
        return draft;
      },
    };
  }

  if (harness === 'codex') {
    const file = join(home, '.codex', 'config.toml');
    const block = [
      '',
      '# 门禁 · MCP（由 gate-setup 写入；删除本节即停用）',
      '[mcp_servers.isolation-gate]',
      `command = ${JSON.stringify(NODE)}`,
      `args = [${JSON.stringify(join(SELF, 'bin', 'gate-mcp.mjs'))}]`,
      '',
    ].join('\n');
    return {
      harness,
      file,
      describe: 'Codex MCP 服务器（advisory：Codex 没有前置钩子，只能提供工具、不能硬拦）',
      appendBlock: block,
      marker: 'mcp_servers.isolation-gate',
    };
  }

  if (harness === 'mcp') {
    const file = join(home, '.cursor', 'mcp.json');
    return {
      harness,
      file,
      describe: 'MCP 服务器注册（advisory，不硬拦）',
      merge: (data) => {
        const draft = structuredClone(data ?? {});
        draft.mcpServers = draft.mcpServers ?? {};
        draft.mcpServers['isolation-gate'] = {
          command: NODE,
          args: [join(SELF, 'bin', 'gate-mcp.mjs')],
        };
        return draft;
      },
    };
  }

  throw new Error(`不认识的 harness：${harness}`);
}

function readJsonIfExists(file) {
  if (!existsSync(file)) return { exists: false, data: null };
  const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (raw.trim() === '') return { exists: true, data: null };
  return { exists: true, data: JSON.parse(raw) };
}

function backupFile(file, backupRoot) {
  if (!existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(backupRoot, stamp);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, file.replace(/[:\\/]/g, '_'));
  writeFileSync(target, readFileSync(file));
  return target;
}

function writeJsonAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  renameSync(temp, file);
}

export function runSetup(harness, options = {}) {
  const plan = planFor(harness, options);
  if (plan.raw !== undefined) {
    const exists = existsSync(plan.file);
    const result = {
      harness: plan.harness,
      describe: plan.describe,
      file: plan.file,
      existed: exists,
      written: false,
      backup: null,
      preview: { content: plan.raw },
    };
    if (!options.write) return result;
    result.backup = backupFile(plan.file, options.backup ?? join(options.home ?? homedir(), 'gate-setup-backup'));
    mkdirSync(dirname(plan.file), { recursive: true });
    writeFileSync(plan.file, plan.raw, 'utf8');
    result.written = true;
    return result;
  }

  if (plan.appendBlock !== undefined) {
    const exists = existsSync(plan.file);
    const current = exists ? readFileSync(plan.file, 'utf8') : '';
    const already = current.includes(plan.marker);
    const next = already ? current : `${current}${current.endsWith('\n') || current === '' ? '' : '\n'}${plan.appendBlock}`;
    const result = {
      harness: plan.harness,
      describe: plan.describe,
      file: plan.file,
      existed: exists,
      written: false,
      backup: null,
      preview: { already, block: plan.appendBlock },
    };
    if (!options.write || already) return result;
    result.backup = backupFile(plan.file, options.backup ?? join(options.home ?? homedir(), 'gate-setup-backup'));
    mkdirSync(dirname(plan.file), { recursive: true });
    writeFileSync(plan.file, next, 'utf8');
    result.written = true;
    return result;
  }

  const { exists, data } = readJsonIfExists(plan.file);
  const merged = plan.merge(data);
  const result = {
    harness: plan.harness,
    describe: plan.describe,
    file: plan.file,
    existed: exists,
    written: false,
    backup: null,
    preview: merged,
  };

  if (!options.write) return result;

  result.backup = backupFile(plan.file, options.backup ?? join(options.home ?? homedir(), 'gate-setup-backup'));
  writeJsonAtomic(plan.file, merged);
  result.written = true;
  return result;
}

export function verifySetup(harness, options = {}) {
  const plan = planFor(harness, options);
  const fallback = {
    pi: 'gate-plugin-pi.mjs',
    opencode: 'gate-plugin-opencode.mjs',
    gemini: 'gate-hook-gemini.mjs',
    mcp: 'isolation-gate',
    claude: 'gate-hook-claude.mjs',
    zcode: 'gate-hook-claude.mjs',
  }[harness];
  const marker = plan.marker ?? fallback ?? '';
  if (!existsSync(plan.file)) {
    return { harness, file: plan.file, ok: false, detail: '目标文件不存在（还没接线）' };
  }
  const text = readFileSync(plan.file, 'utf8');
  const ok = marker !== '' && text.includes(marker);
  return { harness, file: plan.file, ok, detail: ok ? `已接线（标记 ${marker}）` : `未找到接线标记：${marker}` };
}

function main() {
  const argv = process.argv.slice(2);
  const harness = argv.find((item) => !item.startsWith('--'));
  const write = argv.includes('--write');
  const readFlag = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  if (harness === 'doctor') {
    const list = ['claude', 'zcode', 'pi', 'gemini', 'opencode', 'codex', 'mcp'];
    const home = readFlag('--home');
    const fix = argv.includes('--fix');
    let rows = list.map((h) => verifySetup(h, { home }));
    if (fix) {
      for (const r of rows.filter((row) => !row.ok)) {
        try {
          const done = runSetup(r.harness, { home, write: true });
          console.log(`  + 已接上 ${r.harness} → ${done.file}`);
        } catch (error) {
          console.log(`  ! ${r.harness} 接线失败：${error.message}`);
        }
      }
      rows = list.map((h) => verifySetup(h, { home }));
    }
    if (argv.includes('--json')) {
      console.log(JSON.stringify({ ok: rows.filter((r) => r.ok).length, total: rows.length, rows }, null, 2));
      process.exitCode = rows.some((r) => r.ok) ? 0 : 1;
      return;
    }
    console.log('门禁接线体检');
    for (const r of rows) console.log(`${r.ok ? '✔' : '–'} ${r.harness.padEnd(9)} ${r.detail}`);
    const okCount = rows.filter((r) => r.ok).length;
    console.log(`\n已接线 ${okCount}/${rows.length}；未接线的用 gate-setup <harness> --write 接上。`);
    process.exitCode = okCount > 0 ? 0 : 1;
    return;
  }

  if (!harness || harness === 'help' || harness === '--help') {
    console.log(usage());
    return;
  }

  const options = {
    write,
    home: readFlag('--home'),
    project: readFlag('--project'),
    backup: readFlag('--backup'),
  };

  if (argv.includes('--verify')) {
    const check = verifySetup(harness, options);
    console.log(`${check.ok ? '✔' : '✘'} 【${check.harness}】${check.file}`);
    console.log(`  ${check.detail}`);
    process.exitCode = check.ok ? 0 : 1;
    return;
  }

  let result;
  try {
    result = runSetup(harness, options);
  } catch (error) {
    console.error(`门禁接线失败：${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`【${result.harness}】${result.describe}`);
  console.log(`目标文件：${result.file}${result.existed ? '（已存在，将合并）' : '（不存在，将新建）'}`);
  if (result.written) {
    console.log(`已写入。备份：${result.backup ?? '原文件不存在，无需备份'}`);
  } else {
    console.log('（dry-run）将要写入的内容：');
    console.log(JSON.stringify(result.preview, null, 2));
    console.log('\n确认无误后加 --write 真正落盘。');
  }
}

// 入口判定必须比「真实路径」：macOS 的 /var 是 /private/var 的符号链接，
// 直接比 resolve() 会让脚本被当成「被 import 的模块」而静默什么都不做。
const invokedPath = (() => {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) : '';
  } catch {
    return '';
  }
})();
const selfPath = (() => {
  try {
    return realpathSync(import.meta.filename);
  } catch {
    return '';
  }
})();
if (invokedPath !== '' && invokedPath === selfPath) {
  main();
}
