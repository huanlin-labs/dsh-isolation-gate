# 在 Claude Code 里用门禁

同一套策略引擎，Claude Code 这边只多一个「PreToolUse 适配器」——它读 Claude Code 传进来的 hook JSON，用和 DSH 插件完全一样的名单 / 级别 / 审计来判定，命中受管目标就返回 `deny`。

## 它拦在哪

Claude Code 在执行工具前触发 `PreToolUse`；适配器收到事件 JSON（`tool_name` + `tool_input` + `cwd`），逐个检查工具参数里的路径：

| Claude Code 工具 | 按门禁的哪种操作判 |
| --- | --- |
| `Read` `NotebookRead` `Glob` `Grep` `LS` | `read` |
| `Write` `Edit` `MultiEdit` `NotebookEdit` | `write` |
| `Bash` `PowerShell` | `write`（扫描命令行里的绝对路径） |

放行 = 不输出、退出码 0（Claude Code 走它自己的权限流程）；拦截 = 输出 `permissionDecision: "deny"` 并附中文理由。所有判定都写审计日志（`channel: hook/claude-code`）。

## 安装

```bash
npm i -g dsh-isolation-gate     # 或 npx，只要能拿到 bin/gate-hook-claude.mjs
```

在 `~/.claude/settings.json`（全局）或项目 `.claude/settings.json`（仅该项目）里加：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Write|Edit|MultiEdit|NotebookEdit|NotebookRead|Glob|Grep|LS|Bash|PowerShell",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["D:/插件/dsh-isolation-gate/bin/gate-hook-claude.mjs"]
          }
        ]
      }
    ]
  }
}
```

> 路径换成你自己的安装位置；用全局 npm 包时通常写成 `"command": "gate-hook-claude"`（`bin` 已注册）。

## 名单 / 状态放哪

默认读与 DSH 插件相同的三个文件，所以两边**共用一份策略**：

| 用途 | 默认路径 | 环境变量覆盖 |
| --- | --- | --- |
| 级别状态 | `D:\.agents\门禁-授权.json` | `GATE_STATE_PATH` |
| 名单 | `D:\.agents\门禁-名单.txt` | `GATE_ROSTER_PATH` |
| 审计 | `D:\.agents\门禁-审计.jsonl` | `GATE_AUDIT_PATH` |

只想给 Claude Code 单独一套策略时，在 hook 条目里加 `"env"`（或包一层 `.cmd` / `.sh` 设置变量），指向另一组文件即可。

## 管理名单与级别

用同一个 CLI：

```bash
node bin/gate.mjs status
node bin/gate.mjs check --path "D:\Zcode" --op read
node bin/gate.mjs set --name Zcode --level deny
```

## 自测

```bash
npm test          # 含 test/run-hook-claude.mjs：受管拦截 / 未受管放行 / 坏输入 fail-closed
```

## 已知边界（必须明说）

- 只覆盖 **Claude Code 的工具调用**。你在终端里手动 `cat` 一个受管目录，它不管。
- `Bash` 只能靠命令行文本里出现的绝对路径判断；`cd` 进目录后再用相对路径的写法会漏判。
- 若 hook 进程本身崩了（Node 不存在等），Claude Code 会按自身的 hook 失败策略处理——不会因此放行成「静默允许」，但也不等于门禁生效，装完请跑一次自测。
