#!/usr/bin/env node
/**
 * 发布前自检 —— 专治「发了等于没改」。
 *
 * 检四件事：
 *  1. package.json 版本 == lib/index.js 里的 VERSION（插件自报身份不能撒谎）
 *  2. CHANGELOG.md 最新条目就是这个版本
 *  3. README / README.en 里引用的每张本地图片都真实存在（不留 404 图）
 *  4. `git status --porcelain` 干净以外的情况：至少有一个文件相对上一个 tag 变了
 *
 * 用法：node scripts/prepublish-check.mjs      （npm publish 前自动跑）
 * 退出码：0 通过 / 1 不通过
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fail = [];
const ok = [];

const read = (p) => readFileSync(join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));

// 1. 版本一致
const libIndex = read('lib/index.js');
const m = libIndex.match(/const VERSION = '([^']+)'/);
if (!m) fail.push('lib/index.js 里找不到 VERSION 常量');
else if (m[1] !== pkg.version) fail.push(`lib/index.js VERSION=${m[1]}，package.json=${pkg.version}`);
else ok.push(`版本一致 ${pkg.version}`);

// 2. CHANGELOG 有本条
const changelog = read('CHANGELOG.md');
if (!changelog.startsWith(`## ${pkg.version}`)) fail.push(`CHANGELOG.md 没有以 "## ${pkg.version}" 开头的最新条目`);
else ok.push('CHANGELOG 有本版本条目');

// 3. README 图片都存在
const imageRefs = new Set();
for (const file of ['README.md', 'README.en.md']) {
  if (!existsSync(join(root, file))) continue;
  const text = read(file);
  for (const mm of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) imageRefs.add(mm[1]);
  for (const mm of text.matchAll(/<img[^>]+src="([^"]+)"/g)) imageRefs.add(mm[1]);
}
const missing = [];
for (const ref of imageRefs) {
  if (/^https?:/i.test(ref)) continue;
  if (!existsSync(join(root, ref))) missing.push(ref);
}
if (missing.length > 0) fail.push(`README 图片不存在：${missing.join(', ')}`);
else ok.push(`README 图片引用全部存在（${imageRefs.size} 个）`);

// 4. 相对上一个 tag，确实有文件内容变化
try {
  const lastTag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: root, encoding: 'utf8' }).trim();
  const changed = execFileSync('git', ['diff', '--name-only', lastTag, 'HEAD'], { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  // 只算会进包的文件（排除 docs 里的说明与 CI 配置不算——它们不进 npm 包，但 README 会进）
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  const total = new Set([...changed, ...dirty.map((line) => line.slice(3))]).size;
  if (total === 0) fail.push(`相对 ${lastTag} 没有任何文件变化（含未提交）—— 这是空改动，别发`);
  else ok.push(`相对 ${lastTag} 有 ${total} 个文件变化（含未提交 ${dirty.length}）`);
} catch {
  ok.push('没有可用 git tag（跳过变化检查）');
}

for (const line of ok) console.log(`✔ ${line}`);
for (const line of fail) console.error(`✘ ${line}`);
if (fail.length > 0) {
  console.error('\n发布前自检未通过。');
  process.exitCode = 1;
} else {
  console.log('\n发布前自检通过。');
}
