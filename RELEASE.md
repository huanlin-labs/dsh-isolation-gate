# 发布清单 · dsh-isolation-gate

> 状态：**已就绪 5/7**，剩 2 项需户主参与（见「待办」）。

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
- [ ] 发布：`npm publish`（首次会占名，建议先 `--dry-run` 再看一遍 `npm pack` 内容）。

## 发布后第一批
- 临时授权（限时 N 分钟自动回收）
- 状态文件并发锁
- 「为什么被拒」解释（命中哪条规则 / 被哪个父路径覆盖）

---
配套：`README.md`（中文）· `README.en.md`（English）· 状态文件 `D:\.agents\门禁-授权.json` · 名单 `D:\.agents\门禁-名单.txt`
