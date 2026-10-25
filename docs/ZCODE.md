# 在 ZCode 里用门禁

> 依据：ZCode 官方文档《Hooks》（zcode.z.ai/cn/docs/hooks）的 **PreToolUse** 契约，2026-10-26 核对。
> **验证状态**：协议与文档逐项对齐，本机未做真机会话验证（ZCode 装在隔离区，dsh 侧不读其目录）。

## 为什么几乎零成本

ZCode 的 hook 协议与 Claude Code **同形**：stdin 一行 JSON（`tool_name` / `tool_input` / `cwd`），stdout 回 `hookSpecificOutput.permissionDecision = "deny"` + `permissionDecisionReason` 即拒绝；也认 snake_case。所以**直接复用 `bin/gate-hook-claude.mjs`**，不写新适配器。

## 装（一条命令）

```bash
node D:/插件/dsh-isolation-gate/bin/gate-setup.mjs zcode          # 先看计划（dry-run）
node D:/插件/dsh-isolation-gate/bin/gate-setup.mjs zcode --write  # 落盘（自动备份）
```

写入目标：`~/.zcode/cli/config.json`

```json
{
  "hooks": {
    "enabled": true,
    "events": {
      "PreToolUse": [
        {
          "matcher": "*",
          "hooks": [
            { "type": "process", "command": "<node>", "args": ["…/bin/gate-hook-claude.mjs"], "timeoutMs": 10000 }
          ]
        }
      ]
    }
  }
}
```

## 三个坑（官方文档明写，别踩）

1. **项目级 hook 不执行**：写在 `<workspace>/.zcode/config.json` 或 `zcode.json` 里的 hooks 当前版本被整体忽略（日志记 `config_project_hooks_ignored`）。团队共享要走**插件**（`hooks/hooks.json`），个人用就写用户级配置。
2. **必须 `hooks.enabled: true`**，否则整段配置不生效。
3. **配置在 session 启动时快照**：改配置后要**新建 session**才生效，老 session 不热更新。

## 边界

- 只接了 `PreToolUse`（拦工具）。ZCode 还有 `PermissionRequest` / `Stop` / `UserPromptSubmit`，门禁暂不用。
- deny 优先级最高（多 hook 聚合时 deny > ask > allow），符合门禁"默认禁"的语义。
- 与 MCP 那条的区别：这是**硬拦**，不是建议。
