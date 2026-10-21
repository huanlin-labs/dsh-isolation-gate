#!/usr/bin/env node
/**
 * gate —— 受管辖的访问通道（agent / 工具侧唯一入口）
 *
 * 用法（全部先判定、后动手；判定不通过就**一个字节都不碰**）：
 *
 *   node bin/gate.mjs status                     看全部受管对象的级别（agent 读状态用）
 *   node bin/gate.mjs policy                     紧凑策略行（可直接塞进提示词/规则）
 *   node bin/gate.mjs check --name Zcode --op read
 *   node bin/gate.mjs check --path "D:\\Zcode\\某文件" --op delete
 *   node bin/gate.mjs check --path "E:\\资料\\合作档案\\某项目\\a.md" --op read
 *   node bin/gate.mjs traverse --path "D:\\Zcode"
 *   node bin/gate.mjs read  --path "D:\\Zcode\\某文件"
 *   node bin/gate.mjs write --path "D:\\Zcode\\某文件" --text "内容"
 *   node bin/gate.mjs delete --path "D:\\Zcode\\某文件"      （删前自动备份到回收站）
 *   node bin/gate.mjs rmdir  --path "D:\\Zcode\\空目录"      （只删**空目录**；不递归，非空一律拒）
 *   node bin/gate.mjs log --limit 20
 *
 * 退出码：0 = 放行 / 成功 · 3 = **被拒**（授权不足，拒绝文案在 stderr） · 2 = 用错或环境错误。
 *
 * 可选参数：--state <路径> · --roster <路径> · --root <盘根> · --log <审计路径>
 *          --channel <通道名> · --json · --no-backup
 *
 * ⚠️ **fail-closed**：名单文件缺失 / 读坏 ⇒ **一律拒绝**（exit 3，文案含"名单不可用"）。
 *    旧版在同样情形下会"放行一切"（隔离悄悄失效）—— 现已改为拒到底。
 *
 * ⚠️ 本通道**只**能替代"你本来要直接读写受管对象"的那一步；它不会自己变聪明：
 * 走别的路绕开它，等于把"授权以 GUI 门禁开关为准"这条规则丢掉。
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { appendAudit, readAudit } from '../lib/audit.js';
import { buildReport, check, levelInfo, normalizeConfig } from '../lib/service.js';
import { readRoster } from '../lib/roster.js';
import { readState } from '../lib/store.js';

const CHANNEL = 'dsh-isolation-gate/bin/gate.mjs';
const MAX_READ_BYTES = 2 * 1024 * 1024;
const DEFAULT_DELETE_BACKUP_DIR = 'D:\\回收站\\门禁-改前';

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq > 0) {
        options[token.slice(2, eq)] = token.slice(eq + 1);
        continue;
      }
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        options[key] = true;
        continue;
      }
      options[key] = next;
      i += 1;
      continue;
    }
    positional.push(token);
  }
  return { positional, options };
}

function configFrom(options) {
  const raw = {};
  if (typeof options.state === 'string') raw.statePath = options.state;
  if (typeof options.roster === 'string') raw.rosterPath = options.roster;
  if (typeof options.root === 'string') raw.root = options.root;
  if (typeof options.log === 'string') raw.auditPath = options.log;
  if (typeof options['backup-dir'] === 'string') raw.backupDir = options['backup-dir'];
  return normalizeConfig(raw);
}

function emit(options, payload, human) {
  if (options.json === true) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stdout.write(`${human}\n`);
}

function deny(options, decision) {
  const message = decision.error ? `拒绝/出错：${decision.error}` : decision.reason;
  if (options.json === true) {
    process.stdout.write(`${JSON.stringify({ ok: true, allowed: false, decision }, null, 2)}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(decision.error ? 2 : 3);
}

/**
 * 判定 → 通过才继续；不通过就退出（不碰任何文件）。
 * 名单读不到时判定侧**一律拒绝**（fail-closed），所以这里不需要再补丁。
 */
function gate(cfg, options, target) {
  const stateRead = readState(cfg.statePath);
  const rosterRead = readRoster(cfg.rosterPath);
  const decision = check(cfg, {
    name: target.name,
    path: target.path,
    op: target.op,
    channel: typeof options.channel === 'string' && options.channel !== '' ? options.channel : CHANNEL,
  });
  if (!decision.ok || !decision.allowed) {
    deny(options, decision);
    return decision; // deny() 已经 exit，这一行只为静态可读性
  }
  if (!stateRead.ok && !rosterRead.ok) {
    // 配置都读不出来还放行是不可能的（放行只会来自"不属于任何受管对象"）—— 不做特殊处理。
  }
  return decision;
}

