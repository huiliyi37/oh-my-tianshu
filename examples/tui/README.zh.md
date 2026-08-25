# tui

[English](README.md) | 中文

交互式终端 UI 组合：与 [headless-agent](../headless-agent/) 共用同一 agent 主干——真实 DeepSeek 适配器、预创建的一个 `main` agent，以及 `@huiliyi37/dsh-tui` bundle 的 `tui-runner` 插件。TUI 通过只读的 `adapter/transcript` 投影渲染会话日志；会话日志始终是权威事实源。

## 运行

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
pnpm exec tsx ../headless-agent/tests/fixtures/headless-driver.ts ./cordis.yml "say hello"
```

`tui-runner` 插件在该组合 boot 时挂载。上面的 headless driver 让一个任务跑过真实模型，把每条规范 `session/event` 喂进 transcript 投影——与 TUI 相同的读取路径——并在退出前打印派生视图与最终助手文本。交互式终端会话请从 TTY boot 该组合；渲染核心接管 stdin/stdout。

## 组合

- `settings` — 用户设置文档
- `credentials` — 从进程环境解析 `DEEPSEEK_API_KEY`
- `llm-deepseek` — DeepSeek 适配器（全思考、最大 effort）
- `agent-spine` — 预创建一个 `main` agent
- `fs-snapshot` — 写前文件快照，支撑 `/rewind` 的文件回退
- `spark-anchors` — 与 `deepseek-spark` wire 截断成对的排除路径锚点回注
- `tui-runner` — `@huiliyi37/dsh-tui` bundle 的交互渲染核心

## keyless 快照

组合本身不含 key。既有 transcript 冒烟经 `emptyTranscript` / `applyTranscriptEvent` 折叠规范会话事件，并把得到的面向 TUI 的对话视图写入 `.rivet/scratch/`（见 [`tests/transcript-smoke.e2e.ts`](tests/transcript-smoke.e2e.ts)）。

[`tests/welcome.snapshot.ts`](tests/welcome.snapshot.ts) 中的结算欢迎快照经 Loader 用 [`tests/fixtures/welcome-driver.ts`](tests/fixtures/welcome-driver.ts) 拉起本示例真实 `cordis.yml`，经 `node-pty` 以 100×40 驱动 TUI，用 xterm 解析终端，只与 [`tests/snapshots/welcome/terminal.expected.txt`](tests/snapshots/welcome/terminal.expected.txt) 比对结算后的欢迎区。harness 隔离 `HOME`、Harness 根目录与子进程环境变量；其 loopback 请求哨兵在捕获、退出与清理前验证零次模型网络请求。

[`tests/interactive-smoke.snapshot.ts`](tests/interactive-smoke.snapshot.ts) 中的交互冒烟在 100×40 PTY 里拉起 [`tests/fixtures/interactive-smoke.cordis.yml`](tests/fixtures/interactive-smoke.cordis.yml)——本主干加约束性 bash 栈与审批缝，由 [`tests/fixtures/interactive-driver.ts`](tests/fixtures/interactive-driver.ts) 驱动——回环 `dsh-llm-mock-server` 顶替模型。它驱动真实审批卡（bash 沙箱升级 → `y` 结算）、工具结果、`/rewind` 的列表 → 粒度 → 完成 三段、一次 `/theme` 切换与 Ctrl+Q 干净退出，外加审批挂起时 Ctrl+Q 的拆卸用例，以及 `p` 结算用例——验证落盘的精确匹配规则让下一次相同调用免于再询问。标记只对解析后的终端缓冲匹配；共享会话助手在 [`tests/helpers/pty-harness.ts`](tests/helpers/pty-harness.ts)。

`resolveExampleLaunch` 覆盖两个启动平面：source 模式经 `tsx` 与 workspace path 映射运行 TypeScript driver；`DSH_EXAMPLE_MODE=lib` 在普通 Node 下运行，使裸包导入经已构建的 `lib/` exports 解析。只有结算后的仅追加中档面进入 golden。
