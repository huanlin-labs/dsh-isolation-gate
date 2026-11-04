/**
 * 门禁 · 访问审计（受管辖通道的每一次判定都留痕）
 *
 * 落点：`~/.dsh/dsh-isolation-gate/access-log.jsonl`（插件数据位，非源码位）。
 * 记什么：时间 · 通道 · 名字 · 级别 · 操作 · 放行/拒绝。
 * **不记**隔离区内部内容 —— 只记路径名与判定结果（红线：只碰名字与存在性）。
 *
 * 有上限（默认 500 行）：超了从头截掉，避免日志无限长。
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** 插件数据目录（房规：插件数据进 `~\.dsh\<插件名>\`）。 */
export const DEFAULT_LOG_DIR = join(process.env.USERPROFILE || process.env.HOME || ".", '.dsh', 'dsh-isolation-gate');

/** 审计日志默认落点。 */
export const DEFAULT_LOG_PATH = join(DEFAULT_LOG_DIR, 'access-log.jsonl');

/** 保留的最大行数。 */
export const DEFAULT_MAX_ENTRIES = 500;

function pad(n) {
  return String(n).padStart(2, '0');
}

function stamp(now) {
  const d = now instanceof Date ? now : new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** 读日志（逆序，最新在前）。永不抛异常。 */
export function readAudit(logPath = DEFAULT_LOG_PATH, limit = 20) {
  if (!existsSync(logPath)) return { ok: true, exists: false, entries: [], error: null };
  let text;
  try {
    text = readFileSync(logPath, 'utf8');
  } catch (error) {
    return { ok: false, exists: true, entries: [], error: `审计日志读取失败：${error?.message ?? String(error)}` };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const entries = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < Math.max(1, limit); i -= 1) {
    try {
      entries.push(JSON.parse(lines[i]));
    } catch {
      entries.push({ raw: lines[i], parseError: true });
    }
  }
  return { ok: true, exists: true, total: lines.length, entries, error: null };
}

/**
 * 追加一条审计。失败只报错、不抛 —— 审计不该拦住主流程。
 * @param {string} logPath
 * @param {{channel:string,name?:string,level?:string,op:string,allowed:boolean,detail?:string}} entry
 */
export function appendAudit(logPath, entry, options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : DEFAULT_MAX_ENTRIES;
  const record = {
    at: options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(),
    atLocal: stamp(options.now),
    channel: entry?.channel ?? 'unknown',
    name: entry?.name ?? null,
    level: entry?.level ?? null,
    op: entry?.op ?? null,
    allowed: entry?.allowed === true,
    detail: typeof entry?.detail === 'string' ? entry.detail.slice(0, 300) : undefined,
  };
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    return { ok: false, error: `审计写入失败：${error?.message ?? String(error)}` };
  }
  // 超上限就该截断（低频动作，读一次整文件可以接受）。
  try {
    const text = readFileSync(logPath, 'utf8');
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length > maxEntries) {
      writeFileSync(logPath, `${lines.slice(lines.length - maxEntries).join('\n')}\n`, 'utf8');
    }
  } catch {
    /* 截断失败无所谓：宁可日志长一点，也不能因此丢记录或报错 */
  }
  return { ok: true, record };
}

/**
 * 统计审计日志（只读 · 不改一个字节）。
 * 关注四件事：放行/拒绝比例、哪些对象最常被碰、哪些操作最常被拒、按天趋势。
 * @param {string} logPath
 * @param {{days?:number, top?:number, now?:number}} options days=0 表示全部
 */