function statusCommand(cfg, options) {
  const report = buildReport(cfg, { auditLimit: 5 });
  const lines = [];
  lines.push(`门禁状态（唯一生效依据：${report.paths.state}）`);
  lines.push(`受管名单：${report.paths.roster}（存在=${report.files.rosterExists}）`);
  if (report.files.gateClosed) lines.push(`⚠ ${report.files.rosterGateMessage}`);
  if (report.files.stateError) lines.push(`⚠ 状态文件：${report.files.stateError}`);
  if ((report.files.rosterInvalid || []).length > 0) {
    lines.push(`⚠ 名单里有不合法、未生效的行：${report.files.rosterInvalid.map((row) => row.raw).join(' / ')}`);
  }
  lines.push('');
  if (report.roster.length === 0) lines.push('（名单为空）');
  for (const row of report.roster) {
    lines.push(
      `  ${(row.isPath ? '[路径] ' : '')}${row.name.padEnd(14)} = ${row.level.padEnd(5)}（${row.levelLabel}）` +
        ` · 允许：${row.allowedOps.join(',') || '无'}` +
        (row.dirExists ? '' : '  ⚠ 目录不存在'),
    );
  }
  if (report.stateOnly.length > 0) {
    lines.push('');
    lines.push('（状态里有、名单里没有 ⇒ 当前不受管辖）');
    for (const row of report.stateOnly) lines.push(`  ${row.name} = ${row.level}（${row.levelLabel}）`);
  }
  if (options.json === true) {
    emit(options, { ok: true, state: report.paths.state, roster: report.roster, stateOnly: report.stateOnly }, '');
    return 0;
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

function policyCommand(cfg, options) {
  const report = buildReport(cfg, { auditLimit: 1 });
  const text = report.policy.join('\n');
  if (options.json === true) emit(options, { ok: true, policy: report.policy, levels: levelInfo() }, '');
  else process.stdout.write(`${text}\n`);
  return 0;
}

function checkCommand(cfg, options) {
  const op = typeof options.op === 'string' ? options.op : 'read';
  const decision = check(cfg, {
    name: typeof options.name === 'string' ? options.name : undefined,
    path: typeof options.path === 'string' ? options.path : undefined,
    op,
    channel: typeof options.channel === 'string' ? options.channel : CHANNEL,
  });
  if (!decision.ok) {
    process.stderr.write(`判定失败：${decision.error}\n`);
    return 2;
  }
  if (options.json === true) process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  else {
    const levelText = decision.rosterUnavailable === true ? '名单不可用' : (decision.level ?? '不在名单');
    process.stdout.write(
      `${decision.allowed ? '放行' : '拒绝'} · ${decision.name ?? '?'} · 级别=${levelText} · 操作=${op}\n` +
        `${decision.reason}\n`,
    );
  }
  return decision.allowed ? 0 : 3;
}

function traverseCommand(cfg, options) {
  const target = resolve(String(options.path));
  const decision = gate(cfg, options, { path: target, op: 'traverse' });
  let entries;
  try {
    entries = readdirSync(target, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'link' : 'file',
    }));
  } catch (error) {
    process.stderr.write(`列出失败：${error?.message ?? String(error)}\n`);
    return 2;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  if (options.json === true) emit(options, { ok: true, allowed: true, path: target, decision, entries }, '');
  else {
    process.stdout.write(`放行：${target}（${entries.length} 项）\n`);
    // 放行理由也要说清：是"没被隔离管辖"还是"已授权"——两者含义完全不同。
    if (decision.inRoster === false) process.stdout.write(`  · ${decision.reason}\n`);
    for (const entry of entries) process.stdout.write(`  [${entry.kind}] ${entry.name}\n`);
  }
  return 0;
}

function readCommand(cfg, options) {
  const target = resolve(String(options.path));
  gate(cfg, options, { path: target, op: 'read' });
  let stats;
  try {
    stats = statSync(target);
  } catch (error) {
    process.stderr.write(`读取失败：${error?.message ?? String(error)}\n`);
    return 2;
  }
  if (!stats.isFile()) {
    process.stderr.write(`读取失败：不是普通文件（${target}）\n`);
    return 2;
  }
  if (stats.size > MAX_READ_BYTES) {
    process.stderr.write(`读取失败：文件 ${stats.size} 字节，超过通道上限 ${MAX_READ_BYTES}\n`);
    return 2;
  }
  let text;
  try {
    text = readFileSync(target, 'utf8');
  } catch (error) {
    process.stderr.write(`读取失败：${error?.message ?? String(error)}\n`);
    return 2;
  }
  if (options.json === true) emit(options, { ok: true, allowed: true, path: target, bytes: stats.size, text }, '');
  else process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  return 0;
}

function writeCommand(cfg, options) {
  const target = resolve(String(options.path));
  gate(cfg, options, { path: target, op: 'write' });
  if (typeof options.text !== 'string') {
    process.stderr.write('写入失败：缺少 --text（本通道不做交互式编辑）\n');
    return 2;
  }
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, options.text, 'utf8');
  } catch (error) {
    process.stderr.write(`写入失败：${error?.message ?? String(error)}\n`);
    return 2;
  }
  appendAudit(cfg.auditPath, {
    channel: CHANNEL,
    name: null,
    op: 'write',
    allowed: true,
    detail: `已写 ${target}（${Buffer.byteLength(options.text, 'utf8')} 字节）`,
  });
  if (options.json === true) emit(options, { ok: true, allowed: true, path: target, bytes: Buffer.byteLength(options.text, 'utf8') }, '');
  else process.stdout.write(`已写入：${target}\n`);
  return 0;
}

