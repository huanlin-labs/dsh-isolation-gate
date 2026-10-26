# 在 pi 里用门禁

pi 的扩展系统在**进程内**触发 `tool_call` 事件（官方文档：「Authorize or modify a tool call」），
所以门禁在 pi 里是**硬拦**，和 DSH 同级别，不是"建议 + 审计"。

> **验证状态**：适配器 + 8 条单测通过（假 pi 驱动：拦截 / 放行 / snake_case / 命令里的绝对路径 / 只读禁写 / 名单外不拦）。
> **未做真机验证**：写这份文档的机器上没装 pi。接好后请先做一次受管目录读取测试。

## 一条命令接线

```bash
node D:/插件/dsh-isolation-gate/bin/gate-setup.mjs pi          # dry-run，看要写什么
node D:/插件/dsh-isolation-gate/bin/gate-setup.mjs pi --write  # 落盘（有原文件会先备份）
```

生成 `~/.pi/extensions/isolation-gate.js`：

```js
// 门禁 · pi 扩展（由 gate-setup 生成；删除本文件即停用）
export { default } from "file:///<安装路径>/dsh-isolation-gate/bin/gate-plugin-pi.mjs";
```

> 如果这版 pi 只扫描 `.ts` 扩展，把文件名改成 `isolation-gate.ts`，内容不变。

## 判定流程

1. `tool_call` 触发 → 取 `event.toolName` / `event.input`（兼容 `tool_name` / `tool_input` / `args`）；
2. 工具名映射 `read` / `write`（未知工具按 `write`，偏保守）；
3. 收集参数里的路径：`file_path` / `path` / `directory` / `cwd`，以及 shell 命令中的绝对路径；
4. 逐个过策略引擎：**名单内对象**按级别判，**名单外不拦**（与 DSH 工具门同语义）；
5. 命中拒绝 → 返回 `{ block: true, reason }`；判定异常 → **fail-closed**。

## 同一个门禁

和 DSH 共用 `lib/service.js` 的策略引擎、同一份状态文件（`D:\.agents\门禁-授权.json`）与审计。
在 DSH 面板把 `D:\Zcode` 设为「禁」，pi 读同一目录同样被拦——**一处配置，两个 harness 生效**。

## 边界

- 只挂 `tool_call`；`input` / `before_agent_start` 等事件不参与判定。
- 名单外放行是刻意设计：门禁只管"你圈出来的隔离区"，不假装接管整个文件系统。
- 需要 Node 可执行（pi 本身依赖 Node，通常满足）。

## 真机验证（2026-10-26，pi 1.4.0）

- ✅ 扩展放在 **`~/.pi/agent/extensions/isolation-gate.js`** 时被 pi 真实加载（启动零扩展错误）。
- ✅ 返回形状 `{ block: true, reason }` 与安装版 `dist/core/extensions/types.d.ts` 的 `ToolCallEventResult` 一致（`block?: boolean; reason?: string; terminate?: boolean`）。
- ⚠️ 真机暴露并已修的 2 个 bug：**目录写错**（`~/.pi/extensions` → `~/.pi/agent/extensions`）；**静态 re-export 失败**（`export … from "file:///D:/…"` 被 pi 加载器吃成 `d:` 协议 → 改 `pathToFileURL` 动态 import）。
- ⚠️ 未跑完整模型循环：本机无模型凭据（pi 在选模型阶段即退出），"AI 发起读取 → 被拦"仍需登录后跑一次。
