# dsh-access-gate（门禁 · 目录访问管制）

DSH（DeepSeek Harness）**门禁**：在左上应用级导航排的「**技能**」**正下方**
加一个「**门禁**」入口；点开是**主区一整页**：把**受管名单**与磁盘比对并
**标出差异**，逐个**受管对象**切换三级授权（**禁 / 只读 / 可读写删**），状态**持久化**到
`D:\.agents\门禁-授权.json`，**供 agent / 工具侧读取**。

> **受管对象有两类**（名单行决定，同一份名单里可混用）：
> - **名字** —— D 根一级目录名，如 `Zcode`（旧行为，判定取"盘根一级目录名"）；
> - **路径** —— **任意绝对路径**，如 `D:\Zcode`、`E:\资料\合作档案\某项目`（新能力，
>   判定按**路径段最长前缀**命中）。
> 名字键与路径键是**两个键空间**，永不互相匹配。

> **它是补哪一环**：规则已写明"**授权以 GUI 门禁开关为准**"，本包就是那个载体。

- 挂载点 = **官方 `slots` 扩展点**的两个座位（与官方「插件」「自动化任务」页同一套）：
  1. `sidebar.panellist`（root 作用域 **list**）→ 图标行，`order: 6`
     —— 官方「插件」= 0、「自动化任务」= 10、已装的「技能」= 5 ⇒ **6 正好在技能正下方**
     （外壳按 `order` 升序排，与加载先后无关）；
  2. `main`（root 作用域 **keyed**）→ 主区整页，`key` 同行 id：`access-gate`。
- 因此本包**不声明任何 `@deepseek-ai/dsh*` peer 依赖** ⇒ 不受 DSH 兼容性豁免闸门影响。
- 纯 ESM JavaScript，**无构建链**：`lib/*.js` 直接可跑，自测 `node` 即可复跑。

## 它解决什么

