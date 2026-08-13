# self-modification/：agent 修改自身运行时

[English](README.md) | 中文

agent 修改自身运行时：检查已加载的插件与服务接口、挂载模型编写的插件并再次 dispose，外加受限 repository Plugin 运行时。该组是未来自我修改类包的落点。设计居所：[工具集 Agent Note](../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)。

| 包（package） | 角色 | ctx 键 |
|---|---|---|
| [`tool-cordis/`](tool-cordis/README.md) | `cordis_inspect`／`cordis_mount`／`cordis_unmount` 工具：读取当前进程运行时，并在一个自有分组 fiber 下管理内存中的临时插件 | 注册到 `ctx.tools` |
| [`repository-plugin/`](repository-plugin/README.md) | 通过 DSH 自有子 Plugin 准备并挂载静态 repository skills 与通用 `.mcp.json` server | 注册一个 Loader builtin |
