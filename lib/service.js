/**
 * 门禁 · 业务层
 *
 * 把 store / roster / dirs / guard / audit 攒成一个"面板要什么就给什么"的接口。
 * 宿主半的路由与 `bin/gate.mjs` 都只调这里 —— UI 与 CLI 因此不可能说两套话。
 *
 * 写动作（全部在这里，且全部留痕）：
 *   ① setLevel      —— 改一个对象的授权级别
 *   ② editRoster    —— 增/删名单一行（**先备份**；新增自动 deny；移除时顺手清掉状态条目）
 *   ③ setGroupLevel —— 组级一键切（组内所有对象设同一级）
 *   ④ assignGroup   —— 把对象移到某组 / 取消分组
 *   ⑤ deleteGroup   —— 删组（成员保留，只清归属）
 *   ⑥ pruneOrphans  —— 清理"状态里有、名单里没有"的孤儿键
 *   ⑦ 无第七个 —— 本插件不会去读/写任何受管对象内部的内容
 *
 * 受管对象两类（名单行决定）：
 *   · 名字类 —— D 根一级目录名（旧行为），参与"名单 ↔ 磁盘一层目录"差异比对；
 *   · 路径类 —— 任意绝对路径（新能力），只做"目录存在 / 不存在"判定，比对无意义。
 */

import { existsSync, statSync } from 'node:fs';

import {
  DEFAULT_STATE_PATH,
  LEVELS,
  LEVEL_LABEL,
  LEVEL_HINT,
  STATE_VERSION,
  ensureStateFile,
  groupsOf,
  levelOf,
  pruneState,
  readState,
  stateOnlyKeys,
  withGroup,
  withGroupLevel,
  withLevel,
  withoutGroup,
  withoutObject,
  writeState,
} from './store.js';
import {
  DEFAULT_BACKUP_DIR,
  DEFAULT_ROSTER_PATH,
  addObjectToLines,
  readRoster,
  removeObjectToLines,
  writeRoster,
} from './roster.js';
import { DEFAULT_ROOT, diffRoster, listRootDirs } from './dirs.js';
import { DEFAULT_LOG_PATH, appendAudit, readAudit } from './audit.js';
import { OPS, allowedOps, checkAccess, levelTable, policyLines } from './guard.js';

/** 把插件 config 收敛成一份完整配置（全部有默认值 ⇒ 零配置可用）。 */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {};
  const str = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value : fallback);
  const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v !== '') : undefined);
  return {
    statePath: str(input.statePath, DEFAULT_STATE_PATH),
    rosterPath: str(input.rosterPath, DEFAULT_ROSTER_PATH),
    backupDir: str(input.backupDir, DEFAULT_BACKUP_DIR),
    root: str(input.root, DEFAULT_ROOT),
    auditPath: str(input.auditPath, DEFAULT_LOG_PATH),
    auditMaxEntries: Number.isInteger(input.auditMaxEntries) && input.auditMaxEntries > 0 ? input.auditMaxEntries : 500,
    // 2026-10-21 改名：harnessVocabulary → suspectVocabulary；旧键仍读，避免旧装配失效。
    suspectVocabulary: list(input.suspectVocabulary) ?? list(input.harnessVocabulary) ?? null,
    autoCreateStateFile: input.autoCreateStateFile !== false,
    toolGate: input.toolGate !== false,
  };
}

function vocabularyOf(cfg) {
  return cfg.suspectVocabulary && cfg.suspectVocabulary.length > 0 ? cfg.suspectVocabulary : undefined;
}

/** 探一个受管路径"在不在 / 是不是目录"（**只看这一条路径本身**，不列内容）。 */
function probePath(key) {
  try {
    if (!existsSync(key)) return { exists: false, isDir: false };
    return { exists: true, isDir: statSync(key).isDirectory() };
  } catch {
    return { exists: false, isDir: false };
  }
}

