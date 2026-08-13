# self-modification/ — the agent modifies its own runtime

English | [中文](README.zh.md)

Model-facing tools over the live cordis runtime the agent itself runs inside: inspect the loaded plugins and service surface, mount model-written plugins, and dispose them again — plus the restricted repository Plugin runtime. The group is the landing zone for future self-modification packages. Design home: [the toolset Agent Note](../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md).

| Package | Role | ctx key |
|---|---|---|
| [`tool-cordis/`](tool-cordis/README.md) | Model-facing runtime inspection and temporary-plugin tools | registers on `ctx.tools` |
| [`repository-plugin/`](repository-plugin/README.md) | Repository skill and MCP composition | registers a Loader builtin |
