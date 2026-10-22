# 参与贡献 · Contributing

谢谢你看上这个项目。它是给 **DeepSeek Harness（DSH）** 用的插件，代码量不大，改动门槛不高。

## 先聊再写

- **Bug / 想法**：先开 [Issue](https://github.com/huanlin-labs/dsh-isolation-gate/issues)，把「你期望什么、实际发生什么、怎么复现」写清楚。
- **要改行为 / 加配置项**：先在 Issue 里说一句，避免白写。
- **只改错别字 / 注释**：直接提 PR，不用先问。

## 本地开发

```bash
git clone https://github.com/huanlin-labs/dsh-isolation-gate.git
cd dsh-isolation-gate
node --version        # 需要 >= 20.11
npm test              # 4 个套件，325 条断言，无外部依赖
```

单跑某个套件：

```bash
node test/run-data-layer.mjs
node test/run-channel.mjs
node test/run-routes.mjs
node test/run-client.mjs
```

> 测试**只在 Windows 上全绿**：数据层依赖盘符 / 路径语义（`D:\…`），这是产品的真实使用环境。
> CI 里 Linux 只跑 `node --check`，功能自测跑 `windows-latest`。

## 改代码的几条硬规矩

1. **插件是 ESM**，不要 `require()`。
2. **不声明 `@deepseek-ai/dsh*` peer** —— 版本一升就被判不兼容（见 README「兼容性」）。
3. **不探测未声明的 `ctx` 服务**（`ctx.tools` 之类必须先 `inject`）。
4. 宿主半改动**要重启 dsh** 才生效；客户端半改动刷新页面即可。
5. **断言只增不减**：修 Bug 时补一条能复现它的断言。
6. **临时诊断代码用完即删**，不要留在正式分支。

## 提交信息

```
feat: 一句话说做了什么
fix: 修了什么
docs: 文档
test: 测试
ci: 工作流
```

## PR 检查单

- [ ] `npm test` 全绿（Windows）
- [ ] 新增行为有对应断言
- [ ] 没有把本机绝对路径 / 个人目录写进代码或测试
- [ ] 改了 `README` / `CHANGELOG`（有用户可见变化时）

## 授权

提交 PR 即表示你同意以 **MIT** 协议授权你的贡献。
