#!/usr/bin/env node
/**
 * 装得上、跑得动 —— 用 npm pack 出的 tarball 在临时目录里真装一遍，再跑 doctor。
 *
 * 目的：registry 上有版本号 ≠ 别人装得上。这个脚本证明「包本身」可安装、可执行、
 * 且 doctor 的 --fix 能把 0/7 拉满到 7/7（全程只写临时 home，不碰真实配置）。
 *
 * 用法：node scripts/verify-install.mjs
 * 退出码：0 = 装得上且 doctor 行为符合预期；1 = 任一步不符。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) =>
  execFileSync(npm, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const runNode = (args, cwd) => {
  try {
    return execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // doctor 在“未接线”时按设计以退出码 1 结束 —— 这里要的是输出，不是码。
    if (typeof error?.stdout === 'string' && error.stdout !== '') return error.stdout;
    throw error;
  }
};

let work;
let ok = true;
const fail = (message) => {
  ok = false;
  console.error(`✘ ${message}`);
};

try {
  work = mkdtempSync(join(tmpdir(), 'gate-install-'));
  const packed = run(['pack', '--silent', root], work).trim().split('\n').pop();
  const tarball = join(work, packed);
  console.log(`· 打包 ${packed}`);

  run(['init', '-y', '--silent'], work);
  run(['install', '--silent', '--no-audit', '--no-fund', tarball], work);

  const pkgDir = join(work, 'node_modules', 'dsh-isolation-gate');
  const installed = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const local = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (installed.version !== local.version) fail(`装上的是 ${installed.version}，仓库是 ${local.version}`);
  else console.log(`✔ 安装后版本 ${installed.version}`);

  const home = join(work, 'home');
  mkdirSync(home, { recursive: true });
  const setup = join(pkgDir, 'bin', 'gate-setup.mjs');

  const first = runNode([setup, 'doctor', '--home', home], work);
  if (!/已接线 0\/7/.test(first)) fail(`空 home 应为 0/7，实际：${first.trim().split('\n').pop()}`);
  else console.log('✔ 空 home ⇒ 0/7');

  const fixed = runNode([setup, 'doctor', '--fix', '--home', home], work);
  if (!/已接线 7\/7/.test(fixed)) fail(`--fix 后应为 7/7，实际：${fixed.trim().split('\n').pop()}`);
  else console.log('✔ --fix ⇒ 7/7');

  const again = runNode([setup, 'doctor', '--home', home], work);
  if (!/已接线 7\/7/.test(again)) fail(`再查应为 7/7，实际：${again.trim().split('\n').pop()}`);
  else console.log('✔ 再查仍 7/7（可重复）');
} catch (error) {
  fail(`安装验证抛错：${error?.stderr || error?.message || String(error)}`);
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}

if (!ok) process.exitCode = 1;
else console.log('安装验证通过。');
