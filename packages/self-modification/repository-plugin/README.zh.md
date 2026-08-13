# @deepseek-ai/dsh-repository-plugin

[English](README.md) | 中文

这是 DeepSeek Harness 的受信任 repository 包格式。`.dsh-plugin` NPM 包可以贡献已编译的 Cordis／DSH 插件入口、skill（技能）根和通用 `.mcp.json`；其常规 `prepack` 生命周期负责安装依赖并编译源码，随后 DSH 准备辅助程序校验输出并生成 Loader 包装层。静态贡献由 [`dsh-skill-local`](../../skill/skill-local/README.md) 与 [`dsh-mcp-client`](../../mcp/mcp-client/README.md) 组合。设计依据见[受信任 repository 包代码](../../../.agents/notes/implemented/architecture/2026-08-08-trusted-repository-package-code.md)和[静态贡献子格式](../../../.agents/notes/implemented/architecture/2026-07-30-static-repository-plugin-format.md)。

## 创作格式

在仓库的 `.dsh-plugin` 目录中放置一个普通包：

```json
{
  "name": "humanize-dsh-plugin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "prepack": "npm run build && dsh-plugin-prepare"
  },
  "dsh": {
    "entry": "./lib/plugin.js",
    "skills": ["../skills"],
    "mcpServers": "../.mcp.json"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.29.0"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-repository-plugin": "^0.0.1",
    "typescript": "6.0.3"
  }
}
```

`scripts.prepack` 必须非空并调用 `dsh-plugin-prepare`；可以先运行任意包自有的构建步骤。包将 `@deepseek-ai/dsh-repository-plugin` 声明为普通开发依赖，使该生命周期可以使用其已发布的可执行文件。DSH 不会注入辅助程序：repository 包自行声明并运行编译器、运行时依赖、准备辅助程序及其他 NPM 生命周期代码。所选包按自身 manifest 独立安装，而不继承外层 pnpm workspace，因此必须声明所需的每项依赖，不能依赖仅由 workspace 提升而可见的包。DSH 不转译 TypeScript，也不推断包入口。

`dsh.entry` 是指向 `.dsh-plugin` 内已编译 ESM Cordis 插件的可选相对路径。该模块可以使用 namespace 导出或 default export，并自行拥有常规的 `name`、`inject`、`Config`、注册和 effect。`dsh.skills` 是可选的本地 skill 根数组，`dsh.mcpServers` 是指向一个 `.mcp.json` 的可选路径；三个字段中至少声明一个。skill 和 MCP 路径可以引用相邻的 repository 资源，但必须留在包含 `.dsh-plugin` 的目录下；已编译入口必须留在由包管理器选中并打包的包内。一个仓库可以在不同的可选择子目录下放置多个各自独立的 `.dsh-plugin` 包。

repository 包及其运行的每项依赖或生命周期脚本都是受信任代码，与用户直接选择的 NPM 包相同。本格式不是沙箱：只有在你信任仓库代码并愿意允许其访问宿主进程、文件系统、网络及其通过 Cordis 声明的服务时才应安装。精确 ref 和不可变缓存提供身份与可复现性，而非隔离。

## 独立应用配置

随附的 `dsh-base` 组合包是每个 profile 的起点，其中包含一个空 `repository-plugins` 配置项。用户可在用户 patch 层中替换该配置项的配置来启用精确指定的 GitHub generation：写入 `$DSH_HOME/profiles/<name>/cordis.patch.yml`，或写入各 profile 共享的 home 级 `$DSH_HOME/cordis.patch.yml`；`--patch` overlay 则只为单次运行 patch 同一配置项：

```yaml
- id: repository-plugins
  name: '@deepseek-ai/dsh-repository-plugin'
  config:
    repositories:
      - 'github:PolyArch/humanize#<commit>'
      - 'github:owner/repository#<ref>&path:/plugins/one/.dsh-plugin'
```

