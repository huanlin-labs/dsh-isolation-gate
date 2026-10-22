# Changelog

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
