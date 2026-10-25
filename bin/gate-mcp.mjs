#!/usr/bin/env node
/**
 * 门禁 · MCP 服务器（stdio）
 *
 * 给任何支持 MCP 的 harness（Cursor / Windsurf / Codex / Claude Desktop / opencode …）
 * 提供「事前查询」能力：模型在动某个路径前先问一句，门禁按同一套策略回答。
 *
 * ⚠️ 能力边界（诚实声明）：MCP 只能被调用，**不能硬拦**工具执行。
 *    真正的强制拦截需要 harness 提供前置钩子（见 Claude Code / opencode / Gemini CLI 适配器）。
 *    这里提供的是 advisory（建议式）+ 审计留痕。
 *
 * 配置示例（MCP 客户端里的 server 定义）：
 *   command: node
 *   args: ["D:/插件/dsh-isolation-gate/bin/gate-mcp.mjs"]
 *
 * 环境变量：GATE_STATE_PATH / GATE_ROSTER_PATH / GATE_AUDIT_PATH / GATE_ROOT
 */

import { readFileSync } from 'node:fs';
import { check, normalizeConfig } from '../lib/service.js';
import { readRoster } from '../lib/roster.js';
import { readState } from '../lib/store.js';

const SERVER_INFO = { name: 'isolation-gate', version: '1.6.0' };
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

function configFromEnv() {
  const raw = {};
  if (process.env.GATE_STATE_PATH) raw.statePath = process.env.GATE_STATE_PATH;
  if (process.env.GATE_ROSTER_PATH) raw.rosterPath = process.env.GATE_ROSTER_PATH;
  if (process.env.GATE_AUDIT_PATH) raw.auditPath = process.env.GATE_AUDIT_PATH;
  if (process.env.GATE_ROOT) raw.root = process.env.GATE_ROOT;
  return normalizeConfig(raw);
}

const TOOLS = [
  {
    name: 'gate_check',
    description:
      '门禁：在读写某个路径前先问一次。返回该路径的受管级别与是否允许此操作。' +
      '注意：这是 advisory，不会替你拦截——被拒绝时请不要执行该操作。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '绝对路径' },
        op: { type: 'string', enum: ['read', 'write', 'delete', 'traverse'], description: '打算做的操作，默认 read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'gate_status',
    description: '门禁：列出当前受管对象及其级别（deny / read / full），以及名单与状态文件位置。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'gate_audit',
    description: '门禁：读取最近若干条审计记录（who / when / 哪个目标 / 结果）。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '条数，默认 20，最大 200' } },
    },
  },
];

function textResult(payload, isError = false) {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function parseAuditTail(auditPath, limit) {
  const raw = readFileSync(auditPath, 'utf8');
  const rows = raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
  return rows;
}

function callTool(name, args) {
  const cfg = configFromEnv();
  if (name === 'gate_check') {
    const target = args?.path;
    if (typeof target !== 'string' || target.trim() === '') {
      return textResult({ error: '缺少 path 参数' }, true);
    }
    const op = args?.op ?? 'read';
    const decision = check(cfg, { path: target, op, channel: 'mcp' });
    return textResult({
      path: target,
      op,
      allowed: decision.allowed,
      level: decision.level ?? null,
      inRoster: decision.inRoster !== false,
      reason: decision.reason ?? null,
      note: 'advisory：被拒绝时不要执行该操作；硬拦截需 harness 的前置钩子。',
    });
  }
  if (name === 'gate_status') {
    const read = readState(cfg.statePath);
    const roster = readRoster(cfg.rosterPath);
    const objects = read?.state?.objects ?? {};
    return textResult({
      statePath: cfg.statePath,
      rosterPath: cfg.rosterPath,
      auditPath: cfg.auditPath,
      stateOk: read?.ok === true,
      defaultLevel: read?.state?.defaultLevel ?? 'deny',
      objects: Object.entries(objects).map(([key, value]) => ({
        key,
        level: value?.level ?? 'deny',
        group: value?.group ?? '',
        note: value?.note ?? '',
      })),
      groups: read?.state?.groups ?? {},
      rosterOk: roster?.ok === true,
      rosterNames: roster?.names ?? [],
      rosterObjects: roster?.objects ?? [],
    });
  }
  if (name === 'gate_audit') {
    const limit = Math.min(Math.max(Number(args?.limit ?? 20), 1), 200);
    try {
      return textResult({ auditPath: cfg.auditPath, rows: parseAuditTail(cfg.auditPath, limit) });
    } catch (error) {
      return textResult({ auditPath: cfg.auditPath, error: `读取审计失败：${error?.message ?? 'unknown'}` }, true);
    }
  }
  return textResult({ error: `未知工具：${name}` }, true);
}

function respond(id, result) {
  if (id === undefined || id === null) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function respondError(id, code, message) {
  if (id === undefined || id === null) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    const version = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
    respond(id, { protocolVersion: version, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'ping') {
    respond(id, {});
    return;
  }
  if (method === 'tools/list') {
    respond(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      respond(id, callTool(name, args));
    } catch (error) {
      respondError(id, -32603, `门禁内部错误：${error?.message ?? 'unknown'}`);
    }
    return;
  }
  respondError(id, -32601, `不支持的方法：${method}`);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf('\n');
    if (line === '') continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handle(message);
  }
});