/** 拼装面板/CLI 要的一份完整状态报告（每次调用都**重新读盘**，不缓存）。 */
export function buildReport(cfg, options = {}) {
  const now = options.now;
  if (cfg.autoCreateStateFile) ensureStateFile(cfg.statePath, now);

  const stateRead = readState(cfg.statePath);
  const rosterRead = readRoster(cfg.rosterPath);
  const dirsRead = listRootDirs(cfg.root);

  // 名单读不到 ⇒ objects 为空 + `files.gateClosed` 为真（判定侧一律拒绝）。
  const objects = rosterRead.ok ? rosterRead.objects : [];
  const rosterNames = objects.filter((object) => object.kind === 'name').map((object) => object.key);

  const diff = dirsRead.ok
    ? diffRoster({ rosterNames, rootDirs: dirsRead.dirs, vocabulary: vocabularyOf(cfg) })
    : {
        rows: [],
        unlisted: [],
        summary: {
          rosterCount: rosterNames.length,
          rootDirCount: 0,
          rosterMissingDir: [],
          dirNotListedSuspect: [],
          dirNotListed: [],
          caseMismatch: [],
        },
      };

  // 名单内的每一项（两类都列）：附上当前级别 + 组 + 磁盘状态 + 差异提示。
  const rosterRows = objects.map((object) => {
    const level = levelOf(stateRead.state, object.key);
    const group = stateRead.state.objects?.[object.key]?.group ?? '';
    const base = {
      name: object.key,
      key: object.key,
      kind: object.kind,
      isPath: object.kind === 'path',
      raw: object.raw ?? object.key,
      level,
      levelLabel: LEVEL_LABEL[level],
      allowedOps: allowedOps(level),
      group,
      source: 'roster',
      inRoster: true,
    };
    if (object.kind === 'path') {
      const probe = probePath(object.key);
      return {
        ...base,
        exists: probe.exists,
        isDir: probe.isDir,
        dirExists: probe.isDir,
        dirName: object.key,
        status: probe.isDir ? 'path-ok' : probe.exists ? 'path-not-dir' : 'path-missing',
        hint: probe.isDir
          ? '路径受管 · 目录存在'
          : probe.exists
            ? '路径受管 · 该路径存在但不是目录'
            : '路径受管 · 目录当前不存在（判定仍按路径前缀生效；可能是准备新建的）',
      };
    }
    const diskRow = diff.rows.find((row) => row.name.toLowerCase() === object.key.toLowerCase());
    return {
      ...base,
      exists: diskRow ? diskRow.dirExists : false,
      isDir: diskRow ? diskRow.dirExists : false,
      dirExists: diskRow ? diskRow.dirExists : false,
      dirName: diskRow ? diskRow.dirName : null,
      status: diskRow ? diskRow.status : 'unknown',
      hint: diskRow ? diskRow.hint : '磁盘状态未知（列出目录失败）',
    };
  });

  const stateOnly = stateOnlyKeys(stateRead.state, objects).map((key) => {
    const level = levelOf(stateRead.state, key);
    return {
      name: key,
      level,
      levelLabel: LEVEL_LABEL[level],
      group: stateRead.state.objects?.[key]?.group ?? '',
      hint: '状态文件里有、但**不在名单**里 ⇒ 当前不受管辖（可点「清理孤儿键」按钮移除）',
    };
  });

  const groups = groupsOf(stateRead.state).map((group) => {
    const members = rosterRows.filter((row) => row.group === group.name);
    const counts = { deny: 0, read: 0, full: 0 };
    for (const row of members) counts[row.level] = (counts[row.level] ?? 0) + 1;
    const distinct = Object.keys(counts).filter((level) => counts[level] > 0);
    return {
      name: group.name,
      note: group.note,
      count: members.length,
      members: members.map((row) => row.name),
      counts,
      // 组内级别一致时给一个值（UI 用它高亮分段控件）；不一致 ⇒ null
      uniformLevel: distinct.length === 1 ? distinct[0] : null,
      hasOrphans: group.count > members.length,
    };
  });

  const ungrouped = rosterRows.filter((row) => !row.group || !groups.some((group) => group.name === row.group));
  const counts = { deny: 0, read: 0, full: 0 };
  for (const row of rosterRows) counts[row.level] = (counts[row.level] ?? 0) + 1;

  const audit = readAudit(cfg.auditPath, options.auditLimit ?? 10);

  return {
    ok: true,
    now: (now instanceof Date ? now : new Date()).toISOString(),
    version: STATE_VERSION,
    features: {
      toolGate: cfg.toolGate !== false,
      groups: true,
      picker: options.picker === true,
      pickerKind: options.pickerKind ?? null,
    },
    paths: {
      state: cfg.statePath,
      roster: cfg.rosterPath,
      root: cfg.root,
      backupDir: cfg.backupDir,
      audit: cfg.auditPath,
    },
    files: {
      stateExists: stateRead.exists,
      stateError: stateRead.error,
      stateVersion: stateRead.sourceVersion ?? STATE_VERSION,
      stateMigratedFrom: stateRead.migratedFrom ?? null,
      rosterExists: rosterRead.exists,
      rosterError: rosterRead.error,
      rosterOk: rosterRead.ok,
      // ⚠️ fail-closed 生效中：名单不可用 ⇒ 通道对一切受管对象一律拒绝。
      gateClosed: rosterRead.ok === false,
      rosterGateMessage: rosterRead.ok
        ? null
        : `名单不可用（${cfg.rosterPath} 缺失或损坏）⇒ 按"一律拒绝"处理，请先恢复名单文件`,
      rosterDuplicates: rosterRead.duplicates ?? [],
      rosterInvalid: rosterRead.invalid ?? [],
      rootError: dirsRead.error,
    },
    levels: levelTable(),
    defaultLevel: stateRead.state.defaultLevel,
    updatedAt: stateRead.state.updatedAt,
    updatedBy: stateRead.state.updatedBy,
    roster: rosterRows,
    rosterCounts: {
      total: rosterRows.length,
      names: rosterRows.filter((row) => row.kind === 'name').length,
      paths: rosterRows.filter((row) => row.kind === 'path').length,
      ...counts,
    },
    groups,
    ungrouped: ungrouped.map((row) => row.name),
    stateOnly,
    diffs: {
      ...diff.summary,
      pathMissing: rosterRows.filter((row) => row.status === 'path-missing').map((row) => row.key),
      pathNotDir: rosterRows.filter((row) => row.status === 'path-not-dir').map((row) => row.key),
    },
    unlistedDirs: diff.unlisted,
    allRootDirs: dirsRead.ok ? dirsRead.dirs : [],
    policy: policyLines(stateRead.state, objects),
    audit: {
      ok: audit.ok,
      total: audit.total ?? 0,
      entries: audit.entries,
      error: audit.error,
    },
  };
}

