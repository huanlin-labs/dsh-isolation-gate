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
