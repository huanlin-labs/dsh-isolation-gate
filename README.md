# 门禁 · dsh-access-gate

> 给 DeepSeek Harness（DSH）的**隔离区授权台**：一屏看清「这台机器上哪些目录受管、各自什么级别」，
> 点一下就生效 —— **默认禁**、**名单制**、**分组批量切**、**可审计**、**agent 自己能查**。

**English** · [README.en.md](./README.en.md)

---

## 这是什么（以及不是什么）

它不是又一个 allow/deny 规则引擎，也不是沙箱本身。

- **别人做的是「怎么让 agent 多访问几个目录」**（multi-root / allowlist / write-protect）或「怎么用规则拦住工具」（permission-rules / safety-net）；
- **我们做的是「这台机器上哪些目录属于禁区、现在给什么级别、谁改的、agent 自己怎么查」**。

所以它的核心是**管理面**：

| 能力 | 说明 |
|---|---|
| **三级** | `deny` 禁（默认） / `read` 只读 / `full` 可读写删 |
| **两类受管对象** | **名字**（D 根一级目录名，如 `Zcode`）或 **任意绝对路径**（如 `<drive-root>\Zcode`、`E:\资料\合作档案\某项目`） |
| **默认禁 + 名单制** | 只有名单里的对象受管；未列出的不归它管；新增对象一律先按「禁」处理 |
| **一屏开关** | 每个对象一个**分段控件**（禁 / 只读 / 可读写删），点了即落盘，重启后保持 |
| **分组** | 「harness 隔离」「跨家合作」这类命名组；组头一键切三档；组只存在状态文件里，名单仍是"一行一对象" |
| **选择文件夹** | 有原生目录选择器就用它；没有就退回「未入名单的一层目录一键加入 + 文本框」 |
| **两个拦截点** | ① 受管辖通道 `bin/gate.mjs`；② **宿主工具执行门** `ctx.tools.guard()`（2026-10-21 新增） |
| **审计** | `~/.dsh/dsh-access-gate/access-log.jsonl`：只记时间/对象/级别/操作/允许与否/理由，**不记文件内容** |
| **agent 自查** | `node bin/gate.mjs status` —— 模型/脚本可以直接读策略，不用猜 |

---

## 它拦在哪一层

```
模型发起工具调用
   │
   ├─ tools/pre-execute  ← ★ 工具执行门（本插件 ctx.tools.guard）
   │      file tools 参数 / shell 命令文本 → 按三级判定 → 拒绝文案回到模型
   │
   ├─ 工具真正执行（read / write / edit / bash …）
   │
   └─ bin/gate.mjs  ← ★ 受管辖通道（agent 显式走它读写受管对象）
          判定不通过 ⇒ 一个字节都不碰
```

两条路都调用**同一个** `checkAccess`，所以面板、CLI、工具门不会说两套话。

---

## 安装

### 路线 A：`dsh plugin add`（推荐，profile 自动追加一行）

```bash
dsh plugin --profile desktop add dsh-access-gate
```

> 桌面版（Electron）也可以走「插件」页的**添加插件**，填包名或本地路径。

### 路线 B：profile `link:`（开发/自用）

```jsonc
// ~/.dsh/profiles/<profile>/package.json
"dependencies": { "dsh-access-gate": "link:/absolute/path/to/dsh-access-gate" }
```

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- insert:
    - id: access-gate
      name: 'dsh-access-gate'
