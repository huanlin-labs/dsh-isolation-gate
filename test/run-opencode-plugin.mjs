/**
 * 门禁 · opencode 插件适配器测试
 *
 * 直接调用导出的 decide() 与插件 hook（不需要 opencode 进程、不需要模型）。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GatePlugin, collectTargets, decide } from '../bin/gate-plugin-opencode.mjs';
import { normalizeConfig, setLevel } from '../lib/service.js';
import { ensureStateFile } from '../lib/store.js';

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

const root = mkdtempSync(join(tmpdir(), 'isolation-gate-opencode-'));
const statePath = join(root, '门禁-授权.json');
const rosterPath = join(root, '门禁-名单.txt');
const auditPath = join(root, '审计.jsonl');

try {
  ensureStateFile(statePath);
  writeFileSync(rosterPath, 'Zcode\n', 'utf8');
  const cfg = normalizeConfig({ statePath, rosterPath, auditPath, root });
  const leveled = setLevel(cfg, { name: 'Zcode', level: 'deny', by: 'test' });
  check('夹具：Zcode 设为禁', leveled.ok === true, leveled.error ?? '');

  console.log('\n【1】受管目标 —— read 被拦');
  {
    const reason = decide('read', { filePath: 'D:\\Zcode\\notes.md' }, cfg);
    check('返回拦截理由', typeof reason === 'string' && /门禁拦截/.test(reason), String(reason));
  }

  console.log('\n【2】未受管目标 —— 放行');
  {
    const reason = decide('read', { filePath: join(root, 'plain.txt') }, cfg);
    check('返回 null', reason === null, String(reason));
  }

  console.log('\n【3】bash 命令里的受管路径被拦');
  {
    const reason = decide('bash', { command: 'cat D:\\Zcode\\config.toml' }, cfg);
    check('拦截', typeof reason === 'string' && /门禁拦截/.test(reason), String(reason));
  }

  console.log('\n【4】write / edit / patch 都按写判定');
  {
    const a = decide('write', { filePath: 'D:\\Zcode\\a.txt' }, cfg);
    const b = decide('edit', { filePath: 'D:\\Zcode\\a.txt' }, cfg);
    const c = decide('patch', { filePath: 'D:\\Zcode\\a.txt' }, cfg);
    check('三种写工具都被拦', [a, b, c].every((x) => typeof x === 'string'));
  }

  console.log('\n【5】工具参数抽取');
  {
    const targets = collectTargets({ filePath: 'D:\\Zcode\\x', command: 'ls D:\\Zcode\\y' });
    check('包含 filePath', targets.includes('D:\\Zcode\\x'));
    check('包含命令里的路径', targets.some((t) => t.startsWith('D:\\Zcode\\y')));
  }

  console.log('\n【6】插件 hook 会 throw（opencode 据此阻断）');
  {
    // 插件工厂默认读进程环境；固定到夹具，避免依赖本机真实门禁状态（真机测试是另一回事）
    const savedEnv = { ...process.env };
    process.env.GATE_STATE_PATH = statePath;
    process.env.GATE_ROSTER_PATH = rosterPath;
    process.env.GATE_AUDIT_PATH = auditPath;
    process.env.GATE_ROOT = root;
    const plugin = await GatePlugin({});
    let threw = null;
    try {
      await plugin['tool.execute.before']({ tool: 'read', sessionID: 's', callID: 'c' }, { args: { filePath: 'D:\\Zcode\\a.md' } });
    } catch (error) {
      threw = error;
    }
    check('抛错', threw instanceof Error, String(threw));
    check('错误信息带门禁口径', /门禁拦截/.test(threw?.message ?? ''), threw?.message ?? '');
    process.env = savedEnv;

    let ok = true;
    try {
      await plugin['tool.execute.before']({ tool: 'read' }, { args: { filePath: join(root, 'plain.txt') } });
    } catch {
      ok = false;
    }
    check('未受管时不抛', ok);
  }

  console.log('\n【7】审计通道记为 hook/opencode');
  {
    const { readFileSync } = await import('node:fs');
    const rows = readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    check('有 hook/opencode 记录', rows.some((row) => row.channel === 'hook/opencode'));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n[opencode-plugin] ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
