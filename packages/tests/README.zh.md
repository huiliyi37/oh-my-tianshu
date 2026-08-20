# tests/ — 测试运行器能力家族

[English](README.md) | 中文

该家族给模型一个专用测试运行面：`run_tests` 通过 `ctx.bash` seam 执行工作区检测到的测试框架并返回机器可读的通过/失败计数；`related_tests` 按文件名约定列出某个源文件附近的测试文件。两个工具只产生常规的 `tool/call`/`tool/result` 会话事件，因此 evidence-gate 无需新通道即可把 `run_tests` 运行归账为验证证据。

| 包 | 角色 | ctx key |
|---|---|---|
| [`tool-run-tests/`](tool-run-tests/README.md) | 面向模型的 `run_tests` + `related_tests` 工具 | 注册到 `ctx.tools` |

子 README 负责框架检测、摘要解析、发现约定与 evidence-gate 联动。
