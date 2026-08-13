# tui

[English](README.md) | 中文

交互式终端 UI 组合：与 [headless-agent](../headless-agent/) 共用同一 agent 主干——真实
DeepSeek 适配器、预创建的一个 `main` agent，以及 `@huiliyi37/dsh-tui` bundle 的
`tui-runner` 插件。TUI 通过只读的 `adapter/transcript` 投影渲染会话日志；会话日志始终是
权威事实源。

## 运行

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
pnpm exec tsx ../headless-agent/tests/fixtures/headless-driver.ts ./cordis.yml "say hello"
```

`tui-runner` 插件在该组合 boot 时挂载。上面的 headless driver 让一个任务跑过真实模型，
把每条规范 `session/event` 喂进 transcript 投影——与 TUI 相同的读取路径——并在退出前打印
派生视图与最终助手文本。交互式终端会话请从 TTY boot 该组合；渲染核心接管 stdin/stdout。

## 组合

- `settings` — 用户设置文档
- `credentials` — 从进程环境解析 `DEEPSEEK_API_KEY`
- `llm-deepseek` — DeepSeek 适配器（全思考、最大 effort）
- `agent-spine` — 预创建一个 `main` agent
- `tui-runner` — `@huiliyi37/dsh-tui` bundle 的交互渲染核心

## keyless 快照

组合本身不含 key。transcript 投影通过折叠规范会话事件
（`emptyTranscript` / `applyTranscriptEvent`）派生面向 TUI 的对话视图；该视图的 keyless 快照由
真实模型冒烟写入 `.rivet/scratch/`（见 [`tests/transcript-smoke.e2e.ts`](tests/transcript-smoke.e2e.ts)）。
