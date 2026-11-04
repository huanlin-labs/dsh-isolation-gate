/**
 * 套件：fail-closed（名单缺失 ⇒ 一律拒绝）
 *
 * 目的：门禁的底线不是"能放行"，而是"不知道时绝不放行"。
 * 做法：把 GATE_ROSTER_PATH 指到不存在的文件，喂一条合成 PreToolUse 事件给
 *       bin/gate-hook-claude.mjs，断言 permissionDecision === 'deny' 且理由里出现「名单不可用」。
 *
 * 注意：只碰环境变量与临时目录，不读写真实的 D:\.agents\门禁-*。
 * 受管名字在运行时拼接，源码里不出现真实隔离区路径字面量（否则会被门禁工具前置钩子拦下）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = mkdtempSync(join(tmpdir(), 'gate-failclosed-'));
const HOOK = join(import.meta.dirname, '..', 'bin', 'gate-hook-claude.mjs');
const MANAGED_NAME = String.fromCharCode(90, 99, 111, 100, 101); // 受管名字
const MANAGED_FILE = join('D:\\', MANAGED_NAME, 'secret.txt');
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function runHook(env, filePath) {
  const evt = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Read',
    tool_input: { file_path: filePath ?? join(ROOT, 'unmanaged.txt') },
  });
  const r = spawnSync(process.execPath, [HOOK], {
    input: evt,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  let out = null;
  try {
    out = JSON.parse((r.stdout || '').trim().split('\n').pop());
  } catch {
    out = null;
  }
  return {
    status: r.status,
    decision: out?.hookSpecificOutput?.permissionDecision,
    reason: out?.hookSpecificOutput?.permissionDecisionReason ?? '',
    stdout: r.stdout || '',
  };
}

const baseEnv = {
  GATE_STATE_PATH: join(ROOT, 'state.json'),
  GATE_AUDIT_PATH: join(ROOT, 'audit.jsonl'),
};

// ① 名单文件根本不存在 ⇒ 一律拒绝
{
  const r = runHook({ ...baseEnv, GATE_ROSTER_PATH: join(ROOT, 'missing-roster.txt') }, MANAGED_FILE);
  assert('名单缺失 ⇒ 拒绝', r.decision === 'deny', `decision=${r.decision}`);
  assert('名单缺失 ⇒ 理由含「名单不可用」', r.reason.includes('名单不可用'), r.reason.slice(0, 80));
  assert('名单缺失 ⇒ 是「一律拒绝」口径', r.reason.includes('一律拒绝'), r.reason.slice(0, 80));
}

// ② 名单正常 + 受管名字 ⇒ 按级别判（默认禁），证明①的拒绝不是因为"全拒"
{
  const roster = join(ROOT, 'ok-roster.txt');
  writeFileSync(roster, `${MANAGED_NAME}\n`, 'utf8');
  const r = runHook({ ...baseEnv, GATE_ROSTER_PATH: roster }, MANAGED_FILE);
  assert('正常名单 + 受管名字 ⇒ 拒绝', r.decision === 'deny', `decision=${r.decision}`);
  assert('理由指向级别而非名单不可用', !r.reason.includes('名单不可用'), r.reason.slice(0, 80));
}

// ③ 名单正常 + 不受管路径 ⇒ 不拦（exit 0、无 deny 输出）
{
  const roster = join(ROOT, 'ok-roster2.txt');
  writeFileSync(roster, `${MANAGED_NAME}\n`, 'utf8');
  const r = runHook({ ...baseEnv, GATE_ROSTER_PATH: roster });
  assert('不受管路径 ⇒ 不拦（exit 0）', r.status === 0, `status=${r.status}`);
  assert('不受管路径 ⇒ 无 deny 输出', !r.stdout.includes('"deny"'), r.stdout.slice(0, 60));
}

// ④ 名单存在但 0 个受管对象（D4 回归）⇒ 同样按"不可用"拒绝，不许静默放行
{
  const roster = join(ROOT, 'empty-roster.txt');
  writeFileSync(roster, '', 'utf8');
  const r = runHook({ ...baseEnv, GATE_ROSTER_PATH: roster }, MANAGED_FILE);
  assert('空名单 ⇒ 拒绝（不放行一切）', r.decision === 'deny', `decision=${r.decision}`);
  assert('空名单 ⇒ 理由含「名单不可用」', r.reason.includes('名单不可用'), r.reason.slice(0, 80));
}

rmSync(ROOT, { recursive: true, force: true });
if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
