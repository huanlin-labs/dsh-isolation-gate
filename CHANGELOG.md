## 1.13.2 — 2026-10-26

- README.en.md 补齐中文版的首屏：演示 GIF、三条命令上手、「Verified, not claimed」验证表、按 harness 的接线方式与强度、以及诚实限制（MCP = advisory）。

## 1.13.1 — 2026-10-26

- README 首屏新增 30 秒终端回放 GIF（`docs/brand/demo.gif`，25 帧 / 287 KB）：接线 0/7 → `--fix` 7/7 → `status` → 真实拦截文案。内容均为实测输出，非模拟界面。

## 1.13.0 — 2026-10-26

第一个公开里程碑（汇总 1.12.4–1.12.12）。不是新功能，是把这一段的修复与证据收拢成一个可引用的版本。

- 跨平台：`normalizeRoot` / `topSegmentOf` 修复 POSIX 路径（macOS / Linux 上不再拼错分隔符，1.12.4 / 1.12.6）。
- 可验证性：`npm run verify:install` —— 打包、空目录真装、`doctor` 0/7 → `--fix` 7/7 → 复查 7/7（1.12.7）。
- 发布门禁：`scripts/prepublish-check.mjs` 挂 `prepublishOnly`，拒绝版本不一致、CHANGELOG 缺条、README 图片缺失、以及「空改动」（1.12.11）。
- 文档：`docs/EXAMPLES.md` 一页走通（真实输出）；`docs/VERIFY.md` 加作者机实测快照（1.12.8 / 1.12.12）。
- README 首屏去重、图片引用修正（1.12.9 / 1.12.10）。
## 1.12.12 — 2026-10-26

- docs/VERIFY.md 新增「作者机实测快照」：装机链路、目录已加载、真实拦截一次、doctor 7/7、npm 装得上；并说明为何 Service 目录里看不到它。

## 1.12.11 — 2026-10-26

- 新增 `scripts/prepublish-check.mjs` 并挂到 `prepublishOnly`：版本与 `lib/index.js` 一致、CHANGELOG 有本条、README 图片都存在、相对上个 tag 确有文件变化——防「发了等于没改」。

## 1.12.10 — 2026-10-26

- 修正 1.12.9：上一版的去重没生效（正则未命中全角字符），README 仍有两张横幅；本版用正则删掉 SVG 那一行，并验证引用为 0。

## 1.12.9 — 2026-10-26

- README 首屏去重：删掉与 banner.png 重复的旧 SVG 横幅；图片引用全部校验存在。

## 1.12.8 — 2026-10-26

- 新增 docs/EXAMPLES.md：用真实输出讲完「装、接线、三档权限、拦截文案、排错」；修正文中不存在的 `set` 命令（改级别走 `ui`）。

## 1.12.7 — 2026-10-26

- 新增 `npm run verify:install`：用 `npm pack` 的 tarball 在临时目录真装一遍，跑 `doctor`（0/7）与 `doctor --fix`（7/7）并复查可重复。
- CI 增加该步骤 —— 三平台都验证「装得上、跑得动」。

## 1.12.6 — 2026-10-26

- `topSegmentOf` 在非 Windows 上按 POSIX 根解析（不再用 `win32.parse`），名判定的“根下第一段”语义在 macOS/Linux 上成立。
- 测试夹具改为平台无关（`tmpdir()`、平台样例路径）。`run-guard` 仍是 Windows 本机套件（一项路径对象断言待改）。

## 1.12.5 — 2026-10-26

- README 加品牌横幅（docs/brand/banner.png + PHILOSOPHY.md）。

## 1.12.4 — 2026-10-26

- 修复 `normalizeRoot` 在 macOS/Linux 上错误追加反斜杠，导致 `listRootDirs` 在非 Windows 上失败。

## 1.12.3 — 2026-10-26

- 新增 `npm run verify:publish`：发布后直接查 registry 原始 JSON 直到版本出现（防 1.12.1 那种“publish 报成功但没落地”）。

