/**
 * 门禁 · 数据层自测（不需要 dsh、不需要 GUI）
 *
 *   node test/run-data-layer.mjs [reportDir]
 *
 * 覆盖：
 *   · 状态文件：缺省=全禁 · 写读往返 · **无 BOM** · 原子替换 · 坏 JSON ⇒ 报错且**不覆盖** · 大小写不敏感
 *   · **键空间**：键可以是名字或**绝对路径**；路径键归一化（去尾分隔符 / 盘符大写 / 展开 `..`）
 *     且**名字键与路径键永不互相匹配**
 *   · 名单文件：注释/空行保留 · **名字与绝对路径两类行都认** · 增删只动那一行 ·
 *     重复/缺失如实报错 · 非法名/非法路径拒绝 · **读不到 ⇒ ok:false（fail-closed 的源头）** ·
 *     **写前备份到回收站**
 *   · 差异计算：「已在名单但目录不存在」/「目录存在但未入名单」两条都能被报出来 · 大小写不一致提示
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DEFAULT_LEVEL,
  DEFAULT_STATE_PATH,
  LEVELS,
  canonicalKey,
  emptyState,
  ensureStateFile,
  findEntryKey,
  keyKindOf,
  levelOf,
  readState,
  stateOnlyNames,
  withLevel,
  writeState,
} from '../lib/store.js';
import {
  DEFAULT_ROSTER_PATH,
  addNameToLines,
  addObjectToLines,
  backupRoster,
  isValidName,
  isValidPath,
  namesFromLines,
  normalizePathKey,
  objectForName,
  objectForPath,
  parseRosterLines,
  readRoster,
  removeNameFromLines,
  removeObjectToLines,
  rosterHas,
  sameObject,
  writeRoster,
} from '../lib/roster.js';
import { HARNESS_VOCABULARY, diffRoster, listRootDirs } from '../lib/dirs.js';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

const root = mkdtempSync(join(tmpdir(), 'access-gate-data-'));
const statePath = join(root, '门禁-授权.json');
const rosterPath = join(root, '门禁-名单.txt');
const backupDir = join(root, '回收站备份');

try {
  // ---------- 状态文件 ----------
  check('缺省级别 = deny', DEFAULT_LEVEL === 'deny', DEFAULT_LEVEL);
  check('三级为 deny/read/full', LEVELS.join(',') === 'deny,read,full', LEVELS.join(','));
  check('默认状态文件落点已改名', DEFAULT_STATE_PATH === 'D:\\.agents\\门禁-授权.json', DEFAULT_STATE_PATH);
  check('默认名单落点已改名', DEFAULT_ROSTER_PATH === 'D:\\.agents\\门禁-名单.txt', DEFAULT_ROSTER_PATH);

  const missing = readState(statePath);
  check('状态文件不存在 ⇒ 全禁（不报错）', missing.ok === true && missing.exists === false && levelOf(missing.state, 'Zcode') === 'deny');

  const created = ensureStateFile(statePath, new Date('2026-10-09T13:00:00Z'));
  check('ensureStateFile 建出文件', created.created === true && existsSync(statePath), created.error ?? '');
  const rawBytes = readFileSync(statePath);
  check('状态文件无 BOM', rawBytes[0] !== 0xef || rawBytes[1] !== 0xbb || rawBytes[2] !== 0xbf, `首字节 ${rawBytes[0]}`);

  const seeded = readState(statePath);
  check('新建的状态就是全禁', Object.keys(seeded.state.harnesses).length === 0 && levelOf(seeded.state, 'Zcode') === 'deny');

  const leveled = withLevel(seeded.state, 'Zcode', 'read', { now: new Date('2026-10-09T13:05:00Z'), by: 'test' });
  check('withLevel 接受合法级别', leveled.ok === true && leveled.key === 'Zcode', leveled.error ?? '');
  check('withLevel 报出键类 = name', leveled.kind === 'name', leveled.kind);
  writeState(statePath, leveled.state, new Date('2026-10-09T13:05:00Z'));
  const roundTrip = readState(statePath);
  check('写读往返：Zcode = read', levelOf(roundTrip.state, 'Zcode') === 'read', levelOf(roundTrip.state, 'Zcode'));
  check('写后仍无 BOM', readFileSync(statePath)[0] !== 0xef);
  check('落盘对象保留 updatedBy', roundTrip.state.updatedBy === 'test', roundTrip.state.updatedBy);

  const bad = withLevel(roundTrip.state, 'opencode', 'nope');
  check('非法级别被拒', bad.ok === false, bad.error);
  const noName = withLevel(roundTrip.state, '', 'read');
  check('空键被拒', noName.ok === false, noName.error);

  check('级别查询大小写不敏感', levelOf(roundTrip.state, 'zCoDe') === 'read', levelOf(roundTrip.state, 'zCoDe'));
  check('未列出的名字 = 默认禁', levelOf(roundTrip.state, 'pi') === 'deny');

  // 坏 JSON：必须报错，且**不动**原文件
  const brokenPath = join(root, 'broken.json');
  writeFileSync(brokenPath, '{ 这不是 JSON', 'utf8');
  const brokenBefore = readFileSync(brokenPath, 'utf8');
  const broken = readState(brokenPath);
  check('坏 JSON ⇒ ok:false 且给中文原因', broken.ok === false && /不是合法 JSON/.test(broken.error ?? ''), broken.error);
  check('坏 JSON 不被覆盖', readFileSync(brokenPath, 'utf8') === brokenBefore);
  check('坏 JSON 时按全禁处理', levelOf(broken.state, 'Zcode') === 'deny');

  // 带 BOM 的状态文件也要能读（别的工具用 PS 的 -Encoding UTF8 写过的情形）
  const bomPath = join(root, 'bom.json');
  writeFileSync(bomPath, `\uFEFF${JSON.stringify({ harnesses: { Zcode: { level: 'full' } } })}`, 'utf8');
  const bomRead = readState(bomPath);
  check('带 BOM 的状态文件仍能读出 full', bomRead.ok === true && levelOf(bomRead.state, 'Zcode') === 'full', levelOf(bomRead.state, 'Zcode'));

  check('stateOnlyNames：状态有、名单没有', stateOnlyNames(roundTrip.state, ['opencode']).join(',') === 'Zcode');

  // ---------- 键空间：名字 vs 绝对路径 ----------
  check('path 键归一化：去尾分隔符', normalizePathKey('D:\\a\\b\\') === 'D:\\a\\b', normalizePathKey('D:\\a\\b\\'));
  check('path 键归一化：盘符大写', normalizePathKey('d:/a/b') === 'D:\\a\\b', normalizePathKey('d:/a/b'));
  check('path 键归一化：展开 ..', normalizePathKey('D:\\a\\..\\b') === 'D:\\b', normalizePathKey('D:\\a\\..\\b'));
  check('path 键归一化：盘根保留', normalizePathKey('D:\\') === 'D:\\', normalizePathKey('D:\\'));
  check('非绝对路径 ⇒ 归一化返回 null', normalizePathKey('Zcode') === null && normalizePathKey('') === null);

  check('isValidPath：绝对路径合法', isValidPath('D:\\a\\b').ok === true && isValidPath('D:\\a\\b').key === 'D:\\a\\b');
  check('isValidPath：纯名字不合法（不是绝对路径）', isValidPath('Zcode').ok === false, isValidPath('Zcode').error);
  check('isValidPath：通配符不合法', isValidPath('D:\\a\\*').ok === false, isValidPath('D:\\a\\*').error);
  check('isValidName：老规则不变（带分隔符不合法）', isValidName('a\\b').ok === false && isValidName('Zcode').ok === true);

  check('keyKindOf：名字 vs 路径', keyKindOf('Zcode') === 'name' && keyKindOf('D:\\a') === 'path');
  check('canonicalKey：路径被归一化', canonicalKey('d:\\a\\')?.key === 'D:\\a', JSON.stringify(canonicalKey('d:\\a\\')));
  check('canonicalKey：空 ⇒ null', canonicalKey('  ') === null);

  const pathState = withLevel(emptyState(), 'D:\\a\\b', 'full', { now: new Date('2026-10-09T13:10:00Z') });
  check('withLevel 接受绝对路径键', pathState.ok === true && pathState.kind === 'path', pathState.error ?? '');
  check('路径键落盘为归一化形态', pathState.key === 'D:\\a\\b', pathState.key);
  check('路径键查询大小写 / 尾分隔符都不敏感', levelOf(pathState.state, 'd:\\A\\B\\') === 'full', levelOf(pathState.state, 'd:\\A\\B\\'));
  check('findEntryKey 返回存储键', findEntryKey(pathState.state, 'D:\\A\\B') === 'D:\\a\\b', findEntryKey(pathState.state, 'D:\\A\\B'));
  check(
    '⚠ 名字键与路径键**不互相匹配**：查 D:\\Zcode 命不中名字键 Zcode',
    levelOf(roundTrip.state, 'D:\\Zcode') === 'deny',
    levelOf(roundTrip.state, 'D:\\Zcode'),
  );
  check(
    '⚠ 名字键与路径键**不互相匹配**：查名字 a 命不中路径键 D:\\a\\b',
    levelOf(pathState.state, 'a') === 'deny',
    levelOf(pathState.state, 'a'),
  );

  const mixedState = withLevel(pathState.state, 'Zcode', 'read', { now: new Date('2026-10-09T13:11:00Z') }).state;
  check(
    'stateOnlyNames 混两类键也能算差集',
    stateOnlyNames(mixedState, [{ kind: 'name', key: 'Zcode' }]).join(',') === 'D:\\a\\b',
    stateOnlyNames(mixedState, [{ kind: 'name', key: 'Zcode' }]).join(','),
  );

  // ---------- 名单文件 ----------
  const rosterText = [
    '# 受管对象名单（名字 + 绝对路径两类）',
    '# 一行一个对象 · 井号开头为注释',
    'Zcode',
    '',
    'opencode',
    'D:\\Zcode',
    'E:\\资料\\合作档案\\某项目\\',
    '',
  ].join('\n');
  writeFileSync(rosterPath, rosterText, 'utf8');

  const roster = readRoster(rosterPath);
  check('名单解析：注释不算对象', roster.objects.length === 4, roster.objects.map((o) => `${o.kind}:${o.key}`).join(' | '));
  check('名单解析：names = **名字类**键（向后兼容）', roster.names.join(',') === 'Zcode,opencode', roster.names.join(','));
  check('名单解析：路径行成为 path 对象', roster.objects.filter((o) => o.kind === 'path').length === 2, roster.objects.filter((o) => o.kind === 'path').map((o) => o.key).join(','));
  check('名单解析：路径键已归一化（去尾分隔符 + 盘符大写）', roster.objects.some((o) => o.key === 'E:\\资料\\合作档案\\某项目'), roster.objects.map((o) => o.key).join(' | '));
  check('名单里的路径对象原样保留 raw', roster.objects.find((o) => o.kind === 'path' && o.key === 'D:\\Zcode')?.raw === 'D:\\Zcode');
  check('rosterHas 大小写不敏感', rosterHas(roster.names, 'ZCODE') === true);

  check('parseRosterLines：非法行进 invalid 而不是静默丢弃', parseRosterLines(['a\\b', 'D:\\ok']).invalid.length === 1, JSON.stringify(parseRosterLines(['a\\b', 'D:\\ok']).invalid));
  check('objectForName / objectForPath 各守本行', objectForName('Zcode')?.kind === 'name' && objectForPath('D:\\x')?.kind === 'path' && objectForPath('Zcode') === null);
  check('sameObject：名字与路径永不相等', sameObject({ kind: 'name', key: 'Zcode' }, { kind: 'path', key: 'D:\\Zcode' }) === false);
  check('sameObject：同类忽略大小写相等', sameObject({ kind: 'path', key: 'D:\\A' }, { kind: 'path', key: 'd:\\a' }) === true);

  const added = addNameToLines(roster.lines, 'pi');
  check('加入一行名字成功', added.ok === true && namesFromLines(added.lines).includes('pi'));
  const addedTwice = addNameToLines(added.lines, 'PI');
  check('重复加入被拒（大小写不敏感）', addedTwice.ok === false && addedTwice.duplicate === true, addedTwice.error);

  const addedPath = addObjectToLines(added.lines, 'D:\\Zcode');
  check('重复加入路径被拒（按归一化比较）', addedPath.ok === false && addedPath.duplicate === true, addedPath.error);
  const addedNewPath = addObjectToLines(added.lines, 'E:\\资料\\合作档案\\某项目\\子目录');
  check('加入一条**路径**成功', addedNewPath.ok === true && addedNewPath.kind === 'path', JSON.stringify(addedNewPath.object));

  const removed = removeNameFromLines(added.lines, 'opencode');
  check('移除一行名字成功', removed.ok === true && !namesFromLines(removed.lines).includes('opencode'));
  check('移除时注释原样保留', removed.lines.filter((line) => /^\s*#/.test(line)).length === 2);
  const removedMissing = removeNameFromLines(removed.lines, 'codex');
  check('移除不存在的行 ⇒ 如实报错', removedMissing.ok === false && removedMissing.missing === true, removedMissing.error);

  const removedPath = removeObjectToLines(added.lines, 'D:\\Zcode\\');
  check('移除一条**路径**成功（尾分隔符不影响命中）', removedPath.ok === true && !parseRosterLines(removedPath.lines).objects.some((o) => o.key === 'D:\\Zcode'), removedPath.error);
  check('移除路径后名字行仍在（两类互不牵连）', parseRosterLines(removedPath.lines).objects.filter((o) => o.kind === 'name').length === added.lines.filter((l) => /^\s*[^#\s]/.test(l)).length - 2, parseRosterLines(removedPath.lines).objects.map((o) => `${o.kind}:${o.key}`).join(' | '));
  const removedNameNotPath = removeObjectToLines(added.lines, 'Zcode');
  check('按名字移除不会牵连同名路径行（键空间隔离）', removedNameNotPath.ok === true && parseRosterLines(removedNameNotPath.lines).objects.some((o) => o.kind === 'path' && o.key === 'D:\\Zcode'), removedNameNotPath.error);

  check('非法名：带路径分隔符被拒', isValidName('a\\b').ok === false && isValidName('a/b').ok === false);
  check('非法名：. 与 .. 被拒', isValidName('.').ok === false && isValidName('..').ok === false);
  check('非法名：空被拒', isValidName('   ').ok === false);
  check('加入非法行被拒（既不是名字也不是绝对路径）', addObjectToLines(roster.lines, 'a\\b').ok === false, addObjectToLines(roster.lines, 'a\\b').error);

  const written = writeRoster(rosterPath, added.lines, { backupDir, now: new Date('2026-10-09T14:00:00Z') });
  check('写名单成功且有备份路径', written.ok === true && typeof written.backup === 'string', written.backup ?? written.error);
  check('备份文件真的落在备份目录', existsSync(written.backup) && readdirSync(backupDir).length === 1, written.backup);
  check('备份文件名用新名（门禁-名单.*.txt）', /门禁-名单\.\d{8}-\d{6}\.txt$/.test(written.backup), written.backup);
  check('备份内容 = 改动前原文', readFileSync(written.backup, 'utf8') === rosterText);
  const afterWrite = readRoster(rosterPath);
  check('名单落盘后名字 = Zcode,opencode,pi', afterWrite.names.join(',') === 'Zcode,opencode,pi', afterWrite.names.join(','));
  check('名单文件无 BOM', readFileSync(rosterPath)[0] !== 0xef);
  check('名单文件用 CRLF 行尾（与原文风格一致）', readFileSync(rosterPath, 'utf8').includes('\r\n'));

  const noBackup = writeRoster(join(root, 'sub', 'nonexistent-dir-file.txt'), ['a', 'b'], { backupDir: join(root, 'x') });
  check('对不存在的名单文件也能写（自动建父目录）', noBackup.ok === true, noBackup.error);
  const backupSkipped = backupRoster(join(root, 'nope.txt'), backupDir);
  check('原文件不存在时备份标记为 skipped', backupSkipped.ok === true && backupSkipped.skipped === true);

  // ---------- fail-closed 的源头：名单读不到 ⇒ ok:false ----------
  const missingRoster = readRoster(join(root, '根本没有这个名单.txt'));
  check('名单文件不存在 ⇒ ok:false（不再是"放行一切"）', missingRoster.ok === false && missingRoster.exists === false, missingRoster.error);
  check('名单读不到时给中文原因（含"一律拒绝"）', /一律拒绝/.test(missingRoster.error ?? ''), missingRoster.error);
  check('名单读不到时 objects 为空（判定侧不会拿到半份名单）', Array.isArray(missingRoster.objects) && missingRoster.objects.length === 0);
  const blankPathRoster = readRoster('   ');
  check('未配置名单路径 ⇒ ok:false', blankPathRoster.ok === false, blankPathRoster.error);

  // ---------- 差异计算（名字类） ----------
  const diffRoot = mkdtempSync(join(tmpdir(), 'access-gate-root-'));
  mkdirSync(join(diffRoot, 'Zcode'));
  mkdirSync(join(diffRoot, 'zcode-typo-missing')); // 故意不建 opencode，制造"名单有、盘上没有"
  mkdirSync(join(diffRoot, 'pi')); // 疑似新 harness，未入名单
  mkdirSync(join(diffRoot, 'not-a-harness-at-all'));
  writeFileSync(join(diffRoot, 'a-file.txt'), 'x', 'utf8');

  const listed = listRootDirs(diffRoot);
  check('listRootDirs 只列目录、不列文件', listed.ok === true && !listed.dirs.includes('a-file.txt'), listed.dirs.join(','));

  const diff = diffRoster({ rosterNames: ['Zcode', 'opencode'], rootDirs: listed.dirs, vocabulary: HARNESS_VOCABULARY });
  check('差异：已在名单但目录不存在 → opencode', diff.summary.rosterMissingDir.join(',') === 'opencode', diff.summary.rosterMissingDir.join(','));
  check('差异：目录存在但未入名单（疑似受管）→ pi', diff.summary.dirNotListedSuspect.includes('pi'), diff.summary.dirNotListedSuspect.join(','));
  check('差异：普通未入名单目录不被误报为受管', diff.summary.dirNotListedSuspect.includes('not-a-harness-at-all') === false);
  check('差异：Zcode 行状态 = ok', diff.rows.find((row) => row.name === 'Zcode')?.status === 'ok');
  check('差异：提示文案已改口径（"疑似受管目录"）', /疑似受管目录/.test(diff.unlisted.find((row) => row.name === 'pi')?.hint ?? ''), diff.unlisted.find((row) => row.name === 'pi')?.hint);

  const caseDiff = diffRoster({ rosterNames: ['zCoDe'], rootDirs: ['Zcode'], vocabulary: [] });
  check('大小写不一致能被报出', caseDiff.rows[0].status === 'case-mismatch', caseDiff.rows[0].status);

  rmSync(diffRoot, { recursive: true, force: true });
} finally {
  rmSync(root, { recursive: true, force: true });
}

mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, 'data-layer-report.json'), JSON.stringify({ checks }, null, 2));
console.log(`\n报告已写：${join(reportDir, 'data-layer-report.json')}`);

const failed = checks.filter((row) => !row.ok);
console.log(`\n=== 数据层自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
