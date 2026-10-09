/**
 * 门禁 · 受管辖通道自测（**含负向证据**）
 *
 *   node test/run-guard.mjs [reportDir]
 *
 * 本套件分四段，判定类全部用**真实子进程**跑 `bin/gate.mjs`，原始 stdout / stderr /
 * 退出码逐字记进报告（`guard-report.json` 的 `evidence`）——"应该不行"不算证据。
 *
 *   ① 矩阵：三级 × 四操作的判定 + 最长前缀 / 段比较（纯函数，快）
 *   ② **默认禁**：对**真的** `D:\Zcode` 跑 traverse / check，贴出被拒的原始报错
 *      （夹具状态 + 夹具名单；本套件**不读写** `D:\.agents` 下的生产配置）
 *   ③ 夹具放行：临时盘根 + 临时名单 + 临时状态，验证只读 / 可读写删真的能干活、
 *      以及"只读时不许写/删"
 *   ④ **新增能力**：路径对象命中 / 最长前缀优先 / 同前缀不误伤 / **fail-closed**
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  OPS,
  allowedOps,
  checkAccess,
  isSegmentPrefix,
  levelAllows,
  longestPrefixMatch,
  topSegmentOf,
} from '../lib/guard.js';
import { withLevel, writeState } from '../lib/store.js';
import { normalizePathKey, writeRoster } from '../lib/roster.js';

const here = import.meta.dirname;
const cli = resolve(here, '..', 'bin', 'gate.mjs');
const pluginRoot = resolve(here, '..');
const reportDir = resolve(process.argv[2] ?? join(here, 'out'));

const checks = [];
const evidence = [];

function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

/** 跑一次真实 CLI，把原始三件套记进证据表。 */
function runCli(args, label) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: pluginRoot });
  const record = {
    label,
    args: ['node', 'bin/gate.mjs', ...args],
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
  evidence.push(record);
  console.log(`\n--- [${label}] exit=${record.exitCode} ---`);
  if (record.stdout.trim() !== '') console.log(`stdout:\n${record.stdout.trimEnd()}`);
  if (record.stderr.trim() !== '') console.log(`stderr:\n${record.stderr.trimEnd()}`);
  return record;
}

const missingRosterError = (record) => /名单不可用/.test(`${record.stdout}${record.stderr}`);

// ===================== ① 判定矩阵 =====================
console.log('########## ① 判定矩阵（含最长前缀 / 段比较）##########');
check('操作清单 = traverse/read/write/delete', OPS.join(',') === 'traverse,read,write,delete', OPS.join(','));
check('deny 什么都不许', OPS.every((op) => levelAllows('deny', op) === false));
check('read 只许 traverse+read', allowedOps('read').join(',') === 'traverse,read', allowedOps('read').join(','));
check('full 四项全许', allowedOps('full').join(',') === 'traverse,read,write,delete', allowedOps('full').join(','));
check('未知级别按 deny 处理', levelAllows('whatever', 'read') === false);
check('未知操作一律不许', levelAllows('full', 'sudo') === false);

const top = topSegmentOf('D:\\Zcode\\小说\\a.md');
check('路径 → 盘根一级目录名', top.ok === true && top.top === 'Zcode', top.top ?? top.error);

const denyDecision = checkAccess({
  state: { defaultLevel: 'deny', harnesses: {} },
  rosterNames: ['Zcode'],
  path: 'D:\\Zcode\\x',
  op: 'read',
});
check('名单内 + 默认禁 ⇒ 拒', denyDecision.allowed === false && denyDecision.level === 'deny');
check('拒绝文案含级别与操作', /禁/.test(denyDecision.reason) && /读取文件内容/.test(denyDecision.reason));
check('拒绝 / 放行都带命中对象信息', denyDecision.matchedKind === 'name' && denyDecision.matchedKey === 'Zcode', JSON.stringify({ kind: denyDecision.matchedKind, key: denyDecision.matchedKey }));

const outOfScope = checkAccess({
  state: { defaultLevel: 'deny', harnesses: {} },
  rosterNames: ['Zcode'],
  path: 'D:\\工作区\\插件制作\\x',
  op: 'delete',
});
check('不在名单内 ⇒ 不属受管对象（放行但如实说明）', outOfScope.allowed === true && outOfScope.inRoster === false);