/** 公共前置：读状态；不可解析就拒绝覆盖。 */
function readStateForWrite(cfg, now) {
  const stateRead = readState(cfg.statePath);
  if (!stateRead.ok) {
    return { ok: false, error: `${stateRead.error} —— 拒绝在状态文件不可解析时覆盖它（请先人工修好或删除该文件）` };
  }
  return { ok: true, state: stateRead.state };
}

function commitState(cfg, next, now, auditEntry) {
  let written;
  try {
    written = writeState(cfg.statePath, next.state, now);
  } catch (error) {
    return { ok: false, error: `状态写入失败：${error?.message ?? String(error)}` };
  }
  if (auditEntry) appendAudit(cfg.auditPath, auditEntry, { now, maxEntries: cfg.auditMaxEntries });
  return { ok: true, path: written.path, bytes: written.bytes };
}

/** 改一个受管对象的授权级别（写状态文件 + 留痕）。 */
export function setLevel(cfg, input, options = {}) {
  const now = options.now;
  const by = typeof input?.by === 'string' && input.by !== '' ? input.by : 'gui';
  const target = input?.name ?? input?.key;
  const base = readStateForWrite(cfg, now);
  if (!base.ok) return base;
  const result = withLevel(base.state, target, input?.level, { note: input?.note, now, by });
  if (!result.ok) return { ok: false, error: result.error };
  const committed = commitState(cfg, result, now, {
    channel: by,
    name: result.key,
    level: result.level,
    op: 'set-level',
    allowed: true,
    detail: `级别 → ${result.level}（${LEVEL_LABEL[result.level]}）· 键类 ${result.kind}`,
  });
  if (!committed.ok) return committed;
  return {
    ok: true,
    name: result.key,
    level: result.level,
    kind: result.kind,
    levelLabel: LEVEL_LABEL[result.level],
    path: committed.path,
    bytes: committed.bytes,
    bytesWritten: committed.bytes,
  };
}

