# Agent Note: 静态 repository Plugin 格式

状态：已实现

[English](2026-07-30-static-repository-plugin-format.md) | 中文

## 问题

一个已经包含可复用 skills 或 MCP server 声明的仓库，应当能被独立 Harness 应用使用，而不必先变成 Harness SDK 项目，也不应被迫改写现有布局。常见仓库只需新增一个 `.dsh-plugin` 目录，同时仍可把原有 skills 与 `.mcp.json` 放在仓库其他位置。当同一个受信任包还携带原生 Cordis 代码时，这些可移植静态贡献仍需复用现有的 skill 与 MCP 生命周期所有者。

[Package-manager-native repository cache](2026-07-30-package-manager-native-repository-cache.md) 会准备一个精确 package source，但有意不了解任何 DSH 格式。因此本层需要一种兼容 package manager 的创作格式、确定性的已准备产物，以及在 Loader dispose 和替换期间仍保持事务性的 Cordis 组合。

## 决策

`@deepseek-ai/dsh-repository-plugin` 负责 `.dsh-plugin` 包内的静态贡献子格式：skill 根和一个通用 `.mcp.json`。其包元数据使用 `package.json#dsh.skills` 声明相对 skill 根路径，使用 `package.json#dsh.mcpServers` 声明相对 MCP 文档路径。每条路径都可以离开 `.dsh-plugin` 以复用仓库内容，但必须留在包含该 `.dsh-plugin` 的目录之下；因此，一个嵌套且可选择的插件可以拥有其包上方相邻的子树，却不能访问无关宿主路径。该包还可以声明由[受信任 repository 包决策](2026-08-08-trusted-repository-package-code.md)负责的显式代码入口，并且至少需要一种代码或静态贡献。

`.dsh-plugin` 包将已发布的 `@deepseek-ai/dsh-repository-plugin` 包声明为开发依赖，并声明非空 `scripts.prepack` 来调用其 `dsh-plugin-prepare` 可执行文件。在 Git 安装期间，pnpm 会按所选包自身的 manifest（元数据清单）安装该依赖；`prepack` 会在依赖安装后、pnpm 打包选定子目录前运行，即使插件嵌套在另一个包管理器工作区内也不例外。包可以先构建其代码。该辅助程序会校验元数据与源码类型，严格解析 `.mcp.json`，把静态资源复制到 `dsh-plugin-assets`，并写入 `dsh-plugin.mjs`；源码 loader 会在导入该包装层前重新校验已安装包的生命周期元数据是否包含辅助命令。仅含静态贡献的包仍会获得无 import 包装层，其中包含规范化 manifest、由服务派生的 `inject` 列表，以及对 `dsh-repository-plugin` Loader builtin 的委托。依赖与 workspace 隔离的设计依据见[Git 源准备修复](../bug-fix/2026-08-08-npm-backed-git-repository-plugin-preparation.md)。

加载 DSH package 会以 effect 方式注册该 builtin。生成的包装模块使用 `import.meta.url` 把 builtin 挂载为自己的子级，因此所有贡献都归属于包装 fiber，并在 Loader 移除或回滚时消失。Builtin 会在读取资源前重新校验已准备 manifest 与路径包含关系。它只组合现有实现，而不自行注册 skills 或 MCP 工具。

每份已准备 skill 集合都会挂载 `dsh-skill-local`，使用唯一的 `repository:<package-name>` 提供方名称、仅包含复制后的自定义根，并禁用监视。因此 `dsh-skill-local` 新增两个通用配置字段：`providerName` 和 `includeDefaultRoots`。默认值保持原有单一本地提供方行为；repository 实例设置不同名称并排除项目／用户根，使多个实例既不冲突，也不会重复宿主本地发现。

