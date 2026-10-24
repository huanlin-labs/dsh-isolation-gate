/**
 * 待批申请 + AI 授权窗口（与状态文件分开存，避免动 1.0 冻结的 state v3 形状）。
 *
 * 设计约束（2026-10-24 户主拍板）：
 *   · AI 默认只能收紧、只能新增（默认禁）、只能查；
 *   · 放宽（改成 read / full）走「申请 → 户主在面板点批准」；
 *   · 户主在面板点「授权 AI 放宽 N 分钟」后，窗口期内 AI 可以直接改，不必逐条批。
 *
 * 落点：与状态文件同目录的 `requests.json`。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const REQUESTS_VERSION = 1;
export const DEFAULT_GRANT_MINUTES = 30;
export const MAX_PENDING = 50;

export function requestsPathFor(statePath) {
  return join(dirname(statePath), 'requests.json');
}

function empty(now = new Date()) {
  return {
    version: REQUESTS_VERSION,
    updatedAt: now.toISOString(),
    aiGrantUntil: null,
    requests: [],
  };
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return empty();
  const requests = Array.isArray(raw.requests) ? raw.requests : [];
  return {
    version: REQUESTS_VERSION,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    aiGrantUntil: typeof raw.aiGrantUntil === 'string' ? raw.aiGrantUntil : null,
    requests: requests
      .filter((item) => item && typeof item.id === 'string' && typeof item.target === 'string')
      .slice(0, MAX_PENDING),
  };
}

export function readRequests(filePath) {
  try {
    if (!existsSync(filePath)) return empty();
    return normalize(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    // 读坏 ⇒ 当作空；不影响门禁本体（门禁自己的 fail-closed 在状态文件那侧）。
    return empty();
  }
}

export function writeRequests(filePath, data, now = new Date()) {
  const next = normalize({ ...data, updatedAt: now.toISOString() });
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  renameSync(tmp, filePath);
  return next;
}

export function grantActive(data, now = new Date()) {
  if (!data || !data.aiGrantUntil) return false;
  const until = Date.parse(data.aiGrantUntil);
  return Number.isFinite(until) && until > now.getTime();
}

export function setGrant(filePath, minutes = DEFAULT_GRANT_MINUTES, now = new Date()) {
  const data = readRequests(filePath);
  const span = Math.max(1, Math.min(240, Number(minutes) || DEFAULT_GRANT_MINUTES));
  data.aiGrantUntil = new Date(now.getTime() + span * 60_000).toISOString();
  return writeRequests(filePath, data, now);
}

export function clearGrant(filePath, now = new Date()) {
  const data = readRequests(filePath);
  data.aiGrantUntil = null;
  return writeRequests(filePath, data, now);
}

/** 待批：同目标 + 同级别只留一条（新的覆盖旧的），避免刷屏。 */
export function addRequest(filePath, input, now = new Date()) {
  const data = readRequests(filePath);
  const pending = data.requests.filter(
    (item) => item.status === 'pending' && !(item.target === input.target && item.level === input.level),
  );
  const request = {
    id: `req-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    target: String(input.target),
    targetKind: input.targetKind === 'path' ? 'path' : 'name',
    level: input.level,
    fromLevel: input.fromLevel ?? null,
    reason: String(input.reason ?? '').slice(0, 500),
    requestedBy: String(input.requestedBy ?? 'agent').slice(0, 80),
    createdAt: now.toISOString(),
    status: 'pending',
    decidedAt: null,
  };
  data.requests = [request, ...pending].slice(0, MAX_PENDING);
  writeRequests(filePath, data, now);
  return request;
}

export function listRequests(filePath, options = {}) {
  const data = readRequests(filePath);
  const includeAll = options.includeAll === true;
  return {
    aiGrantUntil: data.aiGrantUntil,
    grantActive: grantActive(data, options.now),
    requests: includeAll ? data.requests : data.requests.filter((item) => item.status === 'pending'),
  };
}

export function findRequest(filePath, id) {
  const data = readRequests(filePath);
  return data.requests.find((item) => item.id === id) ?? null;
}

export function markRequest(filePath, id, status, now = new Date()) {
  const data = readRequests(filePath);
  const index = data.requests.findIndex((item) => item.id === id);
  if (index < 0) return null;
  data.requests[index] = { ...data.requests[index], status, decidedAt: now.toISOString() };
  writeRequests(filePath, data, now);
  return data.requests[index];
}

export function pendingCount(filePath) {
  return listRequests(filePath).requests.length;
}
