# 发布清单 · dsh-isolation-gate

> 状态：**已上架 npm（0.2.0 live，2026-10-21）**；剩 1 项：分组卡片截图。

## 已完成
- [x] **包名可用**：`dsh-isolation-gate` 在 npm 上未被占用（`dsh-access-gate` 已被他人占用，故改名）。
- [x] **身份成套**：`package.json` / `cordis.patch.yml` / `lib/index.js`（`name` + 路由前缀 `/__dsh-isolation-gate`）/ `lib/client.js`（`id` + `BASE` + 槽位 id `isolation-gate`）/ `bin/gate.mjs` / 测试断言，全部一致；旧 junction 已删，新 junction 已建。
- [x] **自测**：`npm test` → 4 套件 · 325 断言全绿。
- [x] **打包体检**：`npm pack --dry-run` → 20 个文件、235 KB；不含测试产物；全树无 BOM。
- [x] **元数据**：`publishConfig.access=public`、`files` 白名单、`engines.node>=20.11`、keywords、MIT。
- [x] **CHANGELOG.md** + **CI**（`.github/workflows/test.yml`：ubuntu/windows × node 20/22 跑 `npm test`）。
- [x] 审计数据位已迁移：`~/.dsh/dsh-access-gate` → `~/.dsh/dsh-isolation-gate`（复制，未删旧）。

## 待办（需户主）
- [ ] **截图**：`docs/screenshots/02-group.png`（分组卡片 + 拖拽归组），补进 README 图示。DSH 窗口内的点击/截图由户主做。
- [ ] **干净环境实装**：在一台干净机器 / 空 profile 上跑一次
      `dsh plugin --profile desktop add dsh-isolation-gate`（或先用本地 tarball `npm pack` 后 `add ./dsh-isolation-gate-0.2.0.tgz`），确认「设置 → 插件」里显示为已启用、左排出现「门禁」。
- [x] 发布：`npm publish` 成功；`dist-tags.latest = 0.2.0`，tarball 200。\n- [x] 干净安装冒烟：`npm i dsh-isolation-gate` → 0.2.0，`import` 得 `name=dsh-isolation-gate`、`apply=function`，`gate` CLI 可执行。

## 发布后第一批
- 临时授权（限时 N 分钟自动回收）
- 状态文件并发锁
- 「为什么被拒」解释（命中哪条规则 / 被哪个父路径覆盖）

---
配套：`README.md`（中文）· `README.en.md`（English）· 状态文件 `D:\.agents\门禁-授权.json` · 名单 `D:\.agents\门禁-名单.txt`

## GitHub（2026-10-21 已完成）

前置：`gh` 已装（2.101.0），但**未登录**（无 remote、无凭证）。

```powershell
# 1) 登录（浏览器输 8 位码）
gh auth login --hostname github.com --git-protocol https --web
# 2) 建仓并推送
cd D:\插件\dsh-isolation-gate
gh repo create huanlin-labs/dsh-isolation-gate --public --source=. --remote=origin --push `
  --description "DSH plugin: default-deny directory authorization desk (isolation gate) with roster, groups, audit and agent self-check"
gh repo edit --add-topic dsh,dsh-plugin,isolation,permissions,authorization
# 3) 回填元数据（下次发版生效）
#    package.json: repository/homepage/bugs → github.com/huanlin-labs/dsh-isolation-gate
```
配好 GitHub 后可接 **trusted publishing（OIDC）**，以后发版免 2FA。
**结果**：<https://github.com/huanlin-labs/dsh-isolation-gate>（public，main，topics: dsh/dsh-plugin/isolation/permissions/authorization）。
⚠️ 遗留：GitHub Actions 未注册该 workflow（ctions/workflows 返回 0），待查（疑账号级 Actions 或仓库标记问题）。

## 开源配套（2026-10-21 完成）

- GitHub Release：v0.2.1 / v0.2.2（附 tarball）
- README：横幅 `docs/banner.svg`、6 个徽章、Star CTA、路线图、参与入口
- 配套文件：CONTRIBUTING / SECURITY / CODE_OF_CONDUCT / Issue 模板 2 个 / PR 模板
- CI：ubuntu 语法 + windows 全量自测；**已绿**（run 39626753077）
- 修复：`.gitignore` 曾含 `lib/` → 仓库缺 `lib/toolgate.js`；已移除并强制入库
- 修复：`bin` 写成 `./bin/gate.mjs` 被 npm 删除 → 0.2.2 改为 `bin/gate.mjs`