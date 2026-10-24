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