每个源都必须采用 `github:owner/repository#<ref>`。省略 `&path:` 时选择 `/.dsh-plugin`；显式路径是仓库内的绝对路径，并且必须以 `.dsh-plugin` 结尾。commit ref 提供最清晰的不可变身份；tag 和 branch 仍可作为精确配置值使用。`cacheDir` 可覆盖默认缓存根 `$DSH_HOME/cache/repository-plugins`。

Git 传输使用宿主的常规 Git 认证。公共仓库无需凭据；私有源需要可读取所选仓库的只读凭据或 SSH agent。DSH 会在包生命周期运行前移除名称符合凭据模式的环境变量，因此请配置 Git 本身，例如使用 Git 凭据辅助工具或作业作用域的 Git 配置，而不要指望已导出的 token 变量跨越该边界。仓库生命周期代码受信任且可以调用 Git，因此请使用作用域最窄且仅限所选仓库的凭据。

长期运行的 surface 通过 Cordis HMR（热模块替换）监视两个 `cordis.patch.yml` 层。有效的源列表变更会安装并替换整套 repository Plugin generation；拉取、准备、导入或插件应用失败时，最后一个可用树保持运行，并广播 `hmr/config-update-failed(filename, error)`。一次性运行只在启动时读取这些层，`--patch` overlay 则从不被监视。相同的源字符串会永久复用其已准备缓存条目，因此必须改变 ref、路径或其他源配置，才能选择发生变化的代码。应用集成依据见[仅凭配置接入 repository Plugin 的 Agent Note](../../../.agents/notes/implemented/feature/2026-07-30-config-only-repository-plugins.md)。

## 准备阶段

安装精确指定的 Git 源时，DSH 随附的 pnpm 会按所选包自身的 manifest 安装。由事务持有的 `pnpm` 包装脚本会以 `--ignore-workspace` 重新调用同一份锁定的 pnpm，因此外层 workspace lockfile 无法抑制仅由所选 `.dsh-plugin` 包声明的依赖。必需的 `prepack` 生命周期在该依赖安装完成后、选定子目录打包前运行；其常规 `node_modules/.bin` 查找会从直接声明的 `@deepseek-ai/dsh-repository-plugin` 开发依赖中取得 `dsh-plugin-prepare`。该包把 Cordis／DSH 运行时对等依赖（peer dependency）标为可选，因此单独使用该可执行文件不会安装运行时依赖图。包自有命令可以在调用辅助程序前构建 TypeScript 或其他源码。辅助程序会校验 `package.json#dsh`，确认已编译入口是包内文件，校验 skill 与 MCP 源，把静态资源复制到 `dsh-plugin-assets`，并写入 `dsh-plugin.mjs`。导入该包装层前，DSH 会重新校验已安装包是否仍同时保留该直接开发依赖，以及包含该辅助命令的 `prepack` 声明。无法解析已发布的辅助程序，或安装依赖、构建或准备失败时，流程会在发布缓存 generation 前失败。设计依据见[基于 NPM 的 Git 源准备 Agent Note](../../../.agents/notes/implemented/bug-fix/2026-08-08-npm-backed-git-repository-plugin-preparation.md)。

## 运行时组合

加载本包会注册一个 effect-scoped Loader builtin。每个生成的包装层都把已准备的静态 manifest（元数据清单）委托给该 builtin，再在声明了 `dsh.entry` 时导入并挂载该入口。包装层只能静态门控已准备 manifest 所隐含的 `loader`、`skills` 与 `tools` 服务；入口自身的 `inject` 要到挂载该子级时才会发现。入口必须进入 `ACTIVE`，因此缺少入口专用服务或启动失败时，会拒绝 repository generation，而不会提交未激活的子级；Loader 移除或回滚时，所有 effect 都会消失。运行时同样会在挂载前校验每个声明的 skill 根都是包内实际存在的目录——生成输出因 `files`／`.npmignore` 被丢弃或在缓存中损坏的包会加载失败，而不是静默丢失贡献。Repository skill 根以唯一命名的 `dsh-skill-local` 提供方挂载，排除默认项目／用户根并禁用监视；缓存包 generation 是不可变的。

## 通用 MCP 格式