`.mcp.json` 中的每个 server 都变成一个现有 `dsh-mcp-client` 子级。适配层接受通用根对象 `{ "mcpServers": ... }`；stdio 定义只允许可选的 `type: "stdio"`、`command`、`args` 与 `env`，HTTP 定义只允许 `type: "http"`、`url` 与 `headers`。严格的 `${NAME}` 进程环境变量引用在运行时、cache 准备之后展开；缺失变量会使 Plugin 加载失败。HTTP 映射到 client 的 Streamable HTTP transport，stdio 使用已准备 package 目录作为 `cwd`。只有现有 client 负责连接尝试、失败日志、远端工具同步、工具调用和断开。Repository 实例会启用严格启动，因此初始连接、发现或工具注册失败会拒绝 repository Loader generation；非严格的独立 client 则保留“记录日志、Plugin 成功但不注册工具”的行为。

未知 MCP 字段会被拒绝。这里有意排除 OAuth、`auth` 对象、`CLAUDE_PLUGIN_ROOT` 和更广泛的 Claude 兼容约定。命令、hook、agent（智能体）、规则和其他外来 manifest 约定不会从静态 repository 布局中推断出来；DSH 原生行为使用显式的受信任 Cordis 入口。Repository 子目录选择与 GitHub 源配置属于[独立应用集成](../feature/2026-07-30-config-only-repository-plugins.md)，而不是本静态适配器。

## 考虑过的替代方案

**从 `main`、`exports` 或 repository 布局中发现入口。** 拒绝，因为静态资源并不表示包的普通入口就是 Cordis 插件。受信任代码通过 `dsh.entry` 显式加载，不属于该静态适配器的职责。

**让生成包装模块直接实现 skills 和 MCP。** 拒绝，因为复制的运行时代码会与 `dsh-skill-local` 和 `dsh-mcp-client` 漂移，尤其是提供方失效、工具同步、失败和 teardown 约定。

**让每个生成包装模块 import Harness package。** 拒绝，因为 repository package 不应解析或锁定应用的内部依赖图。Loader builtin 提供一份由 app 所有的实现，并让生成包装模块保持无 import。

**监视已准备 repository 资源。** 拒绝，因为一个精确 repository cache generation 是不可变的。Ref、子目录或配置变化会选择新 generation；第二套 watcher 会创造一套没有所有者的刷新身份。

**把每次 MCP 连接失败都当作 Loader 更新失败。** 拒绝，因为可选的独立 MCP client 会有意收束启动失败，并且不暴露工具。MCP client 改为自行提供显式的严格启动选项，由 repository 适配器为其声明的 server 启用。

## 后果

- 现有 skill／MCP 仓库可以新增一个很小的 `.dsh-plugin/package.json`，无需移动资源或采用 SDK 项目。
- 已准备的静态输出是确定性胶水；可选的 `dsh.entry` 和已配置的 repository 生命周期仍是受信任的可执行包管理器输入，而非沙箱。
- 多个 repository Plugin 通过提供方名称和普通 MCP server-name 唯一性共存；重复名称经现有 registry 失败，并参与 Loader 回滚。
- Cache 内的源码编辑不会实时出现；必须选择另一个精确 source／ref／path／config。
- 新增可移植静态贡献类型必须提供显式格式和 DSH 自有运行时消费方；DSH 原生行为使用独立的显式代码入口。

## 测试

聚焦测试会准备 skill 与 MCP 元数据，证明仅含静态贡献的包装模块不含 import，拒绝 Work IQ 风格的 OAuth 字段，映射 Expo 风格 HTTP 与 DataJunction 风格 stdio 及环境变量，并覆盖缺失变量。真实 Loader 测试通过已注册 builtin 挂载生成包装模块，经 `ctx.skills` 读取其 skill，移除 Loader 条目并观察提供方清理。CI 构建入口验收会使用锁定到 PR（Pull Request）head 的 GitHub 源调用 `dsh run`，并观察已复制的 skill，以及由取代本决策的新决策所负责的受信任代码与 MCP 验证证据。
