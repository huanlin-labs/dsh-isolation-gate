import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
const want = pkg.version;
const url = `https://registry.npmjs.org/${pkg.name}/latest`;
for (let i = 1; i <= 30; i += 1) {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (res.ok) {
    const body = await res.json();
    if (body.version === want) {
      console.log(`✔ registry 已是 ${want}`);
      process.exitCode = 0;
      break;
    }
    console.log(`… registry 现在是 ${body.version}，等 ${want}`);
  } else {
    console.log(`… registry HTTP ${res.status}`);
  }
  await new Promise((r) => setTimeout(r, 10000));
}
console.error(`✘ 等了 5 分钟，registry 仍未出现 ${want}`);
process.exitCode = 1;
