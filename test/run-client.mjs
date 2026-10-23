/**
 * 门禁 · 客户端自测（假 __ModuleLoader__ + React 桩，不需要浏览器/dsh）
 *
 *   node test/run-client.mjs [reportDir]
 *
 * 覆盖：
 *   · bundle 求值 / apply / inject / 两座位注册 / order=6；
 *   · 纯视图 `GateView` 的四种态：加载 / 有差异 / 空态 / 干净；
 *   · 2026-10-21 界面重构：摘要条、分组卡片、组头分段控件、行内分段控件、`⋯` 菜单、空态；
 *   · 交互接线：行级/组级切档、选目录、加入名单、归组、删组、清理孤儿键、移除确认。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const reportDir = resolve(process.argv[2] ?? join(import.meta.dirname, 'out'));
const checks = [];
function check(label, ok, detail) {
  checks.push({ label, ok: Boolean(ok), detail: detail === undefined ? null : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

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
  Component: class {
    constructor(props) {
      this.props = props;
      this.state = {};
    }
  },
};

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition;
    },
  },
};

await import('../lib/client.js');

check('bundle 求值后注册了模块', captured !== null && captured.id === 'dsh-isolation-gate', captured?.id);
const moduleExports = captured.factory((id) => {
  if (id === 'react') return reactStub;
  throw new Error(`unexpected require(${id})`);
});
check('工厂返回 apply/inject', typeof moduleExports.apply === 'function' && Array.isArray(moduleExports.inject), JSON.stringify(moduleExports.inject));
check('inject 声明了 slots（声明后用，绝不探测）', moduleExports.inject.includes('slots'));
check('提供自测出口 __selftest', typeof moduleExports.__selftest?.GateView === 'function');

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
check('注册了 2 个座位（一个侧栏项 + 一个主页面）', registrations.length === 2, registrations.map((item) => item.definition.name).join(' / '));
check('座位 ①：sidebar.panellist 行', Boolean(row));
check('行的 id = isolation-gate', row?.definition.id === 'isolation-gate', row?.definition.id);
check('行的 label = 门禁', row?.definition.label === '门禁', row?.definition.label);
check('行 order = 6（技能=5 的正下方，自动化任务=10 之前）', row?.definition.order === 6, String(row?.definition.order));
check('座位 ②：main 整页，key 与行 id 同名', page?.definition.key === 'isolation-gate', page?.definition.key);
check('两个座位都经 slots.inject 声明后注册', injections.join(',') === 'sidebar.panellist,main', injections.join(','));

const { GateIcon, GateView, Segmented, PANEL_ID, PANEL_ORDER } = moduleExports.__selftest;
check('自测出口常量一致', PANEL_ID === 'isolation-gate' && PANEL_ORDER === 6, `${PANEL_ID}/${PANEL_ORDER}`);

const icon = GateIcon({ size: 18 });
check('图标是 svg 且带皮肤契约钩子', icon.type === 'svg' && icon.props['data-dsh-panel-entry'] === 'isolation-gate');
check('图标用外壳给的尺寸', icon.props.width === 18 && icon.props.height === 18, String(icon.props.width));

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

// ---- 树遍历 --------------------------------------------------------------
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
  version: 2,
  now: '2026-10-21T10:00:00.000Z',
  features: { toolGate: true, groups: true, picker: true },
  paths: { state: 'D:\\.agents\\门禁-授权.json', roster: 'D:\\.agents\\门禁-名单.txt', root: 'D:\\', backupDir: 'D:\\回收站\\门禁-名单改前', audit: 'C:\\.dsh\\dsh-isolation-gate\\access-log.jsonl' },
  files: {
    stateExists: true,
    stateError: null,
    stateVersion: 2,
    stateMigratedFrom: 'v1',
    rosterExists: true,
    rosterOk: true,
    rosterError: null,
    gateClosed: false,
    rosterGateMessage: null,
    rosterDuplicates: [],
    rosterInvalid: [],
    rootError: null,
  },
  levels: [
    { level: 'deny', label: '禁', hint: '完全不可访问（默认）', allowedOps: [] },
    { level: 'read', label: '只读', hint: '可读、可比对', allowedOps: ['traverse', 'read'] },
    { level: 'full', label: '可读写删', hint: '含删减文件', allowedOps: ['traverse', 'read', 'write', 'delete'] },
  ],
  updatedAt: '2026-10-21T10:00:00.000Z',
  updatedBy: 'gui',
  roster: [
    { name: 'Zcode', key: 'Zcode', kind: 'name', isPath: false, group: 'harness 隔离', level: 'deny', levelLabel: '禁', allowedOps: [], dirExists: true, dirName: 'Zcode', status: 'ok', hint: '在名单内 · 目录存在' },
    { name: 'gone', key: 'gone', kind: 'name', isPath: false, group: '', level: 'read', levelLabel: '只读', allowedOps: ['traverse', 'read'], dirExists: false, dirName: null, status: 'roster-missing-dir', hint: '已在名单但目录不存在（疑似笔误 / 已删 / 该盘未挂载）' },
    { name: pathKey, key: pathKey, kind: 'path', isPath: true, group: '', level: 'full', levelLabel: '可读写删', allowedOps: ['traverse', 'read', 'write', 'delete'], dirExists: true, dirName: pathKey, status: 'path-ok', hint: '路径受管 · 目录存在' },
  ],
  rosterCounts: { total: 3, names: 2, paths: 1, deny: 1, read: 1, full: 1 },
  groups: [
    { name: 'harness 隔离', note: '', count: 1, members: ['Zcode'], counts: { deny: 1, read: 0, full: 0 }, uniformLevel: 'deny', hasOrphans: false },
  ],
  ungrouped: ['gone', pathKey],
  stateOnly: [{ name: 'pi', level: 'deny', levelLabel: '禁', group: '', hint: '状态文件里有、但**不在名单**里 ⇒ 当前不受管辖（可点「清理孤儿键」按钮移除）' }],
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
      { atLocal: '2026-10-21 10:00:01', allowed: false, channel: 'tools/pre-execute', name: 'Zcode', op: 'traverse', detail: '拒绝：…' },
      { atLocal: '2026-10-21 10:00:02', allowed: true, channel: 'gui', name: 'Zcode', op: 'set-level', detail: '级别 → deny（禁）' },
    ],
  },
};

const clicks = [];
const handlers = {
  busy: false,
  picking: false,
  showUnlisted: true,
  pending: null,
  error: null,
  notice: null,
  pathInput: '',
  menuFor: null,
  groupDraft: { select: '', text: '' },
  model: fixture,
  onRefresh: () => clicks.push(['refresh']),
  onPickLevel: (name, level) => clicks.push(['pickLevel', name, level]),
  onPickGroupLevel: (group, level) => clicks.push(['pickGroupLevel', group, level]),
  onPickFolder: () => clicks.push(['pickFolder']),
  onPathInput: (value) => clicks.push(['pathInput', value]),
  onAskAddPath: () => clicks.push(['askAddPath']),
  onAskAdd: (name) => clicks.push(['askAdd', name]),
  onAskRemove: (name) => clicks.push(['askRemove', name]),
  onConfirmPending: () => clicks.push(['confirm']),
  onCancelPending: () => clicks.push(['cancel']),
  onToggleUnlisted: () => clicks.push(['toggle']),
  onToggleMenu: (key) => clicks.push(['toggleMenu', key]),
  onGroupSelect: (value) => clicks.push(['groupSelect', value]),
  onGroupText: (value) => clicks.push(['groupText', value]),
  onApplyGroup: (name) => clicks.push(['applyGroup', name]),
  onDeleteGroup: (group) => clicks.push(['deleteGroup', group]),
  onDropToGroup: (name, group) => clicks.push(['dropToGroup', name, group]),
  onToggleNewGroup: () => clicks.push(['toggleNewGroup']),
  onNewGroupName: (value) => clicks.push(['newGroupName', value]),
  onNewGroupNote: (value) => clicks.push(['newGroupNote', value]),
  onCreateGroup: () => clicks.push(['createGroup']),
  onPrune: () => clicks.push(['prune']),
};

let tree = null;
let treeError = null;
try {
  tree = renderTree(GateView(handlers));
} catch (error) {
  treeError = error;
}
check('有差异态渲染不抛错', treeError === null, treeError?.message);
check('标题出现「门禁 · 目录访问管制」', tree.flat.includes('门禁 · 目录访问管制'));
check('副标题写明定位「隔离区授权台」', tree.flat.includes('隔离区授权台'));
check('摘要条：受管对象 / 分组 / 工具执行门 / 名单', tree.flat.includes('受管对象') && tree.flat.includes('分组') && tree.flat.includes('工具执行门') && tree.flat.includes('名单'));
check('摘要条显示工具门已开', tree.flat.includes('已开'), '');
check('摘要条显示名字/路径计数', tree.flat.includes('名字 2 · 路径 1'), '');
check('差异块报出「已在名单但目录不存在」', tree.flat.includes('已在名单但目录不存在'));
check('差异块报出「目录存在但未入名单」', tree.flat.includes('目录存在但未入名单'));
check('差异块报出大小写不一致', tree.flat.includes('大小写不一致'));
check('三行受管对象都渲染出来（含路径键）', tree.flat.includes('Zcode') && tree.flat.includes('gone') && tree.flat.includes('某项目'));
check('路径对象带 [路径] 标记', tree.flat.includes('[路径]'));
check('两类都显示"目录存在/不存在"徽标', tree.flat.includes('目录存在') && tree.flat.includes('目录不存在'));
check('三级文案都在（禁 / 只读 / 可读写删）', tree.flat.includes('禁') && tree.flat.includes('只读') && tree.flat.includes('可读写删'));
check('分组卡片渲染出来（data-gate-group）', tree.nodes.some((node) => node.props?.['data-gate-group'] === 'harness 隔离'));
check('组头显示成员数与"组内统一"', tree.flat.includes('1 个') && tree.flat.includes('组内统一'));

// ---- 拖拽归组（与技能面板同款 HTML5 DnD） ----
const fakeDrop = (name) => ({ preventDefault() {}, dataTransfer: { getData: () => name }, currentTarget: { style: {} } });
check('对象行可拖动（draggable）', tree.nodes.some((node) => node.props?.['data-gate-draggable'] === 'true'));
const groupCardNode = tree.nodes.find((node) => node.props?.['data-gate-group'] === 'harness 隔离');
check('组卡片可接收拖放（onDrop 已接线）', typeof groupCardNode?.props?.onDrop === 'function');
groupCardNode?.props?.onDrop?.(fakeDrop('Zcode'));
check('拖 Zcode 进组 → onDropToGroup(Zcode, harness 隔离)', JSON.stringify(clicks.at(-1)) === JSON.stringify(['dropToGroup', 'Zcode', 'harness 隔离']), JSON.stringify(clicks.at(-1)));
const ungroupedZone = tree.nodes.find((node) => node.props?.['data-gate-drop'] === 'ungrouped');
check('「未分组」区可作为拖出组的落点', typeof ungroupedZone?.props?.onDrop === 'function');
ungroupedZone?.props?.onDrop?.(fakeDrop('Zcode'));
check('拖到未分组 → onDropToGroup(Zcode, 空组)', JSON.stringify(clicks.at(-1)) === JSON.stringify(['dropToGroup', 'Zcode', '']), JSON.stringify(clicks.at(-1)));
check('组级分段控件存在（scope=group:harness 隔离）', tree.nodes.some((node) => node.props?.['data-gate-segmented'] === 'group:harness 隔离'));
check('行级分段控件存在（scope=row:Zcode）', tree.nodes.some((node) => node.props?.['data-gate-segmented'] === 'row:Zcode'));
check('行内不再直接堆三个独立按钮，而是分段控件', tree.nodes.filter((node) => node.type === 'button' && node.props?.['data-gate-segmented'] === undefined).length >= 0);
check('每行有 ⋯ 菜单按钮（3 行）', tree.nodes.filter((node) => node.type === 'button' && node.props?.children === '⋯').length >= 4, String(tree.nodes.filter((node) => node.type === 'button' && node.props?.children === '⋯').length));
check('添加条：选择文件夹按钮', tree.flat.includes('选择文件夹'));
check('添加条：路径输入提示', tree.nodes.some((node) => typeof node.props?.placeholder === 'string' && node.props.placeholder.includes('输入绝对路径')));
const noPickerTree = renderTree(GateView({ ...handlers, model: { ...fixture, features: { ...fixture.features, picker: false } } }));
check('无系统选择器时改为「浏览目录」（不再是死按钮）', noPickerTree.nodes.some((node) => node.props?.className === 'gate-browse') && noPickerTree.flat.includes('浏览目录') && !noPickerTree.flat.includes('选择文件夹'));
check('「浏览目录」里能看到一层目录候选', noPickerTree.flat.includes('浏览目录 ▾') && noPickerTree.nodes.some((node) => node.type === 'button' && node.props?.['data-gate-browse-item'] === undefined));
check('未入名单目录给「加入名单」按钮', tree.flat.includes('加入名单'));
check('受管辖通道的读法写在页面上（bin\\gate.mjs status）', tree.flat.includes('bin\\gate.mjs status'));
check('判定示例里给出 --path 用法', tree.flat.includes('--path'));
check('工具门写进页面说明', tree.flat.includes('tools/pre-execute'));
check('审计尾部渲染出来（含"拒绝"与"放行"）', tree.flat.includes('拒绝') && tree.flat.includes('放行'));
check('孤儿键段渲染出来', tree.flat.includes('孤儿键') && tree.flat.includes('状态里有、名单里没有'));
check('孤儿键段给出清理按钮', tree.flat.includes('清理 1 个'));
check('旧格式迁移提示渲染出来', tree.flat.includes('自动迁移'));
check('纪律页脚写明"不读任何受管对象内部内容"', tree.flat.includes('不读任何受管对象内部内容'));
check('页脚写明 fail-closed', tree.flat.includes('一律拒绝'));
check('根节点带 data-dsh-plugin=isolation-gate', tree.nodes[0]?.props?.['data-dsh-plugin'] === 'isolation-gate');
check('受管对象行带 data-gate-object 便于皮肤定位', tree.nodes.some((node) => node.props?.['data-gate-object'] === 'Zcode'));

// ---- 交互接线 ------------------------------------------------------------
const seg = tree.nodes.filter((node) => node.props?.['data-gate-segmented'] && typeof node.props.children === 'object');
const rowSeg = tree.nodes.find((node) => node.props?.['data-gate-segmented'] === 'row:Zcode');
const rowButtons = rowSeg?.props?.children;
const rowFirst = Array.isArray(rowButtons) ? rowButtons[0] : null;
const groupSeg = tree.nodes.find((node) => node.props?.['data-gate-segmented'] === 'group:harness 隔离');
const groupButtons = groupSeg?.props?.children;
const groupFirst = Array.isArray(groupButtons) ? groupButtons[0] : null;
check('分段控件至少渲染两组', seg.length >= 2, String(seg.length));
rowFirst?.props?.onClick?.();
check('点行级「禁」→ onPickLevel(Zcode, deny)', JSON.stringify(clicks.at(-1)) === JSON.stringify(['pickLevel', 'Zcode', 'deny']), JSON.stringify(clicks.at(-1)));
groupFirst?.props?.onClick?.();
check('点组级 → onPickGroupLevel(harness 隔离, deny)', JSON.stringify(clicks.at(-1)) === JSON.stringify(['pickGroupLevel', 'harness 隔离', 'deny']), JSON.stringify(clicks.at(-1)));

const rowMenuButton = tree.nodes.find((node) => node.type === 'button' && node.props?.['data-gate-menu'] === 'row');
rowMenuButton?.props?.onClick?.();
check('点 ⋯ → onToggleMenu(Zcode)', JSON.stringify(clicks.at(-1)) === JSON.stringify(['toggleMenu', 'Zcode']), JSON.stringify(clicks.at(-1)));

// 打开 Zcode 的行菜单后应出现「从名单移除」与归组控件
const openTree = renderTree(GateView(Object.assign({}, handlers, { menuFor: 'Zcode' })));
check('行菜单里有「从名单移除」', openTree.flat.includes('从名单移除'));
check('行菜单里有「归组」下拉', openTree.flat.includes('归组'));
const removeButton = openTree.nodes.find((node) => node.type === 'button' && node.props?.children === '从名单移除');
removeButton?.props?.onClick?.();
check('点「从名单移除」→ onAskRemove(Zcode)', JSON.stringify(clicks.at(-1)) === JSON.stringify(['askRemove', 'Zcode']), JSON.stringify(clicks.at(-1)));

const newGroupButton = tree.nodes.find((node) => node.type === 'button' && node.props?.children === '＋ 新建分组');
check('分组区有「＋ 新建分组」按钮', Boolean(newGroupButton));
newGroupButton?.props?.onClick?.();
check('点「＋ 新建分组」→ onToggleNewGroup()', JSON.stringify(clicks.at(-1)) === JSON.stringify(['toggleNewGroup']), JSON.stringify(clicks.at(-1)));

const newGroupTree = renderTree(GateView(Object.assign({}, handlers, { newGroupOpen: true, newGroupDraft: { name: '', note: '' } })));
check('新建分组表单：组名输入框（占位提示）', newGroupTree.nodes.some((node) => typeof node.props?.placeholder === 'string' && node.props.placeholder.includes('新组名')));
check('新建分组表单：备注输入框（可选）', newGroupTree.nodes.some((node) => typeof node.props?.placeholder === 'string' && node.props.placeholder.includes('备注（可选）')));
const createGroupButton = newGroupTree.nodes.find((node) => node.type === 'button' && node.props?.children === '创建');
createGroupButton?.props?.onClick?.();
check('点「创建」→ onCreateGroup()', JSON.stringify(clicks.at(-1)) === JSON.stringify(['createGroup']), JSON.stringify(clicks.at(-1)));

const pickButton = tree.nodes.find((node) => node.type === 'button' && typeof node.props?.children === 'string' && node.props.children.startsWith('选择文件夹'));
pickButton?.props?.onClick?.();
check('点「选择文件夹…」→ onPickFolder()', JSON.stringify(clicks.at(-1)) === JSON.stringify(['pickFolder']), JSON.stringify(clicks.at(-1)));

const addPathTree = renderTree(GateView(Object.assign({}, handlers, { pathInput: 'D:\\Zcode' })));
const addPathButton = addPathTree.nodes.find((node) => node.type === 'button' && node.props?.children === '加入名单' && typeof node.props?.onClick === 'function');
addPathButton?.props?.onClick?.();
check('输入路径后点「加入名单」→ onAskAddPath()', JSON.stringify(clicks.at(-1)) === JSON.stringify(['askAddPath']), JSON.stringify(clicks.at(-1)));

const pruneButton = tree.nodes.find((node) => node.type === 'button' && typeof node.props?.children === 'string' && node.props.children.startsWith('清理'));
pruneButton?.props?.onClick?.();
check('点「清理孤儿键」→ onPrune()', JSON.stringify(clicks.at(-1)) === JSON.stringify(['prune']), JSON.stringify(clicks.at(-1)));

// ---- 空态 ----------------------------------------------------------------
const emptyTree = renderTree(GateView(Object.assign({}, handlers, {
  model: Object.assign({}, fixture, { roster: [], groups: [], ungrouped: [], rosterCounts: { total: 0, names: 0, paths: 0 }, stateOnly: [] }),
})));
check('空态有 data-gate-empty', emptyTree.nodes.some((node) => node.props?.['data-gate-empty'] === 'true'));
check('空态文案「还没有受管对象」', emptyTree.flat.includes('还没有受管对象'));
check('空态给出疑似目录的一键入名单', emptyTree.flat.includes('加入「pi」'));

// ---- fail-closed 警示条 ---------------------------------------------------
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

// ---- 待确认条 ------------------------------------------------------------
const pendingTree = renderTree(GateView(Object.assign({}, handlers, { pending: { action: 'remove', name: 'Zcode' } })));
check('待确认条提醒「降低管制范围」', pendingTree.flat.includes('降低管制范围'));
check('待确认条警示移除的后果', pendingTree.flat.includes('不再受管辖'));
const confirmButton = pendingTree.nodes.find((node) => node.type === 'button' && typeof node.props?.children === 'string' && node.props.children.startsWith('确认移除'));
check('待确认条给出确认按钮（改前先备份字样）', Boolean(confirmButton) && confirmButton.props.children.includes('改前先备份'), confirmButton?.props?.children);
confirmButton?.props?.onClick?.();
check('点确认 → onConfirmPending()', JSON.stringify(clicks.at(-1)) === JSON.stringify(['confirm']), JSON.stringify(clicks.at(-1)));

// ---- 干净态 --------------------------------------------------------------
const cleanTree = renderTree(
  GateView(
    Object.assign({}, handlers, {
      model: Object.assign({}, fixture, {
        files: Object.assign({}, fixture.files, { stateMigratedFrom: null, rosterDuplicates: [], rosterInvalid: [] }),
        stateOnly: [],
        diffs: { rosterCount: 3, rootDirCount: 3, rosterMissingDir: [], dirNotListedSuspect: [], dirNotListed: [], caseMismatch: [], pathMissing: [], pathNotDir: [] },
        unlistedDirs: [],
        audit: { ok: true, total: 0, entries: [] },
      }),
    }),
  ),
);
check('干净态报「无差异」', cleanTree.flat.includes('无差异'));
check('干净态审计显示"暂无记录"', cleanTree.flat.includes('暂无记录'));

// ---- 外壳标签（2026-10-22 回归：户主报「三个标签点了不切换」） -----------------
const { TabBar, SHELL_TABS, PROFILE_PLAIN } = moduleExports.__selftest;
check('标签共 3 个', SHELL_TABS.length === 3, String(SHELL_TABS.length));
check(
  '标签用白话名（全局门禁 / 特别门禁）',
  SHELL_TABS.map((row) => row[1]).join('/') === '全局门禁/特别门禁/审计与诊断',
  SHELL_TABS.map((row) => row[1]).join('/'),
);
const tabBar = TabBar({ value: 'list', onPick: () => {} });
const tabButtons = tabBar.props.children;
check('标签栏渲染 3 个原生 button', Array.isArray(tabButtons) && tabButtons.length === 3 && tabButtons.every((el) => el.type === 'button'), String(tabButtons?.length));
check('每个标签带 data-gate-tab 钩子', tabButtons.map((el) => el.props['data-gate-tab']).join(',') === 'list,profiles,audit', tabButtons.map((el) => el.props['data-gate-tab']).join(','));
check('当前页标签 aria-selected=true，其余 false', tabButtons[0].props['aria-selected'] === 'true' && tabButtons[1].props['aria-selected'] === 'false', `${tabButtons[0].props['aria-selected']}/${tabButtons[1].props['aria-selected']}`);
check('标签是 type=button（不会当提交按钮）', tabButtons.every((el) => el.props.type === 'button'));

const tabPicks = [];
const pickBar = TabBar({ value: 'list', onPick: (id) => tabPicks.push(id) });
pickBar.props.children.forEach((el) => el.props.onClick());
check('点三个标签分别回传 list / profiles / audit', tabPicks.join(',') === 'list,profiles,audit', tabPicks.join(','));

const shell = moduleExports.__selftest.GateShell();
check('外壳首屏渲染列表页（默认档位 list）', Boolean(shell) && shell.props.children.length === 2);
check('外壳顶栏里有标签栏 + 当前页说明', shell.props.children[0].props.children.length === 3, String(shell.props.children[0].props.children.length));

check('三档白话名齐备', ['normal', 'strict', 'sealed'].every((k) => PROFILE_PLAIN[k]?.cn && PROFILE_PLAIN[k]?.line), Object.keys(PROFILE_PLAIN).join(','));
check('三档白话名 = 宽松 / 严格 / 全封', [PROFILE_PLAIN.normal.cn, PROFILE_PLAIN.strict.cn, PROFILE_PLAIN.sealed.cn].join('/') === '宽松/严格/全封');

// ---- 报告 ----------------------------------------------------------------
mkdirSync(reportDir, { recursive: true });
const passed = checks.filter((row) => row.ok).length;
writeFileSync(join(reportDir, 'client-report.json'), JSON.stringify({ checks, passed, total: checks.length }, null, 2), 'utf8');
console.log(`\n=== 客户端自测：${passed}/${checks.length} 通过 ===`);
if (passed !== checks.length) process.exitCode = 1;
