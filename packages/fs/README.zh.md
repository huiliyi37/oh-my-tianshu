# fs/：文件系统能力族

[English](README.md) | 中文

文件系统栈包括：提供方约定（执行世界路径、有界文本 I/O 与带可选版本防护的原子变更）、本地实现、政策门禁插件（已观察状态、编辑前读取、版本防护的写入/编辑）、面向模型的文件工具与执行器，以及基于 bash 的发现工具。全部都是**产品** 包。

| 包 | 角色 | ctx 键 |
|---|---|---|
| `fs/` | Service Definition：规范化进程路径、文件 URI 与包含关系、文本 I/O 和原子变更原语；拥有 `fs/*` 政策事件 | `ctx.fs` |
| `fs-local/` | 本地文件系统 `FileSystem` 实现 | （注册 `ctx.fs`） |
| [`e2b/fs-e2b`](../e2b/fs-e2b/README.md) | 以 E2B 为后端的 `FileSystem` 实现，共享由 `ctx.e2b` 拥有的远程运行时 | （注册 `ctx.fs`） |
| `fs-sandbox/` | 强制沙箱的 `FileSystem`：扩展 `fs-local`，并按每次调用的模式与工作区根政策约束写入/编辑（只读模式拒绝，工作区写入模式限制在会话工作区与临时根目录内）；读取直接通过 | （注册 `ctx.fs`） |
| `fs-policy/` | 政策门禁插件：通过 `fs/*` 事件门禁提供已观察状态、编辑前读取和版本防护的写入/编辑 | （无服务，仅有 `fs/*` 监听器） |
| `tool-fs/` | 面向模型的 `read`/`write`/`edit` 工具以及执行器（通过 `ctx.fs` 读取，拥有读取窗口逻辑，分派 `fs/*`）；为会话 cwd 相对路径保留文件系统语义，并在已挂载的 `ctx.fs` 实施约束时声明沙箱升级字段 | （注册到 `ctx.tools`） |
| `tool-fs-search/` | 面向模型的 `glob`/`grep` 发现工具；当 `rg` 位于 bash 执行器 `PATH` 上时注册，通过 `ctx.bash` 运行固定 ripgrep 命令，而不是使用 `ctx.fs` 提供方方法 | （注册到 `ctx.tools`） |

Service Definition 位于 `fs/fs/`。沙箱化、远程或限定项目作用域的文件系统后端可以替换 `fs-local`，而无需更改 seam、政策门禁或面向模型的工具 schema：`fs-sandbox` 基于共享沙箱模式提供进程内路径围栏（[决策](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)），而 `fs-e2b` 则把文件状态置于与 E2B 进程管理提供方共享的远程执行世界中（[决策](../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.md)）。政策（`fs-policy/`）是一个只通过 `fs/*` 事件门禁参与的插件，不是工具注入的服务；因此移除它会平稳失去政策，留下不受约束的裸提供方，而不会破坏工具。加载 `tool-fs/` 的部署也应加载该插件。模式围栏与编辑前读取门禁彼此正交，可以组合。发现（`tool-fs-search/`）有意不扩展提供方约定：搜索是在 bash 执行器上运行 `rg`、由进程支持的工作流，因此文件系统后端无需承担通用搜索约定；只有当执行器能找到 `rg` 时，其工具才会注册。如果 bash 工作目录与 `read` 根目录是同一工作区，结果就能继续读取，这也是其 README 所述的共置部署。

## 文件 I/O 不设超时

`read`/`write`/`edit` **不** 接受 `timeoutMs`，提供方约定也不启动 deadline。这与 bash 和 web（两者使用 [`@deepseek-ai/dsh-timeout`](../util/timeout/README.md)）及基于 bash 的 `glob`/`grep` 不同（它们声明的 `timeoutMs` 由 `@deepseek-ai/dsh-timeout-policy` 强制执行）：这些工作由进程支持，deadline 可以实际终止工作。本地系统调用至多只能尽力中止：超时无法强制正在进行的 `fsync`/`rename` 停止，因此这里的 deadline 会成为无法兑现承诺的配置项。在此添加 deadline 还会在「显式优于隐式」明确禁止的地方引入隐式默认值。两个参考 agent（Claude Code、Codex）出于同一原因都不为文件 I/O 计时；取消仍通过工具执行信号传播，在系统调用边界尽力中止。

子系统参考——目标、结果、防护、策略事件、错误分类体系，以及文件 IO 为何不设超时——见 [docs/subsystems/filesystem.md](../../docs/subsystems/filesystem.md)；沙箱围栏见[跨家族 fs 沙箱 Agent Note](../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)。
