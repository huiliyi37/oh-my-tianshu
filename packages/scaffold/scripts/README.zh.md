# `@deepseek-ai/dsh-scripts`

[English](README.md) | 中文

`dsh-sdk` 启动器负责 SDK 项目启动与配置。

| 命令 | 行为 |
|---|---|
| `dsh-sdk start [target] [-- args…]` | 导入模块目标并调用 `main(bootContext)`；省略目标时启动 `cordis.yml`；`--` 后的参数原样转发 |
| `dsh-sdk dev [target] [-- args…]` | 注册 TypeScript 与本地工作区源代码解析，然后进入 start 路径 |
| `dsh-sdk build [args…]` | 使用项目参数调用项目已安装的 tsdown |
| `dsh-sdk config` | 打开一个交互式编辑会话，审阅累计变更，统一提交一次；NPM 依赖变化时只安装一次 |
| `dsh-sdk create <source>` | 从包管理器原生支持的来源（`pkg@version` 或 `github:owner/repo#ref`）添加外部 Cordis 插件：确认后执行 `<pm> add <source>`，再将解析出的依赖挂载到 `cordis.yml`。不使用 giget／pacote；由包管理器解析并固定来源（GitHub 依赖会在管理器策略下通过自身 `prepare` 构建） |

`ProjectBuild(tsdownConfig)` 与 `PluginBuild(tsdownConfig)` 只从 `@deepseek-ai/dsh-scripts/dev/tsdown-config` 导出。开发环境与生产环境读取同一个 `cordis.yml`。

生成项目的脚本通过 `dsh-sdk` 执行 dev、build、start 和 config；类型检查直接运行 `tsc -b`。HMR（热模块替换）始终是显式的 `cordis.yml` 功能，并由 dev 与 start 同时加载。

运行时库导出 `startSDK(source)`，用于加载 `.env` 和 `cordis.yml` 并返回活跃上下文；还导出 `runSDK(target)`，用于导入项目模块并调用其 `main(bootContext)`（不带目标的 `runSDK()` 会委派给 `startSDK('./cordis.yml')`）。`SdkBootContext` 携带原样转发的 `argv`、通用 `args`、启动器的绝对 `cwd`，以及 `start`／`dev` 模式。启动器不声明项目选项：Node `parseArgs()` 使用空 schema 运行，因此带值的标志写作 `--key=value`，裸标志变为布尔值，`--no-cache` 变为 `args.cache = false`，选项名称保留 Node 的拼写（`--max-depth=3` → `args['max-depth']`）。

`start` 绝不构建。`dev` 注册项目已安装的 tsx 转换，并建立从 `plugins/*/package.json` 中的精确包名到各自 `src/index.ts` 的映射，然后沿用相同的 start 路径。`build` 调用项目已安装的 tsdown 并转发其参数；缺少 tsdown 配置时视为成功且不执行操作。

`config` 要求 TTY。一个功能树用于选择期望的启用集合；变更行会高亮，Right 用于修改取值有限的功能选项，必需行无法取消选择，不一致行会显示诊断，自定义／手动 Cordis 配置项支持启用／禁用。工作流会在一个编辑会话中将配置协调至该目标状态。Review & Apply 只提交一次；之后，如果 NPM 依赖有变更，则触发一次包管理器安装。安装失败不会撤销已提交文件。

根库导出 `startSDK`、`runSDK` 以及 `SdkBootArgs`／`SdkBootContext` 类型；命令组合仍是 bin 的私有实现。不导出 `src/*`、bin 或 package-manifest 子路径。

## 模型体验

通过项目 `cordis.yml` 树间接提供；该树由 `start` 或 `dev` 加载。

#### KV Cache 影响

不会直接导致 KV Cache 失效；由具名消费方负责请求前缀变更。

## 已知限制与暂缓事项

- **启动器参数没有 schema**：`start` 和 `dev` 会保留 Node `parseArgs()` 输出，而不会验证项目专用标志。
