/**
 * 门禁 · 策略档运行时自测（真读文件，端到端）
 *
 *   node test/run-profiles-runtime.mjs
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decideWithProfiles, findDirBinding, loadProfileState, __clearProfileCaches } from '../lib/profiles-runtime.js';

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

const root = 'D:\\临时\\gate-profile-runtime-test';
const ws = join(root, '严苛任务');
const other = join(root, '普通目录');
rmSync(root, { recursive: true, force: true });
mkdirSync(ws, { recursive: true });
mkdirSync(other, { recursive: true });
const statePath = join(root, 'state.json');
const bindingPath = join(ws, '.dsh-gate.json');

writeFileSync(
  statePath,
  JSON.stringify({
    version: 2,
    defaultLevel: 'deny',
    groups: {},
    objects: { Zcode: { level: 'deny', note: '', group: '', updatedAt: '' } },
  }),
  'utf8',
);
writeFileSync(
  bindingPath,
  JSON.stringify({
    profile: 'strict',
    allow: [{ path: ws, level: 'read' }],
  }),
  'utf8',
);
__clearProfileCaches();

// 目录绑定能被发现
const binding = findDirBinding(join(ws, 'a.txt'));
ok('找到最近的 .dsh-gate.json', binding !== null && binding.profile === 'strict', binding?.dir);
ok('目录绑定带 dir', binding?.dir === ws, binding?.dir);

// v2 状态 ⇒ 内置 normal + strict + sealed
const state = loadProfileState(statePath);
ok('v2 状态自动补内置档', state.profiles.has('normal') && state.profiles.has('strict') && state.profiles.has('sealed'));
ok('默认档是 normal', state.defaultProfile === 'normal', state.defaultProfile);

// 严苛目录内：只读允许
const readInside = decideWithProfiles(statePath, {
  tool: 'read',
  targets: [{ op: 'read', path: join(ws, 'a.txt') }],
  known: true,
});
ok('严苛目录内读 ⇒ 放行', readInside.allowed, `${readInside.profile}/${readInside.source}: ${readInside.reason}`);

const writeInside = decideWithProfiles(statePath, {
  tool: 'write',
  targets: [{ op: 'write', path: join(ws, 'a.txt') }],
  known: true,
});
ok('严苛目录内写 ⇒ 拒（只给 read）', !writeInside.allowed, writeInside.reason);

const readOutside = decideWithProfiles(statePath, {
  tool: 'read',
  targets: [{ op: 'read', path: join(other, 'b.txt') }],
  known: true,
});
ok('严苛目录外读 ⇒ 不受影响（normal 档）', readOutside.allowed, `${readOutside.profile}/${readOutside.source}`);

// 会话覆盖优先
writeFileSync(
  statePath,
  JSON.stringify({
    version: 3,
    defaultProfile: 'normal',
    profiles: { normal: { mode: 'blocklist' }, sealed: { mode: 'sealed', allow: [{ path: other, level: 'read' }] } },
    sessionOverrides: { 'sess-x': 'sealed' },
  }),
  'utf8',
);
__clearProfileCaches();
const overridden = decideWithProfiles(statePath, {
  sessionId: 'sess-x',
  tool: 'web_search',
  targets: [],
  known: true,
});
ok('会话覆盖生效（sealed 拦联网）', !overridden.allowed && overridden.source === 'session', `${overridden.profile}/${overridden.source}`);

const notOverridden = decideWithProfiles(statePath, { sessionId: 'sess-y', tool: 'read', targets: [{ op: 'read', path: join(other, 'b.txt') }], known: true });
ok('未覆盖的会话按默认档', notOverridden.allowed && notOverridden.source === 'default', notOverridden.source);

// 坏配置文件 ⇒ fail-closed
writeFileSync(bindingPath, '{ this is not json', 'utf8');
__clearProfileCaches();
const broken = decideWithProfiles(statePath, {
  tool: 'read',
  targets: [{ op: 'read', path: join(ws, 'a.txt') }],
  known: true,
});
ok('坏 .dsh-gate.json ⇒ 按 sealed 拒绝', !broken.allowed && broken.profile === 'sealed', broken.reason);

// 配置不能解锁自己子树之外
writeFileSync(
  bindingPath,
  JSON.stringify({ profile: 'strict', allow: [{ path: 'C:\\', level: 'full' }] }),
  'utf8',
);
__clearProfileCaches();
const escape = decideWithProfiles(statePath, {
  tool: 'read',
  targets: [{ op: 'read', path: join(ws, 'a.txt') }],
  known: true,
});
ok('配置写 C:\\ 不生效（只能管自己子树）', !escape.allowed, escape.reason);

rmSync(root, { recursive: true, force: true });

console.log(`\n=== 策略档运行时自测：${pass}/${pass + fail} 通过 ===`);
if (fail > 0) {
  console.log('失败项：');
  for (const name of failures) console.log(`  - ${name}`);
}
process.exit(fail === 0 ? 0 : 1);
