/**
 * 套件：可操作的拒绝提示（D-3）
 *
 * 目的：拒绝不能只说"不行"。每条拒绝都必须带「下一步能跑什么」——
 *   ① 禁 → 提示 grant --level read（不是空话）
 *   ② 只读但要做写/删 → 提示 grant --level full
 *   ③ 名单不可用 → 提示先恢复名单 + 怎么确认
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = mkdtempSync(join(tmpdir(), 'gate-hint-'));
const CLI = join(import.meta.dirname, '..', 'bin', 'gate.mjs');
const STATE = join(ROOT, 'state.json');
const ROSTER = join(ROOT, 'roster.txt');
const AUDIT = join(ROOT, 'audit.jsonl');
const NAME = 'HintProbe';
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function run(args, { roster = ROSTER } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--state', STATE, '--roster', roster, '--log', AUDIT], {
    encoding: 'utf8',
  });
  const out = r.stdout || ''; const err = r.stderr || ''; return { status: r.status, out, err, text: out + err };
}

writeFileSync(ROSTER, `${NAME}\n`, 'utf8');

// ① 默认禁 ⇒ 拒绝 + 给临时放开命令（read 级）
const denied = run(['check', '--name', NAME, '--op', 'read']);
assert('禁级 read exit=3', denied.status === 3, String(denied.status));
assert('含「下一步」', /下一步/.test(denied.text), denied.text.trim());
assert('给出可执行的 grant 命令', new RegExp(`grant --name "${NAME}" --for 10m --level read`).test(denied.text), denied.text.trim());
assert('给出 GUI 路径', /侧边栏「门禁」/.test(denied.text), denied.text.trim());
assert('给出 status 自检', /gate\.mjs status/.test(denied.text), denied.text.trim());

// ② 只读级别做删除 ⇒ 提示提到 full
run(['grant', '--name', NAME, '--for', '30m', '--level', 'read']);
const readDenied = run(['check', '--name', NAME, '--op', 'delete']);
assert('只读做删除 exit=3', readDenied.status === 3, String(readDenied.status));
assert('提示提到 full', /--level full/.test(readDenied.text), readDenied.text.trim());
assert('说明只允许哪些操作', /该级别只允许/.test(readDenied.text), readDenied.text.trim());

// ③ 名单不可用 ⇒ fail-closed + 可执行的恢复指引
const missing = run(['check', '--name', NAME, '--op', 'read'], { roster: join(ROOT, 'no-such-roster.txt') });
assert('名单缺失 exit=3', missing.status === 3, String(missing.status));
assert('文案含「名单不可用」', /名单不可用/.test(missing.text), missing.text.trim());
assert('名单不可用也给下一步', /下一步/.test(missing.text), missing.text.trim());
assert('含名单格式说明', /每行一个名字或绝对路径/.test(missing.text), missing.text.trim());

rmSync(ROOT, { recursive: true, force: true });
if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exitCode = 1;
} else {
  console.log('\n全部通过');
}

