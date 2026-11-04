/**
 * 套件：审计统计（gate stats）
 *
 * 目的：统计必须**只读**、口径正确、能按时间窗过滤。
 * 做法：造一份已知内容的 audit.jsonl，跑 CLI 断言数字；再断言原文件一个字节没变。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = mkdtempSync(join(tmpdir(), 'gate-stats-'));
const CLI = join(import.meta.dirname, '..', 'bin', 'gate.mjs');
const STATE = join(ROOT, 'state.json');
const ROSTER = join(ROOT, 'roster.txt');
const AUDIT = join(ROOT, 'audit.jsonl');
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const entries = [
  { at: iso(3600e3), channel: 'cli', name: 'Alpha', level: 'deny', op: 'read', allowed: false },
  { at: iso(2 * 3600e3), channel: 'cli', name: 'Alpha', level: 'full', op: 'write', allowed: true },
  { at: iso(3 * 3600e3), channel: 'gui', name: 'Beta', level: 'read', op: 'read', allowed: true },
  { at: iso(4 * 3600e3), channel: 'gui', name: 'Beta', level: 'read', op: 'delete', allowed: false },
  { at: iso(3 * 86400e3), channel: 'hook', name: 'Gamma', level: 'deny', op: 'traverse', allowed: false },
  { at: iso(4 * 86400e3), channel: 'hook', name: 'Gamma', level: 'deny', op: 'read', allowed: false },
];
writeFileSync(AUDIT, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
writeFileSync(ROSTER, 'Alpha\n', 'utf8');
const before = readFileSync(AUDIT, 'utf8');

function run(args) {
  const r = spawnSync(process.execPath, [CLI, 'stats', ...args, '--state', STATE, '--roster', ROSTER, '--log', AUDIT], {
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// ① 全部：6 条 · 放行 2 · 拒绝 4
const all = run(['--json']);
assert('stats --json exit=0', all.status === 0, `实际 ${all.status} ${all.err}`);
let parsed = null;
try {
  parsed = JSON.parse(all.out);
} catch {
  parsed = null;
}
assert('输出是合法 JSON', parsed !== null);
assert('总数 6', parsed?.total === 6, String(parsed?.total));
assert('放行 2', parsed?.counts?.allowed === 2, String(parsed?.counts?.allowed));
assert('拒绝 4', parsed?.counts?.denied === 4, String(parsed?.counts?.denied));
assert('Alpha 记 2 次', parsed?.counts?.byName?.[0]?.count >= 2, JSON.stringify(parsed?.counts?.byName));
assert('按天分 3 个桶', parsed?.counts?.byDay?.length === 3, JSON.stringify(parsed?.counts?.byDay));
assert('通道数 3', parsed?.counts?.byChannel?.length === 3, JSON.stringify(parsed?.counts?.byChannel));

// ② 最近 1 天：只剩 4 条（3 天前那两条被过滤）
const day = run(['--days', '1', '--json']);
const dayParsed = JSON.parse(day.out);
assert('--days 1 只算 4 条', dayParsed.total === 4, String(dayParsed.total));
assert('--days 1 拒绝 2', dayParsed.counts.denied === 2, String(dayParsed.counts.denied));

// ③ 人类可读输出含关键字段
const human = run([]);
assert('人类输出含"拒绝率"', /拒绝率/.test(human.out), human.out.trim());
assert('人类输出含"最常被碰"', /最常被碰/.test(human.out), human.out.trim());

// ④ 统计只读：文件一个字节没变
const after = readFileSync(AUDIT, 'utf8');
assert('审计文件未被改写', before === after);

// ⑤ 空日志也能正常返回 0（不报错）
writeFileSync(AUDIT, '', 'utf8');
const empty = run([]);
assert('空日志 exit=0', empty.status === 0, String(empty.status));
assert('空日志提示无记录', /没有记录/.test(empty.out), empty.out.trim());

rmSync(ROOT, { recursive: true, force: true });
if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exitCode = 1;
} else {
  console.log('\n全部通过');
}