| 能力 | 说明 |
|---|---|
| 三级状态 | `deny`（禁 · 默认） / `read`（只读 · 对应户主说「交叉验证」） / `full`（可读写删 · 对应「可以进去操作/删减」） |
| 持久化 | 状态只存 `D:\.agents\门禁-授权.json` 一处；**页面不留副本**，每次渲染都重新读盘 ⇒ 页面不可能与工具侧读到的不一致 |
| 两类受管对象 | 名单行写**名字**（D 根一级目录名）或**绝对路径**都可以；界面里路径对象带 `[路径]` 标记 |
| 最长前缀判定 | 给 path 时先按**路径段**做最长前缀命中（大小写不敏感，必须整段相等：`D:\a\b` 不会被 `D:\a\bc` 命中）；落空才退回"取盘根一级目录名"匹配名字类 |
| 真身路径 | 先 realpath（或"最深已存在祖先 realpath + 剩余片段"）再判 ⇒ 从别处 junction 绕进来也会被认出来 |
| **fail-closed** | 名单文件**缺失 / 读坏** ⇒ 通道**一律拒绝**（exit 3，文案含"名单不可用"）。旧版那种"读不到名单就放行一切"的 fail-open 已修 |
| 差异提示 | 名字类：「**已在名单但目录不存在**」/「**目录存在但未入名单**」/ 大小写不一致；路径类：「目录不存在」/「存在但不是目录」/ 名单行不合法（如实列出而非静默丢弃） |
| 一键入名单 | 只在界面里给出差异、由户主**点击确认**后才落盘；**新增项自动建 `deny`**（绝不自动授权）；**改前先备份**到 `D:\回收站\门禁-名单改前\` |
| 受管辖通道 | `bin/gate.mjs` —— agent / 工具侧读状态与访问受管对象的**唯一入口**，判定不通过就**一个字节都不碰**；每次判定留痕 |
| 审计 | `~\.dsh\dsh-access-gate\access-log.jsonl`（最近 500 条放行/拒绝） |

## 🔴 它**不**做什么（如实标注）

1. **它没有读任何受管对象内部内容的能力，也没这么做。**
   宿主半与页面只读写两个**配置文件**（状态 JSON / 名单 TXT）、列出 `D:\` 的**一层目录名**，
   并对名单里**显式列出的路径**做一次存在性判定。
   受管对象内部的读写全在 `bin/gate.mjs` 那条受管辖通道里。
2. **它不是内核级闸门。** 裸文件系统层面读 `D:\Zcode\` **目前没有被拒**。
   本包给的是**一条被真正强制执行的通道** + 一个**唯一的状态载体**；"让不走通道的人也进不去"
   需要动 house-guard / 宿主钩子 —— 属管家域。
3. **不改规则、不动 profile 装配**（归管家域）。

## 名单文件格式（`D:\.agents\门禁-名单.txt`）

```text
# 别的 harness 的家目录 · 一行一个受管对象
Zcode                     # 名字类：D 根一级目录名
opencode                  # 名字类
D:\Zcode                  # 路径类：任意绝对路径（归一化后比较）
E:\资料\合作档案\某项目     # 路径类（可以锁到深层目录，不受"盘根一级"限制）
```

- 一行若**含盘符或路径分隔符且 `win32.isAbsolute()` 为真** ⇒ **路径对象**；
  否则按旧规则当**名字**。
- 路径键归一化 = `win32.resolve`（展开 `.` / `..`）→ 去尾分隔符 → 盘符统一大写；
  比较时忽略大小写。名字键与路径键**不互相匹配**。
- 校验不过的行**不静默丢弃** —— 界面与 `status` 会如实报出来（`invalid`）。

## 状态文件格式（`D:\.agents\门禁-授权.json`）

```jsonc
{
  "version": 1,
  "defaultLevel": "deny",           // 未列出的键一律按此
  "updatedAt": "2026-10-09T13:11:42Z",
  "updatedBy": "gui",               // gui / roster-add / evidence …
  "harnesses": {                    // ⚠️ 容器键名沿用 harnesses（磁盘格式，改它要一次迁移）
    "Zcode":                    { "level": "deny", "note": "", "updatedAt": "…" },
    "E:\\资料\\合作档案\\某项目": { "level": "read", "note": "", "updatedAt": "…" }
  }
}
```

- 键 = **受管对象键**：D 根一级目录名，**或**归一化绝对路径（两类键空间互不混淆）。
- 文件**缺失 = 全禁**（不是"没限制"）；**坏 JSON = 全禁且不覆盖原文件**。
- 无 BOM；写盘走临时文件 + rename（原子替换）。

## 受管辖通道（`bin/gate.mjs`）

```bash
node bin/gate.mjs status                       # 工具/agent 侧读全部级别
node bin/gate.mjs policy                       # 紧凑策略行（可塞进提示词）
node bin/gate.mjs check  --name Zcode --op read
node bin/gate.mjs check  --path "D:\Zcode\某文件" --op delete
node bin/gate.mjs check  --path "E:\资料\合作档案\某项目\a.md" --op read
node bin/gate.mjs traverse --path "D:\Zcode"
node bin/gate.mjs read     --path "D:\Zcode\某文件"
node bin/gate.mjs write    --path "D:\Zcode\某文件" --text "内容"
node bin/gate.mjs delete   --path "D:\Zcode\某文件"   # 删前自动备份到回收站
node bin/gate.mjs rmdir    --path "D:\Zcode\空目录"   # 只删**空目录**（不递归；非空 / 链接 / 盘根一级一律拒）
node bin/gate.mjs log      --limit 20
```

**退出码**：`0` 放行 / 成功 · `3` **被拒**（拒绝文案在 stderr）· `2` 用错或环境错误。
可选：`--state` `--roster` `--root` `--log` `--channel` `--json` `--no-backup`。

护栏（任一条不满足即拒绝并给中文原因）：
- 判定取的是**真身路径** ⇒ 从别处 junction 绕进来也会被认出来；
- 级别不足 ⇒ **在 I/O 之前**退出（被拒时 stdout 为空，不泄漏任何目录项）；
- **名单不可用 ⇒ 一律拒绝**（fail-closed；`--roster` 指夹具时只要该文件存在就正常）；
- 只删**文件**，**不删目录**（空目录用 `rmdir`；目录的递归删/搬属高风险，走户主/管家单独授权）；
- 删除前**自动备份**到 `D:\回收站\门禁-改前\`，备份失败即中止删除。

## HTTP 路由（宿主半 · 本机同源）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/__dsh-access-gate/ping` | 插件身份 + 路由清单 + 三级说明 |
| GET | `/__dsh-access-gate/state` | 全量状态：名单 / 级别 / 磁盘差异 / 审计尾部 / agent 策略行 |
| POST | `/__dsh-access-gate/level` | `{ name, level }` 改一个受管对象的授权（`name` 收名字或绝对路径） |
| POST | `/__dsh-access-gate/roster` | `{ action: 'add'\|'remove', name }` 名单增删（先备份；新增项自动 deny） |
| POST | `/__dsh-access-gate/check` | `{ name?\|path?, op }` 受管辖判定（**不读任何内容**） |
| GET | `/__dsh-access-gate/log?limit=` | 最近审计 |

