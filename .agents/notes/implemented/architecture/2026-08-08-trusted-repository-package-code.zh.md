# Agent Note: 受信任 repository 包加载 Cordis 代码

状态：已实现

[English](2026-08-08-trusted-repository-package-code.md) | 中文

## 问题

独立 repository 格式已经会安装选定的 Git 包，并以宿主权限运行其依赖和生命周期代码，但它向 DSH 暴露的只有复制后的 skill（技能）和 MCP 元数据。禁止 Cordis 入口并未建立安全边界：包安装过程仍会执行受信任代码，而这项限制却阻止包贡献 Harness 架构本就用于组合的插件行为。

仓库作者还需要保持普通 TypeScript NPM 包的结构。如果要求发布到 NPM、把预生成的 JavaScript 签入 Git，或使用 DSH 自有的 TypeScript 编译器，Git 源的能力就会弱于通过开发者自有 SDK 项目安装的同一个包。首个模型请求必须看到该包启动的所有 MCP 工具；仅在后台进行初始发现，会让一次成功安装在应用边界上具有不确定性。

## 决策

已配置的 repository 包是受信任代码。其 `.dsh-plugin/package.json` 可以连同 `dsh.skills` 和 `dsh.mcpServers` 声明 `dsh.entry`，也可以用它取代二者；`dsh.entry` 是指向该包内已编译 ESM Cordis 插件的相对路径。至少需要一种贡献。入口可以使用 namespace 导出或 default export，并沿用 Cordis 对 `name`、`inject`、`Config`、注册、启动失败和 effect 作用域清理的常规语义。

包自行负责其 NPM 依赖和构建工具链。它声明已发布的 `@deepseek-ai/dsh-repository-plugin` 包以取得 `dsh-plugin-prepare` 可执行文件。`scripts.prepack` 是由包作者编写的非空命令，必须调用该依赖提供的辅助程序，但可以先运行 `tsc`、`tsdown` 或其他任意构建。DSH 不会注入辅助程序，也不会解析该 shell 程序或编译 repository 源码。辅助程序会在前序构建之后校验元数据，要求已配置入口解析到 `.dsh-plugin` 内的文件，校验并复制已声明的静态资源，再写入已准备的 `dsh-plugin.mjs` 包装层。已安装包必须保留包含该辅助命令的 `prepack` 声明；依赖、包装层或构建输出缺失会在缓存 generation 可用前导致失败。

生成的包装层先挂载 DSH 自有的静态运行时来处理 skill 和 MCP 定义，再动态导入显式入口、解包其导出并将其挂载为子级。包装层会静态声明已准备 manifest（元数据清单）所隐含的依赖；入口模块的额外 `inject` 只有在挂载时才会被发现，并且此时必须已存在于宿主组合中。两个子级都必须进入 Cordis `ACTIVE`；无法满足的 `inject` 或启动异常会拒绝 repository Loader 事务，而不会提交未激活的 generation。Loader 移除、替换失败和父级 dispose（资源释放）会一并撤销入口、skill 提供方、MCP client 及其 effect。

`dsh-mcp-client` 会在插件应用期间完成其初始连接和工具同步 promise。其入口必须是 `async function`，而不是返回 Promise 的普通函数：Cordis 会把带 prototype 的普通函数识别为 constructor，不会把 constructor 返回的 Promise 当作启动工作。因此，有效 server 的工具会在父级 repository 包装层激活前、一次性应用发起首个模型请求前就已存在。其 `failOnStartupError` 配置默认保留独立可选 server 的行为，同时允许 repository adapter 要求已声明 server 必须可用。Repository 转换出的 MCP client 会启用该模式，因此初始连接、发现或工具注册失败会拒绝候选 generation，回滚仍会关闭 transport。

## 信任边界

