/**
 * 门禁 · MCP 服务器测试（真进程 + 真 JSON-RPC over stdio）
 *
 * 扮演一个 MCP 客户端：initialize → tools/list → tools/call …
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { normalizeConfig, setLevel } from '../lib/service.js';
import { ensureStateFile } from '../lib/store.js';

const SERVER = join(import.meta.dirname, '..', 'bin', 'gate-mcp.mjs');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const root = mkdtempSync(join(tmpdir(), 'isolation-gate-mcp-'));
const statePath = join(root, '门禁-授权.json');
const rosterPath = join(root, '门禁-名单.txt');
const auditPath = join(root, '审计.jsonl');

const pending = new Map();
let nextId = 1;

function startServer(env) {
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'], env });
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (line.trim() === '') return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
  });
  return child;
}

function request(child, method, params) {
  const id = nextId++;
  const payload = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`超时：${method}`));
    }, 5000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

function notify(child, method) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
}

try {
  ensureStateFile(statePath);
  writeFileSync(rosterPath, 'Zcode\n', 'utf8');
  const cfg = normalizeConfig({ statePath, rosterPath, auditPath, root });
  setLevel(cfg, { name: 'Zcode', level: 'deny', by: 'test' });

  const env = { ...process.env, GATE_STATE_PATH: statePath, GATE_ROSTER_PATH: rosterPath, GATE_AUDIT_PATH: auditPath, GATE_ROOT: root };
  const child = startServer(env);

  console.log('\n【1】initialize 握手');
  {
    const res = await request(child, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'gate-test', version: '0.0.0' },
    });
    check('有 result', Boolean(res.result), JSON.stringify(res));
    check('回同一协议版本', res.result?.protocolVersion === '2025-06-18', JSON.stringify(res.result));
    check('声明 tools 能力', Boolean(res.result?.capabilities?.tools), JSON.stringify(res.result?.capabilities));
    check('serverInfo.name=isolation-gate', res.result?.serverInfo?.name === 'isolation-gate');
    notify(child, 'notifications/initialized');
  }

  console.log('\n【2】tools/list 暴露三个工具');
  {
    const res = await request(child, 'tools/list', {});
    const names = (res.result?.tools ?? []).map((tool) => tool.name);
    check('三个工具齐备', ['gate_check', 'gate_status', 'gate_audit'].every((n) => names.includes(n)), names.join(','));
    const gateCheck = res.result?.tools?.find((tool) => tool.name === 'gate_check');
    check('gate_check 必有 path 参数', gateCheck?.inputSchema?.required?.includes('path') === true);
  }

  console.log('\n【3】tools/call gate_check —— 受管路径被拒');
  {
    const res = await request(child, 'tools/call', {
      name: 'gate_check',
      arguments: { path: 'D:\\Zcode\\notes.md', op: 'write' },
    });
    const text = res.result?.content?.[0]?.text ?? '';
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* 留空 */ }
    check('allowed=false', payload?.allowed === false, text.slice(0, 120));
    check('level=deny', payload?.level === 'deny', String(payload?.level));
    check('带 advisory 说明', /advisory/.test(text));
  }

  console.log('\n【4】tools/call gate_check —— 未受管路径放行');
  {
    const res = await request(child, 'tools/call', {
      name: 'gate_check',
      arguments: { path: join(root, 'plain.txt'), op: 'read' },
    });
    const payload = JSON.parse(res.result?.content?.[0]?.text ?? '{}');
    check('allowed=true', payload.allowed === true, JSON.stringify(payload));
  }

  console.log('\n【5】缺参数 → isError');
  {
    const res = await request(child, 'tools/call', { name: 'gate_check', arguments: {} });
    check('isError=true', res.result?.isError === true, JSON.stringify(res.result));
  }

  console.log('\n【6】gate_status 列出受管对象');
  {
    const res = await request(child, 'tools/call', { name: 'gate_status', arguments: {} });
    const payload = JSON.parse(res.result?.content?.[0]?.text ?? '{}');
    check('rosterOk=true', payload.rosterOk === true, JSON.stringify(payload).slice(0, 160));
    check('对象里有 Zcode 且 level=deny', Array.isArray(payload.objects) && payload.objects.some((o) => o.level === 'deny'));
  }

  console.log('\n【7】gate_audit 能读到刚才的判定');
  {
    const res = await request(child, 'tools/call', { name: 'gate_audit', arguments: { limit: 5 } });
    const payload = JSON.parse(res.result?.content?.[0]?.text ?? '{}');
    check('有 rows 且非空', Array.isArray(payload.rows) && payload.rows.length > 0, JSON.stringify(payload).slice(0, 160));
    check('审计通道为 mcp', payload.rows.some((row) => row.channel === 'mcp'));
  }

  console.log('\n【8】未知方法 → JSON-RPC 错误');
  {
    const res = await request(child, 'does/not/exist', {});
    check('error.code=-32601', res.error?.code === -32601, JSON.stringify(res));
  }

  child.stdin.end();
  child.kill();
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n[mcp] ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
