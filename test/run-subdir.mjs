/**
 * 套件：子目录粒度（D-4）
 *
 * 场景：父目录只读，子目录单独放开到可读写删；再把子目录收紧，父目录不受影响。
 * 依据：判定按**路径段最长前缀**命中 —— 子目录规则覆盖父目录规则（同级不叠加）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = mkdtempSync(join(tmpdir(), 'gate-subdir-'));
const CLI = join(import.meta.dirname, '..', 'bin', 'gate.mjs');
const STATE = join(ROOT, 'state.json');
const ROSTER = join(ROOT, 'roster.txt');
const AUDIT = join(ROOT, 'audit.jsonl');
const PARENT = join(ROOT, 'proj');
const PUBLIC_DIR = join(PARENT, 'public');
const SECRET_DIR = join(PARENT, 'secret');
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

for (const dir of [PARENT, PUBLIC_DIR, SECRET_DIR]) mkdirSync(dir, { recursive: true });
writeFileSync(join(PARENT, 'a.txt'), 'a', 'utf8');
writeFileSync(join(PUBLIC_DIR, 'b.txt'), 'b', 'utf8');
writeFileSync(join(SECRET_DIR, 'c.txt'), 'c', 'utf8');
writeFileSync(ROSTER, `${PARENT}\n${PUBLIC_DIR}\n`, 'utf8');

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--state', STATE, '--roster', ROSTER, '--log', AUDIT], {
    encoding: 'utf8',
  });
  return { status: r.status, text: (r.stdout || '') + (r.stderr || '') };
}

// ① 父只读、子放开到 full
const setParent = run(['set', '--path', PARENT, '--level', 'read']);
assert('set 父目录 read exit=0', setParent.status === 0, setParent.text.trim());
const setChild = run(['set', '--path', PUBLIC_DIR, '--level', 'full']);
assert('set 子目录 full exit=0', setChild.status === 0, setChild.text.trim());
assert('set 文案说明子目录覆盖父目录', /子目录.*覆盖父目录/.test(setChild.text), setChild.text.trim());

const parentRead = run(['check', '--path', join(PARENT, 'a.txt'), '--op', 'read']);
assert('父目录 read 放行', parentRead.status === 0, parentRead.text.trim());
const parentWrite = run(['check', '--path', join(PARENT, 'a.txt'), '--op', 'write']);
assert('父目录 write 仍拒（exit 3）', parentWrite.status === 3, String(parentWrite.status));
const childWrite = run(['check', '--path', join(PUBLIC_DIR, 'b.txt'), '--op', 'write']);
assert('子目录 write 放行（覆盖父级）', childWrite.status === 0, childWrite.text.trim());
const secretWrite = run(['check', '--path', join(SECRET_DIR, 'c.txt'), '--op', 'write']);
assert('未单独设置的同一父下子目录 write 仍拒', secretWrite.status === 3, String(secretWrite.status));

// ② 把子目录收紧到 deny：父目录的 read 不受影响
const setChildDeny = run(['set', '--path', PUBLIC_DIR, '--level', 'deny']);
assert('set 子目录 deny exit=0', setChildDeny.status === 0, setChildDeny.text.trim());
const childReadDenied = run(['check', '--path', join(PUBLIC_DIR, 'b.txt'), '--op', 'read']);
assert('子目录收紧后 read 被拒（exit 3）', childReadDenied.status === 3, String(childReadDenied.status));
const parentReadAgain = run(['check', '--path', join(PARENT, 'a.txt'), '--op', 'read']);
assert('父目录 read 不受子目录影响', parentReadAgain.status === 0, parentReadAgain.text.trim());

// ③ 非法级别 / 缺目标：用法错误 exit 2
const badLevel = run(['set', '--path', PARENT, '--level', 'super']);
assert('非法级别 exit=2', badLevel.status === 2, String(badLevel.status));
assert('非法级别给出可读原因', /只接受 deny/.test(badLevel.text), badLevel.text.trim());
const noTarget = run(['set', '--level', 'read']);
assert('缺 --path/--name exit=2', noTarget.status === 2, String(noTarget.status));

rmSync(ROOT, { recursive: true, force: true });
if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exitCode = 1;
} else {
  console.log('\n全部通过');
}
