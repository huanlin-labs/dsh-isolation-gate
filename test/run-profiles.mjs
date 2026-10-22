/**
 * 门禁 · 策略档自测（纯函数，不需要 dsh / 不需要 GUI）
 *
 *   node test/run-profiles.mjs
 */

import {
  normalizeProfile,
  readProfiles,
  pickProfile,
  narrowProfile,
  matchAllow,
  isNetworkTool,
  isNetworkCommand,
  evaluateCall,
} from '../lib/profiles.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(label, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---- 规范化 ----
const sealed = normalizeProfile('sealed', { mode: 'sealed' });
ok('sealed：网络强制 deny', sealed.network === 'deny', sealed.network);
ok('sealed：未知工具强制 deny', sealed.unknownTool === 'deny', sealed.unknownTool);

const bad = normalizeProfile('x', { mode: 'nonsense' });
ok('未知 mode ⇒ sealed（fail-closed）', bad.mode === 'sealed', bad.mode);

const al = normalizeProfile('strict', {
  mode: 'allowlist',
  allow: [{ path: 'D:\\工作区\\A', level: 'read' }, { path: 'D:\\工作区\\B', level: 'full' }, { path: 'relative' }],
});
ok('非法 allow 项被丢弃', al.allow.length === 2, String(al.allow.length));
ok('allow 路径被规范化', al.allow[0].path === 'D:\\工作区\\A', al.allow[0].path);

// ---- 前缀匹配 ----
ok('同路径命中', matchAllow(al, 'D:\\工作区\\A')?.path === 'D:\\工作区\\A');
ok('子路径命中', matchAllow(al, 'D:\\工作区\\A\\src\\x.js')?.path === 'D:\\工作区\\A');
ok('同前缀不误伤（AB）', matchAllow(al, 'D:\\工作区\\AB\\x.js') === null);
ok('大小写不敏感', matchAllow(al, 'd:\\工作区\\a\\x.js')?.path === 'D:\\工作区\\A');
ok('尾斜杠等价', matchAllow(al, 'D:\\工作区\\A\\')?.path === 'D:\\工作区\\A');
ok('不在 allow 内 ⇒ null', matchAllow(al, 'E:\\资料') === null);

// ---- allowlist 判定 ----
const allowRead = evaluateCall(al, { tool: 'read', targets: [{ op: 'read', path: 'D:\\工作区\\A\\a.txt' }], known: true });
ok('allowlist：读允许目录 ⇒ 放行', allowRead.allowed, allowRead.reason);

const denyWrite = evaluateCall(al, { tool: 'write', targets: [{ op: 'write', path: 'D:\\工作区\\A\\a.txt' }], known: true });
ok('allowlist：只读目录写 ⇒ 拒', !denyWrite.allowed, denyWrite.reason);

const allowWrite = evaluateCall(al, { tool: 'write', targets: [{ op: 'write', path: 'D:\\工作区\\B\\b.txt' }], known: true });
ok('allowlist：full 目录写 ⇒ 放行', allowWrite.allowed, allowWrite.reason);

const outside = evaluateCall(al, { tool: 'read', targets: [{ op: 'read', path: 'D:\\别处\\x' }], known: true });
ok('allowlist：目录外 ⇒ 拒', !outside.allowed, outside.reason);

const emptyAllow = normalizeProfile('empty', { mode: 'allowlist', allow: [] });
const emptyHit = evaluateCall(emptyAllow, { tool: 'read', targets: [{ op: 'read', path: 'D:\\工作区\\A\\x' }], known: true });
ok('allow 为空 ⇒ 全拒（不是"不限制"）', !emptyHit.allowed, emptyHit.reason);

// ---- blocklist 行为不变 ----
const block = normalizeProfile('normal', { mode: 'blocklist' });
ok('blocklist：未列出的路径不拦', evaluateCall(block, { tool: 'read', targets: [{ op: 'read', path: 'D:\\随便' }], known: true }).allowed);

// ---- 联网判定 ----
ok('联网工具：web_search', isNetworkTool('web_search'));
ok('联网工具：web_fetch', isNetworkTool('web_fetch'));
ok('非联网工具：read', !isNetworkTool('read'));

ok('命令：curl', isNetworkCommand('curl https://x'));
ok('命令：Invoke-WebRequest', isNetworkCommand('Invoke-WebRequest https://x'));
ok('命令：npm install', isNetworkCommand('npm install lodash'));
ok('命令：npm test 不误判', !isNetworkCommand('npm test'));
ok('命令：git clone', isNetworkCommand('git clone https://x'));
ok('命令：git status 不误判', !isNetworkCommand('git status'));
ok('命令：链式 cd && curl', isNetworkCommand('cd D:\\x && curl https://x'));
ok('命令：node 脚本不误判', !isNetworkCommand('node app.js'));
ok('命令：裸 npm 视为联网', isNetworkCommand('npm'));

