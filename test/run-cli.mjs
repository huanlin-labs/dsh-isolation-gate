/**
 * CLI 契约：`--version` / `-v` 必须打印与 package.json 一致的版本，且 exit 0。
 *
 *   node test/run-cli.mjs [报告目录]
 *
 * 这条看似琐碎，但它是**支持场景的第一句话**：用户报问题时先问版本。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
mkdirSync(reportDir, { recursive: true });

const expected = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const results = [];
const check = (label, ok, detail) => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

for (const [label, bin] of [
  ['gate --version', 'bin/gate.mjs'],
  ['gate -v', 'bin/gate.mjs'],
  ['gate-setup --version', 'bin/gate-setup.mjs'],
  ['gate-setup -v', 'bin/gate-setup.mjs'],
]) {
  const flag = label.endsWith('-v') ? '-v' : '--version';
  const out = execFileSync(process.execPath, [join(root, bin), flag], { encoding: 'utf8', env: { ...process.env } }).trim();
  check(label, out === `dsh-isolation-gate ${expected}`, out);
}

const failed = results.filter((row) => !row.ok).length;
writeFileSync(join(reportDir, 'cli.json'), JSON.stringify({ expected, results }, null, 2), 'utf8');
console.log(`\n${results.length - failed}/${results.length} 项通过`);
process.exit(failed === 0 ? 0 : 1);
