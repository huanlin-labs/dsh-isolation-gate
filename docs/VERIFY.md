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

> **CI 口径：三平台 × Node 20/22/24 跑「全模块语法检查 + 数据层 / doctor / UI 套件 + tag 时 registry 对账」。**路径判定核心按盘符模型设计（`<盘>:\<名>\`），`run-guard`（74 项）是 Windows 本机套件** —— 这点如实标注，不宣称全平台。

## 作者机实测快照（2026-10-26）

| 项 | 实测结果 |
|---|---|
| 装机方式 | `~/.dsh/profiles/desktop/package.json` 里 `dsh-isolation-gate: link:D:/插件/dsh-isolation-gate`，并列在 `dsh.profile.bundles` |
| 插件目录已加载 | `cordis_inspect_query(Config, listConfigs, name=dsh-isolation-gate)` 返回条目 `include:isolation-gate`（patchId `isolation-gate`） |
| 真实拦截 | 本会话内一次 shell 调用被拒，文案包含「命中对象 / 当前级别 / 什么操作」三项 |
| 接线体检 | `doctor` 在空目录 0/7，`--fix` 后 7/7（见上方输出） |
| npm 装得上 | `npm run verify:install`：打包 → 空目录装 → 0/7 → 7/7 → 复查 7/7 |

> 注：插件在宿主里通过 `ctx.tools.guard()` 生效，它不注册服务、也不注册工具，所以在 Service 目录里看不到它——判它活着的证据是「真的拦下了一次调用」，不是目录里有没有名字。
