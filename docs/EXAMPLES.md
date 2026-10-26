# 用完这一页就够了（真实输出，非示意）

下面每一段都是**本机实测**的输出，不是手写样例。你按顺序粘贴即可。

## 1. 装 + 自检（30 秒）

```bash
npx dsh-isolation-gate doctor --fix
npx dsh-isolation-gate doctor
```

第一次跑 `--fix`，真实输出（节选）：

```text
  + 已接上 claude → ~/.claude/settings.json
  + 已接上 zcode → ~/.zcode/cli/config.json
  + 已接上 pi → ~/.pi/agent/extensions/isolation-gate.js
  + 已接上 gemini → ~/.gemini/settings.json
  + 已接上 opencode → ~/.config/opencode/opencode.json
  + 已接上 codex → ~/.codex/config.toml
  + 已接上 mcp → ~/.cursor/mcp.json
门禁接线体检
✔ claude    已接线（标记 gate-hook-claude.mjs）
✔ zcode     已接线（标记 gate-hook-claude.mjs）
✔ pi        已接线（标记 gate-plugin-pi.mjs）
✔ gemini    已接线（标记 gate-hook-gemini.mjs）
…
已接线 7/7；未接线的用 gate-setup <harness> --write 接上。
```

没接线时是 `已接线 0/7`，并以**退出码 1** 结束 —— 便于脚本判断（不要忽略退出码）。

## 2. 三档权限长什么样

| 级别 | 允许的操作 | 典型用途 |
|---|---|---|
| `deny` | 无（连列目录都不行） | 默认值；未明确授权的隔离区 |
| `read` | `traverse` + `read` | 让 AI 读别的 harness 的笔记，但不许改 |
| `full` | `traverse` `read` `write` `delete` | 明确要 AI 代管某个目录 |

```bash
npx dsh-isolation-gate --version                     # 报问题先给这个
npx dsh-isolation-gate status      # 看谁被管、当前什么级别
npx dsh-isolation-gate policy      # 一行紧凑策略（可塞进提示词）
npx dsh-isolation-gate ui          # 打开本机设置页，点开关改级别
```

> 改级别走 **`ui` 设置页**（或宿主里的「门禁」面板）；CLI 的 `gate` 命令是**受管辖通道**（判定/读写/删除），不负责改授权。

判定是**最长前缀优先**：`D:\Zcode` 设 `deny`、`D:\Zcode\public` 设 `read`，则只有 `public` 放行，其余仍禁。

## 3. 被拦时你会看到什么

```text
门禁：拒绝工具「cli」对「D:\Zcode」的「读取文件内容」。拒绝：受管名字「Zcode」当前授权级别为「禁」（deny），不允许「读取文件内容」。
```

三条信息一次给全：**命中哪个对象 / 当前级别 / 什么操作**。不用猜为什么被拒。

## 4. 各 harness 是怎么接上的

| harness | 接线方式 | 强度 |
|---|---|---|
| Claude Code / ZCode | `PreToolUse` hook | **硬拦**（工具不执行） |
| Gemini CLI | `BeforeTool` hook | **硬拦** |
| opencode | 进程内插件 | **硬拦** |
| pi | 扩展 | **硬拦** |
| Codex CLI | MCP server | 提示级（无 pre-tool hook） |
| Cursor / Windsurf | MCP server | 提示级 |

同为「接线 7/7」，**强度不同**。这一点不模糊：`docs/VERIFY.md` 有逐项实测状态。

## 5. 状态文件在哪

- 授权：`<盘>\.agents\门禁-授权.json`（Windows 有 D 盘时用 `D:\.agents`，否则 `~/.agents`）
- 名单：`<盘>\.agents\门禁-名单.txt`
- 待批：`<盘>\.agents\requests.json`
- 审计：`C:\.dsh\dsh-isolation-gate\access-log.jsonl`（可用 `GATE_AUDIT_PATH` 覆盖）

想换位置（测试 / 多用户机器）：设置 `GATE_STATE_PATH` / `GATE_ROSTER_PATH` / `GATE_ROOT`。

## 6. 排错三连

```bash
npx dsh-isolation-gate status                        # 谁被管、什么级别
npx dsh-isolation-gate check --path <某路径> --op read   # 单点判定（0 放行 / 3 拒 / 2 用错）
npx dsh-isolation-gate log --limit 20                # 最近 20 条审计
npx dsh-isolation-gate doctor --json                 # 机器可读的接线体检
```

`check` 的退出码：**0 = 放行 / 3 = 拒绝 / 2 = 参数或环境错误**。脚本里直接判码，不要解析文案。