精确 ref、源路径包含约束、清除名称符合凭据模式的环境变量、已准备的 manifest 和不可变缓存键，可以保护身份与组合完整性；它们不会为可执行包输入提供沙箱隔离。Repository 生命周期脚本、传递性 NPM 依赖、已编译入口和 spawn 的 MCP server 可以行使 DSH 进程可用的权限，以及它们所获 Cordis 服务授予的权限。因此，用户必须信任所选仓库，应当固定不可变 ref，并只授予 Git 获取源码所需的最小只读凭据。

模型可见行为仍由所属 DSH seam 管理。repository 入口可以注册工具、提示词段落、策略、命令、agent（智能体）或其他 effect，但任何进入模型请求的内容仍须具有对应的 DSH 日志表示和生命周期清理。repository 格式授予代码加载能力；它不会削弱这些服务约定。

## 考虑过的替代方案

**继续禁止代码，但允许任意包生命周期。** 拒绝，因为安装过程本就执行受信任的 repository 代码，所以该限制没有提供隔离，反而迫使插件作者发布或维护第二条集成路径。

**由 DSH 编译 repository TypeScript。** 拒绝，因为编译器选择、模块布局、生成分片、原生依赖和包元数据属于 NPM 包。运行包所声明的构建，可以保持与其他 Git 依赖相同的边界。

**隐式导入 `main`、`exports` 或其他发现的入口。** 拒绝，因为 NPM 包可能包含并非 Cordis 插件的实用工具或 MCP 可执行文件。显式 `dsh.entry` 字段使代码激活可供评审，并让准备阶段校验打包后的路径。

**为未来每种 DSH 贡献添加封闭 manifest 字段。** 不采用它作为通用扩展机制。skill 和通用 MCP 文件仍保留有用的可移植静态适配器；DSH 原生行为则通过现有 Cordis 插件与服务约定组合。

## 后果

- TypeScript DSH 插件可以存放在 GitHub 仓库中，安装普通 NPM 依赖，在 `prepack` 期间完成编译，并在无需把插件包发布到 NPM 的情况下运行。
- 仅含静态贡献的 repository 包仍然有效，并保留无 import 包装层；添加 `dsh.entry` 会使该包选择启用运行时代码导入。
- 包构建、依赖安装、入口导入、所需服务未满足或插件启动失败，都会阻止候选 generation 替换最后一个可用配置。
- 初始 MCP 同步可能因 MCP SDK 的单次请求超时而延长应用启动时间；repository 声明的 server 不可用或无法发布完整工具 generation 时，该候选 generation 无法激活。
- Repository 代码获得宿主权限，因此源码评审和锁定不可变 ref 是运行安全要求，而不是可选加固措施。

## 测试

repository 格式测试通过真实 Loader 准备并挂载使用 default export 的代码入口，观察入口自有服务，移除 Loader 配置项，再观察清理；测试还保留针对 skill／MCP 准备、路径包含约束、包损坏、等待服务和回滚的覆盖。MCP 生命周期测试要求 `apply` 只在初始工具发布后完成，保留可选择启用的启动失败收束行为，并证明严格连接拒绝或工具注册拒绝仍会关闭 client。

Node 24 消费方验收使用实际构建的 `dsh run` 命令、全新 DSH 主目录，以及锁定到 PR（Pull Request）的精确 head SHA 且经过认证的私有 GitHub 源。测试会采用发布时相同的移除 `private` 字段和固定 workspace 依赖版本流程，对当前 repository 插件构建进行打包；再由作业本地 NPM 注册表提供其 `packument` 与 tarball，并把 Git 包的常规 scoped NPM 解析指向该注册表。该 repository 包从模拟发布的依赖取得 `dsh-plugin-prepare`，安装其他固定版本的运行时依赖与开发依赖，在 `prepack` 期间对 TypeScript 进行类型检查和打包，准备一个 skill、一个 stdio MCP server 及 `dsh.entry`，在首个真实模型请求中暴露 skill 与 MCP schema，执行 MCP 工具，并让已编译 Cordis 入口向结果追加第二个标记，供后续请求观察。注册表与缓存断言要求 NPM 解析必须命中模拟发布，打包安装中不存在源码文件，同时必须存在两个已构建模块、其已安装依赖、复制资源和生成包装层。
