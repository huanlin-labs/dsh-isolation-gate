/**
 * 门禁 · opencode 插件适配器
 *
 * 用法（项目级或全局）：
 *   1) 把本文件复制/软链到项目 `.opencode/plugins/gate.mjs`，或
 *      `~/.config/opencode/plugins/gate.mjs`
 *   2) （本地插件要引用本包时）在 opencode 配置目录放一个 package.json，
 *      依赖写 `"dsh-isolation-gate": "^1.4.0"`，或直接把本文件整体复制过去。
 *
 * 行为：opencode 在每次工具执行前调用 `tool.execute.before`；
 *   本适配器用与 DSH 插件相同的策略引擎判定，命中受管目标就 throw——
 *   opencode 会把错误交给模型，工具不会真正执行。
 *
 * 环境变量（可选）：GATE_STATE_PATH / GATE_ROSTER_PATH / GATE_AUDIT_PATH / GATE_ROOT
 */

import { check, normalizeConfig } from '../lib/service.js';

/** opencode 工具名 → 门禁操作 */
const TOOL_OP = {
  read: 'read',
  list: 'read',
  glob: 'read',
  grep: 'read',
  write: 'write',
  edit: 'write',
  patch: 'write',
  bash: 'write',
};

const PATH_KEYS = ['filePath', 'path', 'file', 'directory', 'cwd', 'notebookPath'];

export function collectTargets(args) {
  const out = [];
  if (!args || typeof args !== 'object') return out;
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim() !== '') out.push(value.trim());
  }
  if (typeof args.command === 'string') {
    for (const match of args.command.matchAll(/[A-Za-z]:[\\/][^\s"'`|;&<>()]*|\/(?:[\w.\-]+)(?:\/[\w.\-]+)*/g)) {
      out.push(match[0]);
    }
  }
  return [...new Set(out)];
}

function configFromEnv() {
  const raw = {};
  if (process.env.GATE_STATE_PATH) raw.statePath = process.env.GATE_STATE_PATH;
  if (process.env.GATE_ROSTER_PATH) raw.rosterPath = process.env.GATE_ROSTER_PATH;
  if (process.env.GATE_AUDIT_PATH) raw.auditPath = process.env.GATE_AUDIT_PATH;
  if (process.env.GATE_ROOT) raw.root = process.env.GATE_ROOT;
  return normalizeConfig(raw);
}

/** 纯判定：返回 null（放行）或错误信息（拦截） */
export function decide(toolName, args, cfg = configFromEnv()) {
  const op = TOOL_OP[toolName] ?? 'write';
  const targets = collectTargets(args);
  for (const target of targets) {
    let decision;
    try {
      decision = check(cfg, { path: target, op, channel: 'hook/opencode' });
    } catch (error) {
      return `门禁：策略判定异常（${error?.message ?? 'unknown'}），按拒绝处理。目标：${target}`;
    }
    if (decision && decision.allowed === false) {
      return (
        `门禁拦截：${target} 当前级别为「${decision.level ?? '未知'}」，不允许 ${op}。` +
        `${decision.reason ? `（${decision.reason}）` : ''}` +
        ' 需要放宽请让户主在门禁面板授权，或改用别的位置。'
      );
    }
  }
  return null;
}

/**
 * opencode 插件入口。
 * @param {{ directory?: string, worktree?: string, client?: unknown }} context
 */
export const GatePlugin = async () => ({
  'tool.execute.before': async (input, output) => {
    const reason = decide(input?.tool ?? '', output?.args ?? {});
    if (reason) throw new Error(reason);
  },
});

export default GatePlugin;