export function statsAudit(logPath = DEFAULT_LOG_PATH, options = {}) {
  const days = Number.isInteger(options.days) && options.days > 0 ? options.days : 0;
  const top = Number.isInteger(options.top) && options.top > 0 ? options.top : 10;
  const nowMs = Number.isFinite(Number(options.now)) && Number(options.now) > 0 ? Number(options.now) : Date.now();
  const sinceMs = days > 0 ? nowMs - days * 86400000 : null;

  if (!existsSync(logPath)) {
    return { ok: true, exists: false, total: 0, counts: emptyStats(), path: logPath, days, error: null };
  }
  let text;
  try {
    text = readFileSync(logPath, 'utf8');
  } catch (error) {
    return { ok: false, exists: true, total: 0, counts: emptyStats(), path: logPath, days, error: `审计日志读取失败：${error?.message ?? String(error)}` };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');

  const counts = emptyStats();
  let scanned = 0;
  let skipped = 0;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    const at = typeof entry?.at === 'string' ? Date.parse(entry.at) : NaN;
    if (sinceMs !== null && (!Number.isFinite(at) || at < sinceMs)) continue;
    scanned += 1;
    counts.total += 1;
    if (entry.allowed === true) counts.allowed += 1;
    else counts.denied += 1;

    const name = typeof entry.name === 'string' && entry.name !== '' ? entry.name : '(未知对象)';
    const nameCell = counts.byName.get(name) ?? { name, count: 0, denied: 0 };
    nameCell.count += 1;
    if (entry.allowed !== true) nameCell.denied += 1;
    counts.byName.set(name, nameCell);

    const op = typeof entry.op === 'string' && entry.op !== '' ? entry.op : '(未知操作)';
    const opCell = counts.byOp.get(op) ?? { op, count: 0, denied: 0 };
    opCell.count += 1;
    if (entry.allowed !== true) opCell.denied += 1;
    counts.byOp.set(op, opCell);

    const channel = typeof entry.channel === 'string' && entry.channel !== '' ? entry.channel : '(未知通道)';
    counts.byChannel.set(channel, (counts.byChannel.get(channel) ?? 0) + 1);

    const day = Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : '(无时间)';
    counts.byDay.set(day, (counts.byDay.get(day) ?? 0) + 1);
    if (Number.isFinite(at)) {
      if (counts.firstAt === null || at < Date.parse(counts.firstAt)) counts.firstAt = new Date(at).toISOString();
      if (counts.lastAt === null || at > Date.parse(counts.lastAt)) counts.lastAt = new Date(at).toISOString();
    }
  }

  const sortTop = (map, key) =>
    [...map.entries()]
      .map(([, value]) => value)
      .sort((a, b) => b.count - a.count || String(a[key]).localeCompare(String(b[key])))
      .slice(0, top);

  return {
    ok: true,
    exists: true,
    total: counts.total,
    scanned,
    skipped,
    counts: {
      ...counts,
      byName: sortTop(counts.byName, 'name'),
      byOp: sortTop(counts.byOp, 'op'),
      byChannel: [...counts.byChannel.entries()].map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count),
      byDay: [...counts.byDay.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => String(a.day).localeCompare(String(b.day))),
    },
    path: logPath,
    days,
    error: null,
  };
}

/** 内部：可变累加器（导出前换成数组）。 */
function emptyStats() {
  return {
    total: 0,
    allowed: 0,
    denied: 0,
    byName: new Map(),
    byOp: new Map(),
    byChannel: new Map(),
    byDay: new Map(),
    firstAt: null,
    lastAt: null,
  };
}

/** 清空前的备份落点（房规：备份一律进 D:\\回收站）。 */
export const DEFAULT_BACKUP_DIR = existsSync('D:\\回收站')
  ? 'D:\\回收站\\isolation-gate-audit'
  : join(process.env.USERPROFILE || process.env.HOME || ".", '.agents', 'audit-backups');

/**
 * 一键清空审计：先整份复制到备份目录，再截断原文件。
 * @param {string} logPath
 * @param {{backupDir?:string, now?:Date}} options
 */
export function clearAudit(logPath = DEFAULT_LOG_PATH, options = {}) {
  if (!existsSync(logPath)) return { ok: true, removed: 0, backup: null };
  let removed = 0;
  try {
    const text = readFileSync(logPath, 'utf8');
    removed = text.split(/\r?\n/).filter((line) => line.trim() !== '').length;
  } catch {
    removed = 0;
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
  const stampName = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let backup = null;
  try {
    mkdirSync(backupDir, { recursive: true });
    backup = join(backupDir, `access-log-${stampName}.jsonl`);
    copyFileSync(logPath, backup);
  } catch (error) {
    return { ok: false, removed: 0, backup: null, error: `备份失败，未清空：${error?.message ?? String(error)}` };
  }
  try {
    writeFileSync(logPath, '', 'utf8');
  } catch (error) {
    return { ok: false, removed: 0, backup, error: `清空失败：${error?.message ?? String(error)}` };
  }
  return { ok: true, removed, backup };
}
