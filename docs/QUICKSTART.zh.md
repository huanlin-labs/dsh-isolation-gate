# 3 分钟上手（中文）

> 目标：让 AI 编程助手**只碰你允许的目录**。三档：**禁 / 只读 / 可读写删**。

## 1. 接线（选你用的那个）

```bash
npx dsh-isolation-gate setup claude    # Claude Code
npx dsh-isolation-gate setup zcode     # ZCode
npx dsh-isolation-gate setup opencode  # opencode
npx dsh-isolation-gate setup pi        # pi
npx dsh-isolation-gate setup gemini    # Gemini CLI
npx dsh-isolation-gate setup codex     # Codex（MCP，advisory）
npx dsh-isolation-gate setup mcp       # Cursor / Windsurf（MCP，advisory）
```

默认是 dry-run，只打印计划；加 `--write` 才落盘（会先备份原文件）。
接完用一条命令体检：

```bash
npx dsh-isolation-gate doctor
```

## 2. 定规矩

```bash
npx dsh-isolation-gate ui      # 打开 http://127.0.0.1:19390/
```

- 左边是对象（目录名或绝对路径），右边三档按钮：**禁 / 只读 / 可读写删**；
- 新增对象默认「禁」；
- 也可以直接改 `~/.agents/门禁-名单.txt` 与 `~/.agents/门禁-授权.json`（Windows 上有 `D:\.agents` 时用那份）。

## 3. 验证

```bash
node -e "1"   # 不用 Node 也行，用下面这条：
npx dsh-isolation-gate check --path "D:\secret\a.txt" --op read
```

退出码 `0` 放行、`3` 被拒。

## 注意

- 改完策略要**新开会话**（ZCode 有 session 快照；其它同理）。
- Codex / Cursor 没有前置钩子，只能 advisory（提供工具，不硬拦）。
- 名单损坏或读不到 = **全禁**（fail-closed），不会"放开了算"。
