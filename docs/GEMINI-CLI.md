# 在 Gemini CLI 里用门禁

Gemini CLI 有 `BeforeTool` 钩子：工具执行前触发，hook 从 stdin 收到事件 JSON，可以用 `{"decision":"deny","reason":"…"}` 或退出码 2 阻断。门禁的 Gemini 适配器走 JSON 那条。

> ⚠️ **验证状态（诚实标注）**：适配器与单测（13 条断言）通过；**未在真机 Gemini CLI 会话验证**——本机没装 `gemini` CLI，也没有 Google 账号凭据。接好后请先做一次受管目录的读取测试。

## 安装

确认已安装 Gemini CLI（`gemini --version`）。然后在项目 `.gemini/settings.json` 或全局 `~/.gemini/settings.json` 里加：

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "read_file|read_many_files|list_directory|glob|search_file_content|write_file|replace|run_shell_command",
        "hooks": [
          {
            "type": "command",
            "command": "node D:/插件/dsh-isolation-gate/bin/gate-hook-gemini.mjs"
          }
        ]
      }
    ]
  }
}
```

（`command` 换成你自己的安装路径；npm 全局安装可用 `gate-hook-gemini` 这个 bin 名——见 `package.json`。）

## 判定口径

| Gemini 工具 | 门禁操作 |
| --- | --- |
| `read_file` `read_many_files` `list_directory` `glob` `search_file_content` | `read` |
| `write_file` `replace` | `write` |
| `run_shell_command` | `write`（扫命令行里的绝对路径） |

命中受管目标 → 输出 `{"decision":"deny","reason":"门禁拦截：…"}`；放行时不输出任何东西。

## 策略文件

| 用途 | 默认路径 | 环境变量 |
| --- | --- | --- |
| 级别状态 | `D:\.agents\门禁-授权.json` | `GATE_STATE_PATH` |
| 名单 | `D:\.agents\门禁-名单.txt` | `GATE_ROSTER_PATH` |
| 审计 | `D:\.agents\门禁-审计.jsonl` | `GATE_AUDIT_PATH` |

审计记 `channel: hook/gemini-cli`。

## 自测

```bash
node test/run-hook-gemini.mjs     # 13 条断言，不需要 Gemini CLI
```

真机自测：让模型读一个「禁」级别的受管目录 → 预期工具被拒并回一句门禁理由；再读普通目录 → 预期正常。

## 已知边界

- 只管 Gemini CLI 的工具调用；终端里手打命令不管。
- `run_shell_command` 靠命令行文本里的绝对路径判断，`cd` 后相对路径会漏判。
- 若 `matcher` 写错（工具名对不上），hook 不会触发，等于没装——改完先在 `gemini` 里跑一次受管读取确认。