```

⚠️ **改装配 = 要重启 dsh**。**开关本身不需要重启**：改级别、改名单都是即时落盘。

### 零配置默认值

| 配置 | 默认 | 说明 |
|---|---|---|
| `statePath` | `<data-root>/access-gate/state.json` | 状态唯一真身 |
| `rosterPath` | `<data-root>/access-gate/roster.txt` | 名单（一行一对象） |
| `backupDir` | `<backup-dir>` | 改名单前备份 |
| `root` | `<drive-root>\` | 列"一层目录"的根 |
| `auditPath` | `~\.dsh\dsh-access-gate\access-log.jsonl` | 审计 |
| `toolGate` | `true` | 关掉就只剩通道层 |
| `suspectVocabulary` | `['pi','codex',…]` 内置 | 追加"疑似受管目录"名谱（旧键 `harnessVocabulary` 仍读） |

---

## 状态文件（v2）

```jsonc
{
  "version": 2,
  "defaultLevel": "deny",
  "groups": {
    "harness 隔离": { "note": "", "updatedAt": "…" }
  },
  "objects": {
    "Zcode": { "level": "deny", "note": "", "group": "harness 隔离", "updatedAt": "…" },
    "E:\\资料\\合作档案\\某项目": { "level": "read", "note": "", "group": "", "updatedAt": "…" }
  }
}
```

- **v1 仍可读**：旧的 `harnesses: { key: { level } }` 读入时自动迁移成 `objects`，**级别不丢**；下一次写盘才落成 v2。
- 文件缺失 = **全禁**；坏 JSON = **全禁且不覆盖原文件**。
- 无 BOM；写盘走临时文件 + rename（原子替换）。
- `state.harnesses` 在内存里保留为只读别名，磁盘上不再写它。

---

## 判定语义（别改坏）

1. 给路径时先算**真身路径**（目标 realpath，或"最深已存在祖先 realpath + 剩余片段"）⇒ 从别处 junction 绕进来也会被认出来；
2. 在**路径对象**里找**最长前缀命中**（按路径段比较、忽略大小写，`<drive-root>\a\b` 不会命中 `<drive-root>\a\bc`）；
3. 没命中路径对象 ⇒ 退回"盘根一级目录名"匹配**名字对象**；
4. 都不中 ⇒ **不属受管对象**，本通道放行（它只管辖名单内的东西）；
5. **名单缺失 / 读坏 ⇒ 一律拒绝**（fail-closed），不是"放行一切"。

---

## 工具执行门（`ctx.tools.guard`）

- 覆盖：`read / read_image / grep / glob / write / edit / str_replace_editor / apply_patch / mkdir / move / copy / delete / bash / pwsh / …`
- shell 命令会做词法分解：`cd` + 相对路径、重定向、管道、`bash -c "…"` 都会跟进去；
- 未知命令只要命令文本里出现受管绝对路径，就**按写处理**（只在 `full` 放行）——宁可误拒，不可漏放；
- 判定自身抛错 ⇒ **fail-closed**（按拒绝处理）；
- `bin/gate.mjs` 自身的调用**豁免**工具门（它自己会判定，否则会双重拦截）。

---

## CLI（agent / 脚本用）

```bash
node bin/gate.mjs status                       # 全部级别
node bin/gate.mjs policy                       # 紧凑策略行（可塞进提示词）
node bin/gate.mjs check  --name Zcode --op read
node bin/gate.mjs check  --path "<drive-root>\Zcode\某文件" --op delete
node bin/gate.mjs traverse --path "<drive-root>\Zcode"
node bin/gate.mjs read   --path "<drive-root>\Zcode\某文件"
node bin/gate.mjs write  --path "<drive-root>\Zcode\某文件" --text "内容"
node bin/gate.mjs delete --path "<drive-root>\Zcode\某文件"   # 删前自动备份到回收站
node bin/gate.mjs rmdir  --path "<drive-root>\Zcode\空目录"   # 只删空目录（不递归）
node bin/gate.mjs log    --limit 20
```

**退出码**：`0` 放行 / 成功 · `3` 被拒（拒绝文案在 stderr）· `2` 用错或环境错误。

护栏：判定在 I/O 之前；只删文件不删目录；删除前自动备份，备份失败即中止；名单不可用一律拒绝。

---

## HTTP 路由（宿主半 · 本机同源）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/__dsh-access-gate/ping` | 身份 + 路由清单 + 能力（`toolGate` / `picker`） |
| GET | `/__dsh-access-gate/state` | 全量状态（名单 / 级别 / 分组 / 差异 / 审计 / 策略行） |
| POST | `/__dsh-access-gate/level` | `{ name, level }` 改一个对象 |
| POST | `/__dsh-access-gate/roster` | `{ action:'add'\|'remove', name }` 名单增删 |
| POST | `/__dsh-access-gate/group-level` | `{ group, level }` 组级一键切 |
| POST | `/__dsh-access-gate/group` | `{ action:'assign'\|'delete', name?, group }` |
| POST | `/__dsh-access-gate/prune` | 清理孤儿键 |
| POST | `/__dsh-access-gate/pick` | 调原生目录选择器（无则 400，面板自动走退路） |
| POST | `/__dsh-access-gate/toolcheck` | `{ tool, args }` 工具门**干跑**（不执行工具） |
| POST | `/__dsh-access-gate/check` | `{ name?\|path?, op }` 判定（不读内容） |
| GET | `/__dsh-access-gate/log?limit=` | 最近审计 |

