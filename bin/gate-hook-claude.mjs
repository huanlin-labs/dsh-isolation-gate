#!/usr/bin/env node
/**
 * 门禁 · Claude Code PreToolUse 适配器
 *
 * 用法（写入 ~/.claude/settings.json 或项目 .claude/settings.json）：
 *
 *   {
 *     "hooks": {
 *       "PreToolUse": [
 *         {
 *           "matcher": "Read|Write|Edit|MultiEdit|NotebookEdit|NotebookRead|Glob|Grep|LS|Bash|PowerShell",
 *           "hooks": [
 *             { "type": "command", "command": "node", "args": ["D:/插件/dsh-isolation-gate/bin/gate-hook-claude.mjs"] }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 *
 * 行为：读 stdin 的 hook 事件 JSON → 用与 DSH 插件完全相同的策略引擎判定 →
 *   · 放行：不输出、退出码 0（保持 Claude Code 正常权限流程）
 *   · 拦截：输出 hookSpecificOutput.permissionDecision = "deny" 的 JSON
 *   · 无法解析输入 / 内部异常：按「禁」处理（fail-closed），但只在能定位到受管目标时拦截
 *
 * 环境变量可覆盖路径（默认与插件一致）：
 *   GATE_STATE_PATH / GATE_ROSTER_PATH / GATE_AUDIT_PATH / GATE_ROOT
 */

import { readFileSync } from 'node:fs';
import { check, normalizeConfig } from '../lib/service.js';

/** Claude Code 工具名 → 门禁操作类型 */
const TOOL_OP = {
  Read: 'read',
  NotebookRead: 'read',
  Glob: 'read',
  Grep: 'read',
  LS: 'read',
  Write: 'write',
  Edit: 'write',
  MultiEdit: 'write',
  NotebookEdit: 'write',
  Bash: 'write',
  PowerShell: 'write',
};

const PATH_KEYS = ['file_path', 'notebook_path', 'path', 'target_file', 'directory', 'cwd'];

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** 从工具参数里收集所有可能是「受管目标」的字符串 */
function collectTargets(toolInput) {
  const out = [];
  if (!toolInput || typeof toolInput !== 'object') return out;
  for (const key of PATH_KEYS) {
    const value = toolInput[key];
    if (typeof value === 'string' && value.trim() !== '') out.push(value.trim());
  }
  if (typeof toolInput.command === 'string') {
    // 只取明显的绝对路径（Windows 盘符 / POSIX 绝对路径），避免把普通单词当成路径
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

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exitCode = 0; // JSON 决策已表达拦截，退出码保持 0
}

function main() {
  const raw = readStdin();
  if (raw.trim() === '') {
    // 没有输入 = 不是 hook 调用（例如手动执行），给出用法提示但不拦截
    process.stderr.write('门禁 hook：从 stdin 读取 Claude Code PreToolUse JSON。见 docs/CLAUDE-CODE.md\n');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    deny('门禁：hook 输入不是合法 JSON，按拒绝处理（fail-closed）。');
    return;
  }

  const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
  const op = TOOL_OP[toolName] ?? 'write';
  const targets = collectTargets(payload?.tool_input);
  if (targets.length === 0) return; // 无可判定目标 → 交给 Claude Code 正常流程

  const cfg = configFromEnv();
  for (const target of targets) {
    let decision;
    try {
      decision = check(cfg, { path: target, op, channel: 'hook/claude-code' });
    } catch (error) {
      deny(`门禁：策略判定异常（${error?.message ?? 'unknown'}），按拒绝处理。目标：${target}`);
      return;
    }
    if (decision && decision.allowed === false) {
      deny(
        `门禁拦截：${target} 当前级别为「${decision.level ?? '未知'}」，不允许 ${op}。` +
          `${decision.reason ? `（${decision.reason}）` : ''}` +
          ' 需要放宽请让户主在门禁面板授权，或改用别的位置。',
      );
      return;
    }
  }
}

main();