const caseInsensitive = checkAccess({
  state: { defaultLevel: 'deny', harnesses: { Zcode: { level: 'read' } } },
  rosterNames: ['zcode'],
  name: 'ZCODE',
  op: 'read',
});
check('名字大小写不敏感（名单小写、状态大写也能命中）', caseInsensitive.allowed === true && caseInsensitive.level === 'read');

const badOp = checkAccess({ state: { defaultLevel: 'deny', harnesses: {} }, rosterNames: ['Zcode'], name: 'Zcode', op: 'explode' });
check('非法操作名 ⇒ 报错（不放行）', badOp.ok === false && badOp.allowed === false);

// —— 路径段比较 / 最长前缀（纯函数）——
check('段比较：D:\\a\\b 命中 D:\\a\\b\\c', isSegmentPrefix('D:\\a\\b', 'D:\\a\\b\\c') === true);
check('段比较：D:\\a\\b **不**命中 D:\\a\\bc\\d（整段相等才认）', isSegmentPrefix('D:\\a\\b', 'D:\\a\\bc\\d') === false);
check('段比较：D:\\a 命中 D:\\A\\b（大小写不敏感）', isSegmentPrefix('D:\\a', 'D:\\A\\b') === true);
check('段比较：更长的前缀不是"前缀"', isSegmentPrefix('D:\\a\\b\\c', 'D:\\a\\b') === false);

const pathObjects = [
  { kind: 'path', key: 'D:\\tmp\\p', raw: 'D:\\tmp\\p' },
  { kind: 'path', key: 'D:\\tmp\\p\\sub', raw: 'D:\\tmp\\p\\sub' },
  { kind: 'name', key: 'tmp', raw: 'tmp' },
];
const longest = longestPrefixMatch(pathObjects, 'D:\\tmp\\p\\sub\\file.txt');
check('最长前缀命中：取更长的那条（sub 赢）', longest?.key === 'D:\\tmp\\p\\sub', JSON.stringify(longest));
check('最长前缀命中：命中对象带上 kind=path', longest?.kind === 'path');
check('最长前缀命中：完全无关的路径 ⇒ null', longestPrefixMatch(pathObjects, 'D:\\other\\x') === null, JSON.stringify(longestPrefixMatch(pathObjects, 'D:\\other\\x')));

const pathDecision = checkAccess({
  state: { defaultLevel: 'deny', harnesses: { 'D:\\tmp\\p\\sub': { level: 'read' } } },
  rosterObjects: pathObjects,
  path: 'D:\\tmp\\p\\sub\\file.txt',
  op: 'read',
});
check('给 path 时按路径对象判定（不是退回名字）', pathDecision.matchedKind === 'path' && pathDecision.matchedKey === 'D:\\tmp\\p\\sub', JSON.stringify({ kind: pathDecision.matchedKind, key: pathDecision.matchedKey }));
check('路径对象命中 + read 级 ⇒ 放行 read', pathDecision.allowed === true, pathDecision.reason);

const nameOnlyDecision = checkAccess({
  state: { defaultLevel: 'deny', harnesses: { Zcode: { level: 'read' } } },
  rosterObjects: [{ kind: 'name', key: 'Zcode', raw: 'Zcode' }],
  path: 'D:\\Zcode\\x',
  op: 'read',
});
check('路径没命中时**退回**名字对象（旧行为不破）', nameOnlyDecision.allowed === true && nameOnlyDecision.matchedKind === 'name');

// ===================== ② 默认禁（负向证据 · 夹具）=====================
console.log('\n########## ② 默认禁 · 对 D:\\Zcode 的负向实测（夹具状态 + 夹具名单）##########');

// ⚠️ 这一段刻意**不读生产配置**：夹具全禁状态 + 夹具名单 ⇒ 跑在任何机器、任何开关状态下结论一致，
//    也避免自测去写 `D:\.agents\`（那两个文件是生产资产）。生产文件只做**只读**不变式断言。
const realStatePath = 'D:\\.agents\\门禁-授权.json';
const realRosterPath = 'D:\\.agents\\门禁-名单.txt';
const negDir = mkdtempSync(join('D:\\临时', 'hs-gate-neg-'));
const negState = join(negDir, 'state.json');
const negRoster = join(negDir, 'roster.txt');
writeFileSync(negState, JSON.stringify({ version: 1, defaultLevel: 'deny', harnesses: {} }), 'utf8');
writeFileSync(negRoster, '# 夹具名单\nZcode\nopencode\n', 'utf8');
const negRosterBefore = readFileSync(negRoster, 'utf8');
const negArgs = ['--state', negState, '--roster', negRoster];

