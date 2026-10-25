# 在 opencode 里用门禁

opencode 的插件系统有 `tool.execute.before` 钩子：每次工具执行前触发，**抛错即阻断**。门禁的 opencode 适配器就是把这个钩子接到同一套策略引擎上。

> ⚠️ **验证状态（诚实标注）**：适配器代码与单测（11 条断言）已通过；**未在真机 opencode 会话里验证**——本机 `opencode 1.18.29` 没有任何模型凭据（`opencode auth list` = 0 credentials），跑不了真实会话。请按下面步骤接上后**先做一次受管目录的读取测试**再长期使用。

## 安装（二选一）

### A. 本地插件文件（推荐，最可控）

```bash
mkdir -p .opencode/plugins
```

在 `.opencode/plugins/gate.mjs` 写：

```js
export { GatePlugin, default } from 'file:///D:/插件/dsh-isolation-gate/bin/gate-plugin-opencode.mjs';
```

（路径换成你自己的安装位置；npm 全局安装时可用 `file:///.../node_modules/dsh-isolation-gate/bin/gate-plugin-opencode.mjs`。）

### B. 配置里声明

`opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///D:/插件/dsh-isolation-gate/bin/gate-plugin-opencode.mjs"]
}
```

## 判定口径

| opencode 工具 | 门禁操作 |
| --- | --- |
| `read` `list` `glob` `grep` | `read` |
| `write` `edit` `patch` | `write` |
| `bash` | `write`（扫命令行里的绝对路径） |

命中受管目标 → `throw new Error("门禁拦截：…")`，opencode 把错误交给模型，工具不执行。审计记 `channel: hook/opencode`。

## 策略文件

默认与 DSH 插件共用：

| 用途 | 默认路径 | 环境变量 |
| --- | --- | --- |
| 级别状态 | `D:\.agents\门禁-授权.json` | `GATE_STATE_PATH` |
| 名单 | `D:\.agents\门禁-名单.txt` | `GATE_ROSTER_PATH` |
| 审计 | `D:\.agents\门禁-审计.jsonl` | `GATE_AUDIT_PATH` |

## 自测

```bash
node test/run-opencode-plugin.mjs     # 11 条断言，不需要 opencode 进程
```

真机自测（接好插件后）：让模型读一个**受管且为「禁」**的目录，预期工具报「门禁拦截」；再读一个普通目录，预期正常返回。

## 已知边界

- 只管 opencode 的工具调用；终端里手打命令不管。
- `bash` 靠命令行文本里的绝对路径判断，`cd` 后相对路径会漏判。
- 若该版本 opencode 不加载 `.opencode/plugins/`（各版本有差异），改用上面 B 的配置声明，或先用 `opencode debug startup --print-logs` 看插件加载日志。
