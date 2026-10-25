#!/usr/bin/env node
/**
 * 门禁 · Gemini CLI BeforeTool 适配器
 *
 * Gemini CLI 在工具执行前触发 `BeforeTool`，把事件 JSON 写到 hook 的 stdin；
 * hook 可以用两种方式阻断：
 *   ① stdout 返回 {"decision":"deny","reason":"…"}（本适配器用这个）
 *   ② 退出码 2 + stderr 写理由
 *
 * 配置（.gemini/settings.json 或 ~/.gemini/settings.json）：
 *
 *   {
 *     "hooks": {
 *       "BeforeTool": [
 *         {
 *           "matcher": "read_file|write_file|replace|run_shell_command|glob|search_file_content|list_directory",
 *           "hooks": [
 *             { "type": "command", "command": "node D:/插件/dsh-isolation-gate/bin/gate-hook-gemini.mjs" }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 *
 * 环境变量（可选）：GATE_STATE_PATH / GATE_ROSTER_PATH / GATE_AUDIT_PATH / GATE_ROOT
 */

import { readFileSync } from 'node:fs';
import { check, normalizeConfig } from '../lib/service.js';

/** Gemini CLI 工具名 → 门禁操作 */
const TOOL_OP = {
  read_file: 'read',
  read_many_files: 'read',
  list_directory: 'read',
  glob: 'read',
  search_file_content: 'read',
  write_file: 'write',
  replace: 'write',
  run_shell_command: 'write',
};

const PATH_KEYS = ['file_path', 'path', 'absolute_path', 'directory', 'dir_path', 'cwd', 'target_file'];

export function collectTargets(toolInput) {
  const out = [];
  if (!toolInput || typeof toolInput !== 'object') return out;
  for (const key of PATH_KEYS) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.trim() !== '') out.push(value.trim());
  }
  if (typeof toolInput.command === 'string') {
    for (const match of toolInput.command.matchAll(/[A-Za-z]:[\\/][^\s"'`|;&<>()]*|\/(?:[\w.\-]+)(?:\/[\w.\-]+)*/g)) {
      out.push(match[0]);
    }
  }
  return [...new Set(out)];
}

function configFromEnv() {
  const raw = {};
  if (process.env.GATE_STATE_PATH) raw.statePath = process.env.GATE_STATE_PATH;
  if (process.env.GATE_ROSTER_PATH) raw.rosterPath = process.env.GATE_ROSTER_PATH;
  if (process.env.GATE_AUDIT_PATH) raw.auditPath = process.env.GATE_AUDIT_PATH;
  if (process.env.GATE_ROOT) raw.root = process.env.GATE_ROOT;
  return normalizeConfig(raw);
}

/** 纯判定：返回 null（放行）或理由字符串（拦截） */
export function decide(toolName, toolInput, cfg = configFromEnv()) {
  const op = TOOL_OP[toolName] ?? 'write';
  for (const target of collectTargets(toolInput)) {
    let decision;
    try {
      decision = check(cfg, { path: target, op, channel: 'hook/gemini-cli' });
    } catch (error) {
      return `门禁：策略判定异常（${error?.message ?? 'unknown'}），按拒绝处理。目标：${target}`;
    }
    if (decision && decision.allowed === false) {
      return (
        `门禁拦截：${target} 当前级别为「${decision.level ?? '未知'}」，不允许 ${op}。` +
        `${decision.reason ? `（${decision.reason}）` : ''}` +
        ' 需要放宽请让户主在门禁面板授权，或改用别的位置。'
      );
    }
  }
  return null;
}

function main() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return;
  }
  if (raw.trim() === '') {
    process.stderr.write('门禁 hook：从 stdin 读取 Gemini CLI BeforeTool JSON。见 docs/GEMINI-CLI.md\n');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stdout.write(JSON.stringify({ decision: 'deny', reason: '门禁：hook 输入不是合法 JSON，按拒绝处理（fail-closed）。' }));
    return;
  }

  const reason = decide(payload?.tool_name ?? '', payload?.tool_input ?? payload?.args ?? {});
  if (reason) process.stdout.write(JSON.stringify({ decision: 'deny', reason }));
}

main();
