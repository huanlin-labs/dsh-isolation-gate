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
