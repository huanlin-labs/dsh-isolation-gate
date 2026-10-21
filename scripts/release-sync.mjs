#!/usr/bin/env node
// 发版双端同步检查：本地版本 == npm latest == git tag == GitHub Release
// 用法：npm run release:check    退出码 0=同步，1=不同步，2=环境问题
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const name = pkg.name;
const version = pkg.version;
const tag = `v${version}`;

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function safe(cmd, args) {
  try { return { ok: true, out: run(cmd, args) }; } catch (e) { return { ok: false, out: (e.stderr || e.message || '').toString().trim() }; }
}

const rows = [];
const problems = [];
let envFailed = false;

// 1. npm
const npmArgs = ['view', name, 'version', '--registry', 'https://registry.npmjs.org'];
const npm = process.platform === 'win32'
  ? (() => { try { return { ok: true, out: run('cmd.exe', ['/c', 'npm', ...npmArgs]) }; } catch (e) { return { ok: false, out: (e.stderr || e.message || '').toString().trim() }; } })()
  : safe('npm', npmArgs);
if (!npm.ok) { envFailed = true; rows.push(['npm latest', '查询失败', npm.out.split('\n')[0]]); }
else {
  rows.push(['npm latest', npm.out, npm.out === version ? 'OK' : '不同步']);
  if (npm.out !== version) problems.push(`npm latest 是 ${npm.out}，本地是 ${version}（先 npm publish）`);
}

// 2. git tag
const gitTag = safe('git', ['tag', '--list', tag]);
if (!gitTag.ok) { rows.push(['git tag', '查询失败', gitTag.out.split('\n')[0]]); }
else {
  rows.push(['git tag', gitTag.out || `(缺 ${tag})`, gitTag.out === tag ? 'OK' : '缺 tag']);
  if (gitTag.out !== tag) problems.push(`缺 git tag ${tag}（git tag -a ${tag} -m "..." && git push origin ${tag}）`);
}

// 3. GitHub Release
const rel = safe('gh', ['release', 'view', tag, '--json', 'tagName', '--jq', '.tagName']);
if (!rel.ok) {
  rows.push(['GitHub Release', `(缺 ${tag})`, '缺 Release']);
  problems.push(`GitHub 上没有 Release ${tag}（gh release create ${tag} --title "..." --notes-file ... --latest）`);
} else {
  rows.push(['GitHub Release', rel.out, rel.out === tag ? 'OK' : '不同步']);
  if (rel.out !== tag) problems.push(`Release 标签是 ${rel.out}，期望 ${tag}`);
}

// 4. 元数据回链
const meta = [
  ['repository', pkg.repository?.url, 'github.com'],
  ['homepage', pkg.homepage, 'github.com'],
  ['bugs', pkg.bugs?.url, 'github.com'],
];
for (const [k, v, need] of meta) {
  const ok = typeof v === 'string' && v.includes(need);
  rows.push([k, v || '(缺)', ok ? 'OK' : '缺/错']);
  if (!ok) problems.push(`package.json 的 ${k} 没指向 GitHub`);
}

// 5. 发现性关键词（npm 侧最重要的两个：dsh-plugin、deepseek-harness）
const kw = pkg.keywords || [];
for (const k of ['dsh', 'dsh-plugin', 'dsh-bundle', 'deepseek-harness']) {
  const ok = kw.includes(k);
  rows.push([`keyword ${k}`, ok ? '有' : '缺', ok ? 'OK' : '建议补']);
  if (!ok) problems.push(`package.json keywords 缺 "${k}"（插件市场按关键词抓取）`);
}

const w = [16, 46, 10];
const line = (cells) => cells.map((c, i) => String(c).padEnd(w[i])).join(' ');
console.log(`\n${name} 发版同步检查（本地 ${version}）\n`);
console.log(line(['项目', '实际', '结论']));
console.log('-'.repeat(w.reduce((a, b) => a + b, 0)));
for (const r of rows) console.log(line(r));

if (envFailed) { console.log('\n⚠️ 环境问题：查询 npm 失败（代理/网络？）\n'); process.exit(2); }
if (problems.length) {
  console.log('\n✗ 不同步，待办：');
  for (const p of problems) console.log('  - ' + p);
  console.log('');
  process.exit(1);
}
console.log('\n✓ 两端一致：npm latest / git tag / GitHub Release / 元数据 / 关键词\n');