## 1.12.2 — 2026-10-26

- `doctor --json`：机器可读的接线体检结果，便于 CI/脚本判定。
- 修复 1.12.1 未真正发布到 npm 的问题（发布后逐条核对 registry）。

## 1.12.1 — 2026-10-26

- `doctor --fix`：一次把没接线的 harness 全接上（每处仍先备份原文件）；新增 5 项回归测试，套件 15/15。

## 1.12.0 — 2026-10-26

- 新增 `gate-setup doctor`：一次体检所有 harness 的接线状态（✔ 已接线 / – 未接线）。
- 新增中文《3 分钟上手》：docs/QUICKSTART.zh.md，README 加索引。

## 1.11.1 — 2026-10-26

真机补齐：opencode 1.18.29 插件已装并验到 deny 拦截；Gemini CLI 0.65.0 安装 + BeforeTool 钩子已写；新增 docs/VERIFY.md 与 README 支持矩阵。

## 1.11.0 — 2026-10-26

- **跨平台**：默认状态/名单/审计目录不再写死 D 盘 —— Windows 有 `D:\.agents` 时沿用，否则 `~/.agents`；扫描根默认系统盘根。
- **Codex 接线**：`gate-setup codex` 写 `~/.codex/config.toml` 的 `mcp_servers`（advisory；Codex 无前置钩子，不能硬拦）。
- **`--verify`**：`gate-setup <harness> --verify` 一键检查接线是否真的落盘。
- **CI**：GitHub Actions 三平台 × Node 20/22/24 跑全部套件；README 加 stars / CI 徽章；英文 README 补齐。
## 1.10.1 — 2026-10-26

加兼容性标签（npm keywords / GitHub topics）与 `gate-ui` 命令别名：明确对 Claude Code / ZCode / opencode / pi / Codex / Cursor / MCP 通用。

## 1.10.0 — 2026-10-26

**给没有前端的 harness 补一个设置页**：ZCode / opencode / pi / Claude Code 的用户原本只能改 JSON，没法"设分组、禁谁"。

- 新增 `gate ui` / `npx dsh-isolation-gate ui`：本机 127.0.0.1 页面，列出对象与分组，一键切「禁 / 只读 / 可读写删」，可新增/移出对象、整组切档。
- 与 dsh 面板共用同一份状态文件；写操作带一次性 token，只监听本机。
- 新增 12 条 UI 测试；HTTP 接口在无 token 时返回 403。
## 1.9.2 — 2026-10-26

ZCode 真机核对（3.16.3）：配置路径 `~/.zcode/cli/config.json` 确认，`hooks.enabled: true` 必需；PreToolUse 返回协议 `hookSpecificOutput.permissionDecision` 与适配器逐字一致；项目级 hooks 当前版本被忽略，配置在 session 启动时快照。补 docs/ZCODE.md 真机结论。另：opencode 适配器测试改为夹具隔离（不再依赖本机真实门禁状态）。
## 1.9.1 — 2026-10-26

真机装 pi 1.4.0 后修的两个 bug（纸上看不出、装上才炸）：

