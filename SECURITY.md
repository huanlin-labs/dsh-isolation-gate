# 安全策略 · Security Policy

## 报告漏洞

**不要开公开 Issue。** 请用 GitHub 的私密通道：
[Report a vulnerability](https://github.com/huanlin-labs/dsh-isolation-gate/security/advisories/new)

或在 Issue 里只说「有安全问题，需要私聊」，我回你一个私密渠道。

请尽量带上：影响版本、复现步骤、你期望的判定 vs 实际判定、以及是否涉及受管目录的真实越权。

## 支持范围

| 版本 | 安全修复 |
|---|---|
| 最新 minor（当前 `0.2.x`） | ✅ |
| 更早版本 | ❌ 建议先升级 |

## 这个插件「负责什么 / 不负责什么」

它管的是 **DSH 内部**对受管对象的访问判定：

- ✅ 覆盖：DSH 工具调用（`read` / `write` / `edit` / `glob` / `grep` / `pwsh` / `ssh` 等）与 `bin/gate.mjs` 通道。
- ❌ 不覆盖：其他应用、其他 harness、已在运行的进程、以及绕过 DSH 直接操作文件系统。

**所以它是「减少误操作与越界」的护栏，不是操作系统级沙箱。** 需要强隔离请配 Windows ACL / 虚拟机。

## 设计上的 fail-closed

- 名单文件缺失 ⇒ **全部对象按 `deny`**，不报「放行」。
- 状态文件损坏 ⇒ 按全禁处理，且**不覆盖**坏文件（留证据）。
- 判定函数只有一处（`checkAccess`），UI / CLI / 工具门共用，不会出现两套口径。
