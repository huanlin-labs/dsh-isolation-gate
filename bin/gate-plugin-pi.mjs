/**
 * 门禁 · pi 扩展（in-process）
 *
 * pi 的扩展系统在**进程内**触发 `tool_call` 事件（官方文档：「Authorize or modify a tool call」），
 * 所以这里和 DSH 一样是硬拦，不是事后审计。
 *
 * 用法（二选一）：
 *   1) 让 `gate-setup pi --write` 在 `~/.pi/extensions/` 生成一个转发文件；
 *   2) 自己写一个扩展文件：export { default } from 'file:///…/bin/gate-plugin-pi.mjs';
 *
 * 事件字段名做容错：pi 各版本可能用 toolName / tool_name、input / args / toolInput。
 */

import { check, normalizeConfig } from '../lib/service.js';

const TOOL_OP = {
  read: 'read',
  read_file: 'read',
  read_many_files: 'read',
  list_directory: 'read',
  list_dir: 'read',
  glob: 'read',
  search: 'read',
  grep: 'read',
  ls: 'read',
  write: 'write',
  write_file: 'write',
  edit: 'write',
  replace: 'write',
  multiedit: 'write',
  bash: 'write',
  shell: 'write',
  run_shell_command: 'write',
};

const PATH_KEYS = ['file_path', 'path', 'target_file', 'directory', 'cwd', 'notebook_path'];

function collectTargets(input) {
  const out = [];
  if (!input || typeof input !== 'object') return out;
  for (const key of PATH_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') out.push(value.trim());
  }
  if (typeof input.command === 'string') {
    for (const match of input.command.matchAll(/[A-Za-z]:[\\/][^\s"'`|;&<>()]*|\/(?:[\w.\-]+)(?:\/[\w.\-]+)*/g)) {
      out.push(match[0]);
    }
  }
  return [...new Set(out)];
}

function pickEvent(event) {
  const toolName = String(event?.toolName ?? event?.tool_name ?? event?.name ?? '');
  const input = event?.input ?? event?.args ?? event?.toolInput ?? event?.tool_input ?? {};
  return { toolName, input };
}

/**
 * 造一个 pi 扩展工厂。
 * @param {object} [options] 覆盖 statePath / rosterPath / auditPath / root（测试与多环境用）
 */
export function createGateExtension(options = {}) {
  const cfg = normalizeConfig(options);
  const opFor = (toolName) => TOOL_OP[String(toolName).toLowerCase()] ?? 'write';

  return function gateExtension(pi) {
    if (!pi || typeof pi.on !== 'function') {
      throw new Error('门禁：这看起来不是 pi 扩展 API（缺少 pi.on）');
    }

    pi.on('tool_call', async (event) => {
      const { toolName, input } = pickEvent(event);
      const op = opFor(toolName);

      for (const target of collectTargets(input)) {
        let decision;
        try {
          decision = check(cfg, { path: target, op, channel: 'hook/pi' });
        } catch (error) {
          // fail-closed：策略判定异常时宁可拦下
          return { block: true, reason: `门禁：策略判定异常，按拒绝处理（${error?.message ?? 'unknown'}）` };
        }
        if (decision && decision.allowed === false) {
          return {
            block: true,
            reason: decision.reason ?? `门禁：${target} 当前级别为 ${decision.level ?? '未知'}，不允许 ${op}`,
          };
        }
      }

      return undefined;
    });
  };
}

export default createGateExtension();