const negStatus = runCli([...negArgs, 'status'], '夹具全禁 · status');
check(
  '夹具全禁下 status 把 Zcode / opencode 都读成「禁」',
  /Zcode\s*=\s*deny/.test(negStatus.stdout) && /opencode\s*=\s*deny/.test(negStatus.stdout),
  negStatus.stdout.split('\n').filter((line) => /Zcode|opencode/.test(line)).join(' | '),
);

const realTraverse = runCli([...negArgs, 'traverse', '--path', 'D:\\Zcode'], '默认禁 · traverse D:\\Zcode');
check('默认禁时 traverse D:\\Zcode 被拒（退出码 3）', realTraverse.exitCode === 3, `exit=${realTraverse.exitCode}`);
check('被拒时 stderr 有可抄的原始报错', /拒绝：/.test(realTraverse.stderr), realTraverse.stderr.trim());
check('被拒时 stdout 为空（没有泄漏任何目录项）', realTraverse.stdout.trim() === '', JSON.stringify(realTraverse.stdout));

const realCheck = runCli([...negArgs, 'check', '--path', 'D:\\Zcode\\任意文件.md', '--op', 'read'], '默认禁 · check read');
check('默认禁时 check(read) 也被拒', realCheck.exitCode === 3, `exit=${realCheck.exitCode}`);

const realCheckDelete = runCli([...negArgs, 'check', '--name', 'opencode', '--op', 'delete'], '默认禁 · check delete');
check('默认禁时 check(delete) 也被拒', realCheckDelete.exitCode === 3, `exit=${realCheckDelete.exitCode}`);

check('本套件未改动夹具名单（仍是 Zcode/opencode）', readFileSync(negRoster, 'utf8') === negRosterBefore);

// 生产文件：**只读**不变式（存在则不得带 BOM；不因迁移期文件缺失而变红）
check(
  '生产状态文件（门禁-授权.json）：不存在，或**无 BOM**（本套件只读它）',
  !existsSync(realStatePath) || readFileSync(realStatePath, 'utf8').charCodeAt(0) !== 0xfeff,
  existsSync(realStatePath) ? '存在且无 BOM' : '尚未创建（迁移期允许）',
);
const realRosterBefore = existsSync(realRosterPath) ? readFileSync(realRosterPath, 'utf8') : null;
check(
  '生产名单文件（门禁-名单.txt）当前状态已取样（套件结束时比对未被改动）',
  realRosterBefore === null ? !existsSync(realRosterPath) : typeof realRosterBefore === 'string',
  realRosterBefore === null ? '不存在（迁移期允许）' : `${realRosterBefore.length} 字节`,
);

rmSync(negDir, { recursive: true, force: true });

// ===================== ③ 夹具放行（名字类） =====================
console.log('\n########## ③ 夹具放行（D:\\临时 下的夹具 / 临时名单 / 临时状态）##########');
// ⚠️ 夹具必须放在某个**盘根一级目录**之下，因为名字类判定取的正是"盘根一级目录名"（`D:\<名>\`）。
//    临时目录 `D:\临时\` 本身就是合法的盘根一级目录名，因此夹具用 `临时` 当名单项 ——
//    整段只跑在**临时名单 / 临时状态**上（--roster / --state 全部指向夹具），不碰真实配置。
const fx = mkdtempSync(join('D:\\临时', 'hs-gate-'));
const fxName = '临时';
const fxRoot = join(fx, 'fakeRoot');
const fxState = join(fx, 'state.json');
const fxRoster = join(fx, 'roster.txt');
const fxAudit = join(fx, 'audit.jsonl');
const fxBackup = join(fx, 'backup');
mkdirSync(join(fxRoot, 'harnessA'), { recursive: true });
mkdirSync(join(fxRoot, 'harnessB'), { recursive: true });
writeFileSync(join(fxRoot, 'harnessA', 'note.txt'), '夹具原文', 'utf8');
writeRoster(fxRoster, [fxName], { backupDir: fxBackup });

const common = ['--root', `${fxRoot}\\`, '--state', fxState, '--roster', fxRoster, '--log', fxAudit];

