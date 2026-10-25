/**
 * 门禁 · Claude Code 适配器测试
 *
 * 用临时 state / roster 跑真实的 bin/gate-hook-claude.mjs（子进程 + stdin JSON），
 * 断言「放行 = 无输出」「受管目标 = deny JSON」。
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeConfig, setLevel } from '../lib/service.js';
import { ensureStateFile } from '../lib/store.js';

const here = dirname(fileURLToPath(import.meta.url));
const hookPath = join(here, '..', 'bin', 'gate-hook-claude.mjs');

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

function runHook(payload, env) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

const root = mkdtempSync(join(tmpdir(), 'isolation-gate-hook-'));
const statePath = join(root, '门禁-授权.json');
const rosterPath = join(root, '门禁-名单.txt');
const auditPath = join(root, '审计.jsonl');

try {
  ensureStateFile(statePath);
  writeFileSync(rosterPath, 'Zcode\n', 'utf8'); // 名单存在，否则 fail-closed 会拒一切
  const cfg = normalizeConfig({ statePath, rosterPath, auditPath, root });
  const leveled = setLevel(cfg, { name: 'Zcode', level: 'deny', by: 'test' });
  check('夹具：Zcode 设为禁', leveled.ok === true, leveled.error ?? '');

  const env = {
    GATE_STATE_PATH: statePath,
    GATE_ROSTER_PATH: rosterPath,
    GATE_AUDIT_PATH: auditPath,
    GATE_ROOT: root,
  };

  console.log('\n【1】受管目标被拦');
  {
    const r = runHook(
      { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'D:\\Zcode\\notes.md' }, cwd: root },
      env,
    );
    let parsed = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      parsed = null;
    }
    check('退出码 0', r.code === 0, `code=${r.code}`);
    check('输出 deny 决策', parsed?.hookSpecificOutput?.permissionDecision === 'deny', r.stdout.slice(0, 120));
    check('理由是中文门禁口径', /门禁拦截/.test(parsed?.hookSpecificOutput?.permissionDecisionReason ?? ''));
  }

  console.log('\n【2】Bash 命令里的受管路径也被拦');
  {
    const r = runHook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'cat D:\\Zcode\\config.toml' },
        cwd: root,
      },
      env,
    );
    check('deny', r.stdout.includes('"permissionDecision":"deny"'), r.stdout.slice(0, 120));
  }

  console.log('\n【3】未受管路径放行（无输出）');
  {
    const r = runHook(
      { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: join(root, 'plain.txt') }, cwd: root },
      env,
    );
    check('退出码 0', r.code === 0, `code=${r.code}`);
    check('stdout 为空', r.stdout === '', r.stdout.slice(0, 120));
  }

  console.log('\n【4】坏输入 fail-closed');
  {
    const r = runHook('{not json', env);
    check('仍输出 deny', r.stdout.includes('"permissionDecision":"deny"'), r.stdout.slice(0, 120));
  }

  console.log('\n【5】空输入不拦（手动执行提示用法）');
  {
    const r = runHook('', env);
    check('退出码 0', r.code === 0, `code=${r.code}`);
    check('stdout 为空', r.stdout === '');
  }

  console.log('\n【6】审计日志记到 hook 通道');
  {
    const { readFileSync } = await import('node:fs');
    const lines = readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean);
    const hookRows = lines.map((line) => JSON.parse(line)).filter((row) => row.channel === 'hook/claude-code');
    check('有 hook/claude-code 记录', hookRows.length > 0, `rows=${lines.length}`);
    check('受管目标记录为拒绝', hookRows.some((row) => row.name === 'Zcode' && row.allowed === false));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n[hook-claude] ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