/** 组级一键切。 */
export function setGroupLevel(cfg, input, options = {}) {
  const now = options.now;
  const by = typeof input?.by === 'string' && input.by !== '' ? input.by : 'gui';
  const base = readStateForWrite(cfg, now);
  if (!base.ok) return base;
  const result = withGroupLevel(base.state, input?.group, input?.level, { now, by });
  if (!result.ok) return { ok: false, error: result.error };
  const committed = commitState(cfg, result, now, {
    channel: by,
    name: `组:${result.group}`,
    level: result.level,
    op: 'set-group-level',
    allowed: true,
    detail: `组内 ${result.keys.length} 个对象统一 → ${result.level}（${LEVEL_LABEL[result.level]}）`,
  });
  if (!committed.ok) return committed;
  return {
    ok: true,
    group: result.group,
    level: result.level,
    levelLabel: LEVEL_LABEL[result.level],
    count: result.keys.length,
    keys: result.keys,
    path: committed.path,
    bytes: committed.bytes,
  };
}

/** 把对象移到某组（group='' = 取消分组；组不存在则建）。 */
export function assignGroup(cfg, input, options = {}) {
  const now = options.now;
  const base = readStateForWrite(cfg, now);
  if (!base.ok) return base;
  const result = withGroup(base.state, input?.name ?? input?.key, input?.group, { now, by: 'gui' });
  if (!result.ok) return { ok: false, error: result.error };
  const committed = commitState(cfg, result, now, {
    channel: 'gui',
    name: result.key,
    op: 'assign-group',
    allowed: true,
    detail: result.group === '' ? '取消分组' : `归入组「${result.group}」`,
  });
  if (!committed.ok) return committed;
  return { ok: true, name: result.key, group: result.group, path: committed.path, bytes: committed.bytes };
}

/** 删组（成员保留）。 */
export function deleteGroup(cfg, input, options = {}) {
  const now = options.now;
  const base = readStateForWrite(cfg, now);
  if (!base.ok) return base;
  const result = withoutGroup(base.state, input?.group, { now, by: 'gui' });
  if (!result.ok) return { ok: false, error: result.error };
  const committed = commitState(cfg, result, now, {
    channel: 'gui',
    name: `组:${result.group}`,
    op: 'delete-group',
    allowed: true,
    detail: `删除组（${result.keys.length} 个成员保留，仅清归属）`,
  });
  if (!committed.ok) return committed;
  return { ok: true, group: result.group, released: result.keys, path: committed.path, bytes: committed.bytes };
}

/** 清理孤儿键：状态里有、名单里没有。 */
export function pruneOrphans(cfg, options = {}) {
  const now = options.now;
  const base = readStateForWrite(cfg, now);
  if (!base.ok) return base;
  const rosterRead = readRoster(cfg.rosterPath);
  if (!rosterRead.ok) return { ok: false, error: rosterRead.error };
  const result = pruneState(base.state, rosterRead.objects, { now, by: 'gui' });
  if (result.removed.length === 0) return { ok: true, removed: [], path: cfg.statePath, bytes: 0 };
  const committed = commitState(cfg, result, now, {
    channel: 'gui',
    name: '—',
    op: 'prune-orphans',
    allowed: true,
    detail: `清理孤儿键 ${result.removed.length} 个：${result.removed.join(' / ')}`,
  });
  if (!committed.ok) return committed;
  return { ok: true, removed: result.removed, path: committed.path, bytes: committed.bytes };
}

/**
 * 改名单一行（**先备份**；新增项自动建 deny 条目 —— 绝不自动授权）。
 * 名字与绝对路径都能加/删（种类由那一行本身决定）。
 * 移除时顺手清掉状态条目，避免产生新的孤儿键。
 * @param {object} input { action: 'add'|'remove', name|key }
 */