带外部 `Origin` 的请求一律 403；错误方法 405；坏 JSON / 非法级别 400。

## 装配

```jsonc
// ~/.dsh/profiles/<profile>/package.json
"dependencies": { "dsh-access-gate": "link:D:/插件/dsh-access-gate" }
```

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- insert:
    - id: access-gate
      name: 'dsh-access-gate'
```

⚠️ **改装配 = 要重启 dsh**（进程红线：重启只由户主执行）。**开关本身不需要重启** ——
改级别、改名单都是即时落盘。

可选 config（全部有默认值）：

```yaml
      # config:
      #   statePath: 'D:\\.agents\\门禁-授权.json'
      #   rosterPath: 'D:\\.agents\\门禁-名单.txt'
      #   backupDir: 'D:\\回收站\\门禁-名单改前'
      #   root: 'D:\\'
      #   auditPath: 'C:\\Users\\<你>\\.dsh\\dsh-access-gate\\access-log.jsonl'
      #   harnessVocabulary: ['pi', 'codex']   # 追加"疑似受管目录"名谱
      #   autoCreateStateFile: true
```

## 自测

```bash
node test/run-all.mjs        # 4 个套件，全离线（不需要 GUI、不需要 dsh）
```

| 套件 | 覆盖 |
|---|---|
| `run-data-layer.mjs` | 状态缺省=全禁 / 往返 / **无 BOM** / 坏 JSON 不覆盖 / 大小写不敏感 / **路径键的支持与"两类键不互相匹配"**；名单两类行解析（名字 + 绝对路径）/ 增删只动那一行 / 注释保留 / **写前备份** / 非法行如实报出；差异两条都能报出来 |
| `run-guard.mjs` | 三级×四操作矩阵 + **最长前缀优先** + **同前缀不误伤（`hs-gate-x` vs `hs-gate-xyz`）** + **fail-closed（名单缺失 ⇒ exit 3 且文案含"名单不可用"）** + 夹具上只读/**可读写删**的真实闭环（原始 stdout/stderr/退出码全录进 `test/out/guard-report.json`） |
| `run-routes.mjs` | 假 ctx 跑真 `apply()`：6 条路由、200/400/403/405、级别落盘（=重启后仍在）、名单增删、**路径对象的级别读写**、无 `webServer` 时降级等待 |
| `run-client.mjs` | 假 `__ModuleLoader__` + React 桩：两座位注册（**行 order=6 / id / label；页 key 一致**）、座位缺失不抛错、图标皮肤钩子、**加载态/差异态/干净态/错误态**渲染、**路径对象的 `[路径]` 标记**、交互回调接线 |

> 注：自测全部跑在**临时夹具**上（`D:\临时\` 与系统 temp），**不依赖 `D:\.agents\` 下的生产文件**；
> 对生产状态文件只做**只读**的"无 BOM"条件断言。

## 未实查项（如实标注）

- **GUI 真实渲染未人眼确认**：`lib/client.js` 是启动时载入的，必须**重启 dsh** 才装载。
  自测只证明"座位注册与渲染树正确"，不证明"外壳里真的出现在技能下方"。
- `sidebar.panellist` 当前各占用方的 `order`（插件 0 / 技能 5 / 自动化任务 10）来自
  `dsh-skill-panel` README 记载的实测结论，**本次未重新字节扫描 `app.asar` 复核**。
- 路径类受管对象的"目录存在 / 不存在"只看**那一条路径本身**；路径不存在时判定仍按
  前缀生效（目标可能是准备新建的）。

## 许可

MIT。
