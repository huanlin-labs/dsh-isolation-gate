# 在 pi 里用门禁

> ⚠️ **验证状态**：本机没有安装 pi，**未做真机验证**。下面是按 pi 官方文档核对出的接入点，接线后请先做一次受管目录读取测试。

## 它拦在哪

pi 的 extension 系统有 `tool_call` 事件，文档对它的描述是 **"Authorize or modify a tool call"** —— 工具执行前触发，handler 可以拒绝这次调用。这就是完整的前置拦截点，和 DSH 的 `ctx.tools.guard` 同级。

事件表（摘自 `packages/coding-agent/docs/extensions.md`）：

| 阶段 | 事件 |
| --- | --- |
| 工具执行 | `tool_execution_start` → **`tool_call`** → `tool_execution_update` → `tool_result` → `tool_execution_end` |

## 接线方式（示意）

```ts
// ~/.pi/extensions/gate.ts（路径以你安装的 pi 版本为准）
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function gate(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    // 1) 取出本次调用涉及的路径（event.toolName / event.input）
    // 2) 调门禁 CLI 判定：node D:/插件/dsh-isolation-gate/bin/gate.mjs check <路径> <op>
    // 3) 拒绝时返回「阻止」结果（字段名以你这版 types.ts 的 ToolCallEventResult 为准）
    return { block: true, reason: "blocked by 门禁" };
  });
}
```

> `{ block: true, reason }` 这个形状来自社区实现（oh-my-pi 的 hook 文档）；**上游 `ToolCallEventResult` 的确切字段请以你安装版本的 `types.ts` 为准**，别照抄。

## 为什么 pi 值得做

和 DSH 一样，pi 的扩展跑在**进程内**、能拿到工具名与参数，所以「默认禁 + 人批放宽」这套不对称权限能原样成立，不需要退化成 advisory。

## 还没做的部分

- 适配器代码（`bin/gate-plugin-pi.mjs`）没写：没有真机就没法验证返回形状，写了也只是猜。
- 你装好 pi 后告诉我版本，我照着 `types.ts` 写适配器 + 单测 + 一次真机读取测试。