function setFixtureLevel(level) {
  const base = { defaultLevel: 'deny', harnesses: {} };
  writeState(fxState, withLevel(base, fxName, level).state);
}

try {
  // level = deny
  setFixtureLevel('deny');
  const fxDeny = runCli([...common, 'traverse', '--path', join(fxRoot, 'harnessA')], '夹具 deny · traverse');
  check('夹具：deny 时 traverse 被拒', fxDeny.exitCode === 3 && fxDeny.stdout.trim() === '', `exit=${fxDeny.exitCode}`);

  // level = read
  setFixtureLevel('read');
  const fxTraverse = runCli([...common, 'traverse', '--path', join(fxRoot, 'harnessA')], '夹具 read · traverse');
  check('夹具：read 时 traverse 放行并列出条目', fxTraverse.exitCode === 0 && fxTraverse.stdout.includes('note.txt'), fxTraverse.stdout.trim());

  const fxRead = runCli([...common, 'read', '--path', join(fxRoot, 'harnessA', 'note.txt')], '夹具 read · read');
  check('夹具：read 时读文件成功且内容一致', fxRead.exitCode === 0 && fxRead.stdout.includes('夹具原文'), fxRead.stdout.trim());

  const fxWrite = runCli([...common, 'write', '--path', join(fxRoot, 'harnessA', 'note.txt'), '--text', '改过了'], '夹具 read · write');
  check('夹具：read 时**不许写**', fxWrite.exitCode === 3, `exit=${fxWrite.exitCode}`);
  check('夹具：被拒的写没有改动文件', readFileSync(join(fxRoot, 'harnessA', 'note.txt'), 'utf8') === '夹具原文');

  const fxDelete = runCli([...common, 'delete', '--path', join(fxRoot, 'harnessA', 'note.txt')], '夹具 read · delete');
  check('夹具：read 时**不许删**', fxDelete.exitCode === 3, `exit=${fxDelete.exitCode}`);
  check('夹具：被拒的删没有删掉文件', existsSync(join(fxRoot, 'harnessA', 'note.txt')));

  // ---- rmdir 回归（2026-10-09 户主实测暴露的缺陷，固化在这里防复发）----
  const rmdirDir = join(fxRoot, 'harnessA', 'subdir');
  mkdirSync(rmdirDir, { recursive: true });
  const rmRead = runCli([...common, 'rmdir', '--path', rmdirDir], '夹具 read · rmdir');
  check('夹具：read 时 rmdir 被拒（exit 3）', rmRead.exitCode === 3, `exit=${rmRead.exitCode}`);
  check('夹具：被拒的 rmdir 没有删掉目录', existsSync(rmdirDir));

  writeFileSync(join(rmdirDir, 'x.txt'), 'x', 'utf8');
  setFixtureLevel('full');
  const rmNonEmpty = runCli([...common, 'rmdir', '--path', rmdirDir], '夹具 full · rmdir 非空');
  check('夹具：full 时**非空目录仍被拒**（不递归）', rmNonEmpty.exitCode === 2, `exit=${rmNonEmpty.exitCode}`);
  check('夹具：非空目录没被删（内容未动）', existsSync(join(rmdirDir, 'x.txt')));

  rmSync(join(rmdirDir, 'x.txt'), { force: true });
  const rmEmpty = runCli([...common, 'rmdir', '--path', rmdirDir], '夹具 full · rmdir 空目录');
  check('夹具：full 时**空目录删除成功**', rmEmpty.exitCode === 0, `exit=${rmEmpty.exitCode}`);
  check('夹具：空目录确已消失', !existsSync(rmdirDir));

  // level = full
  setFixtureLevel('full');
  const fxWriteOk = runCli(
    [...common, 'write', '--path', join(fxRoot, 'harnessA', 'note.txt'), '--text', '已授权改写'],
    '夹具 full · write',
  );
  check('夹具：full 时写成功', fxWriteOk.exitCode === 0 && readFileSync(join(fxRoot, 'harnessA', 'note.txt'), 'utf8') === '已授权改写');

  const fxDeleteDir = runCli([...common, 'delete', '--path', join(fxRoot, 'harnessB')], '夹具 full · delete 目录（应拒）');
  check('夹具：full 也不删目录（高风险动作不在通道能力内）', fxDeleteDir.exitCode === 2 && existsSync(join(fxRoot, 'harnessB')));

  const fxDeleteFile = runCli(
    [...common, 'delete', '--path', join(fxRoot, 'harnessA', 'note.txt'), '--backup-dir', join(fx, 'delBackup')],
    '夹具 full · delete 文件',
  );
  check('夹具：full 时文件删除成功', fxDeleteFile.exitCode === 0 && !existsSync(join(fxRoot, 'harnessA', 'note.txt')));
  check('夹具：删前真的留了备份', existsSync(join(fx, 'delBackup')), fxDeleteFile.stdout.trim());

  const fxLog = runCli([...common, 'log', '--limit', '50'], '夹具 · 审计日志');
  check('夹具：审计记下了放行与被拒', /拒绝/.test(fxLog.stdout) && /放行/.test(fxLog.stdout));

  // 「不在名单内」的盘根一级目录必须放行（它不是受管对象）。
  // 取样用**本插件自己的源码目录**（`D:\插件\dsh-access-gate` ⇒ 盘根一级目录名 = `插件`）：
  // 它一定存在（跑自测时就在里面），且不在夹具名单里 —— 不依赖任何"碰巧存在"的目录。
  const outside = runCli(
    [...common, 'traverse', '--path', pluginRoot],
    '夹具 · 名单外盘根目录（插件源码位）',
  );
  check('夹具：名单外的盘根一级目录不被本通道拦（不属受管对象）', outside.exitCode === 0, `exit=${outside.exitCode} ${outside.stderr.trim()}`);
  check('夹具：放行时理由写明"不在名单内"', /不在名单内/.test(outside.stdout), outside.stdout.trim().split('\n')[0]);
} finally {
  rmSync(fx, { recursive: true, force: true });
}

