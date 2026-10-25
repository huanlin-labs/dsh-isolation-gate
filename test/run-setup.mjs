/**
 * 门禁 · 一键接线器测试（全部在临时目录里做，不碰真实配置）
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planFor, runSetup } from '../bin/gate-setup.mjs';

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

const root = mkdtempSync(join(tmpdir(), 'isolation-gate-setup-'));
const home = join(root, 'home');
const backup = join(root, 'backup');

try {
  console.log('\n【1】dry-run 不落盘');
  {
    const result = runSetup('claude', { home, backup });
    check('written=false', result.written === false);
    check('目标文件未创建', existsSync(result.file) === false, result.file);
    check('预览里有 hooks.PreToolUse', Boolean(result.preview?.hooks?.PreToolUse), JSON.stringify(result.preview).slice(0, 120));
    check('钩子命令指向 gate-hook-claude.mjs', JSON.stringify(result.preview).includes('gate-hook-claude.mjs'));
  }

  console.log('\n【2】--write 合并已有配置并备份');
  {
    const claudeDir = join(home, '.claude');
    const file = join(claudeDir, 'settings.json');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ theme: 'dark', hooks: { Other: [{ x: 1 }] } }, null, 2), 'utf8');

    const result = runSetup('claude', { home, backup, write: true });
    check('written=true', result.written === true);
    check('生成了备份', typeof result.backup === 'string' && existsSync(result.backup), String(result.backup));

    const raw = readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    check('保留原有 theme', parsed.theme === 'dark');
    check('保留原有 hooks.Other', Array.isArray(parsed.hooks?.Other));
    check('新增 PreToolUse', Array.isArray(parsed.hooks?.PreToolUse) && parsed.hooks.PreToolUse.length === 1);
    check('文件不带 BOM', raw.charCodeAt(0) !== 0xfeff);
  }

  console.log('\n【3】再次执行不重复追加（幂等）');
  {
    const file = join(home, '.claude', 'settings.json');
    runSetup('claude', { home, backup, write: true });
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    check('PreToolUse 仍只有 1 条', parsed.hooks.PreToolUse.length === 1, String(parsed.hooks.PreToolUse.length));
  }

  console.log('\n【4】zcode / gemini / opencode / mcp 四个目标');
  {
    const zcode = runSetup('zcode', { home, backup, write: true });
    const zcodeJson = JSON.parse(readFileSync(zcode.file, 'utf8'));
    check('zcode 打开 hooks.enabled', zcodeJson.hooks?.enabled === true);
    check('zcode 写入 PreToolUse', Array.isArray(zcodeJson.hooks?.events?.PreToolUse) && zcodeJson.hooks.events.PreToolUse.length === 1);
    check('zcode 复用 claude 适配器', JSON.stringify(zcodeJson).includes('gate-hook-claude.mjs'));
    check('zcode 用 process 执行器', zcodeJson.hooks.events.PreToolUse[0].hooks[0].type === 'process');

    const gemini = runSetup('gemini', { home, backup, write: true });
    const geminiJson = JSON.parse(readFileSync(gemini.file, 'utf8'));
    check('gemini 写入 BeforeTool', Array.isArray(geminiJson.hooks?.BeforeTool));
    check('gemini 命令正确', JSON.stringify(geminiJson).includes('gate-hook-gemini.mjs'));

    const opencode = runSetup('opencode', { home, backup, write: true });
    const opencodeJson = JSON.parse(readFileSync(opencode.file, 'utf8'));
    check('opencode plugin 数组含我们的插件', Array.isArray(opencodeJson.plugin) && opencodeJson.plugin.some((item) => item.includes('gate-plugin-opencode.mjs')));

    const mcp = runSetup('mcp', { home, backup, write: true });
    const mcpJson = JSON.parse(readFileSync(mcp.file, 'utf8'));
    check('mcpServers.isolation-gate 存在', Boolean(mcpJson.mcpServers?.['isolation-gate']));
    check('mcp 命令指向 gate-mcp.mjs', JSON.stringify(mcpJson).includes('gate-mcp.mjs'));
  }

  console.log('\n【5】未知 harness 报错');
  {
    let threw = null;
    try {
      planFor('nope', { home });
    } catch (error) {
      threw = error;
    }
    check('抛出错误', threw instanceof Error, String(threw));
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n[setup] ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exitCode = 1;
