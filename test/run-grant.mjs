/**
 * 套件：临时授权（gate grant --for）
 *
 * 目的：`grant --for 30m` 必须做到三件事，少一件就算失败：
 *   ① 授权期内该级别**真的生效**（check 放行）；
 *   ② 到期**自动回落**到授权前的级别（不需要任何后台进程）；
 *   ③ 撤销（--revoke）立刻回到原级别。
 * 做法：全部在临时目录里跑 CLI，不碰真实的 D:\.agents\门禁-*。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = mkdtempSync(join(tmpdir(), 'gate-grant-'));
const CLI = join(import.meta.dirname, '..', 'bin', 'gate.mjs');
const STATE = join(ROOT, 'state.json');
const ROSTER = join(ROOT, 'roster.txt');
const AUDIT = join(ROOT, 'audit.jsonl');
const NAME = 'GrantProbe';
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--state', STATE, '--roster', ROSTER, '--log', AUDIT], {
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function readState() {
  return JSON.parse(readFileSync(STATE, 'utf8'));
}

writeFileSync(ROSTER, `${NAME}\n`, 'utf8');

// ① 非法时长 ⇒ 用法错误（exit 2），且不写状态
const bad = run(['grant', '--name', NAME, '--for', '0m']);
assert('非法时长 exit=2', bad.status === 2, `实际 ${bad.status}`);
assert('非法时长给出可读原因', /--for/.test(bad.err), bad.err.trim());

// ② 授权 2 分钟 ⇒ 成功，状态里带到期时间与回落级别
const granted = run(['grant', '--name', NAME, '--for', '2m', '--level', 'full']);
assert('grant exit=0', granted.status === 0, `实际 ${granted.status} ${granted.err}`);
assert('grant 文案含"自动回到"', /自动回到/.test(granted.out), granted.out.trim());
const cell = readState().objects[NAME];
assert('状态写入 expiresAt', typeof cell?.expiresAt === 'string' && cell.expiresAt !== '');
assert('状态写入 baseLevel=deny', cell?.baseLevel === 'deny', String(cell?.baseLevel));

// ③ 授权期内：删除被放行
const allowed = run(['check', '--name', NAME, '--op', 'delete']);
assert('授权期内 delete 放行（exit 0）', allowed.status === 0, `实际 ${allowed.status}`);

// ④ --list 能看到剩余时间
const listed = run(['grant', '--list']);
assert('grant --list 列出对象', listed.out.includes(NAME), listed.out.trim());
assert('grant --list 显示剩余', /剩/.test(listed.out), listed.out.trim());

// ⑤ 到期（人为把 expiresAt 拨到过去）⇒ 自动回落 deny，无需任何进程
const expired = readState();
expired.objects[NAME].expiresAt = '2020-01-01T00:00:00.000Z';
writeFileSync(STATE, `${JSON.stringify(expired, null, 2)}\n`, 'utf8');
const afterExpiry = run(['check', '--name', NAME, '--op', 'delete']);
assert('到期后 delete 被拒（exit 3）', afterExpiry.status === 3, `实际 ${afterExpiry.status}`);

// ⑥ 重新授权后撤销 ⇒ 立刻回到 deny，且清掉 expiresAt
run(['grant', '--name', NAME, '--for', '5m', '--level', 'read']);
const revoked = run(['grant', '--name', NAME, '--revoke']);
assert('revoke exit=0', revoked.status === 0, `实际 ${revoked.status} ${revoked.err}`);
const afterRevoke = readState().objects[NAME];
assert('撤销后级别回 deny', afterRevoke.level === 'deny', String(afterRevoke.level));
assert('撤销后清掉 expiresAt', !afterRevoke.expiresAt, String(afterRevoke.expiresAt));

// ⑦ 撤销一个没有临时授权的对象 ⇒ 明确报错（exit 2），不静默
const noGrant = run(['grant', '--name', NAME, '--revoke']);
assert('无临时授权时 revoke 报错 exit=2', noGrant.status === 2, `实际 ${noGrant.status}`);

rmSync(ROOT, { recursive: true, force: true });
if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exitCode = 1;
} else {
  console.log('\n全部通过');
}
