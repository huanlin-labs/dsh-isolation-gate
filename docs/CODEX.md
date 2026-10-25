# 在 Codex CLI 里用门禁

> ⚠️ **先说清现状**：Codex CLI 的钩子能力**随版本变化很大**。社区资料同时存在两种说法：
> ① 新版有 `hooks.json` / `[[hooks]]`，事件含 `pre_tool`（可在工具执行前阻断，支持退出码 2 与 `permissionDecision`）；
> ② 旧版只有 `notify`（fire-and-forget，**不能阻断**）。
>
> 所以本文件给的是「先自检、再接」的流程，**不承诺任何版本一定生效**。本机没有安装 Codex CLI，**未做过真机验证**。

## 第一步：确认你这版有没有前置钩子

```bash
codex --version
codex --help | grep -i hook
```

- 看到 `hooks` 相关子命令或文档里提到 `PreToolUse` / `pre_tool` → 走下面「接钩子」。
- 只有 `notify` → 接不了硬拦，只能用下面的「接 MCP」或靠人工审批。

## 接钩子（有前置钩子时）

用**通用适配器**，默认 `exit2` 模式（Codex / Claude Code 都认退出码 2 阻断）：

```bash
node D:/插件/dsh-isolation-gate/bin/gate-hook-generic.mjs
```

配置写在哪，取决于你的版本：

**A. `config.toml` 形式**

```toml
[[hooks]]
event = "pre_tool"
command = "node D:/插件/dsh-isolation-gate/bin/gate-hook-generic.mjs"
```

**B. `.codex/hooks.json` 形式**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          { "type": "command", "command": "node D:/插件/dsh-isolation-gate/bin/gate-hook-generic.mjs" }
        ]
      }
    ]
  }
}
```

字段名不用改：通用适配器默认认 `tool_name` / `tool_input`，也认 camelCase（`toolName` / `toolInput`）。若你这版的字段名不同，用 `GATE_TOOL_KEYS` / `GATE_ARGS_KEYS` 覆盖即可（见 [GENERIC-HOOK.md](GENERIC-HOOK.md)）。

如果 Codex 只认 JSON 形式的拒绝，把环境变量设成：

```
GATE_DENY_STYLE=json-claude
```

## 接 MCP（没有前置钩子时的退路）

见 [MCP.md](MCP.md)。注意：MCP 是 advisory，**拦不住**，只能让模型先问一句并留下审计。

## 验证方法（接完必做）

1. 让 Codex 读一个**受管且为「禁」**的路径 → 预期工具被拒、能看到「门禁拦截」字样；
2. 让它读一个普通路径 → 预期正常返回；
3. 看 `D:\.agents\门禁-审计.jsonl` 有没有 `channel: hook/generic` 的新记录。

三步都过才算接上了。任一步不过，先查 `codex --version` 是否支持钩子，再查配置路径。

## 已知边界

- 只能覆盖 Codex 的工具调用；你在终端里手打命令不管。
- 命令里的相对路径（`cd` 之后）会漏判。
- 若你这版 Codex 的钩子是异步/只通知，退出码 2 不会阻断——那就只能退回 MCP + 人工审批。
