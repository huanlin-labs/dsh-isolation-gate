#!/usr/bin/env node
/**
 * 发布面一致性核对（只读）：本地 package.json / CHANGELOG / npm registry / GitHub tag 四处比对。
 *
 * 用法：node tools/check-release-face.mjs [--remote origin]
 * 退出码：0 完全一致 / 1 有不一致 / 2 环境问题（没网、没 git）
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { get } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const remote = process.argv.includes('--remote')
  ? process.argv[process.argv.indexOf('--remote') + 1]
  : 'origin';

const rows = [];
let bad = 0;
function record(item, value, ok) {
  rows.push({ item, value, ok });
  if (!ok) bad += 1;
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
} catch (error) {
  console.error(`读不到 package.json：${error.message}`);
  process.exit(2);
}

record('package.json version', pkg.version, Boolean(pkg.version));

let changelogHead = '';
try {
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const match = changelog.match(/^##\s+([0-9]+\.[0-9]+\.[0-9]+)/m);
  changelogHead = match ? match[1] : '';
} catch {
  changelogHead = '';
}
record('CHANGELOG 最新条目', changelogHead || '（未找到）', changelogHead === pkg.version);

let npmVersion = '';
try {
  npmVersion = await new Promise((resolve, reject) => {
    const req = get(`https://registry.npmjs.org/${pkg.name}/latest`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).version ?? '');
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
} catch (error) {
  console.error(`registry 查询失败（环境问题）：${error.message}`);
  process.exit(2);
}
record('npm registry latest', npmVersion, npmVersion === pkg.version);

let remoteTags = [];
try {
  const out = execFileSync(
    'git',
    ['-c', 'http.sslVerify=false', 'ls-remote', '--tags', remote],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  remoteTags = out
    .split('\n')
    .map((line) => line.split('refs/tags/')[1] ?? '')
    .filter((tag) => tag && !tag.endsWith('^{}'))
    .map((tag) => tag.trim());
} catch (error) {
  console.error(`git ls-remote 失败（环境问题）：${error.message}`);
  process.exit(2);
}
const wantTag = `v${pkg.version}`;
const hasTag = remoteTags.includes(wantTag);
record(`GitHub tag ${wantTag}`, hasTag ? '存在' : `缺失（远端共 ${remoteTags.length} 个 tag）`, hasTag);

const newest = remoteTags
  .map((tag) => tag.replace(/^v/, ''))
  .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
  .sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  })
  .pop();
record('GitHub 最高版本 tag', newest ? `v${newest}` : '（无）', newest === pkg.version);

const width = Math.max(...rows.map((row) => row.item.length));
for (const row of rows) {
  console.log(`${row.ok ? 'OK  ' : 'FAIL'}  ${row.item.padEnd(width)}  ${row.value}`);
}
console.log(bad === 0 ? '\n发布面一致' : `\n${bad} 处不一致`);
process.exit(bad === 0 ? 0 : 1);
