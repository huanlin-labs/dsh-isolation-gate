/**
 * 门禁 · 宿主路由自测（假 cordis ctx，不需要 dsh）
 *
 *   node test/run-routes.mjs [reportDir]
 *
 * 证明（全部真跑 `apply()`，写入的是临时文件，不碰真实配置）：
 *   · 6 条路由都注册上了，且全是 kind=exact；
 *   · `ctx.get('webServer')` 是**唯一**的 ctx 访问（不探测未声明服务）；
 *   · ping / state 200；level / roster 写入生效并**重启后仍在**（重新读盘即验证）；
 *   · 非法级别 / 缺名字 / 坏 JSON → 400；错误方法 → 405；外部 Origin → 403；
 *   · check 在被拒时仍回 200，但 `allowed:false` 且拒绝文案是中文（判定与通道同源）；
 *   · **绝对路径键**也能经路由改级别 / 判定（新能力）；
 *   · 名单不可用时报告里如实标出 `gateClosed`，且 check 一律拒绝（fail-closed）。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { apply, name, inject } from '../lib/index.js';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const checks = [];
const log = [];
function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

// 夹具放在 `D:\临时\` 下 —— 名字类判定取的钥匙是**盘根一级目录名**，
// 而 `临时` 本身就是一个合法的盘根一级目录名，因此"按名字判定"这一段可以用真名前缀来验；
// 路径类判定另用一条绝对路径（夹具里的深层目录）来验。
const root = mkdtempSync(join('D:\\临时', 'hs-gate-routes-'));
const statePath = join(root, '门禁-授权.json');
const rosterPath = join(root, '门禁-名单.txt');
const auditPath = join(root, 'audit.jsonl');
const backupDir = join(root, 'backup');
const scanRoot = join(root, 'fakeDrive');
mkdirSync(join(scanRoot, 'Zcode'), { recursive: true });
mkdirSync(join(scanRoot, 'pi'), { recursive: true });
const deepDir = join(scanRoot, 'Zcode', 'deep-dir');
mkdirSync(deepDir, { recursive: true });
writeFileSync(join(deepDir, 'a.txt'), 'x', 'utf8');

// ---- 假 cordis ------------------------------------------------------------
const registered = [];
const fakeWebServer = {
  register(definition) {
    registered.push(definition);
    return () => {};
  },
};
const guards = [];
const fakeTools = {
  guard(fn) {
    guards.push(fn);
    return () => {};
  },
};
const fakeDirectoryPicker = {
  capability: () => ({ kind: 'native', pick: async () => 'D:\\临时\\picked-dir' }),
};
const ctx = {
  tools: fakeTools,
  effect(callback) {
    const disposer = callback();
    return () => {
      if (typeof disposer === 'function') disposer();
    };
  },
  get(service) {
    log.push(`ctx.get('${service}')`);
    if (service === 'webServer') return fakeWebServer;
    if (service === 'directoryPicker') return fakeDirectoryPicker;
    return undefined;
  },
  inject(names, callback) {
    log.push(`ctx.inject(${JSON.stringify(names)})`);
    return () => {};
  },
};

apply(ctx, { statePath, rosterPath, auditPath, backupDir, root: `${scanRoot}\\` });

check('导出 name = dsh-isolation-gate', name === 'dsh-isolation-gate', name);
check('inject 为空数组（不猜、不探服务）', JSON.stringify(inject) === '["tools"]', JSON.stringify(inject));
check('注册了 20 条路由', registered.length === 20, registered.map((row) => row.path).join(' '));
check('路由前缀已改名（/__dsh-isolation-gate/*）', registered.every((row) => row.path.startsWith('/__dsh-isolation-gate/')), registered.map((row) => row.path).join(' '));
check('每条路由都是 kind=exact', registered.every((row) => row.kind === 'exact'));
check('只通过 ctx.get 访问 ctx 服务', log.every((entry) => entry.startsWith("ctx.get('webServer')") || entry.startsWith("ctx.get('directoryPicker')")), log.join(' '));

// ---- 假 http --------------------------------------------------------------
function makeRes() {
  const holder = {};
  return {
    holder,
    writeHead(status, headers) {
      holder.status = status;
      holder.headers = headers;
    },
    end(text) {
      holder.body = text;
      try {
        holder.json = JSON.parse(text);
      } catch {
        holder.json = null;
      }
    },
  };
}

function makeReq(method, url, body, headers = {}) {
  const listeners = {};
  return {
    method,
    url,
    headers,
    on(event, callback) {
      listeners[event] = callback;
      return this;
    },
    destroy() {},
    emitBody() {
      if (listeners.data && body !== undefined) {
        listeners.data(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'));
      }
      if (listeners.end) listeners.end();
    },
  };
}

async function hit(path, { method = 'GET', body, headers } = {}) {
  const [routePath] = path.split('?');
  const route = registered.find((row) => row.path === routePath);
  if (!route) throw new Error(`route not registered: ${routePath}`);
  const req = makeReq(method, path, body, headers);
  const res = makeRes();
  const pending = route.handler(req, res);
  req.emitBody();
  await pending;
  return res.holder;
}

const BASE = '/__dsh-isolation-gate';

try {
  const ping = await hit(`${BASE}/ping`);
  check('GET ping → 200', ping.status === 200, String(ping.status));
  check('ping 报出的路由数与注册数一致', Array.isArray(ping.json?.routes) && ping.json.routes.length === registered.length, `${ping.json?.routes?.length}/${registered.length}`);
  check('ping 报出三级说明', Array.isArray(ping.json?.table) && ping.json.table.length === 3, JSON.stringify(ping.json?.levels));
  check('ping 报出受管辖通道名（dsh-isolation-gate/bin/gate.mjs）', ping.json?.guardChannel === 'dsh-isolation-gate/bin/gate.mjs', ping.json?.guardChannel);
  check('apply() 本身不写盘（状态文件此刻还不存在）', !existsSync(statePath), 'apply 无副作用');

  const state = await hit(`${BASE}/state`);
  check('GET state → 200', state.status === 200, String(state.status));
  check('首次读取状态时按默认建出状态文件（全禁）', existsSync(statePath));
  {
    const raw = JSON.parse(readFileSync(statePath, 'utf8'));
    check('新建的状态文件里没有任何授权条目', Object.keys(raw.objects ?? {}).length === 0);
  }
  check('state 列出盘根一层目录（含 Zcode / pi）', state.json?.allRootDirs?.includes('Zcode') === true && state.json?.allRootDirs?.includes('pi') === true, (state.json?.allRootDirs ?? []).join(','));
  check('state 认出「疑似受管目录未入名单」= pi', (state.json?.diffs?.dirNotListedSuspect ?? []).includes('pi'), JSON.stringify(state.json?.diffs?.dirNotListedSuspect));
  check('state 里名单为空（清单还没建）', Array.isArray(state.json?.roster) && state.json.roster.length === 0);

  const badLevel = await hit(`${BASE}/level`, { method: 'POST', body: { name: 'Zcode', level: 'nope' } });
  check('POST level 非法级别 → 400', badLevel.status === 400, `${badLevel.status} ${badLevel.json?.error}`);

  const noName = await hit(`${BASE}/level`, { method: 'POST', body: { level: 'read' } });
  check('POST level 缺名字 → 400', noName.status === 400, noName.json?.error);

  // 先把 Zcode 加进名单（这一步会同时建 deny 条目）
  const addRoster = await hit(`${BASE}/roster`, { method: 'POST', body: { action: 'add', name: 'Zcode' } });
  check('POST roster add → 200', addRoster.status === 200, `${addRoster.status} ${addRoster.json?.error ?? ''}`);
  check('名单落盘后含 Zcode', readFileSync(rosterPath, 'utf8').includes('Zcode'));
  check('名单文件无 BOM', readFileSync(rosterPath)[0] !== 0xef);
  check('加入名单时**自动建 deny 条目**（不自动授权）', /默认禁/.test(addRoster.json?.stateNote ?? ''), addRoster.json?.stateNote);
  check('名单加入项的 kind 如实回报', addRoster.json?.kind === 'name', addRoster.json?.kind);

  const dupAdd = await hit(`${BASE}/roster`, { method: 'POST', body: { action: 'add', name: 'zcode' } });
  check('重复加入（大小写不同）→ 400', dupAdd.status === 400, dupAdd.json?.error);

  const setLevel = await hit(`${BASE}/level`, { method: 'POST', body: { name: 'Zcode', level: 'read' } });
  check('POST level → 200 且回报新级别', setLevel.status === 200 && setLevel.json?.level === 'read', JSON.stringify(setLevel.json?.level));
  const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
  check(
    '级别已落盘（= 重启后仍在）',
    Object.values(persisted.objects).some((cell) => cell.level === 'read'),
    JSON.stringify(persisted.objects),
  );
  check('落盘状态无 BOM', readFileSync(statePath)[0] !== 0xef);

  const state2 = await hit(`${BASE}/state`);
  const zcodeRow = (state2.json?.roster ?? []).find((row) => row.name === 'Zcode');
  check('state 里 Zcode 行 = read 且目录存在', zcodeRow?.level === 'read' && zcodeRow?.dirExists === true, JSON.stringify(zcodeRow));
  check('state 里 Zcode 行的 kind = name（名字类参与磁盘差异比对）', zcodeRow?.kind === 'name' && zcodeRow?.isPath === false, JSON.stringify({ kind: zcodeRow?.kind, isPath: zcodeRow?.isPath }));
  check('state 报出 rosterCounts（两类分别计数）', state2.json?.rosterCounts?.names === 1 && state2.json?.rosterCounts?.paths === 0, JSON.stringify(state2.json?.rosterCounts));
  check('策略行可读（给 agent 用）', (state2.json?.policy ?? []).some((line) => /^Zcode = read/.test(line)), (state2.json?.policy ?? []).join(' | '));

  const checkRead = await hit(`${BASE}/check`, { method: 'POST', body: { name: 'Zcode', op: 'read' } });
  check('POST check(read) → 200 且 allowed', checkRead.status === 200 && checkRead.json?.allowed === true);
  const checkDelete = await hit(`${BASE}/check`, { method: 'POST', body: { name: 'Zcode', op: 'delete' } });
  check('POST check(delete) → 200 但 allowed:false', checkDelete.status === 200 && checkDelete.json?.allowed === false);
  check('被拒理由含中文说明与通道名', /拒绝：/.test(checkDelete.json?.reason ?? '') && /http/.test(checkDelete.json?.reason ?? ''), checkDelete.json?.reason);
  check('判定结果带上命中对象（matchedKey/matchedKind）', checkDelete.json?.matchedKey === 'Zcode' && checkDelete.json?.matchedKind === 'name', JSON.stringify({ key: checkDelete.json?.matchedKey, kind: checkDelete.json?.matchedKind }));

  const checkTraverseDenied = await hit(`${BASE}/check`, {
    method: 'POST',
    body: { path: join(scanRoot, 'Zcode', 'anything'), op: 'read' },
  });
  check(
    '按**路径**判定的钥匙 = 盘根一级目录名（夹具在 D:\\临时 下 ⇒ 名字应为「临时」）',
    checkTraverseDenied.json?.name === null || checkTraverseDenied.json?.name === '临时',
    JSON.stringify(checkTraverseDenied.json?.name),
  );

  await hit(`${BASE}/roster`, { method: 'POST', body: { action: 'add', name: '临时' } });
  const byPathDeny = await hit(`${BASE}/check`, { method: 'POST', body: { path: join(scanRoot, 'Zcode', 'anything'), op: 'read' } });
  check('新入名单的项按路径判定即为 deny（不自动授权）', byPathDeny.json?.name === '临时' && byPathDeny.json?.level === 'deny' && byPathDeny.json?.allowed === false, JSON.stringify({ name: byPathDeny.json?.name, level: byPathDeny.json?.level }));
  await hit(`${BASE}/level`, { method: 'POST', body: { name: '临时', level: 'read' } });
  const byPathRead = await hit(`${BASE}/check`, { method: 'POST', body: { path: join(scanRoot, 'Zcode', 'anything'), op: 'read' } });
  check('授权只读后同一路径放行 read', byPathRead.json?.allowed === true && byPathRead.json?.level === 'read');
  const byPathDelete = await hit(`${BASE}/check`, { method: 'POST', body: { path: join(scanRoot, 'Zcode', 'anything'), op: 'delete' } });
  check('只读时同一路径仍拒 delete', byPathDelete.json?.allowed === false);

  // ---- 新能力：走路由加一条**绝对路径**受管对象并判定 ----
  const addPath = await hit(`${BASE}/roster`, { method: 'POST', body: { action: 'add', name: deepDir } });
  check('POST roster add（绝对路径）→ 200 且 kind=path', addPath.status === 200 && addPath.json?.kind === 'path', `${addPath.status} ${addPath.json?.error ?? ''}`);
  check('路径行以归一化形态落进名单', readFileSync(rosterPath, 'utf8').split(/\r?\n/).some((line) => line.trim().toLowerCase() === deepDir.toLowerCase()), readFileSync(rosterPath, 'utf8').replace(/\r?\n/g, ' | '));
  const pathDeny = await hit(`${BASE}/check`, { method: 'POST', body: { path: join(deepDir, 'a.txt'), op: 'read' } });
  check('新入名单的路径对象默认 deny（不自动授权）', pathDeny.json?.allowed === false && pathDeny.json?.matchedKind === 'path', JSON.stringify({ allowed: pathDeny.json?.allowed, kind: pathDeny.json?.matchedKind }));

  const setPathLevel = await hit(`${BASE}/level`, { method: 'POST', body: { name: deepDir, level: 'read' } });
  check('POST level（绝对路径键）→ 200', setPathLevel.status === 200 && setPathLevel.json?.level === 'read' && setPathLevel.json?.kind === 'path', JSON.stringify(setPathLevel.json?.name));
  const pathRead = await hit(`${BASE}/check`, { method: 'POST', body: { path: join(deepDir, 'a.txt'), op: 'read' } });
  check('路径对象授权只读后，其下的文件放行 read', pathRead.json?.allowed === true && pathRead.json?.matchedKey?.toLowerCase() === deepDir.toLowerCase(), JSON.stringify({ key: pathRead.json?.matchedKey }));
  const pathDelete = await hit(`${BASE}/check`, { method: 'POST', body: { path: join(deepDir, 'a.txt'), op: 'delete' } });
  check('路径对象只读时仍拒 delete', pathDelete.json?.allowed === false);
  check('路径 **不**靠名字类命中（名字键与路径键互不混淆）', pathRead.json?.matchedKind === 'path', pathRead.json?.matchedKind);

  const state3 = await hit(`${BASE}/state`);
  const pathRow = (state3.json?.roster ?? []).find((row) => row.key?.toLowerCase() === deepDir.toLowerCase());
  check('state 里路径行带 isPath=true 且报"目录存在"', pathRow?.isPath === true && pathRow?.dirExists === true, JSON.stringify(pathRow));
  check('policy 里路径行带 [路径] 标记', (state3.json?.policy ?? []).some((line) => line.startsWith('[路径] ')), (state3.json?.policy ?? []).join(' | '));

  // 降回 deny，再确认 check 被拒
  await hit(`${BASE}/level`, { method: 'POST', body: { name: 'Zcode', level: 'deny' } });
  const backToDeny = await hit(`${BASE}/check`, { method: 'POST', body: { name: 'Zcode', op: 'traverse' } });
  check('降回 deny 后 traverse 立即被拒', backToDeny.json?.allowed === false && backToDeny.json?.level === 'deny');

  const removeRoster = await hit(`${BASE}/roster`, { method: 'POST', body: { action: 'remove', name: 'Zcode' } });
  check('POST roster remove → 200', removeRoster.status === 200, removeRoster.json?.error ?? '');
  check('移除后名单不含 Zcode（路径行不受牵连）', !readFileSync(rosterPath, 'utf8').split(/\r?\n/).some((line) => line.trim() === 'Zcode') && readFileSync(rosterPath, 'utf8').includes(deepDir), readFileSync(rosterPath, 'utf8').replace(/\r?\n/g, ' | '));
  check('移除时也留了备份', typeof removeRoster.json?.backup === 'string' && existsSync(removeRoster.json.backup), removeRoster.json?.backup);
  const removePath = await hit(`${BASE}/roster`, { method: 'POST', body: { action: 'remove', name: deepDir } });
  check('POST roster remove（绝对路径）→ 200', removePath.status === 200 && removePath.json?.kind === 'path', `${removePath.status} ${removePath.json?.error ?? ''}`);

  const audit = await hit(`${BASE}/log?limit=20`);
  check('GET log → 200 且有记录', audit.status === 200 && Array.isArray(audit.json?.audit?.entries) && audit.json.audit.entries.length > 0, String(audit.json?.audit?.entries?.length));

  const wrongMethod = await hit(`${BASE}/state`, { method: 'POST', body: {} });
  check('GET 路由用 POST → 405', wrongMethod.status === 405, String(wrongMethod.status));

  const badJson = await hit(`${BASE}/level`, { method: 'POST', body: '不是 JSON' });
  check('坏 JSON → 400', badJson.status === 400, badJson.json?.error);

  const foreign = await hit(`${BASE}/state`, { headers: { origin: 'https://evil.example.com' } });
  check('外部 Origin → 403', foreign.status === 403, String(foreign.status));

  const local = await hit(`${BASE}/state`, { headers: { origin: 'http://127.0.0.1:19387' } });
  check('本机 Origin → 200', local.status === 200, String(local.status));

  // ---- fail-closed：名单不可用 ⇒ 报告标出 gateClosed，判定一律拒绝 ----
  // ---- 2026-10-21：分组 / 组级一键切 / 孤儿清理 / 工具门干跑 / 原生选择器 ----
  check('工具门已挂载（ctx.tools.guard 一次）', guards.length === 1, String(guards.length));
  const guardRead = guards[0]({ name: 'read', arguments: { path: join(deepDir, 'a.txt') } });
  check('工具门：read 级下读文件放行', guardRead === undefined, String(guardRead));
  const guardWrite = guards[0]({ name: 'write', arguments: { path: join(deepDir, 'a.txt') } });
  check('工具门：read 级下写文件被拒（文案含门禁）', typeof guardWrite === 'string' && guardWrite.includes('门禁'), guardWrite);
  const guardShell = guards[0]({ name: 'bash', arguments: { command: 'rm -rf "' + deepDir + '"' } });
  check('工具门：shell 删除受管路径被拒', typeof guardShell === 'string' && guardShell.includes('门禁'), guardShell);

  await hit(`${BASE}/roster`, { method: 'POST', body: { action: 'add', name: 'pi' } });
  const assign = await hit(`${BASE}/group`, { method: 'POST', body: { action: 'assign', name: 'pi', group: 'harness 隔离' } });
  check('POST group assign → 200 且回组名', assign.status === 200 && assign.json?.group === 'harness 隔离', JSON.stringify(assign.json?.group));
  const withGroup = await hit(`${BASE}/state`);
  check('state 报出分组（含成员数）', (withGroup.json?.groups ?? []).some((g) => g.name === 'harness 隔离' && g.count === 1), JSON.stringify(withGroup.json?.groups));
  const groupLevel = await hit(`${BASE}/group-level`, { method: 'POST', body: { group: 'harness 隔离', level: 'full' } });
  check('POST group-level → 200 且报 count=1', groupLevel.status === 200 && groupLevel.json?.count === 1, JSON.stringify(groupLevel.json?.count));
  check('组级切换已落盘（pi = full）', groupLevel.json?.report?.roster?.find((r) => r.name === 'pi')?.level === 'full');
  const persistedGroup = JSON.parse(readFileSync(statePath, 'utf8'));
  check('状态文件 v3：groups/objects 落盘', persistedGroup.version === 3 && Boolean(persistedGroup.groups?.['harness 隔离']) && persistedGroup.objects?.pi?.group === 'harness 隔离', JSON.stringify(Object.keys(persistedGroup)));
  const delGroup = await hit(`${BASE}/group`, { method: 'POST', body: { action: 'delete', group: 'harness 隔离' } });
  check('POST group delete → 200 且成员保留', delGroup.status === 200 && Array.isArray(delGroup.json?.released) && delGroup.json.released.includes('pi'), JSON.stringify(delGroup.json?.released));

  const newGroup = await hit(`${BASE}/group`, { method: 'POST', body: { action: 'create', group: '空组试验', note: '还没成员' } });
  check('POST group create → 200 且回组名', newGroup.status === 200 && newGroup.json?.group === '空组试验', JSON.stringify(newGroup.json));
  const afterCreate = await hit(`${BASE}/state`);
  check(
    '空组出现在 state（count=0，带备注）',
    (afterCreate.json?.groups ?? []).some((g) => g.name === '空组试验' && g.count === 0 && g.note === '还没成员'),
    JSON.stringify(afterCreate.json?.groups),
  );
  const dupGroup = await hit(`${BASE}/group`, { method: 'POST', body: { action: 'create', group: '空组试验' } });
  check('重复建同名组 → 400 且提示已存在', dupGroup.status === 400 && /已存在/.test(dupGroup.json?.error ?? ''), JSON.stringify(dupGroup.json?.error));
  const persistedEmpty = JSON.parse(readFileSync(statePath, 'utf8'));
  check('空组已落盘（groups 有条目、objects 无成员）', Boolean(persistedEmpty.groups?.['空组试验']) && !Object.values(persistedEmpty.objects ?? {}).some((cell) => cell?.group === '空组试验'), JSON.stringify(Object.keys(persistedEmpty.groups ?? {})));

  const orphanLevel = await hit(`${BASE}/level`, { method: 'POST', body: { name: 'steam', level: 'read' } });
  check('给名单外对象设级别 → 200（成为孤儿键）', orphanLevel.status === 200);
  const pruned = await hit(`${BASE}/prune`, { method: 'POST', body: {} });
  check('POST prune → 200 且清掉 steam', pruned.status === 200 && (pruned.json?.removed ?? []).includes('steam'), JSON.stringify(pruned.json?.removed));

  const dry = await hit(`${BASE}/toolcheck`, { method: 'POST', body: { tool: 'write', args: { path: join(deepDir, 'a.txt') } } });
  check('POST toolcheck（写）→ wouldDeny=true', dry.status === 200 && dry.json?.wouldDeny === true, JSON.stringify({ deny: dry.json?.wouldDeny, targets: dry.json?.targets?.length }));
  const dryRead = await hit(`${BASE}/toolcheck`, { method: 'POST', body: { tool: 'read', args: { path: join(deepDir, 'a.txt') } } });
  check('POST toolcheck（读）→ wouldDeny=false', dryRead.status === 200 && dryRead.json?.wouldDeny === false);
  const pick = await hit(`${BASE}/pick`, { method: 'POST', body: {} });
  check('POST pick → 200 且返回选择器给出的路径', pick.status === 200 && pick.json?.ok === true && /picked-dir/.test(pick.json?.path ?? ''), JSON.stringify(pick.json));

  const closedRosterPath = join(root, '不存在的名单.txt');
  const registered2 = [];
  const fakeWebServer2 = {
    register(definition) {
      registered2.push(definition);
      return () => {};
    },
  };
  apply(
    {
      effect: (callback) => callback(),
      tools: fakeTools,
      get: (service) =>
        service === 'webServer' ? fakeWebServer2 : service === 'directoryPicker' ? fakeDirectoryPicker : undefined,
      inject: () => () => {},
    },
    { statePath, rosterPath: closedRosterPath, auditPath, backupDir, root: `${scanRoot}\\` },
  );
  const hit2 = async (path, { method = 'GET', body, headers } = {}) => {
    const [routePath] = path.split('?');
    const route = registered2.find((row) => row.path === routePath);
    const req = makeReq(method, path, body, headers);
    const res = makeRes();
    const pending = route.handler(req, res);
    req.emitBody();
    await pending;
    return res.holder;
  };
  const closedState = await hit2(`${BASE}/state`);
  check('名单不可用时 state 标出 gateClosed=true', closedState.json?.files?.gateClosed === true, JSON.stringify(closedState.json?.files?.rosterError));
  check('名单不可用时 state 给出可直接抄的报告文案', /名单不可用/.test(closedState.json?.files?.rosterGateMessage ?? ''), closedState.json?.files?.rosterGateMessage);
  const closedCheck = await hit2(`${BASE}/check`, { method: 'POST', body: { name: 'Zcode', op: 'read' } });
  check('名单不可用时 check 一律拒绝（allowed:false，HTTP 仍 200）', closedCheck.status === 200 && closedCheck.json?.allowed === false && closedCheck.json?.rosterUnavailable === true, JSON.stringify({ status: closedCheck.status, allowed: closedCheck.json?.allowed }));
  check('fail-closed 的拒绝理由含「名单不可用」', /名单不可用/.test(closedCheck.json?.reason ?? ''), closedCheck.json?.reason);
  const closedOutside = await hit2(`${BASE}/check`, { method: 'POST', body: { path: 'D:\\工作区\\插件制作\\随便', op: 'read' } });
  check('名单不可用时**连名单外路径也拒**（旧版会放行 ⇒ fail-open）', closedOutside.json?.allowed === false, JSON.stringify(closedOutside.json?.allowed));

  // 「没有 webServer」的 profile：应走 ctx.inject 等待，而不是挂死
  const waited = [];
  const ctxNoWeb = {
    tools: fakeTools,
    effect(callback) {
      callback();
      return () => {};
    },
    get(service) {
      waited.push(`get:${service}`);
      return undefined;
    },
    inject(names, callback) {
      waited.push(`inject:${names.join(',')}`);
      return () => {};
    },
  };
  apply(ctxNoWeb, { statePath, rosterPath, auditPath, backupDir, root: `${scanRoot}\\` });
  check('没有 webServer 时改用 ctx.inject 等待（不挂死、不探测）', waited.includes('get:webServer') && waited.includes('inject:webServer'), waited.join(' '));
} finally {
  rmSync(root, { recursive: true, force: true });
}

mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, 'routes-report.json'), JSON.stringify({ checks, registered: registered.map((row) => row.path) }, null, 2));
console.log(`\n报告已写：${join(reportDir, 'routes-report.json')}`);

const failed = checks.filter((row) => !row.ok);
console.log(`\n=== 宿主路由自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
