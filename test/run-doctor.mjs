import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'gate-doctor-'));
const bin = join(import.meta.dirname, '..', 'bin', 'gate-setup.mjs');
const run = (args) => spawnSync(process.execPath, [bin, 'doctor', '--home', home, ...args], { encoding: 'utf8' });
let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS  ' + name); }
  else { fail += 1; console.log('FAIL  ' + name + (detail ? ' — ' + String(detail).trim() : '')); }
};

const empty = run([]);
check('空目录体检：0/7', empty.stdout.includes('已接线 0/7'), empty.stdout);
check('空目录体检：退出码 1', empty.status === 1, empty.status);

const fixed = run(['--fix']);
check('--fix 之后 7/7', fixed.stdout.includes('已接线 7/7'), fixed.stdout.lastLine);
check('--fix 报告每条接线', (fixed.stdout.match(/已接上/g) ?? []).length === 7, fixed.stdout);

const again = run([]);
check('复发检查：仍然 7/7 且退出码 0', again.stdout.includes('已接线 7/7') && again.status === 0, again.status);

rmSync(home, { recursive: true, force: true });
console.log('\n' + pass + '/' + (pass + fail) + ' 项通过');
process.exitCode = fail === 0 ? 0 : 1;
