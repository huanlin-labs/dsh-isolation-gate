#!/usr/bin/env node
/**
 * 门禁 · 一键接线器
 *
 *   gate-setup <harness> [--write] [--home <dir>] [--project <dir>] [--backup <dir>]
 *
 * harness：claude | gemini | opencode | mcp
 * 默认只打印「要写什么、写到哪」（dry-run）；加 --write 才真正落盘。
 * 落盘前会把原文件备份到 --backup 目录（默认 <home>/gate-setup-backup/<时间戳>/）。
 *
 * 设计原则：
 *   - 只合并自己负责的那几个键，其它配置原样保留
 *   - 写 JSON 不带 BOM、先写临时文件再改名（避免写坏）
 *   - 已经配过就不重复追加（幂等）
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const SELF = resolve(import.meta.dirname, '..');
const NODE = process.execPath;

function usage() {
  return `用法：gate-setup <claude|gemini|opencode|mcp> [--write] [--home <dir>] [--project <dir>] [--backup <dir>]

  claude    写 ~/.claude/settings.json 的 hooks.PreToolUse
  gemini    写 ~/.gemini/settings.json 的 hooks.BeforeTool
  opencode  写 ~/.config/opencode/opencode.json 的 plugin 数组
  mcp       写 ~/.cursor/mcp.json 的 mcpServers（Cursor / Windsurf 通用形状）

默认 dry-run：只打印计划，不落盘。加 --write 才写。`;
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

function main() {
  const argv = process.argv.slice(2);
  const harness = argv.find((item) => !item.startsWith('--'));
  const write = argv.includes('--write');
  const readFlag = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

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

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