function deleteCommand(cfg, options) {
  const target = resolve(String(options.path));
  gate(cfg, options, { path: target, op: 'delete' });
  if (!existsSync(target)) {
    process.stderr.write(`删除失败：目标不存在（${target}）\n`);
    return 2;
  }
  let stats;
  try {
    stats = statSync(target);
  } catch (error) {
    process.stderr.write(`删除失败：${error?.message ?? String(error)}\n`);
    return 2;
  }
  if (stats.isDirectory()) {
    process.stderr.write(
      '删除失败：本通道只删**文件**，不删目录（目录的递归删/搬属高风险动作，' +
        '请按房规先备份、由户主/管家单独授权执行；空目录请用 rmdir）\n',
    );
    return 2;
  }
  let backup = null;
  if (options['no-backup'] !== true) {
    try {
      const backupDir = join(String(options['backup-dir'] ?? DEFAULT_DELETE_BACKUP_DIR));
      mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backup = join(backupDir, `${stamp}__${target.replace(/[:\\/]/g, '_')}`);
      cpSync(target, backup);
    } catch (error) {
      process.stderr.write(`删除中止：删前备份失败（房规：删前必先备份）—— ${error?.message ?? String(error)}\n`);
      return 2;
    }
  }
  try {
    rmSync(target, { force: true });
  } catch (error) {
    process.stderr.write(`删除失败：${error?.message ?? String(error)}\n`);
    return 2;
  }
  appendAudit(cfg.auditPath, {
    channel: CHANNEL,
    name: null,
    op: 'delete',
    allowed: true,
    detail: `已删 ${target}；备份=${backup ?? '（--no-backup 跳过）'}`,
  });
  if (options.json === true) emit(options, { ok: true, allowed: true, path: target, backup }, '');
  else process.stdout.write(`已删除：${target}（备份：${backup ?? '未做'}）\n`);
  return 0;
}

/**
 * 删**空目录**（不递归）。
 *
 * 为什么补这个命令（2026-10-09 户主实测发现）：`write` 会自动建父目录 ⇒ 通道**能建目录**，
 * 却没有能力删掉自己建的目录 ⇒ 收尾必留残渣。这里只补"删空目录"这一最小能力；
 * 非空目录**一律拒绝**（递归删仍属高风险，按房规走户主/管家单独授权）。
 * 护栏：① 只删受管范围之下第 2 层及更深（盘根与受管对象本身不可由本通道删）
 *       ② 只删空目录（不递归）③ 目标是链接/junction 时拒（本通道不动链接）
 */