// ===================== ④ 新增能力：路径对象 / 最长前缀 / 不误伤 / fail-closed =====================
console.log('\n########## ④ 路径对象 · 最长前缀 · 不误伤 · fail-closed ##########');
const fx2 = mkdtempSync(join('D:\\临时', 'hs-gate-paths-'));
const fx2State = join(fx2, 'state.json');
const fx2Roster = join(fx2, 'roster.txt');
const fx2Log = join(fx2, 'audit.jsonl');
const fx2Backup = join(fx2, 'backup');
const fx2Root = join(fx2, 'drive');
const parentPath = join(fx2Root, 'parent');
const childPath = join(fx2Root, 'parent', 'sub');
mkdirSync(join(childPath), { recursive: true });
mkdirSync(join(parentPath, 'other'), { recursive: true });
writeFileSync(join(childPath, 'ok.txt'), '子目录原文', 'utf8');
writeFileSync(join(parentPath, 'other', 'no.txt'), 'x', 'utf8');

const siblingShort = 'D:\\临时\\hs-gate-x';
const siblingLong = 'D:\\临时\\hs-gate-xyz';
const outsideRosterPath = fx2Roster; // 复用夹具名单路径，但用例之间重写

function setPathState(levels) {
  let state = { defaultLevel: 'deny', harnesses: {} };
  for (const [key, level] of levels) state = withLevel(state, key, level, { now: new Date('2026-10-09T15:00:00Z') }).state;
  writeState(fx2State, state);
}

