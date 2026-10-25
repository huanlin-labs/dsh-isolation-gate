#!/usr/bin/env node
/**
 * 门禁 · 通用前置钩子适配器（一家家适配之外的「兜底款」）
 *
 * 用途：任何 harness 只要有「工具执行前调用一个命令、并把事件 JSON 喂给 stdin」的钩子，
 *       都能直接接本文件，不用再写代码。字段名与拦截方式都能用环境变量调。
 *
 * 字段映射（默认按 Claude Code / Codex 风格）：
 *   GATE_TOOL_KEYS   工具名字段候选，逗号分隔，默认 tool_name,toolName,tool,name
 *   GATE_ARGS_KEYS   参数对象字段候选，逗号分隔，默认 tool_input,toolInput,args,input,arguments
 *   GATE_OP_KEYS     显式操作字段候选（可选），默认 op,operation
 *
 * 拦截方式（GATE_DENY_STYLE）：
 *   exit2       退出码 2 + stderr 写理由（Claude Code / Codex 通用，默认）
 *   json-claude 输出 {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",...}}
 *   json-gemini 输出 {"decision":"deny","reason":"…"}
 *   text        只在 stderr 写理由，退出码 0（给只读日志型钩子用；不阻断）
 *
 * 策略口径：操作按工具名猜（read*→read，write/edit→write，bash/shell/exec→write），
 *          也可用 GATE_OP 环境变量强制指定。
 *
 * 环境变量（策略文件）：GATE_STATE_PATH / GATE_ROSTER_PATH / GATE_AUDIT_PATH / GATE_ROOT
 */

import { readFileSync } from 'node:fs';
import { check, normalizeConfig } from '../lib/service.js';

const TOOL_OP_HINTS = [
  [/^(read|view|cat|list|ls|glob|grep|search|find)/i, 'read'],
  [/^(write|edit|create|replace|patch|apply|delete|remove|rm|move|mv)/i, 'write'],
  [/^(bash|shell|exec|run|terminal|command|powershell|cmd)/i, 'write'],
];

const PATH_KEYS = [
  'file_path',
  'filePath',
  'path',
  'target_file',
  'notebook_path',
  'directory',
  'cwd',
];

function envList(name, fallback) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function configFromEnv() {
  const raw = {};
  if (process.env.GATE_STATE_PATH) raw.statePath = process.env.GATE_STATE_PATH;
  if (process.env.GATE_ROSTER_PATH) raw.rosterPath = process.env.GATE_ROSTER_PATH;
  if (process.env.GATE_AUDIT_PATH) raw.auditPath = process.env.GATE_AUDIT_PATH;
  if (process.env.GATE_ROOT) raw.root = process.env.GATE_ROOT;
  return normalizeConfig(raw);
}

export function pickFirst(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

export function opForTool(toolName, explicitOp) {
  if (typeof explicitOp === 'string' && explicitOp.trim() !== '') return explicitOp.trim();
  if (typeof process.env.GATE_OP === 'string' && process.env.GATE_OP.trim() !== '') return process.env.GATE_OP.trim();
  const name = String(toolName ?? '');
  for (const [pattern, op] of TOOL_OP_HINTS) {
    if (pattern.test(name)) return op;
  }
  return 'write';
}

export function collectTargets(args) {
  const out = [];
  if (!args || typeof args !== 'object') return out;
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim() !== '') out.push(value.trim());
  }
  const command = pickFirst(args, ['command', 'cmd', 'script']);
  if (typeof command === 'string') {
    for (const match of command.matchAll(/[A-Za-z]:[\\/][^\s"'`|;&<>()]*|\/(?:[\w.\-]+)(?:\/[\w.\-]+)*/g)) {
      out.push(match[0]);
    }
  }
  return [...new Set(out)];
}

/** 纯判定：返回 null 或理由字符串 */
export function decide(payload, cfg = configFromEnv()) {
  const toolKeys = envList('GATE_TOOL_KEYS', ['tool_name', 'toolName', 'tool', 'name']);
  const argsKeys = envList('GATE_ARGS_KEYS', ['tool_input', 'toolInput', 'args', 'input', 'arguments']);
  const opKeys = envList('GATE_OP_KEYS', ['op', 'operation']);

  const toolName = pickFirst(payload, toolKeys);
  const args = pickFirst(payload, argsKeys) ?? {};
  const op = opForTool(toolName, pickFirst(payload, opKeys));

  for (const target of collectTargets(args)) {
    let decision;
    try {
      decision = check(cfg, { path: target, op, channel: 'hook/generic' });
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

export function renderDeny(reason, style = process.env.GATE_DENY_STYLE || 'exit2') {
  if (style === 'json-claude') {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }),
      stderr: '',
    };
  }
  if (style === 'json-gemini') {
    return { exitCode: 0, stdout: JSON.stringify({ decision: 'deny', reason }), stderr: '' };
  }
  if (style === 'text') {
    return { exitCode: 0, stdout: '', stderr: reason };
  }
  return { exitCode: 2, stdout: '', stderr: reason };
}

function main() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return;
  }
  if (raw.trim() === '') {
    process.stderr.write(
      '门禁通用钩子：从 stdin 读取事件 JSON。字段映射见 docs/GENERIC-HOOK.md\n',
    );
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    const rendered = renderDeny('门禁：hook 输入不是合法 JSON，按拒绝处理（fail-closed）。');
    if (rendered.stdout) process.stdout.write(rendered.stdout);
    if (rendered.stderr) process.stderr.write(rendered.stderr);
    process.exitCode = rendered.exitCode;
    return;
  }

  const reason = decide(payload);
  if (!reason) return;
  const rendered = renderDeny(reason);
  if (rendered.stdout) process.stdout.write(rendered.stdout);
  if (rendered.stderr) process.stderr.write(rendered.stderr);
  process.exitCode = rendered.exitCode;
}

main();
