/**
 * 门禁 · 通用前置钩子适配器测试
 *
 * 覆盖：字段名容错（snake / camel）、三种拦截输出、操作推断、审计通道、fail-closed。
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectTargets, decide, opForTool } from '../bin/gate-hook-generic.mjs';
import { normalizeConfig, setLevel } from '../lib/service.js';
import { ensureStateFile } from '../lib/store.js';

const HOOK = join(import.meta.dirname, '..', 'bin', 'gate-hook-generic.mjs');

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

const root = mkdtempSync(join(tmpdir(), 'isolation-gate-generic-'));
const statePath = join(root, '门禁-授权.json');
const rosterPath = join(root, '门禁-名单.txt');
const auditPath = join(root, '审计.jsonl');
const baseEnv = { ...process.env, GATE_STATE_PATH: statePath, GATE_ROSTER_PATH: rosterPath, GATE_AUDIT_PATH: auditPath, GATE_ROOT: root };

function run(payload, extraEnv = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...baseEnv, ...extraEnv },
  });
  return { code: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

try {
  ensureStateFile(statePath);
  writeFileSync(rosterPath, 'Zcode\n', 'utf8');
  const cfg = normalizeConfig({ statePath, rosterPath, auditPath, root });
  setLevel(cfg, { name: 'Zcode', level: 'deny', by: 'test' });

  console.log('\n【1】Codex / Claude 风格 payload（tool_name + tool_input），默认 exit2');
  {
    const out = run({ tool_name: 'Read', tool_input: { file_path: 'D:\\Zcode\\a.md' } });
    check('退出码 2', out.code === 2, String(out.code));
    check('stderr 带门禁口径', /门禁拦截/.test(out.stderr), out.stderr);
    check('stdout 为空', out.stdout === '', out.stdout);
  }

  console.log('\n【2】camelCase payload（toolName + toolInput）');
  {
    const out = run({ toolName: 'write_file', toolInput: { path: 'D:\\Zcode\\b.txt' } });
    check('退出码 2', out.code === 2, String(out.code));
  }

  console.log('\n【3】未受管路径 → 放行（退出码 0、无输出）');
  {
    const out = run({ tool_name: 'Read', tool_input: { file_path: join(root, 'plain.txt') } });
    check('退出码 0', out.code === 0, String(out.code));
    check('stdout 空', out.stdout === '', out.stdout);
    check('stderr 空', out.stderr === '', out.stderr);
  }

  console.log('\n【4】输出风格 json-claude');
  {
    const out = run({ tool_name: 'Read', tool_input: { file_path: 'D:\\Zcode\\a.md' } }, { GATE_DENY_STYLE: 'json-claude' });
    const parsed = JSON.parse(out.stdout || '{}');
    check('退出码 0', out.code === 0, String(out.code));
    check('permissionDecision=deny', parsed?.hookSpecificOutput?.permissionDecision === 'deny', out.stdout);
  }

  console.log('\n【5】输出风格 json-gemini');
  {
    const out = run({ tool_name: 'read_file', tool_input: { file_path: 'D:\\Zcode\\a.md' } }, { GATE_DENY_STYLE: 'json-gemini' });
    const parsed = JSON.parse(out.stdout || '{}');
    check('decision=deny', parsed?.decision === 'deny', out.stdout);
  }

  console.log('\n【6】输出风格 text（只记日志、不阻断）');
  {
    const out = run({ tool_name: 'Read', tool_input: { file_path: 'D:\\Zcode\\a.md' } }, { GATE_DENY_STYLE: 'text' });
    check('退出码 0', out.code === 0, String(out.code));
    check('stderr 仍写理由', /门禁拦截/.test(out.stderr), out.stderr);
  }

  console.log('\n【7】坏 JSON → fail-closed');
  {
    const out = run('{oops');
    check('退出码 2', out.code === 2, String(out.code));
    check('stderr 说明 fail-closed', /fail-closed/.test(out.stderr), out.stderr);
  }

  console.log('\n【8】工具名推断与自定义字段');
  {
    check('Read → read', opForTool('Read') === 'read');
    check('Write → write', opForTool('Write') === 'write');
    check('bash → write', opForTool('bash') === 'write');
    check('未知工具按 write（保守）', opForTool('mystery_tool') === 'write');
    const targets = collectTargets({ path: 'D:\\Zcode\\x', command: 'type D:\\Zcode\\y' });
    check('取到 path 与命令里的路径', targets.length >= 2, targets.join(','));
  }

  console.log('\n【9】显式 op 字段优先');
  {
    const reason = decide({ tool_name: 'Read', op: 'write', tool_input: { file_path: 'D:\\Zcode\\a.md' } }, cfg);
    check('按 write 拒绝', typeof reason === 'string' && /不允许 write/.test(reason), String(reason));
  }

  console.log('\n【10】审计通道 hook/generic');
  {
    const rows = readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    check('有 hook/generic 记录', rows.some((row) => row.channel === 'hook/generic'));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n[hook-generic] ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