try {
  const args2 = ['--root', `${fx2Root}\\`, '--state', fx2State, '--roster', outsideRosterPath, '--log', fx2Log];

  // —— (a) 路径对象命中：名单里放一条绝对路径（夹具目录）——
  writeRoster(outsideRosterPath, [childPath], { backupDir: fx2Backup, now: new Date('2026-10-09T15:00:00Z') });
  setPathState([[childPath, 'read']]);
  const a1 = runCli([...args2, 'check', '--path', join(childPath, 'ok.txt'), '--op', 'read'], 'a) 路径对象 · read 级下 read');
  check('a) 路径对象命中：read 级下 check read **放行**（exit 0）', a1.exitCode === 0, `exit=${a1.exitCode}`);
  check('a) 放行理由点名受管路径', /受管路径/.test(a1.stdout), a1.stdout.trim().split('\n').pop());

  const aRead = runCli([...args2, 'read', '--path', join(childPath, 'ok.txt')], 'a) 路径对象 · 真读文件');
  check('a) 路径对象命中：read 命令真能读到内容', aRead.exitCode === 0 && aRead.stdout.includes('子目录原文'), aRead.stdout.trim());

  setPathState([[childPath, 'deny']]);
  const a2 = runCli([...args2, 'check', '--path', join(childPath, 'ok.txt'), '--op', 'read'], 'a) 路径对象 · deny 级下 read');
  check('a) 路径对象命中：deny 级下 check read **被拒**（exit 3）', a2.exitCode === 3, `exit=${a2.exitCode}`);
  check('a) 被拒时的文案含"受管路径"', /受管路径/.test(a2.stdout), a2.stdout.trim().split('\n').pop());

  // —— (b) 最长前缀优先：父 deny + 子 full ⇒ 子目录里的文件放行 ——
  writeRoster(outsideRosterPath, [parentPath, childPath], { backupDir: fx2Backup, now: new Date('2026-10-09T15:05:00Z') });
  setPathState([
    [parentPath, 'deny'],
    [childPath, 'full'],
  ]);
  const b1 = runCli([...args2, 'check', '--path', join(childPath, 'ok.txt'), '--op', 'read'], 'b) 最长前缀优先 · 子目录文件');
  check('b) 最长前缀优先：父 deny + 子 full ⇒ 子目录里的文件**放行**（长的那条赢）', b1.exitCode === 0, `exit=${b1.exitCode}`);

  const b2 = runCli([...args2, 'check', '--path', join(parentPath, 'other', 'no.txt'), '--op', 'read'], 'b) 对照：父目录其他子路径');
  check('b) 对照：同父目录下的其他路径仍按父的 deny 被拒（证明父条目确实生效）', b2.exitCode === 3, `exit=${b2.exitCode}`);

  // —— (c) 不误伤：同前缀目录 ——
  mkdirSync(siblingShort, { recursive: true });
  mkdirSync(siblingLong, { recursive: true });
  writeFileSync(join(siblingShort, 'f.txt'), 'x', 'utf8');
  writeFileSync(join(siblingLong, 'f2.txt'), 'y', 'utf8');
  const sibArgs = ['--state', fx2State, '--roster', outsideRosterPath, '--log', fx2Log];

  // 反方向（真正的字符串前缀陷阱）：名单里放**短**名，查询**长**名 ⇒ 不能被短名以字符串前缀命中
  writeRoster(outsideRosterPath, [siblingShort], { backupDir: fx2Backup, now: new Date('2026-10-09T15:10:00Z') });
  setPathState([[siblingShort, 'deny']]);
  const c1 = runCli([...sibArgs, 'check', '--path', join(siblingLong, 'f2.txt'), '--op', 'read'], 'c) 不误伤 · 长名不被短名命中');
  check(
    `c) 不误伤：${siblingLong} 不被 ${siblingShort} 以"字符串前缀"命中（放行 exit 0）`,
    c1.exitCode === 0,
    `exit=${c1.exitCode} ${c1.stdout.trim().split('\n').pop()}`,
  );
  const c2 = runCli([...sibArgs, 'check', '--path', join(siblingShort, 'f.txt'), '--op', 'read'], 'c) 对照：短名自己仍被拒');
  check('c) 对照：同一条名单项对**自己**的子文件仍按 deny 被拒（证明该条目生效，c1 的放行不是空转）', c2.exitCode === 3, `exit=${c2.exitCode}`);

  // 正方向：名单里放**长**名，查询**短**名 ⇒ 也不该被命中
  writeRoster(outsideRosterPath, [siblingLong], { backupDir: fx2Backup, now: new Date('2026-10-09T15:12:00Z') });
  setPathState([[siblingLong, 'deny']]);
  const c3 = runCli([...sibArgs, 'check', '--path', join(siblingShort, 'f.txt'), '--op', 'read'], 'c) 不误伤 · 短名不被长名命中');
  check(`c) 不误伤：${siblingShort} 不被 ${siblingLong} 命中（放行 exit 0）`, c3.exitCode === 0, `exit=${c3.exitCode}`);

  // —— (d) fail-closed：名单文件不存在 —— 通道必须一律拒绝 ——
  const missingRosterPath = join(fx2, '根本不存在的名单.txt');
  const dArgs = ['--state', fx2State, '--roster', missingRosterPath, '--log', fx2Log];
  const d1 = runCli([...dArgs, 'check', '--path', join(siblingShort, 'f.txt'), '--op', 'read'], 'd) fail-closed · 名单缺失 · check');
  check('d) fail-closed：名单文件不存在 ⇒ check 被拒（exit 3，不再"放行一切"）', d1.exitCode === 3, `exit=${d1.exitCode}`);
  check('d) fail-closed：报错含「名单不可用」（可直接抄进报告）', missingRosterError(d1), `${d1.stdout}${d1.stderr}`.trim());
  check('d) fail-closed：报错点名缺失的名单路径', new RegExp('根本不存在的名单').test(`${d1.stdout}${d1.stderr}`));

  const d2 = runCli([...dArgs, 'traverse', '--path', siblingShort], 'd) fail-closed · 名单缺失 · traverse');
  check('d) fail-closed：traverse 也被拒（exit 3）', d2.exitCode === 3, `exit=${d2.exitCode}`);
  check('d) fail-closed：traverse 的 stderr 含「名单不可用」', missingRosterError(d2), d2.stderr.trim());
  check('d) fail-closed：traverse 的 stdout 为空（一个字节都不碰）', d2.stdout.trim() === '', JSON.stringify(d2.stdout));

  const d3 = runCli([...dArgs, 'check', '--name', 'Zcode', '--op', 'read'], 'd) fail-closed · 名单缺失 · check --name');
  check('d) fail-closed：按**名字**判定同样一律拒绝（名单读不到就什么都不放）', d3.exitCode === 3, `exit=${d3.exitCode}`);

  const d4 = runCli([...dArgs, 'status'], 'd) fail-closed · 名单缺失 · status');
  check('d) fail-closed：status 如实报"名单不可用"（不伪装成"名单为空"）', /名单不可用/.test(d4.stdout), d4.stdout.split('\n').filter((line) => /名单/.test(line)).join(' | '));

  const d5 = runCli([...dArgs, 'check', '--path', 'D:\\工作区\\插件制作\\随便', '--op', 'read'], 'd) fail-closed · 名单缺失 · 名单外路径');
  check('d) fail-closed：**连"名单外路径"也拒**（旧版此处会放行 ⇒ 隔离悄悄失效）', d5.exitCode === 3, `exit=${d5.exitCode}`);

  // 夹具名单文件存在时一切照常（--roster 指夹具不受影响）
  writeRoster(outsideRosterPath, [siblingShort], { backupDir: fx2Backup, now: new Date('2026-10-09T15:20:00Z') });
  setPathState([[siblingShort, 'read']]);
  const d6 = runCli([...sibArgs, 'check', '--path', join(siblingShort, 'f.txt'), '--op', 'read'], 'd) 夹具名单存在 · 一切照常');
  check('d) 夹具名单存在时不受 fail-closed 影响（read 级放行 exit 0）', d6.exitCode === 0, `exit=${d6.exitCode}`);

  check('路径键归一化（尾分隔符 / 大小写）在后端一致', normalizePathKey(`${childPath}\\`) === normalizePathKey(childPath), normalizePathKey(`${childPath}\\`));
} finally {
  rmSync(fx2, { recursive: true, force: true });
  rmSync(siblingShort, { recursive: true, force: true });
  rmSync(siblingLong, { recursive: true, force: true });
}

// 生产名单文件：**只读**不变式（本套件全程只读它）
check(
  '生产名单文件（门禁-名单.txt）未被本套件改动（本套件只读它）',
  realRosterBefore === null ? !existsSync(realRosterPath) : readFileSync(realRosterPath, 'utf8') === realRosterBefore,
  realRosterBefore === null ? '不存在（迁移期允许）' : `${realRosterBefore.length} 字节，未变`,
);

mkdirSync(reportDir, { recursive: true });
writeFileSync(
  join(reportDir, 'guard-report.json'),
  JSON.stringify(
    {
      checks,
      evidence,
      stateFile: realStatePath,
      rosterFile: realRosterPath,
      note:
        'evidence[].stdout/stderr 是子进程原始输出，未经改写；被拒的调用在 I/O 之前就退出了。' +
        '判定用例全部跑在 D:\\临时 下的夹具上，未读写 D:\\.agents 下的生产配置。',
    },
    null,
    2,
  ),
);
console.log(`\n报告已写：${join(reportDir, 'guard-report.json')}`);

const failed = checks.filter((row) => !row.ok);
console.log(`\n=== 受管辖通道自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
