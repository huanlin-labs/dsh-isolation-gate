# 用 MCP 接任何 harness（Cursor / Windsurf / Codex / Claude Desktop …）

MCP（Model Context Protocol）服务器是一层**通用适配**：任何支持 MCP 的 harness 都能加载它，模型在动某个路径前先问一句门禁。

> ⚠️ **能力边界（必须先看）**：MCP 是**被调用**的，**不能硬拦**工具执行。这里提供的是 **advisory**（建议 + 审计留痕）。
> 真正的强制拦截必须靠 harness 的前置钩子——DSH 原生、Claude Code `PreToolUse`、opencode `tool.execute.before`、Gemini CLI `BeforeTool` 这几个已有适配器。

## 启动方式

```bash
node D:/插件/dsh-isolation-gate/bin/gate-mcp.mjs
```

stdio 传输、按行 JSON-RPC，无第三方依赖。

## 在客户端里注册

**Claude Desktop / Cursor / Windsurf**（`mcpServers` 形式）：

```json
{
  "mcpServers": {
    "isolation-gate": {
      "command": "node",
      "args": ["D:/插件/dsh-isolation-gate/bin/gate-mcp.mjs"]
    }
  }
}
```

**opencode**（`opencode.json`）：

```json
{
  "mcp": {
    "isolation-gate": {
      "type": "local",
      "command": ["node", "D:/插件/dsh-isolation-gate/bin/gate-mcp.mjs"],
      "enabled": true
    }
  }
}
```

## 提供的三个工具

| 工具 | 作用 | 输入 |
| --- | --- | --- |
| `gate_check` | 问某路径能不能做某个操作 | `path`（必填）、`op`（read / write / delete / traverse，默认 read） |
| `gate_status` | 列出受管对象、级别、名单状态、文件位置 | 无 |
| `gate_audit` | 读最近审计记录 | `limit`（默认 20，最大 200） |

`gate_check` 返回示例：

```json
{
  "path": "D:\\某受管目录\\a.md",
  "op": "write",
  "allowed": false,
  "level": "deny",
  "inRoster": true,
  "reason": "…",
  "note": "advisory：被拒绝时不要执行该操作；硬拦截需 harness 的前置钩子。"
}
```

## 策略文件

与其它适配器共用：`D:\.agents\门禁-授权.json`（级别）、`门禁-名单.txt`（名单）、`门禁-审计.jsonl`（审计，`channel: mcp`）。
可用 `GATE_STATE_PATH` / `GATE_ROSTER_PATH` / `GATE_AUDIT_PATH` / `GATE_ROOT` 覆盖。

## 自测

```bash
node test/run-mcp.mjs
```

它真的起一个子进程、走完整 JSON-RPC 握手（initialize → tools/list → tools/call → 错误码），共 16 条断言。

## 已知边界

- advisory：模型不问就不起作用；要硬拦请用有前置钩子的适配器。
- 读审计只读文件尾部若干行，超大日志不会全量解析。
- 协议版本按客户端请求回（支持 2025-06-18 / 2025-03-26 / 2024-11-05）。
