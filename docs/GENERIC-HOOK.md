# 通用前置钩子（给任何「能调命令」的 harness 兜底）

不是每家 harness 都值得单独写适配器。只要它满足两个条件：

1. 工具执行**前**会调用一个命令；
2. 把事件 JSON 从 **stdin** 喂进来；

就能直接用 `bin/gate-hook-generic.mjs`，不用改代码。

## 一、字段映射（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `GATE_TOOL_KEYS` | `tool_name,toolName,tool,name` | 工具名字段候选（逗号分隔，按顺序取第一个存在的） |
| `GATE_ARGS_KEYS` | `tool_input,toolInput,args,input,arguments` | 参数对象字段候选 |
| `GATE_OP_KEYS` | `op,operation` | 若事件里自带操作字段，优先用它 |
| `GATE_OP` | 空 | 强制指定操作（忽略工具名推断） |

## 二、拦截方式（`GATE_DENY_STYLE`）

| 值 | 行为 | 适用 |
| --- | --- | --- |
| `exit2`（默认） | 退出码 **2** + stderr 写理由 | Claude Code、Codex 等按退出码判定的钩子 |
| `json-claude` | stdout 输出 `hookSpecificOutput.permissionDecision = "deny"` | Claude Code 的 JSON 通道 |
| `json-gemini` | stdout 输出 `{"decision":"deny","reason":…}` | Gemini CLI 风格 |
| `text` | 只写 stderr，退出码 0 | 只做记录、不阻断的场合 |

## 三、操作推断

按工具名前缀猜，猜不到一律按 `write`（保守）：

| 工具名以…开头 | 判为 |
| --- | --- |
| `read` `view` `cat` `list` `ls` `glob` `grep` `search` `find` | `read` |
| `write` `edit` `create` `replace` `patch` `apply` `delete` `remove` `rm` `move` `mv` | `write` |
| `bash` `shell` `exec` `run` `terminal` `command` `powershell` `cmd` | `write` |

参数里出现 `command` / `cmd` / `script` 时，会把命令行里的绝对路径也拿去判定。

## 四、快速自测

```bash
echo '{"tool_name":"Read","tool_input":{"file_path":"D:/某受管目录/a.md"}}' \
  | node bin/gate-hook-generic.mjs ; echo "退出码=$?"
```

受管且为「禁」时应得 `退出码=2`，stderr 有一句中文理由。

```bash
node test/run-hook-generic.mjs   # 21 断言
```

## 五、边界

- 只有「stdin JSON + 退出码/JSON 输出」这种钩子才能接；只支持 `notify` 回调（fire-and-forget、无返回值）的 harness 接不了，只能用 MCP 或人工审批。
- 参数里没有绝对路径时判不出来（相对路径、cd 之后的路径会漏）。
- 审计记 `channel: hook/generic`。