export function editRoster(cfg, input, options = {}) {
  const now = options.now;
  const action = input?.action;
  if (action !== 'add' && action !== 'remove') {
    return { ok: false, error: `action 只接受 add / remove，收到：${String(action)}` };
  }
  const target = input?.name ?? input?.key;
  const rosterRead = readRoster(cfg.rosterPath);
  let lines;
  if (rosterRead.ok) {
    lines = rosterRead.lines;
  } else if (rosterRead.exists === false) {
    // 名单文件还没建（或刚被删）⇒ 允许从空名单开始建；其余"读坏"情形一律不动。
    lines = [];
  } else {
    return { ok: false, error: rosterRead.error };
  }

  const edited =
    action === 'add' ? addObjectToLines(lines, target) : removeObjectToLines(lines, target);
  if (!edited.ok) return { ok: false, error: edited.error, duplicate: edited.duplicate, missing: edited.missing };

  const written = writeRoster(cfg.rosterPath, edited.lines, { backupDir: cfg.backupDir, now });
  if (!written.ok) return { ok: false, error: written.error };

  // 新增到名单的对象：**立刻落一条 deny**；移除：**立刻清掉状态条目**。
  let stateNote = null;
  const stateRead = readState(cfg.statePath);
  if (stateRead.ok) {
    const next =
      action === 'add'
        ? withLevel(stateRead.state, edited.key, 'deny', { now, by: 'roster-add' })
        : withoutObject(stateRead.state, edited.key, { now, by: 'roster-remove' });
    if (next.ok) {
      try {
        writeState(cfg.statePath, next.state, now);
        stateNote =
          action === 'add'
            ? `已为「${edited.key}」建 deny 条目（默认禁）`
            : `已清掉「${edited.key}」的状态条目（不留孤儿键）`;
      } catch (error) {
        stateNote = `名单已改，但状态文件写入失败：${error?.message ?? String(error)}`;
      }
    }
  }

  appendAudit(
    cfg.auditPath,
    {
      channel: 'gui',
      name: edited.key,
      op: `roster-${action}`,
      allowed: true,
      detail:
        `名单${action === 'add' ? '加入' : '移除'}一行（${edited.kind}）；` +
        `备份 → ${written.backup ?? '（原文件不存在，无需备份）'}`,
    },
    { now, maxEntries: cfg.auditMaxEntries },
  );

  return {
    ok: true,
    action,
    name: edited.key,
    key: edited.key,
    kind: edited.kind,
    path: written.path,
    backup: written.backup,
    bytes: written.bytes,
    stateNote,
  };
}

/** 受管辖通道的判定（记录审计）。名单读不到时判定侧**一律拒绝**（fail-closed）。 */
export function check(cfg, input, options = {}) {
  const now = options.now;
  const stateRead = readState(cfg.statePath);
  const rosterRead = readRoster(cfg.rosterPath);
  const decision = checkAccess({
    state: stateRead.state,
    rosterObjects: rosterRead.ok ? rosterRead.objects : [],
    rosterOk: rosterRead.ok,
    rosterPath: cfg.rosterPath,
    name: input?.name,
    path: input?.path,
    op: input?.op,
    channel: typeof input?.channel === 'string' && input.channel !== '' ? input.channel : 'gui',
  });
  if (decision.ok) {
    appendAudit(
      cfg.auditPath,
      {
        channel: decision.channel,
        name: decision.name,
        level: decision.level,
        op: decision.op,
        allowed: decision.allowed,
        detail: decision.reason,
      },
      { now, maxEntries: cfg.auditMaxEntries },
    );
  }
  return {
    ...decision,
    stateReadOk: stateRead.ok,
    stateError: stateRead.error,
    stateExists: stateRead.exists,
    rosterReadOk: rosterRead.ok,
    rosterError: rosterRead.error,
  };
}

/** 工具执行门专用：判定但不给"名单外"调用留审计噪音（拒绝必记）。 */
export function checkTool(cfg, input, options = {}) {
  const now = options.now;
  const stateRead = readState(cfg.statePath);
  const rosterRead = readRoster(cfg.rosterPath);
  const decision = checkAccess({
    state: stateRead.state,
    rosterObjects: rosterRead.ok ? rosterRead.objects : [],
    rosterOk: rosterRead.ok,
    rosterPath: cfg.rosterPath,
    path: input?.path,
    name: input?.name,
    op: input?.op,
    channel: 'tools/pre-execute',
  });
  if (decision.ok && (decision.inRoster === true || decision.allowed === false)) {
    appendAudit(
      cfg.auditPath,
      {
        channel: 'tools/pre-execute',
        name: decision.name,
        level: decision.level,
        op: decision.op,
        allowed: decision.allowed,
        detail: decision.reason,
      },
      { now, maxEntries: cfg.auditMaxEntries },
    );
  }
  return decision;
}

/** 三级一览（CLI / UI 用同一份）。 */
export function levelInfo() {
  return { levels: LEVELS, labels: LEVEL_LABEL, hints: LEVEL_HINT, ops: OPS, table: levelTable() };
}
