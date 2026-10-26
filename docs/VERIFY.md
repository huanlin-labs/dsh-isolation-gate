# 各 harness 验证状态（2026-10-26）

| harness | 机制 | 配置已接线 | 适配器/拦截已验证 | 完整会话（含登录） |
|---|---|---|---|---|
| dsh | 原生插件 ctx.tools.guard | — | ✅ 14 套件 | ✅ 本机日常使用 |
| ZCode 3.16.3 | PreToolUse 钩子 | ✅ ~/.zcode/cli/config.json | ✅ deny JSON / 放行 | ⏳ 需登录会话（户主） |
| Claude Code 2.1.310 | PreToolUse 钩子 | ✅ ~/.claude/settings.json | ✅ hook 载荷测试 | ⏳ 需登录会话（户主） |
| opencode 1.18.29 | 进程内插件 | ✅ ~/.config/opencode/opencode.json | ✅ 插件加载 + deny 夹具拦截 | ⏳ 需模型凭据（户主） |
| pi 1.4.0 | 扩展 tool_call | ✅ ~/.pi/agent/extensions | ✅ 拦截 / 放行 / 字段容错 | ⏳ 需模型凭据（户主） |
| Gemini CLI 0.65.0 | BeforeTool 钩子 | ✅ ~/.gemini/settings.json | ✅ 载荷测试 | ⏳ 需 Google 登录（户主） |
| Cursor / Windsurf | MCP 工具 | ✅ ~/.cursor/mcp.json（gate-setup mcp） | ⚠️ advisory：无钩子，不能硬拦 | ⏳ 未装客户端 |
| Codex CLI 0.164.0 | MCP 工具 | ✅ ~/.codex/config.toml | ⚠️ advisory：Codex 无前置钩子，**不能硬拦** | ⏳ |

> 结论口径：**“配置已接线 + 适配器已验证”不等于“端到端拦过一次真实模型调用”**。后者需要各家的登录态，属于户主账号范畴。

> **CI 口径：三平台 × Node 20/22/24 跑「可移植子集」（数据层 / 适配器 / UI / doctor）；**完整 15 套件是 Windows 本机套件**（部分用例假设 `D:\` 盘符与 `D:\临时\`），尚未跨平台化 —— 如实标注，不假装全平台全绿。
