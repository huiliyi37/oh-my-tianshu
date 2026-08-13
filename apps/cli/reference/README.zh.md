# `dsh` CLI（命令行界面）行为参考

[English](README.md) | 中文

本参考定义 profile、一次性运行、web 别名、插件管理和配置 dump 命令模式。参数由 [`src/args.ts`](../src/args.ts) 统一解析，[`src/bin.ts`](../src/bin.ts) 只动态导入选中的运行器。

## Profile 启动

`dsh --profile <name>` 启动位于 `$DSH_HOME/profiles/<name>` 的 profile。生效配置树在空根节点之上按以下顺序逐层组合：profile manifest（元数据清单）的 `dsh.profile.bundles` 列表所列的各个组合包 patch、profile 自身的 `cordis.patch.yml`、home 级的 `$DSH_HOME/cordis.patch.yml`（各 profile 共享的机器本地偏好，因此优先级高于逐 profile 的层）、按 argv 顺序的各个 `--patch <path>` overlay，以及启动器 flag patch。后应用的层按行胜出；patch 替换目标行完整的 `config` 值，而不是深度合并各键，并且可以插入新行。配置解析、schema 校验、模块解析或插件启动失败会得到报告并以非零状态退出。收到 SIGINT 或 SIGTERM 时，挂载的根节点会先 dispose（资源释放）再退出。

组合包名称先从 dsh 安装解析，再从 profile 目录解析。因此内置组合包（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`）总是来自与正在运行的 `dsh` 相同的安装；树外组合包来自 profile 由 pnpm 管理的 `node_modules`。任何 patch 行中的裸插件 `name` 通过 profile 目录的 Node 父目录逐级查找解析，该查找可达到持续维护的安装后备目录 `$DSH_HOME/profiles/node_modules`（安装的应用和组合包所依赖的每个包对应一个符号链接，每次启动时修复）。

`web` 和 `headless` profile 首次使用时会从随附模板自动初始化（`web`：base + web-app；`headless`：base + headless）。加载时，与安装所管理的 headless 元组（base + web-app + headless）完全一致的列表会规范化为随附模板；包含额外项、缺少项或调整过顺序的组合包列表由用户拥有，保持不变。其他缺失的 profile 会显式报错，并提示运行 `dsh plugin --profile <name> add <package>`。

Profile 启动不接受位置参数任务。因此，挂载了一次性运行器行（`headless-runner`）的 profile 会显式报错，并提示规范命令 `dsh run --profile <name> "<task>"`，而不会触发该行原始的必填字段错误。

可在不启动的情况下检查组合出的配置树：

```sh
dsh --profile web --dump-default-config
dsh --profile web --patch ./extra.yml --dump-config
```

`--dump-default-config` 只打印组合包各层；`--dump-config` 额外加上 profile 的 `cordis.patch.yml`、home 级的 `$DSH_HOME/cordis.patch.yml` 和 `--patch` overlay。两者都会打印注释，标明每行由哪个文件提供，以及哪些 overlay 修改过它；`!!js` 表达式保持未求值，找不到目标的 patch 会报告到 stderr。

## 一次性运行

`dsh run [--profile <name>] [--patch <path>...] <task...>` 会用空格拼接任务参数，拒绝缺失或空白任务，并让 `--profile` 默认为 `headless`。可重复使用的 `--patch` overlay 与 profile 启动的 overlay 位于同一层。所选的自定义 profile 必须挂载 `headless-runner`；否则启动器会在启动前失败，并在诊断中指明缺少该行。

启动器把任务文本 patch 进运行器行。Loader 结算后，运行器读取共享的 `ctx.agentDefaultModel` 默认值，通过 `ctx.agents` 创建一个全新的持久化 Agent（智能体），提交任务、等待完全停稳并对 Session 执行 flush，再从其持久化事件区间中推导最后一个非空 assistant 文本与最终 `turn/end` 原因。它在 stdout 打印文本，并在原因为 `completed` 时以 0 退出，否则以 1 退出。随附 headless profile 不挂载 ApiProxy、Host、HTTP 服务器、Web 运行时或浏览器客户端；成功运行不会向 stderr 写入任何内容，也不会打开监听端口。

## 插件管理

`dsh plugin --profile <name> <args...>` 在 profile 缺失时先初始化它（有随附模板的用模板，其他名称只装 `@deepseek-ai/dsh-base`），然后以 profile 目录为工作目录，把 `<args...>` 转发给 `pnpm`：`add`、`remove`、`why`、`update` 及其他所有 pnpm 子命令都照常可用；pnpm 必须在 PATH 上。相对路径 spec（`.`、`../plugin` 及其 `file:`/`link:` 形式）会先锚定到调用目录，因此在插件 checkout 中执行 `add .` 安装的是该 checkout，而不是 profile。每次成功运行后，`dsh.profile.bundles` 都会与已安装状态对齐：每个解析到 manifest 中声明了 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的包的依赖加入层栈（因此让包获得该声明的 `update` 会将其激活），没有组合包声明的依赖保持为普通依赖并给出一次性警告，已移除的依赖则退出层栈。

```sh
dsh plugin --profile tui add github:deepseek-harness/turtle-ui
dsh plugin --profile tui remove turtle-ui
dsh --profile tui
```

Git 托管、随附源码的插件在安装期间通过其 `prepare` 脚本构建，而 pnpm ≥10 在消费方允许之前会阻止该脚本：首次 `add` 会失败并给出 pnpm 的 `allowBuilds` 提示（以及 dsh 指向该 profile 的 `pnpm-workspace.yaml` 的指引）；把打印出的键复制到那里并重新运行即可。安装已构建的 tarball 或本地 checkout 不需要任何允许。

## Web 别名

`dsh web` 是 `--profile web` 的硬编码别名，并额外接受 Web flag 系列。`--host`、`--port`、`--workspace-root` 和可重复的 `--trusted-host` 值会成为作用在组合行之上的 patch；负责这些值的插件 schema 会在启动时验证它们。`--dev` 把 web-runtime 行切换到开发模式并插入客户端插件 HMR（热模块替换）接收器；若要无刷新更新客户端 bundle，还需单独运行 `pnpm run dev:web` watcher。

```sh
dsh web
dsh web --patch ./extra.cordis.yml
dsh web --dump-config
```

生产 Web 运行器需要已构建的包和前端产物（`pnpm run build`）。默认服务地址是 `http://127.0.0.1:3080`。绑定所有接口时，还会信任机器自动发现的 LAN IP 字面量；`--trusted-host` 可添加 `/api` 浏览器信任围栏接受的具名 authority。

