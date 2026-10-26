#!/usr/bin/env node
/**
 * 设置页（gate ui）：本地 HTTP 接口的行为测试。
 * 夹具自带状态 / 名单，绝不碰本机真实门禁。
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startUi } from '../bin/gate-ui.mjs';

const root = mkdtempSync(join(tmpdir(), 'isolation-gate-ui-'));
const statePath = join(root, '门禁-授权.json');
const rosterPath = join(root, '门禁-名单.txt');
const auditPath = join(root, '审计.jsonl');
writeFileSync(rosterPath, 'Zcode\n', 'utf8');
process.env.GATE_STATE_PATH = statePath;
process.env.GATE_ROSTER_PATH = rosterPath;
process.env.GATE_AUDIT_PATH = auditPath;
process.env.GATE_ROOT = 'D:\\';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ui = await startUi({ port: 0 });
const base = ui.url.replace(/\/$/, '');

try {
  console.log('\n【1】页面与只读接口');
  {
    const html = await (await fetch(`${base}/`)).text();
    check('首页返回 HTML', html.includes('门禁 · 设置'));
    const report = await (await fetch(`${base}/api/report`)).json();
    check('report 有对象', Array.isArray(report.roster) && report.roster.length >= 1, String(report.roster?.length));
    check('report 带级别表', Array.isArray(report.levels) && report.levels.length === 3);
    const token = /const TOKEN="([a-f0-9]+)"/.exec(html)?.[1] ?? '';
    check('页面带 token', token.length === 32, String(token.length));
  }

  console.log('\n【2】写操作需要 token');
  {
    const res = await fetch(`${base}/api/level`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'Zcode', level: 'full' }),
    });
    check('无 token 被拒 403', res.status === 403, String(res.status));
  }

  const html = await (await fetch(`${base}/`)).text();
  const token = /const TOKEN="([a-f0-9]+)"/.exec(html)?.[1] ?? '';
  const post = (action, body) =>
    fetch(`${base}/api/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gate-token': token },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  console.log('\n【3】改级别 / 加对象 / 删对象');
  {
    const level = await post('level', { key: 'Zcode', level: 'read' });
    check('改级别成功', level.ok === true, JSON.stringify(level).slice(0, 90));
    const saved = JSON.parse(readFileSync(statePath, 'utf8'));
    check('落盘级别 = read', saved.objects?.Zcode?.level === 'read', saved.objects?.Zcode?.level);

    const added = await post('add', { value: 'D:\\secret' });
    check('新增路径成功', added.ok === true, JSON.stringify(added).slice(0, 90));
    check('名单里出现路径行', readFileSync(rosterPath, 'utf8').includes('D:\\secret'));

    const removed = await post('remove', { key: 'D:\\secret' });
    check('移出名单成功', removed.ok === true, JSON.stringify(removed).slice(0, 90));
    check('名单里路径行已消失', !readFileSync(rosterPath, 'utf8').includes('D:\\secret'));
  }

  console.log('\n【4】整组切档');
  {
    const r = await post('group-level', { group: 'harness 隔离', level: 'deny' });
    check('整组切档有返回', typeof r === 'object', JSON.stringify(r).slice(0, 90));
  }
} finally {
  ui.close();
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n[gate-ui] ${pass} 通过 / ${fail} 失败`);
process.exitCode = fail === 0 ? 0 : 1;
