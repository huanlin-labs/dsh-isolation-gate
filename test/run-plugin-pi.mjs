/**
 * 门禁 · pi 扩展测试（假 pi，不上真机）
 *
 * 语义提醒：门禁只管辖「名单内」的对象；名单外一律放行。
 * 所以夹具必须把目标写进 state + roster，才是真实场景。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGateExtension } from '../bin/gate-plugin-pi.mjs';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const root = mkdtempSync(join(tmpdir(), 'isolation-gate-pi-'));
const statePath = join(root, 'state.json');
const rosterPath = join(root, 'roster.txt');
const auditPath = join(root, 'audit.jsonl');

const objects = {
  'D:\\secret': { level: 'deny', kind: 'path' },
  'D:\\open': { level: 'read', kind: 'path' },
};
writeFileSync(statePath, JSON.stringify({ version: 3, defaultLevel: 'deny', objects, groups: {} }), 'utf8');
writeFileSync(rosterPath, 'D:\\secret\nD:\\open\n', 'utf8');

const handlers = new Map();
const fakePi = {
  on(event, handler) {
    handlers.set(event, handler);
    return () => handlers.delete(event);
  },
};
createGateExtension({ statePath, rosterPath, auditPath })(fakePi);

try {
  const toolCall = handlers.get('tool_call');
  check('注册了 tool_call', typeof toolCall === 'function');

  const denied = await toolCall({ toolName: 'read_file', input: { file_path: 'D:\\secret\\a.txt' } });
  check('禁目录子路径被拦', denied?.block === true, JSON.stringify(denied));
  check('拒绝理由带「门禁」', typeof denied?.reason === 'string' && denied.reason.includes('门禁'));

  const allowed = await toolCall({ toolName: 'read_file', input: { file_path: 'D:\\open\\x.txt' } });
  check('只读目录的读取放行', allowed === undefined, JSON.stringify(allowed));

  const bare = await toolCall({ toolName: 'think', input: {} });
  check('无路径的调用不拦', bare === undefined, JSON.stringify(bare));

  const snake = await toolCall({ tool_name: 'bash', tool_input: { command: 'cat D:\\secret\\b.txt' } });
  check('兼容 snake_case + 命令里的绝对路径', snake?.block === true, JSON.stringify(snake));

  const writeToReadOnly = await toolCall({ toolName: 'write_file', input: { file_path: 'D:\\open\\y.txt' } });
  check('只读对象禁止写', writeToReadOnly?.block === true, JSON.stringify(writeToReadOnly));

  const unmanaged = await toolCall({ toolName: 'write_file', input: { file_path: 'D:\\elsewhere\\z.txt' } });
  check('名单外不拦（与 DSH 同语义）', unmanaged === undefined, JSON.stringify(unmanaged));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n[pi] ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