- **扩展目录写错**：`~/.pi/extensions/` → **`~/.pi/agent/extensions/`**（pi 只认后者，写错等于没装）。
- **Windows 静态 re-export 失败**：`export { default } from "file:///D:/…"` 被 pi 加载器吃成 `d:` 协议，报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`；改为 `pathToFileURL(...).href` 动态 import。

并用安装版 `types.d.ts` 核对：`ToolCallEventResult = { block?: boolean; reason?: string; terminate?: boolean }`，与适配器返回形状一致。
## 1.9.0 — 2026-10-26

- **pi 适配器**：`bin/gate-plugin-pi.mjs` —— 挂 pi 的 `tool_call` 事件，进程内硬拦；策略引擎、状态文件、审计与 DSH 共用（一处配置，两个 harness 生效）。
- **`gate-setup pi`**：一条命令在 `~/.pi/extensions/` 生成转发扩展；dry-run 默认、`--write` 自动备份。
- 工具名映射 read/write、事件字段容错（toolName/tool_name、input/args/toolInput）、命令内绝对路径提取；策略异常 **fail-closed**。
- 新增 `test/run-plugin-pi.mjs`（8 断言）→ **13 套件全绿**。
- 文档 `docs/PI.md` 改写为真实接入说明（含"未真机验证"声明）。

## 1.8.0 — 2026-10-26

- **一键接线器**：`bin/gate-setup.mjs`（bin 名 `gate-setup`）——`gate-setup <claude|zcode|gemini|opencode|mcp>`，默认 dry-run，`--write` 才落盘并自动备份；幂等（重复执行不重复追加）。
- **ZCode 支持**：ZCode 的 `PreToolUse` 与 Claude Code 同协议（`hookSpecificOutput.permissionDecision`），直接复用 `gate-hook-claude.mjs`；`gate-setup zcode` 写 `~/.zcode/cli/config.json`（`hooks.enabled=true` + `events.PreToolUse`，process 执行器）。
- **诚实能力矩阵**：README 新增「各 harness 支持度」表，按「能硬拦 / 只能建议」分档；MCP 明确标注**拦不住**，opencode / Gemini / pi 标 experimental。
- 新增 `docs/ZCODE.md`、`docs/PI.md`；新增 `test/run-setup.mjs`（21 断言）→ **12 套件**。

## 1.7.0 — 2026-10-25

- **通用前置钩子适配器**：`bin/gate-hook-generic.mjs`（bin 名 `gate-hook-generic`）——任何「工具执行前调命令 + stdin 喂 JSON」的 harness 都能直接接。
- 字段容错：`GATE_TOOL_KEYS` / `GATE_ARGS_KEYS` / `GATE_OP_KEYS` 可配；默认同时认 snake_case 与 camelCase。
- 拦截输出四选一（`GATE_DENY_STYLE`）：exit2（默认）/ json-claude / json-gemini / text。
- 新增 `test/run-hook-generic.mjs`（21 断言），并入 `npm test` → 11 套件。
- 文档 `docs/GENERIC-HOOK.md` 与 `docs/CODEX.md`（Codex 钩子能力随版本变化，含自检步骤；标注未真机验证）。

## 1.6.0 — 2026-10-25

- **MCP 服务器**：`bin/gate-mcp.mjs`（bin 名 `gate-mcp`），stdio + 按行 JSON-RPC，无第三方依赖；支持 initialize / tools/list / tools/call / ping。
- 三个工具：`gate_check`（路径 + 操作 → 判定）、`gate_status`（受管对象与级别）、`gate_audit`（最近审计）。
- 定位 **advisory**：MCP 不能硬拦，只做事前询问 + 审计（channel=mcp）；硬拦仍靠前置钩子适配器。
- 新增 `test/run-mcp.mjs`（16 断言，真子进程 + 真握手），并入 `npm test` → 10 套件。
- 文档 `docs/MCP.md`（含 Claude Desktop / Cursor / opencode 的注册片段）。

## 1.5.0 — 2026-10-25

- **Gemini CLI 适配器**：`bin/gate-hook-gemini.mjs`（bin 名 `gate-hook-gemini`）读 `BeforeTool` 事件 JSON，命中受管目标输出 `{"decision":"deny","reason":…}`；坏输入 fail-closed。
- 工具映射：read_file/read_many_files/list_directory/glob/search_file_content→read；write_file/replace/run_shell_command→write。
- 新增 `test/run-hook-gemini.mjs`（13 断言），并入 `npm test` → 9 套件。
- 文档 `docs/GEMINI-CLI.md`（含 settings.json 片段；标注本机未装 gemini CLI、未真机验证）。

## 1.4.0 — 2026-10-25

- **opencode 适配器**：`bin/gate-plugin-opencode.mjs` 导出 `GatePlugin`，挂 `tool.execute.before`，命中受管目标 `throw` 阻断；审计 `channel: hook/opencode`。
- 新增 `test/run-opencode-plugin.mjs`（11 断言），并入 `npm test` → 8 套件。
- 文档 `docs/OPENCODE.md`（含诚实标注：本机 opencode 1.18.29 无模型凭据，未做真机会话验证）。
- README 跨 harness 表：opencode 标为「代码+单测通过，未真机验证」。

## 1.3.0 — 2026-10-25

- **跨 harness**：新增 Claude Code `PreToolUse` 适配器 `bin/gate-hook-claude.mjs`（`gate-hook-claude` 命令）——同一套名单 / 级别 / 审计，命中受管目标返回 `permissionDecision: deny`。
- 工具名 → 操作映射：Read/Glob/Grep/LS→read；Write/Edit/MultiEdit/NotebookEdit→write；Bash/PowerShell→write（扫描命令行里的绝对路径）。
- 环境变量可覆盖策略文件：`GATE_STATE_PATH` / `GATE_ROSTER_PATH` / `GATE_AUDIT_PATH` / `GATE_ROOT`。
- 新增测试套件 `test/run-hook-claude.mjs`（12 断言：拦截 / 放行 / 坏输入 fail-closed / 审计通道）。
- 文档 `docs/CLAUDE-CODE.md`；README 增「在别的 harness 里用」。

## 1.1.2 — 2026-10-25

- 补 npm 搜索关键词（dsh / dsh-plugin / access-control / sandbox / audit-log 等 13 个），便于在 npm 搜索里被找到；代码无变化。

## 1.1.1 — 2026-10-24

- 与 1.1.0 内容一致；1.1.0 在 npm 被一条旧的暂存记录占用，改发补丁号。

# Changelog

## 1.1.0 — 2026-10-24

- 加固：`gate_request` 只接受已在名单里的对象；面板「批准」会复核对象仍在受管名单（防止批准出名单外的孤儿对象）。
**模型可以直接管门禁了。** 以前改门禁只能人工点面板或 shell 出去跑 `gate.mjs`；这一版把同一套能力注册成 7 个模型工具，像任务板那样「说需求 → 模型自己调」。

- **新增 7 个工具**：`gate_status`（全量状态）、`gate_check`（干跑判定）、`gate_add`（加对象，固定「禁」）、`gate_set_level`（改级别）、`gate_request`（申请放宽）、`gate_requests`（看待批）、`gate_log`（读审计）。
- **权限边界（刻意的不对称）**：查 / 新增 / 收紧随时可做；**放宽（→只读 / 可读写删）模型自己批不了** —— 没户主授权窗口时只生成一条待批申请。
- **待批队列**：新文件 `<状态目录>\requests.json`（v1），含 `requests[]` 与 `aiGrantUntil`；同目标同级别去重，最多 50 条。**不动已冻结的 state v3**。
- **新增 4 条路由**：`GET /requests`、`POST /requests-approve`、`POST /requests-reject`、`POST /grant`（户主在面板/本机窗口批准，模型工具里没有"批准"这个动作）。
- **零新依赖**：工具定义直接按宿主 `ToolDefinition` 形状注册，**没有引入 `@deepseek-ai/dsh-tools` peer**，躲开兼容性闸门。
- 测试：6 个套件全绿（路由数 16 → 20）。

## 1.0.0 — 2026-10-23

**1.0 = 功能与格式冻结，不是「完美版」。** 承诺范围见 README 的「1.0 的稳定性承诺」：状态文件 v3、CLI 子命令与退出码、HTTP 路径、四条判定语义 —— 只增不破。

这一版**没有功能变更、没有格式变更**，只做发版前的对齐：

- **文档纠错**：状态文件章节标到 v3（原文写 v2，实际 `STATE_VERSION = 3`）。
- **测试数字纠错**：改为实跑结果 **6 个套件 · 396 条断言**（原文「4 个套件 · 325 断言」是旧数；英文 README 的 309 同样过期）。
- **定位改写**：从「别人做规则、我们做管理面」改为「别人按工具/参数立规则，我们按目录立对象」—— 前者已被同类追上，后者才是实际差异。
- **SECURITY.md**：支持范围改 `1.x`；新增「已知边界」五条（同权限域可自改、档位模式无 realpath、黑名单只判抽到的目标、审计可改、管不到 DSH 之外）。
- **新增**：README（中/英）各加一节「1.0 的稳定性承诺」。

## 0.4.0 — 2026-10-23

- **改（重要）**：组类型（严格 / 宽松）以前只在按钮上写一句小字，实际是**两套相反语义** —— 严格组是白名单（没列进组的全拒），宽松组是黑名单（没列进组的照常）。实测踩坑：把目录加进严格组当「只禁这个」，结果全盘封死。现在模板卡片和编辑区都挂一条醒目的**模式横幅**（白名单模式 / 黑名单模式 + 「没列进组的怎么算」），编辑区还给一键「换成宽松组 / 严格组」（不动清单，只换清单外怎么算）。
- 模板卡片显示**挂在哪几个会话**（会话 id 前 8 位），不再只有一个数字。
- 模板编辑区原来那句「不在组里的目录不受影响」是**错的**（那是宽松组才成立），已按组类型分写。
- 会话头部选择器里每组也补上「没点名的全拒 / 照常」。
- **测试**：客户端 94 → 97 条（锁住两种组类型的横幅文案与会话头部提示），`npm test` 6/6 通过。

- **新**：会话头部小按钮（`conversation.session.header.utilities`，垃圾桶那一排右侧）—— 打开就能给**当前会话**挂一个「特别门禁」组，或者选「不额外限制」取消。单选：一个会话最多挂一个组，组本身可以被多个会话共用。
- 按钮直接显示当前挂的组名；没挂时显示「门禁」并保持低调（虚线灰），挂上后变强调色 —— 一眼看出这个会话是不是被额外限制着。
- 数据源与「特别门禁」页是同一份：`GET /profiles?sessionId=` 读、`POST /session-profile` 写，不另存副本。
- 弹出的清单里每组带一行说明（严格组 / 宽松组 · 多少条），并固定一句边界提示「组只会更严，不会放宽全局名单」。
- 弹层包在渲染错误边界里：它坏了也不会拖垮整个会话头部。
- **测试**：客户端 93 → 94 条（3 个座位 + 新座位 id），`npm test` 6/6 通过。

## 0.3.3 — 2026-10-22

- **改名**：「策略档」→「隔离强度」，三档一律用白话名 —— 宽松（normal）/ 严格（strict）/ 全封（sealed），每档一句「这档会发生什么」
- **修**：页内三个标签点了不切换。标签改用原生 `<button type="button">` + `data-gate-tab`，并把当前页记在模块级变量里（宿主若重建组件实例，回来还是刚才那页）；顶栏右侧新增「当前页说明」可肉眼确认
- **测试**：客户端自测新增 11 条标签回归（3 个标签、白话名、`type=button`、点击回传 list/profiles/audit、首屏渲染、三档白话名），82 → 93

## 0.2.3 — 2026-10-21

- 新增 `npm run release:check`：一条命令核对「本地版本 / npm latest / git tag / GitHub Release / 元数据回链 / 发现性关键词」
- 关键词补齐：`deepseek-harness`、`cordis`、`ai-agent`、`security`（插件市场按关键词抓取）
- GitHub topics 补到 10 个：`dsh` `dsh-plugin` `dsh-bundle` `deepseek-harness` `isolation` `permissions` `authorization` `access-control` `ai-agent` `security`
## 0.2.2 — 2026-10-21

- **修复**：`bin` 写成 `./bin/gate.mjs` 时 npm 会判定名字非法并**删除 bin 入口**（0.2.1 因此缺 `gate` 命令）；改为 `bin/gate.mjs`
## 0.2.1 — 2026-10-21

只改元数据，无行为变更。

- `package.json` 补 `repository` / `homepage` / `bugs`，npm 页面回链 GitHub
- 关键词补充 `agent-safety` / `access-control` / `windows`
- README 重写首屏：横幅、徽章、Star CTA、路线图、参与入口
- 补齐开源配套：CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / Issue 与 PR 模板
- CI 拆成 ubuntu 语法检查 + windows 功能自测
# 变更记录 · dsh-isolation-gate

> 本包原名 `dsh-access-gate`（npm 上该名已被他人占用，与本插件无关系）。
> 公开发布起用现名，版本号沿用内部版本序列。

## 0.2.0 — 2026-10-21（首个公开发布版本）

### 新增
- **隔离区授权台**：默认禁 + 名单制 + 三级（禁 / 只读 / 可读写删）；`D:\.agents\门禁-授权.json` 为唯一生效依据。
- **分组**：组头一键切三档；空组可先建（`POST /group action=create`）；成员逐项归组。
- **拖拽归组**：对象行直接拖进组卡片归组，拖到「未分组」= 取消分组（与技能面板同款 HTML5 拖放）。
- **原生目录选择**：宿主无 picker 服务时，自调 Windows `FolderBrowserDialog`（`spawn powershell -STA`）。
- **工具执行门**：`ctx.tools.guard` 拦截 read / write / shell 类工具对受管路径的访问；fail-closed（名单不可用一律拒绝）。
- **通道判定**：`bin/gate.mjs check|traverse|status`，给脚本与 agent 自查用；`/toolcheck` 干跑不执行。
- **审计**：`~/.dsh/dsh-isolation-gate/access-log.jsonl`，只记时间/对象/级别/操作/允许与否/理由，不记内容。
- **分组 / 名单 / 状态**：v1 → v2 自动迁移；写盘原子、无 BOM；名单增删先备份。

### 已知边界
- 只拦**经过 dsh 工具层**的访问；其它程序、别的 harness 进程、已在运行的进程不受影响。
- 不拦绕过工具层的原生文件系统调用（见 README「已知边界」）。

### 自测
- `npm test` → 4 个套件 · **325 断言**全绿（数据层 85 / 通道 74 / 路由 84 / 客户端 82）。

## 0.3.0 — 策略档（会话级隔离）

- 新增三种档：`blocklist`（原行为）/ `allowlist`（只允许列出目录，其余全拒）/ `sealed`（再加禁网与未知工具全拒）
- 档的绑定：**会话覆盖**（`state.sessionOverrides[sessionId]`，用 `exec.agent.id`）> **目录配置** `.dsh-gate.json` > 全局默认档
- `.dsh-gate.json` **只能加严、且只能管自己所在的子树**：写 `C:\` 不会生效（防"仓库自带配置解锁"）
- 坏配置 / 坏状态文件 ⇒ 按 `sealed` 处理（fail-closed）
- 联网软禁：`web_search` / `web_fetch` 等工具 + `curl` / `npm install` / `git clone` 等命令；`npm test`、`git status` 不误判
- `sealed` 下认不出路径的 shell 命令一律拒
- 自测：新增 44 + 12 条断言，套件 6/6 通过

### 面板拆成三页（同日）

- 侧栏三项：`门禁`（对象授权）/ `门禁 · 策略`（档位与目录绑定，只读）/ `门禁 · 审计`（磁盘差异 + 审计账本）
- 新增宿主路由 `GET /__dsh-isolation-gate/profiles`
- 原单页保留为第 1 页，内容未删

- 修正：不做三个侧栏项，改回**一个「门禁」+ 页内标签**（对象与分组 / 策略档 / 审计与诊断），与「技能」面板同款交互

- 审计页新增「清空审计」：清空前整份备份到 `D:\回收站\isolation-gate-audit\access-log-<时间>.jsonl`，再截断原文件；新增 `POST /__dsh-isolation-gate/audit/clear`

- 修：`POST /audit/clear` 缺 `clearAudit` 导入（运行时 ReferenceError → 400）；前端改用 `post()` 正确序列化 body
