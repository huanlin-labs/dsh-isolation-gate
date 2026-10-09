/**
 * 门禁 · 客户端自测（假 __ModuleLoader__ + React 桩，不需要浏览器/dsh）
 *
 *   node test/run-client.mjs [reportDir]
 *
 * 覆盖：
 *   · bundle 能被求值、工厂拿到 require('react') 后返回 { apply, inject }；
 *   · **两个座位都注册**：`sidebar.panellist` 行（id/order/label）+ `main` keyed 页（key 同行 id）；
 *   · **order = 6 ⇒ 紧贴「技能」（5）下方**，且仍在「自动化任务」（10）之前；
 *   · `inject: ['slots']` 声明到位（不探测服务）；
 *   · 座位未声明时不抛错（外壳没这个槽位时安静缺席）；
 *   · 导航图标带 `data-dsh-panel-entry`；
 *   · 纯视图 `GateView` 的三种态渲染：加载态 / 有差异态 / 干净态，且**差异文字真的出现**；
 *   · **两类受管对象都渲染**：路径对象带 `[路径]` 标记 + 目录存在/不存在；
 *   · 交互回调接线正确（点三级按钮 → onPickLevel(name, level)；点"加入名单" → onAskAdd(name)）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

// ---- React 桩：只实现本插件用到的那几个 API -------------------------------
function createElement(type, props, ...children) {
  let kids;
  if (children.length === 0) kids = undefined;
  else if (children.length === 1) kids = children[0];
  else kids = children;
  return { type, props: Object.assign({}, props ?? {}, { children: kids }) };
}

const reactStub = {
  createElement,
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useEffect: () => undefined,
  useState: (initial) => [initial, () => {}],
};

// ---- 假 window.__ModuleLoader__ -------------------------------------------
let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition;
    },
  },
};

await import('../lib/client.js');

check('bundle 求值后注册了模块', captured !== null && captured.id === 'dsh-access-gate', captured?.id);
const moduleExports = captured.factory((id) => {
  if (id === 'react') return reactStub;
  throw new Error(`unexpected require(${id})`);
});
check('工厂返回 apply/inject', typeof moduleExports.apply === 'function' && Array.isArray(moduleExports.inject), JSON.stringify(moduleExports.inject));
check('inject 声明了 slots（声明后用，绝不探测）', moduleExports.inject.includes('slots'));
check('提供自测出口 __selftest', typeof moduleExports.__selftest?.GateView === 'function');

// ---- apply：座位注册 ------------------------------------------------------
const registrations = [];
const injections = [];
const ctx = {
  slots: {
    inject(name, callback) {
      injections.push(name);
      return callback();
    },
    register(definition, component) {
      registrations.push({ definition, component });
      return () => {};
    },
  },
  effect(callback) {
    callback();
  },
};
moduleExports.apply(ctx);

const row = registrations.find((item) => item.definition.name === 'sidebar.panellist');
const page = registrations.find((item) => item.definition.name === 'main');
check('注册了 2 个座位', registrations.length === 2, registrations.map((item) => item.definition.name).join(' / '));
check('座位 ①：sidebar.panellist 行', Boolean(row));
check('行的 id = access-gate', row?.definition.id === 'access-gate', row?.definition.id);
check('行的 label = 门禁', row?.definition.label === '门禁', row?.definition.label);
check('行 order = 6（技能=5 的正下方，自动化任务=10 之前）', row?.definition.order === 6, String(row?.definition.order));
check('座位 ②：main 整页，key 与行 id 同名', page?.definition.key === 'access-gate', page?.definition.key);
check('两个座位都经 slots.inject 声明后注册', injections.join(',') === 'sidebar.panellist,main', injections.join(','));

const { GateIcon, GateView, PANEL_ID, PANEL_ORDER } = moduleExports.__selftest;
check('自测出口常量一致', PANEL_ID === 'access-gate' && PANEL_ORDER === 6, `${PANEL_ID}/${PANEL_ORDER}`);

const icon = GateIcon({ size: 18 });
check('图标是 svg 且带皮肤契约钩子', icon.type === 'svg' && icon.props['data-dsh-panel-entry'] === 'access-gate');
check('图标用外壳给的尺寸', icon.props.width === 18 && icon.props.height === 18, String(icon.props.width));

// ---- 座位不存在时不抛错 ---------------------------------------------------
let missingSeatThrew = null;
try {
  moduleExports.apply({
    slots: {
      inject: () => () => {},
      register: () => () => {},
    },
    effect: (callback) => callback(),
  });
} catch (error) {
  missingSeatThrew = error;
}
check('外壳没有该座位时不抛错（安静缺席）', missingSeatThrew === null, missingSeatThrew?.message);

// ---- 纯视图渲染（树遍历） -------------------------------------------------
function renderTree(element) {
  const texts = [];
  const nodes = [];
  const visit = (node, depth) => {
    if (depth > 40 || node === null || node === undefined || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node));
      return;
    }
    if (typeof node !== 'object') return;
    if (typeof node.type === 'function') {
      nodes.push(node);
      visit(node.type(node.props), depth + 1);
      return;
    }
    nodes.push(node);
    visit(node.props?.children, depth + 1);
  };
  visit(element, 0);
  return { texts, nodes, flat: texts.join(' ') };
}

let renderError = null;
let loadingTree = null;
try {
  loadingTree = renderTree(GateView({ model: null, busy: true }));
} catch (error) {
  renderError = error;
}
check('加载态渲染不抛错', renderError === null, renderError?.message);
check('加载态给出"读取中…"', loadingTree?.flat.includes('读取中'), loadingTree?.flat.slice(0, 60));

const pathKey = 'E:\\资料\\合作档案\\某项目';
const fixture = {
  now: '2026-10-09T13:00:00.000Z',
  paths: { state: 'D:\\.agents\\门禁-授权.json', roster: 'D:\\.agents\\门禁-名单.txt', root: 'D:\\', backupDir: 'D:\\回收站\\门禁-名单改前', audit: 'C:\\.dsh\\dsh-access-gate\\access-log.jsonl' },
  files: { stateExists: true, stateError: null, rosterExists: true, rosterOk: true, rosterError: null, gateClosed: false, rosterGateMessage: null, rosterDuplicates: [], rosterInvalid: [], rootError: null },
  levels: [
    { level: 'deny', label: '禁', hint: '完全不可访问（默认）', allowedOps: [] },
    { level: 'read', label: '只读', hint: '可读、可比对', allowedOps: ['traverse', 'read'] },
    { level: 'full', label: '可读写删', hint: '含删减文件', allowedOps: ['traverse', 'read', 'write', 'delete'] },
  ],
  updatedAt: '2026-10-09T13:00:00.000Z',
  updatedBy: 'gui',
  roster: [
    { name: 'Zcode', key: 'Zcode', kind: 'name', isPath: false, level: 'deny', levelLabel: '禁', allowedOps: [], dirExists: true, dirName: 'Zcode', status: 'ok', hint: '在名单内 · 目录存在' },
    { name: 'gone', key: 'gone', kind: 'name', isPath: false, level: 'read', levelLabel: '只读', allowedOps: ['traverse', 'read'], dirExists: false, dirName: null, status: 'roster-missing-dir', hint: '已在名单但目录不存在（疑似笔误 / 已删 / 该盘未挂载）' },
    { name: pathKey, key: pathKey, kind: 'path', isPath: true, level: 'full', levelLabel: '可读写删', allowedOps: ['traverse', 'read', 'write', 'delete'], dirExists: true, dirName: pathKey, status: 'path-ok', hint: '路径受管 · 目录存在' },
  ],
  rosterCounts: { total: 3, names: 2, paths: 1 },
  stateOnly: [{ name: 'pi', level: 'deny', levelLabel: '禁', hint: '状态文件里有、但**不在名单**里 ⇒ 当前不受管辖' }],
  diffs: { rosterCount: 3, rootDirCount: 3, rosterMissingDir: ['gone'], dirNotListedSuspect: ['pi'], dirNotListed: ['steam'], caseMismatch: [{ roster: 'zCoDe', disk: 'Zcode' }], pathMissing: [], pathNotDir: [] },
  unlistedDirs: [
    { name: 'pi', suspect: true, status: 'dir-not-listed-suspect' },
    { name: 'steam', suspect: false, status: 'dir-not-listed' },
  ],
  allRootDirs: ['Zcode', 'pi', 'steam'],
  policy: ['Zcode = deny（禁）· 允许：无', 'gone = read（只读）· 允许：traverse,read', `[路径] ${pathKey} = full（可读写删）· 允许：traverse,read,write,delete`],
  audit: {
    ok: true,
    total: 2,
    entries: [
      { atLocal: '2026-10-09 13:00:01', allowed: false, channel: 'dsh-access-gate/bin/gate.mjs', name: 'Zcode', op: 'traverse', detail: '拒绝：…' },
      { atLocal: '2026-10-09 13:00:02', allowed: true, channel: 'gui', name: 'Zcode', op: 'set-level', detail: '级别 → deny（禁）' },
    ],
  },
};

const clicks = [];
const handlers = {
  busy: false,
  showUnlisted: true,
  pending: null,
  error: null,
  notice: null,
  model: fixture,
  onRefresh: () => clicks.push(['refresh']),
  onPickLevel: (name, level) => clicks.push(['pickLevel', name, level]),
  onAskAdd: (name) => clicks.push(['askAdd', name]),
  onAskRemove: (name) => clicks.push(['askRemove', name]),
  onConfirmPending: () => clicks.push(['confirm']),
  onCancelPending: () => clicks.push(['cancel']),
  onToggleUnlisted: () => clicks.push(['toggle']),
};

let diffTree = null;
let diffError = null;
try {
  diffTree = renderTree(GateView(handlers));
} catch (error) {
  diffError = error;
}
check('有差异态渲染不抛错', diffError === null, diffError?.message);
check('标题出现「门禁 · 目录访问管制」', diffTree.flat.includes('门禁 · 目录访问管制'));
check('抬头写明两类受管对象（名字 / 绝对路径）', diffTree.flat.includes('名字') && diffTree.flat.includes('绝对路径'));
check('差异块报出「已在名单但目录不存在」', diffTree.flat.includes('已在名单但目录不存在'));
check('差异块报出「目录存在但未入名单」', diffTree.flat.includes('目录存在但未入名单'));
check('差异块报出大小写不一致', diffTree.flat.includes('大小写不一致'));
check('差异块口径已改：写的是「疑似受管目录」', diffTree.flat.includes('疑似受管目录') && !diffTree.flat.includes('疑似 harness：'), '');
check('三行受管对象都渲染出来（含路径键）', diffTree.flat.includes('Zcode') && diffTree.flat.includes('gone') && diffTree.flat.includes('某项目'));
check('路径对象带 [路径] 标记', diffTree.flat.includes('[路径]'));
check('两类都显示"目录存在/不存在"徽标', diffTree.flat.includes('目录存在') && diffTree.flat.includes('目录不存在'));
check('受管对象计数（名字 / 路径）渲染出来', diffTree.flat.includes('名字 2') && diffTree.flat.includes('路径 1'), '');
check('三级徽标都在（禁 / 只读 / 可读写删）', diffTree.flat.includes('禁') && diffTree.flat.includes('只读') && diffTree.flat.includes('可读写删'));
check('未入名单的疑似项有「加入名单」按钮', diffTree.flat.includes('加入名单'));
check('受管辖通道的读法写在页面上（bin\\gate.mjs status）', diffTree.flat.includes('bin\\gate.mjs status'));
check('判定示例里给出 --path 用法', diffTree.flat.includes('--path'));
check('审计尾部渲染出来（含"拒绝"与"放行"）', diffTree.flat.includes('拒绝') && diffTree.flat.includes('放行'));
check('状态里有、名单里没有的那段渲染出来', diffTree.flat.includes('当前不受管辖'));
check('纪律页脚写明"不读任何受管对象内部内容"', diffTree.flat.includes('不读任何受管对象内部内容'), '');
check('页脚写明 fail-closed', diffTree.flat.includes('一律拒绝'), '');
check('根节点带 data-dsh-plugin=access-gate', diffTree.nodes[0]?.props?.['data-dsh-plugin'] === 'access-gate');
check('受管对象行带 data-gate-object 便于皮肤定位', diffTree.nodes.some((node) => node.props?.['data-gate-object'] === 'Zcode'));

// fail-closed 警示条
const closedTree = renderTree(
  GateView(
    Object.assign({}, handlers, {
      model: Object.assign({}, fixture, {
        files: Object.assign({}, fixture.files, {
          rosterExists: false,
          rosterOk: false,
          gateClosed: true,
          rosterGateMessage: `名单不可用（D:\\.agents\\门禁-名单.txt 缺失或损坏）⇒ 按"一律拒绝"处理，请先恢复名单文件`,
        }),
      }),
    }),
  ),
);
check('名单不可用时页面顶部给出警示条', closedTree.flat.includes('名单不可用') && closedTree.flat.includes('一律拒绝'), '');

// 交互接线：找到三级按钮与"加入名单"按钮并真的点一下
const levelButtons = diffTree.nodes.filter((node) => node.type === 'button' && ['禁', '只读', '可读写删'].includes(node.props?.children) && typeof node.props?.onClick === 'function');
check('找得到三级切换按钮（3 行 × 3 级）', levelButtons.length >= 9, String(levelButtons.length));
levelButtons[0].props.onClick();
levelButtons[3].props.onClick();
check('点三级按钮 → onPickLevel(名字, 级别)', JSON.stringify(clicks.filter((row) => row[0] === 'pickLevel').slice(0, 2)) === JSON.stringify([['pickLevel', 'Zcode', 'deny'], ['pickLevel', 'gone', 'deny']]), JSON.stringify(clicks.filter((row) => row[0] === 'pickLevel').slice(0, 2)));

const pathRowButtons = levelButtons.slice(6, 9);
pathRowButtons[2].props.onClick();
check('路径对象也有 禁/只读/可读写删 三个按钮，且回调带的是**路径键**', JSON.stringify(clicks.at(-1)) === JSON.stringify(['pickLevel', pathKey, 'full']), JSON.stringify(clicks.at(-1)));

const addButton = diffTree.nodes.find((node) => node.type === 'button' && node.props?.children === '加入名单');
check('找得到「加入名单」按钮', Boolean(addButton));
addButton?.props.onClick();
check('点「加入名单」 → onAskAdd(名字)（只是置为待确认，不直接写盘）', JSON.stringify(clicks.at(-1)) === JSON.stringify(['askAdd', 'pi']), JSON.stringify(clicks.at(-1)));

const removeButtons = diffTree.nodes.filter((node) => node.type === 'button' && node.props?.children === '从名单移除');
check('每个受管对象（含路径类）都有「从名单移除」按钮', removeButtons.length === 3, String(removeButtons.length));
removeButtons[0].props.onClick();
check('点「从名单移除」 → onAskRemove(名字)', JSON.stringify(clicks.at(-1)) === JSON.stringify(['askRemove', 'Zcode']), JSON.stringify(clicks.at(-1)));
removeButtons[2].props.onClick();
check('路径类的「从名单移除」回调带路径键', JSON.stringify(clicks.at(-1)) === JSON.stringify(['askRemove', pathKey]), JSON.stringify(clicks.at(-1)));

// 待确认条：确认前不写盘（只有点击才回调 confirm）
const pendingTree = renderTree(GateView(Object.assign({}, handlers, { pending: { action: 'remove', name: 'Zcode' } })));
check('待确认条提醒「降低管制范围」', pendingTree.flat.includes('降低管制范围'));
check('待确认条警示移除的后果', pendingTree.flat.includes('不再受管辖'));
const confirmButton = pendingTree.nodes.find((node) => node.type === 'button' && typeof node.props?.children === 'string' && node.props.children.startsWith('确认移除'));
check('待确认条给出确认按钮（改前先备份字样）', Boolean(confirmButton) && confirmButton.props.children.includes('改前先备份'), confirmButton?.props?.children);
confirmButton?.props.onClick();
check('点确认 → onConfirmPending()', JSON.stringify(clicks.at(-1)) === JSON.stringify(['confirm']), JSON.stringify(clicks.at(-1)));

// 干净态：无差异、无未入名单、无审计
const cleanTree = renderTree(
  GateView(
    Object.assign({}, handlers, {
      model: Object.assign({}, fixture, {
        diffs: { rosterCount: 1, rootDirCount: 1, rosterMissingDir: [], dirNotListedSuspect: [], dirNotListed: [], caseMismatch: [], pathMissing: [], pathNotDir: [] },
        unlistedDirs: [],
        stateOnly: [],
        audit: { ok: true, total: 0, entries: [] },
      }),
    }),
  ),
);
check('干净态显示 ✓ 无差异', cleanTree.flat.includes('无差异'));
check('干净态审计显示"暂无记录"', cleanTree.flat.includes('暂无记录'));

// 错误态
const errorTree = renderTree(GateView(Object.assign({}, handlers, { error: '状态文件不是合法 JSON' })));
check('错误态把宿主给的错误原文显示出来', errorTree.flat.includes('状态文件不是合法 JSON'));

mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, 'client-report.json'), JSON.stringify({ checks, registrations: registrations.map((item) => item.definition) }, null, 2));
console.log(`\n报告已写：${join(reportDir, 'client-report.json')}`);

const failed = checks.filter((row) => !row.ok);
console.log(`\n=== 客户端自测：${checks.length - failed.length}/${checks.length} 通过 ===`);
process.exit(failed.length === 0 ? 0 : 1);