进程关闭时会给插件树最多 5 秒完成 dispose。第一次 `SIGINT`/`SIGTERM` 启动该优雅排空；第二次信号强制立即退出。如果一次性运行正常结束时已经卡在 dispose 中，第一次 `Ctrl+C` 就会升格并立即退出，而不会被吞掉。

所有模式都将调用目录作为默认 workspace 根目录，以 65,536 字节渲染预算加载适用的 `AGENTS.md` 或 `CLAUDE.md` 指令，并使用内存 SQLite 会话内容索引。常驻 surface 监视两个 `cordis.patch.yml` 层（profile 与 home）的有效编辑并以事务方式重新应用；一次性运行只在启动时读取这些文件一次。

新会话默认使用 `workspace-write` 权限预设。Bash 和文件系统修改仅限于会话 workspace 与平台临时根目录；读取、网络访问和进程可见性不受限制。`DSH_PERMISSION_MODE` 更改进程后备值。General settings 中存储的权限影响后续 Web 会话，不改变已打开的会话。

`DSH_TOOLS_MODE` 为进程选择 `native`、`code` 或 `both`；其他值会导致启动失败。[`config/core-web.cordis.yml`](../config/core-web.cordis.yml) 是可选的 RL 兼容 `--patch` overlay：它固定使用 `native` 模式，仅将 `DSH_SYSTEM_PROMPT` 或 `You are a helpful software engineer assistant.` 渲染为系统提示词，禁用 Workspace 指令与所有 Web 运行时提示词贡献，并且在保留随附宿主、浏览器、workspace、持久化和权限组合的同时，仅暴露持久 `bash` 和 `str_replace_editor`。

`DSH_SYSTEM_PROMPT` 会传给系统提示词的 [`persona`](../../../packages/core/system-prompt/README.md#config)：完整的 `{{…}}` 分组遵循该约定的严格变量插值规则，且无法转义为字面花括号；任何已设置的值（包括空字符串）都具有权威性，因此空值会移除系统提示词，只有未设置该变量时才会选择后备值。

## 共享部署行为

基础组合包挂载原生 DeepSeek 适配器、settings 与凭据提供方、稳定的 `web_search`、repository Plugin 支持和会话遥测。提供方凭据依次从继承环境、`$DSH_HOME/.credentials.yaml`、调用目录的 `.env` 和 `$DSH_HOME/.env` 解析；受管文档从不物化进 `process.env`，而两个 `.env` 文件都是普通启动环境层。搜索使用 `DEEPSEEK_API_KEY` 并接受 `DEEPSEEK_SEARCH_BASE_URL`；只有 patch 层插入提供方并启用 `web_fetch` 后，该工具才可用。

会话事件默认作为 OTLP/HTTP 日志流式发送。`DSH_TELEMETRY_OTLP_URL` 选择其他 collector。任何非空 `DSH_TELEMETRY_DISABLED` 都会在启动前禁用遥测配置行。随附基础配置没有遥测脱敏规则，因此导出的记录可能包含消息文本、工具参数与结果以及 workspace 路径；该部署决策由[遥测 Agent Note](../../../.agents/notes/implemented/feature/2026-07-31-web-telemetry-default-mount.md)负责。

空 `repository-plugins` 行让 profile 的 patch 层能够挂载已准备的不可变 repository Plugin generation。参见 [repository Plugin 约定](../../../packages/self-modification/repository-plugin/README.md#standalone-app-configuration)。CLI 还随附 `@deepseek-ai/dsh-mcp-client` 作为供 patch 层使用的依赖，但默认不启用 MCP 服务器，因为每条服务器命令都是 agent（智能体）沙箱之外的受信任可执行代码。

## 源码启动器

把源码运行启动器链接到 PATH：

```sh
ln -sf "$(pwd)/bin/dsh" ~/.local/bin/dsh
```

它通过 real path 解析 checkout，并使用 `node --import tsx/esm` 启动 `apps/cli/src/bin.ts`。`TSX_TSCONFIG_PATH` 固定到 checkout 根目录，因此 workspace 包解析不依赖调用目录。`pnpm run dsh` 使用同一入口并转发参数。运行 `pnpm run build` 后，构建形式为 `apps/cli/lib/bin.js`。
