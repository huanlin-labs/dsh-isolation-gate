/**
 * 门禁 · Gemini CLI BeforeTool 适配器测试
 *
 * 通过 spawnSync 直接喂 stdin，模拟 Gemini CLI 调用 hook 的真实形态。
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decide } from '../bin/gate-hook-gemini.mjs';
import { normalizeConfig, setLevel } from '../lib/service.js';
import { ensureStateFile } from '../lib/store.js';

const HOOK = join(import.meta.dirname, '..', 'bin', 'gate-hook-gemini.mjs');

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

const root = mkdtempSync(join(tmpdir(), 'isolation-gate-gemini-'));
const statePath = join(root, '门禁-授权.json');
const rosterPath = join(root, '门禁-名单.txt');
const auditPath = join(root, '审计.jsonl');
const env = { ...process.env, GATE_STATE_PATH: statePath, GATE_ROSTER_PATH: rosterPath, GATE_AUDIT_PATH: auditPath, GATE_ROOT: root };

function run(payload) {
  const result = spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8', env });
  return { code: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

try {
  ensureStateFile(statePath);
  writeFileSync(rosterPath, 'Zcode\n', 'utf8');
  const cfg = normalizeConfig({ statePath, rosterPath, auditPath, root });
  setLevel(cfg, { name: 'Zcode', level: 'deny', by: 'test' });

  console.log('\n【1】BeforeTool 命中受管路径 → decision=deny');
  {
    const out = run(JSON.stringify({ hook_event_name: 'BeforeTool', tool_name: 'read_file', tool_input: { file_path: 'D:\\Zcode\\notes.md' } }));
    check('退出码 0', out.code === 0, String(out.code));
    let parsed = null;
    try { parsed = JSON.parse(out.stdout); } catch { /* 留空 */ }
    check('输出合法 JSON', parsed !== null, out.stdout);
    check('decision=deny', parsed?.decision === 'deny', JSON.stringify(parsed));
    check('reason 带门禁口径', /门禁拦截/.test(parsed?.reason ?? ''), parsed?.reason ?? '');
  }

  console.log('\n【2】未受管路径 → 无输出（放行）');
  {
    const out = run(JSON.stringify({ tool_name: 'read_file', tool_input: { file_path: join(root, 'plain.txt') } }));
    check('退出码 0', out.code === 0, String(out.code));
    check('stdout 为空', out.stdout === '', out.stdout);
  }

  console.log('\n【3】shell 命令里的受管路径被拦');
  {
    const out = run(JSON.stringify({ tool_name: 'run_shell_command', tool_input: { command: 'type D:\\Zcode\\config.toml' } }));
    check('decision=deny', JSON.parse(out.stdout || '{}').decision === 'deny', out.stdout);
  }

  console.log('\n【4】坏 JSON → fail-closed');
  {
    const out = run('{not json');
    check('decision=deny', JSON.parse(out.stdout || '{}').decision === 'deny', out.stdout);
  }

  console.log('\n【5】空输入 → 只提示用法，不拦');
  {
    const out = run('');
    check('退出码 0', out.code === 0, String(out.code));
    check('stdout 为空', out.stdout === '', out.stdout);
    check('stderr 有用法提示', /BeforeTool/.test(out.stderr), out.stderr);
  }

  console.log('\n【6】纯判定函数：write_file / replace 按写处理');
  {
    const a = decide('write_file', { file_path: 'D:\\Zcode\\a.txt' }, cfg);
    const b = decide('replace', { file_path: 'D:\\Zcode\\a.txt' }, cfg);
    check('两种写工具都被拦', typeof a === 'string' && typeof b === 'string');
  }

  console.log('\n【7】审计通道记为 hook/gemini-cli');
  {
    const rows = readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    check('有 hook/gemini-cli 记录', rows.some((row) => row.channel === 'hook/gemini-cli'));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n[hook-gemini] ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