function rmdirCommand(cfg, options) {
  const target = resolve(String(options.path));
  gate(cfg, options, { path: target, op: 'delete' });
  if (!existsSync(target)) {
    process.stderr.write(`删除目录失败：目标不存在（${target}）\n`);
    return 2;
  }
  let link;
  try {
    link = lstatSync(target);
  } catch (error) {
    process.stderr.write(`删除目录失败：${error?.message ?? String(error)}\n`);
    return 2;
  }
  if (link.isSymbolicLink()) {
    process.stderr.write(`删除目录失败：目标是链接 / junction（${target}）—— 本通道不动链接，请人工处理\n`);
    return 2;
  }
  if (!link.isDirectory()) {
    process.stderr.write(`删除目录失败：不是目录（${target}）—— 删文件请用 delete\n`);
    return 2;
  }
  const rel = relative(resolve(cfg.root), target);
  const depth = rel.split(/[\\/]/).filter(Boolean).length;
  if (depth < 2) {
    process.stderr.write(
      `删除目录失败：只能删「受管范围之下第 2 层及更深」的目录；${target} 是第 ${depth} 层` +
        '（盘根与受管对象目录本身不得由本通道删除）\n',
    );
    return 2;
  }
  const entries = readdirSync(target);
  if (entries.length > 0) {
    process.stderr.write(
      `删除目录失败：目录非空（${entries.length} 项）—— 本通道**不递归删**；` +
        '请先用 delete 逐个删文件，或由户主 / 管家按房规单独授权处理\n',
    );
    return 2;
  }
  try {
    // ⚠️ 必须用 rmdirSync：fs.rmSync(recursive:false) 对**目录**会直接抛 EISDIR（2026-10-09 实测踩到）。
    //    rmdirSync 本身只删空目录 —— 与"不递归"的语义天然一致。
    rmdirSync(target);
  } catch (error) {
    process.stderr.write(`删除目录失败：${error?.message ?? String(error)}\n`);
    return 2;
  }
  appendAudit(cfg.auditPath, {
    channel: CHANNEL,
    name: null,
    op: 'delete',
    allowed: true,
    detail: `已删空目录 ${target}（空目录无内容可备份）`,
  });
  if (options.json === true) emit(options, { ok: true, allowed: true, path: target, removed: 'empty-dir' }, '');
  else process.stdout.write(`已删除空目录：${target}（空目录无内容，未做备份）\n`);
  return 0;
}

function logCommand(cfg, options) {
  const limit = Number.parseInt(String(options.limit ?? '20'), 10);
  const result = readAudit(cfg.auditPath, Number.isInteger(limit) && limit > 0 ? limit : 20);
  if (options.json === true) emit(options, { ok: true, audit: result }, '');
  else if (result.entries.length === 0) process.stdout.write(`（无审计记录；${cfg.auditPath}）\n`);
  else {
    process.stdout.write(`审计（最新在前，共 ${result.total ?? 0} 条；${cfg.auditPath}）\n`);
    for (const entry of result.entries) {
      process.stdout.write(
        `  ${entry.atLocal ?? entry.at} · ${entry.allowed ? '放行' : '拒绝'} · ${entry.channel} · ` +
          `${entry.name ?? '-'} · ${entry.op} · ${entry.detail ?? ''}\n`,
      );
    }
  }
  return 0;
}

function usage() {
  process.stdout.write(
    [
      'gate —— 受管辖的访问通道',
      '',
      '  status                                  看全部受管对象的级别（agent 读状态用）',
      '  policy                                  紧凑策略行（塞提示词用）',
      '  check   --name X --op read              只判定不动手',
      '  check   --path P --op delete            路径也支持（最长前缀命中）',
      '  traverse --path P                       列目录名（需 traverse 权限）',
      '  read    --path P                        读文件（需 read 权限）',
      '  write   --path P --text S               写文件（需 write 权限）',
      '  delete  --path P                        删**文件**（需 delete 权限；删前自动备份）',
      '  rmdir   --path P                        删**空目录**（需 delete 权限；不递归，非空则拒）',
      '  log     [--limit 20]                    审计日志',
      '',
      '  级别：deny 禁（默认） / read 只读 / full 可读写删',
      '  退出码：0 放行 · 3 被拒 · 2 用错或环境错误',
      '  fail-closed：名单缺失 / 损坏 ⇒ 一律拒绝（exit 3，文案含"名单不可用"）',
      '',
    ].join('\n'),
  );
  return 2;
}

function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (!command || command === 'help' || options.help === true) return usage();
  const cfg = configFrom(options);
  switch (command) {
    case 'status':
      return statusCommand(cfg, options);
    case 'policy':
      return policyCommand(cfg, options);
    case 'check':
      return checkCommand(cfg, options);
    case 'traverse':
    case 'list':
      if (typeof options.path !== 'string') {
        process.stderr.write('traverse 需要 --path\n');
        return 2;
      }
      return traverseCommand(cfg, options);
    case 'read':
      if (typeof options.path !== 'string') {
        process.stderr.write('read 需要 --path\n');
        return 2;
      }
      return readCommand(cfg, options);
    case 'write':
      if (typeof options.path !== 'string') {
        process.stderr.write('write 需要 --path\n');
        return 2;
      }
      return writeCommand(cfg, options);
    case 'delete':
      if (typeof options.path !== 'string') {
        process.stderr.write('delete 需要 --path\n');
        return 2;
      }
      return deleteCommand(cfg, options);
    case 'rmdir':
      if (typeof options.path !== 'string') {
        process.stderr.write('rmdir 需要 --path\n');
        return 2;
      }
      return rmdirCommand(cfg, options);
    case 'log':
      return logCommand(cfg, options);
    default:
      process.stderr.write(`未知命令：${command}\n`);
      return usage();
  }
}

process.exitCode = main();
