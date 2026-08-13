# `@deepseek-ai/dsh`

[English](README.md) | 中文

`dsh` 命令是 profile 的产品启动器：profile 是按序叠放的插件组合包 patch 层，之上再叠加用户自己的覆盖层。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh run [--profile <name>] [--patch <path>...] "task"` | 直接在 core 上运行一个新的持久化会话，打印最终答案并退出；profile 默认为 `headless`，且不挂载 Web server。 |
| `dsh web` | `--profile web` 的别名，附带 Web flag 系列（`--host`、`--port`、`--dev` 等）。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |

调用目录是默认 workspace 根目录。`dsh run` 要求任务文本非空白，且所选 profile 必须挂载 `headless-runner` 行；`--profile` 保留对自定义一次性 profile 的支持。`web` 和 `headless` profile 在首次使用时会从随附模板自动初始化；其他任何 profile 都必须通过 `dsh plugin` 创建。

## Profile

profile 目录包含一个 `package.json`（树外插件依赖，加上 profile manifest（元数据清单）`dsh.profile` 及其有序的 `bundles` 列表）和一个 `cordis.patch.yml`（用户自己的 patch 层，在长期运行的 surface 上热重载）。配置树在空根之上组合：先按 `dsh.profile.bundles` 顺序应用各组合包的 patch，然后是 profile 的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`，然后是 `--patch` overlay，最后是 flag patch。`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`），再从 profile 自己的 `node_modules` 解析；pnpm 把树外插件安装在后者。使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。

[CLI（命令行界面）行为参考](reference/README.md)负责确切的层优先级、flag、关闭行为、部署默认值和源码启动器。

## 开发

生产运行需要已构建的包与前端产物。在 checkout 中，`pnpm run dsh` 会运行 TypeScript 入口并转发参数；[源码启动器参考](reference/README.md#source-launcher)说明 PATH 符号链接和模块解析约定。
