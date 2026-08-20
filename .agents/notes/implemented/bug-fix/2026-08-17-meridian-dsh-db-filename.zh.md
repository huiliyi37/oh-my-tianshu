# Agent Note: dsh meridian 索引用 dsh-meridian.db，不用天枢 meridian.db

Status: implemented

[English](2026-08-17-meridian-dsh-db-filename.md) | 中文

## 问题

`tool-meridian` 把 `<codebase-index>` 动态 context 块注入每轮提示，渲染时打开索引 SQLite。`MeridianIndexer` 把该库落在 `<cwd>/.rivet/meridian.db`。同时跑天枢的工作区里这份文件已是 schema 2，且带着未裁剪的生态表（`physarum_*`、`immune_memory`、`cli_entries` 等）。本移植保持 6 表 schema 1，打开这份共用文件就会抛 `meridian database has schema version 2, incompatible with this build (1)`，抛错的 context 贡献在 TUI 里渲染成 `✗` 工具失败。删掉该文件能修好 dsh，但下次天枢运行会被破坏。

## 决策

dsh 的文件是同一状态目录下的 `dsh-meridian.db`（`MERIDIAN_DB_FILENAME`）。schema 1 与六表裁剪不变。同目录的天枢 `meridian.db` 不会被打开。`dsh-meridian.db` 版本不匹配时 `repo_graph` 仍 fails loud。`meridian:index` context 回调吞掉打开失败并在该回合不注入，派生索引不可用时不能让整轮提示失败。

## 备选方案

**把本构建升到 schema 2 并打开天枢的文件。** 否决：schema 2 是未裁剪的天枢布局；本移植丢掉了那些表，不得回写。

**版本不匹配时原地删除或重建 `meridian.db`。** 否决：会毁掉共享工作区里的天枢索引，随后天枢以 schema 1 vs 2 失败。

**继续共用文件名，让操作者自己删文件。** 否决：天枢下次写入后冲突回来，在那之前每轮 context 仍失败。

## 影响

在已有天枢 `.rivet/meridian.db` 的工作区里，omts 会创建 `.rivet/dsh-meridian.db`，`理解` 回合不再出现这条 schema `✗`。测试钉住与 schema 2 的 `meridian.db` 共存，以及该布局下 context 回调不抛。