const netTool = evaluateCall(sealed, { tool: 'web_search', targets: [], known: true });
ok('sealed：联网工具被拒', !netTool.allowed, netTool.reason);

const netCmd = evaluateCall(sealed, {
  tool: 'pwsh',
  shell: true,
  command: 'curl https://x',
  targets: [{ op: 'traverse', path: 'D:\\工作区\\A' }],
  known: true,
});
ok('sealed：联网命令被拒（即使路径合法）', !netCmd.allowed, netCmd.reason);

const sealedWithAllow = normalizeProfile('sealed', {
  mode: 'sealed',
  allow: [{ path: 'D:\\工作区\\A', level: 'full' }],
});
const noPathShell = evaluateCall(sealedWithAllow, {
  tool: 'pwsh',
  shell: true,
  command: 'Get-ChildItem',
  targets: [],
  known: true,
});
ok('sealed：认不出路径的 shell 命令 ⇒ 拒', !noPathShell.allowed, noPathShell.reason);

const localCmd = evaluateCall(sealedWithAllow, {
  tool: 'pwsh',
  shell: true,
  command: 'npm test',
  targets: [{ op: 'traverse', path: 'D:\\工作区\\A' }],
  known: true,
});
ok('sealed：npm test 放行（有 allow 时）', localCmd.allowed, localCmd.reason);

const emptySealed = evaluateCall(sealed, {
  tool: 'pwsh',
  shell: true,
  command: 'npm test',
  targets: [{ op: 'traverse', path: 'D:\\工作区\\A' }],
  known: true,
});
ok('sealed：allow 为空 ⇒ 连本地命令也拒（有意为之）', !emptySealed.allowed, emptySealed.reason);

// ---- 档位解析优先级 ----
const state = readProfiles({
  version: 3,
  defaultProfile: 'normal',
  profiles: {
    normal: { mode: 'blocklist' },
    strict: { mode: 'allowlist', allow: [{ path: 'D:\\工作区\\A', level: 'read' }] },
    sealed: { mode: 'sealed', allow: [{ path: 'D:\\工作区\\A', level: 'read' }] },
  },
  sessionOverrides: { 'sess-1': 'sealed' },
});

ok('readProfiles：三档齐全', state.profiles.size === 3, String(state.profiles.size));
ok('默认档 = normal', state.defaultProfile === 'normal');

const pDefault = pickProfile(state, { sessionId: 'sess-9' });
ok('未覆盖的会话 ⇒ 默认档', pDefault.profile.name === 'normal' && pDefault.source === 'default', pDefault.source);

const pSession = pickProfile(state, { sessionId: 'sess-1' });
ok('会话覆盖优先', pSession.profile.name === 'sealed' && pSession.source === 'session', pSession.source);

const pDir = pickProfile(state, { sessionId: 'sess-9', dirBinding: { profile: 'strict' } });
ok('目录绑定次之', pDir.profile.name === 'strict' && pDir.source === 'dir', pDir.source);

const v2 = readProfiles({ version: 2, objects: { Zcode: { level: 'deny' } } });
ok('v2 兼容：自动生成 normal 档', v2.profiles.get('normal')?.mode === 'blocklist');

// ---- 目录绑定只能加严 ----
const strictBase = state.profiles.get('strict');
const widened = narrowProfile(strictBase, { allow: [{ path: 'D:\\工作区\\B', level: 'full' }] });
ok('目录绑定不能新增允许项', widened.allow.length === 0, String(widened.allow.length));
ok('放宽尝试留下 warning', widened.warnings.length === 1, String(widened.warnings.length));

const lowered = narrowProfile(strictBase, { allow: [{ path: 'D:\\工作区\\A', level: 'deny' }] });
ok('目录绑定可以降级', lowered.allow[0].level === 'deny', lowered.allow[0].level);

const raised = narrowProfile(strictBase, { allow: [{ path: 'D:\\工作区\\A', level: 'full' }] });
ok('目录绑定不能提级', raised.allow[0].level === 'read', raised.allow[0].level);

const escalated = narrowProfile(state.profiles.get('normal'), { mode: 'sealed' });
ok('目录绑定可以加严到 sealed', escalated.mode === 'sealed', escalated.mode);

console.log(`\n=== 策略档自测：${pass}/${pass + fail} 通过 ===`);
if (fail > 0) {
  console.log('失败项：');
  for (const name of failures) console.log(`  - ${name}`);
}
process.exit(fail === 0 ? 0 : 1);
