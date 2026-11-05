/**
 * 套件：分组不被改级别抹掉（2026-11-05 事故回归）
 *
 * 事故：一次批量改级别之后，状态文件里的 groups 变成 {}，所有对象的 group 也被清空，
 * 且审计里找不到任何 delete-group —— 说明是某条写路径把组字段丢了，不是用户删组。
 *
 * 本套件钉住三件事：
 *   1. withLevel 只改 level，不得动 group；
 *   2. service.setLevel 落盘后，组与归属仍在；
 *   3. 每次写状态都在同目录留一份上一版快照 `<state>.bak`（事后可回滚/取证）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyState,
  groupsOf,
  levelOf,
  readState,
  withGroup,
  withLevel,
  writeState,
} from '../lib/store.js';
import { normalizeConfig, setLevel } from '../lib/service.js';

const ROOT = mkdtempSync(join(tmpdir(), 'gate-group-'));
const STATE = join(ROOT, 'state.json');
const ROSTER = join(ROOT, 'roster.txt');
const AUDIT = join(ROOT, 'audit.jsonl');
const GROUP = 'probe-group';
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

writeFileSync(ROSTER, 'ProbeA\nProbeB\n', 'utf8');

let state = withGroup(emptyState(), 'ProbeA', GROUP).state;
state = withGroup(state, 'ProbeB', GROUP).state;
writeState(STATE, state);

assert('建组后 groups 有该组', groupsOf(readState(STATE).state).some((g) => g.name === GROUP));
assert('建组后两个成员都在组里', groupsOf(readState(STATE).state)[0]?.count === 2);

// ① store 层：改级别保留分组
const afterLevel = withLevel(readState(STATE).state, 'ProbeA', 'read');
assert('withLevel 不动 group', afterLevel.state.objects.ProbeA.group === GROUP, String(afterLevel.state.objects.ProbeA.group));
writeState(STATE, afterLevel.state);
assert('落盘后组仍在', groupsOf(readState(STATE).state).some((g) => g.name === GROUP));
assert('落盘后成员归属仍在', readState(STATE).state.objects.ProbeA.group === GROUP);

// ② 第二次写应留下上一版快照
const beforeService = readFileSync(STATE, 'utf8');
const cfg = normalizeConfig({ statePath: STATE, rosterPath: ROSTER, auditPath: AUDIT });
const result = setLevel(cfg, { name: 'ProbeB', level: 'read' }, { now: new Date(), by: 'gui' });
assert('service.setLevel 成功', result.ok === true, result.error ?? '');
const afterService = readState(STATE).state;
assert('service.setLevel 后组仍在', groupsOf(afterService).some((g) => g.name === GROUP));
assert('service.setLevel 后两名成员归属仍在', afterService.objects.ProbeA.group === GROUP && afterService.objects.ProbeB.group === GROUP);
assert('service.setLevel 后级别确实变了', levelOf(afterService, 'ProbeB') === 'read', String(levelOf(afterService, 'ProbeB')));

let backup = '';
try {
  backup = readFileSync(`${STATE}.bak`, 'utf8');
} catch {
  backup = '';
}
assert('写了 .bak 快照', backup !== '');
assert('.bak 内容是上一版（未含本次改级别）', backup === beforeService, backup === '' ? 'missing' : 'differs');

rmSync(ROOT, { recursive: true, force: true });
if (failed > 0) {
  console.log(`\n${failed} 项失败`);
  process.exitCode = 1;
} else {
  console.log('\n全部通过');
}
