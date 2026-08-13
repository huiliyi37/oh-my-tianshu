# tui/ — interactive terminal UI

[English](README.md) | 中文

`tianshu --profile` 的终端 UI 层：bundle patch 在 dsh-base 之上插入 `tui-runner`，渲染核心为天枢（Tianshu）终端引擎的移植（逐文件溯源：[tui/SOURCE-MAP.md](tui/SOURCE-MAP.md)）。

| Package | Role | ctx key |
|---|---|---|
| [`tui/`](tui/README.md) | TUI 运行器 + 渲染引擎移植 | —（消费 sessions/agents/投影总线；注册 `userInteraction` provider） |