`.mcp.json` 根对象是 `{ "mcpServers": { ... } }`。stdio 条目只接受可选的 `type: "stdio"`、`command`、`args` 和 `env`；HTTP 条目只接受 `type: "http"`、`url` 和 `headers`。字符串值在插件加载时支持严格的 `${NAME}` 进程环境变量展开；缺失变量会使该次加载失败。HTTP URL 映射到现有 MCP client 的 `streamable-http` transport；stdio 条目以已准备的包目录作为 `cwd`。

未知字段会被拒绝，包括 OAuth 字段与 `auth` 对象。不提供 `CLAUDE_PLUGIN_ROOT` 展开或兼容层。完成格式转换后，现有 `dsh-mcp-client` 独占 transport 创建、连接诊断、工具同步、调用和断开生命周期。Repository 声明的 server 会启用其严格启动模式：插件激活会等待初始连接与工具同步，因此首个模型请求会看到已完整注册的初始工具 generation；网络、子进程、发现或注册失败则会拒绝候选 repository generation，而不是在缺少已声明工具的情况下静默激活。

## 导出形状

Namespace 插件：具名导出 `name`／`inject`／`apply`、准备阶段常量和 `prepareDshPlugin`，不提供 default export。本包还提供 `dsh-plugin-prepare` 可执行文件和 invariant companion。

## 模型体验

### Repository skill

#### 模型看到什么

通过 `dsh-tool-skill` 间接呈现：已准备且允许模型调用的 skill 会按其声明的名称和描述进入该消费方记录到日志的目录及所选指令正文表面。消费方的确切 schema 见生成的 [`skill` 工具目录](../../../docs/tool-catalog.md#deepseek-aidsh-tool-skill)。

#### Token 影响

有条件且随数据变化：每个可见的 repository skill 增加一行受限长度的目录项；加载一个 skill 会把其当前完整指令正文和资源基址指引加入保留的工具历史。

#### KV Cache 影响

稳定的已准备插件集合保持前缀稳定。添加、移除或替换 repository 插件可能使消费方追加替换目录，并影响后续请求前缀。

### Repository MCP 工具

#### 模型看到什么

通过 `dsh-mcp-client` 间接呈现：每个已连接 server 都贡献带 server 限定名的工具 schema；调用会保留该 client 的规范 MCP 结果和渲染。

#### Token 影响

取决于连接成功和远端工具列表；schema 会在当前工具视图中的请求上重复出现，而调用与结果会留在历史中直至压缩（compaction）。

#### KV Cache 影响

稳定的已连接工具列表保持前缀稳定。插件生命周期或 MCP 工具列表变化可能从首个受影响定义开始改变后续工具 schema 前缀。

### Repository 代码

#### 模型看到什么

取决于数据。受信任的 Cordis 入口可以通过其声明的服务和事件贡献任意可用的 DSH 行为，包括工具、提示词片段、策略、命令和转换。每项模型可见贡献仍受所属 DSH seam 的日志与生命周期约定约束。

#### Token 影响

由入口贡献的服务和注册决定；repository 格式本身不添加模型内容。

#### KV Cache 影响

稳定的注册会保留所属表面的正常前缀行为。加载、移除或替换精确的 repository generation，可能改变受该插件影响的任意前缀。

## 已知限制与暂缓事项

- **没有代码沙箱**：`dsh.entry`、NPM 依赖和包生命周期脚本以 DSH 宿主权限执行；必须信任该 repository。
- **入口专用服务依赖不会预先门控**：生成的包装层无法在导入入口模块前声明其 `inject`。除 skill 或 MCP 隐含的服务外，其他任何服务在包装层挂载入口时都必须已经存在，否则该 repository generation 会被拒绝。
- **没有 MCP 认证协议**：静态 header 可以使用环境变量展开，但带 OAuth 的定义会被拒绝，私有 server 登录流程不在此实现。
- **生成资源是不可变运行时输入**：repository cache generation 不受监视；必须改变 source、ref、path 或配置才能选择另一份已准备 generation。