带外部 `Origin` 的请求一律 403；错误方法 405；坏 JSON / 非法级别 400。

---

## 与其它插件的分工

| 插件 | 它管什么 | 与本插件 |
|---|---|---|
| `dsh-house-guard`（本机内建） | **体系资产**：固定几个受保护路径，只有白名单管家会话可写 | 目的不同、对象不重叠；两边都拒则拒（更严者胜） |
| `PerryLink/dsh-permission-rules` | 规则引擎：allow/deny/ask + 工具参数/shell/网络 | **互补**：它没有「只读」这一档；我们的面板不写它的 YAML，**不依赖**它 |
| `cherrchen/dsh-plugin-multi-root-workspace` | 给工作区**加**附加根（只读/读写），靠内核沙箱执行 | **互补**：它是"扩权"，我们是"划禁区"；它强在拦截强度，我们强在管理面与分组 |
| `azazo1/dsh-write-protect` | 工作区内只读保护 + 额外可写根 | 互补；Windows 上它的 bash 侧有明确缺口 |

> 本插件**不声明任何 `@deepseek-ai/dsh*` peer 依赖** —— dsh 升级不会因"版本豁免失效"被静默禁用。

---

## 已知边界（必须明说）

1. **raw fs 与独立进程拦不住。** 任何程序、脚本、别的 agent 不经过 DSH 工具调用就直接读写磁盘，本插件看不到。
   它拦的是**经过 DSH 的工具调用**与**走 `bin/gate.mjs` 的通道**。
2. **shell 是文本启发式。** 变量间接、命令替换、编码、符号链接、`cmd /c` 套一层等都可能绕过；
   与同类实现同一层级的已知限制。要更强，需要内核沙箱（Windows ACL / Seatbelt / bwrap）。
3. **不是内核级闸门。** 它不修改任何系统 ACL、不接管沙箱。
4. **工具门只覆盖宿主工具。** MCP 工具如果自己开进程读文件，同样只受其参数文本约束。
5. **Windows 优先**：路径比较按 Windows 语义（盘符、`\`、大小写不敏感）；其他平台未验证。

---

## 自测

```bash
node test/run-all.mjs     # 4 个套件 · 309 断言 · 全离线（不需要 GUI/dsh）
node --check lib/*.js
```

| 套件 | 覆盖 |
|---|---|
| `run-data-layer.mjs` | 状态 v1→v2 迁移 / 无 BOM / 坏 JSON 不覆盖 / 路径键 / 名单备份 / 分组 / 孤儿清理 |
| `run-guard.mjs` | 三级×四操作矩阵 / 最长前缀 / 同前缀不误伤 / fail-closed / 真实 I/O 闭环 |
| `run-routes.mjs` | 11 条路由 / 组级切 / 工具门挂载与干跑 / 选择器缺省 / 级别落盘 / 403/405/400 |
| `run-client.mjs` | 两座位注册 / 摘要条 / 分组卡片 / 分段控件 / `⋯` 菜单 / 空态 / 交互接线 |

---

## 致谢

- 设计受 `PerryLink/dsh-permission-rules`（Apache-2.0）与 Claude Code `permissions` 的**思路**启发；
  **未复制其任何代码或 README 文字**。
- 与 `@dsh-external/dsh-house-guard` 同机共存，边界见上表。

## 许可

MIT · 见 [LICENSE](./LICENSE)。
