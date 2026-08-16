# 天枢 Harness(Tianshu)

[English](README.md) | 中文

天枢 Harness(`oh-my-tianshu`)是一款完全体开源 coding agent:在 agent harness 之上带视觉、跨会话记忆、验证门、agent 路由、语义 + 图谱代码检索、文件回滚和全屏终端 UI——全部以插件组合。

它是 [DeepSeek Harness](https://github.com/deepseek-ai)(`dsh`,MIT)的友好 fork,以 **Apache License 2.0** 发布;分叉点为 2026-08 基线;本线独立演进,不追踪上游。完整署名见 [NOTICE](NOTICE)。

它保留了上游**一切皆插件**的架构。

## 安装

要求:Node `^22.19 || >=24`,以及一个 DeepSeek API key(`DEEPSEEK_API_KEY`)。

已发布到 npm,一条命令直接运行:

```sh
npx @huiliyi37/oh-my-tianshu tui
```

或全局安装:

```sh
npm i -g @huiliyi37/oh-my-tianshu
oh-my-tianshu tui
```

npm 11 及以上默认拦截未显式放行的生命周期脚本(`allowScripts`)。原生依赖需要执行各自的脚本——`koffi` 需源码编译、`node-pty` 需构建 PTY 二进制、`@huiliyi37/dsh-subprocess-local` 需恢复 PTY spawn-helper 的可执行位、`@google/genai` / `protobufjs` 需生成运行时资源——因此全局安装时一并放行:

```sh
npm i -g --allow-scripts=koffi,node-pty,@huiliyi37/dsh-subprocess-local,@google/genai,protobufjs @huiliyi37/oh-my-tianshu
```

若 npm 仍警告列表中未覆盖的包,将其追加后重装;静默跳过的原生构建会在运行时以 `Cannot find module` 形式暴露。

#### Android(Termux)

在 Termux(或 `proot-distro` root)上 `process.platform` 为 `android`,`koffi` FFI 依赖没有 Android 预编译产物而需源码编译,其 CMake configure 需要 Termux 前缀——`proot-distro` root 可能未导出该变量。安装前先设置:

```sh
export PREFIX=/data/data/com.termux/files/usr
npm i -g @huiliyi37/oh-my-tianshu
```

**API key**:启动前导出,或写入用户环境文件一次(每次启动自动加载):

```sh
export DEEPSEEK_API_KEY=sk-…
echo 'DEEPSEEK_API_KEY=sk-…' >> ~/.dsh/.env
```

第一行管当前 shell;第二行持久化。

启动后看欢迎页环境行:`API Key ✓` 表示已就位;`API Key ✗` 表示未读到——设置后重启。退出用 `Ctrl+Q` 或 `/exit`。

如需开发(或修改 harness 本体),从仓库检出直接运行——要求系统已安装 `git`、Node `^22.19 || >=24` 与 `pnpm`:

```sh
git clone https://github.com/huiliyi37/oh-my-tianshu.git
cd oh-my-tianshu
pnpm install
pnpm run build
pnpm oh-my-tianshu tui
pnpm oh-my-tianshu web
```

`pnpm oh-my-tianshu tui` 从源码跑全屏终端 UI;`pnpm oh-my-tianshu web` 在 `http://127.0.0.1:3080` 起 Web UI。

## 完全体新增什么

在上游基线(文件、shell/PTY、技能、任务/目标/计划、subagent 与工作流、沙箱与审批、可恢复会话、LSP、Web 访问、上下文压缩、循环卫生 guard)之上,本 monorepo 附带差异化能力集:

| 能力 | 包 | 作用 |
|---|---|---|
| 视觉桥 | `@huiliyi37/dsh-vision-bridge` | text-only 主控也能读图:独立视觉模型描述图片附件,`agent/pre-step` 时注入描述。 |
| 视觉副驾 | `@huiliyi37/dsh-vision-ask` | 会话级图片登记簿 + `ask_image` 工具:主控可对任意留存图片反复重询,无需用户重发。 |
| 项目记忆 | `@huiliyi37/dsh-memory` | 跨会话召回(结构化 claim 与知识笔记上的 BM25 hybrid),写入带质量门;`/memory`、`/remember`。 |
| 验证门 | `@huiliyi37/dsh-evidence-gate` | bugfix 任务的 RED→GREEN 纪律:编辑以「先见失败」的验证归账为门。 |
| Agent 路由 | `@huiliyi37/dsh-agent-router` | 基础指标 → 路由算法 → MoE 式派发到原生 subagent。 |
| 信息素 | `@huiliyi37/dsh-pheromone` | 文件级 stigmergy:指数衰减信号(fragile / entry-point / …)构成的会话级空间记忆。 |
| 语义索引 | `@huiliyi37/dsh-semantic-index` | 工作区检索:定义对齐分块上的文件级 BM25(感知 CJK bigram),可选向量层 RRF 融合;支撑 `semantic_search`。 |
| Meridian | `@huiliyi37/dsh-meridian` | 代码图谱索引(tree-sitter → sqlite):repo map、影响分析、流查询、行为信号;支撑 `repo_graph`。 |
| 文件回滚 | `@huiliyi37/dsh-fs-snapshot` | 写工具触碰的每个文件先做写前快照,支撑 `/rewind` 的 code/both 粒度。 |
| Git 接缝 | `@huiliyi37/dsh-git` | 类型化 git 能力服务(`GitLocal` CLI provider、类型化 `GitError`),供工具与 UI 消费。 |
| 终端 UI | `@huiliyi37/dsh-tui` | 基于天枢(opencode-tui)渲染核的全屏 TUI——Apache-2.0 来源链原样保留。 |
| Spark 锚点 | `@huiliyi37/dsh-spark-anchors` | 与截断推理的 provider route 成对:回注被排除的路径,防止模型重复推导。 |

## 使用天枢

### Web UI

推荐在本地使用 Web UI;可从 npm 安装直接启动(`oh-my-tianshu web`),或从构建好的检出启动:

```sh
pnpm run build
pnpm oh-my-tianshu web
```

Web UI 默认通过 `http://127.0.0.1:3080` 提供服务。

### Profile

`oh-my-tianshu` 启动 profile:按序叠放的插件组合包 patch 层,之上再叠加你在 `$DSH_HOME/profiles/<name>` 中的自有覆盖层:

```sh
oh-my-tianshu --profile web                       # the browser UI (same as: oh-my-tianshu web)
oh-my-tianshu plugin --profile tui add <package>  # install a plugin into a custom profile
oh-my-tianshu --profile tui                       # boot it
```

profile 布局、层语义与配置输出命令详见 [CLI(命令行界面)约定](apps/cli/README.md#profiles)。

### 终端 UI

启动全屏终端界面:

```sh
oh-my-tianshu tui          # or: oh-my-tianshu --profile tui
```

TUI 是天枢(opencode-tui)渲染核心适配 harness 接缝的移植,界面对标 oh-my-pi:边框欢迎卡 + 渐变 logo、嵌入输入框顶边的段式状态栏、消息面整宽底色(用户气泡、按状态着色的工具块)、17 个主题(琥珀色 `omp` 为默认,`graphite` 等可经 `/theme` 切换)。输入 `/` 打开命令菜单——↑↓ 选择、Tab 接受、Enter 提交、Esc 关闭;随时按 `Ctrl+.` 查看键位表。

**Slash 命令**

| 命令 | 作用 |
|---|---|
| `/session` | 会话管理(列表 / 切换) |
| `/fork [directive]` | 分叉当前会话(复制历史)并切换;可带首条消息 |
| `/branch` | `/fork` 别名 |
| `/model [provider/model]` | 查看/切换模型(热切当前会话;`spark-flash` / `spark-pro` 别名一键切 DeepSeek Spark) |
| `/theme [name]` | 切换主题 |
| `/clear` | 清空当前会话滚动区 |
| `/compact` | 压缩当前会话上下文 |
| `/steer <text>` | 中轮转向(不中断地纠正方向) |
| `/status` | 状态面板(goal/todos/plan 投影 + 会话汇总段) |
| `/config` | 设置面板(settings / permission / credentials) |
| `/skills` | 技能浏览面板 |
| `/subagents` | 委派树面板 |
| `/workflow` | workflow 运行中面板 |
| `/tasks` | 任务窗格(后台任务) |
| `/goal` | 目标管理(创建 / 暂停 / 恢复 / 完成 / 阻塞) |
| `/memory` | 记忆浏览器(列表 / 过滤 / 删除 / 预览) |
| `/remember <text>` | 保存一条记忆 |
| `/rewind` | 两阶段回滚(消息列表 → 粒度) |
| `/btw <question>` | 向后台 agent 侧问 |
| `/doctor` | 终端诊断 + 修复指引 |
| `/mcp` | 列出已连接 MCP server 与工具 |
| `/export [path]` | 导出当前会话转录为 Markdown 文件 |
| `/density` | 切换紧凑工具卡渲染 |
| `/permission` | 切换权限预设(workspace-write / danger-full-access) |

**快捷键**

| 按键 | 作用 |
|---|---|
| `Ctrl+N` | 新会话 |
| `Ctrl+S` | 恢复最近会话 |
| `Ctrl+Q` | 退出 |
| `Ctrl+P` | 命令面板 |
| `Ctrl+.` | 键位表 overlay |
| `Ctrl+F` | 历史搜索(n/N 跳转) |
| `Ctrl+O` | 用 `$EDITOR` 打开输入行 |
| `Ctrl+T` | 中轮转向 |
| `Ctrl+V` | 粘贴系统剪贴板图片(剪贴板无图时 fallback 剪贴板文本) |
| `Alt+W` | 把选区复制到系统剪贴板(OSC52) |
| `Shift+Tab` | 模式循环:normal → plan → always-approve |
| `Tab` | `@`-路径补全;接受 slash 菜单选中项 |
| `↑/↓` | 输入历史(slash 菜单打开时为选择) |
| `PageUp/PageDown` | slash 菜单翻页 |
| `Esc` | 关闭 slash 菜单或 overlay |

**交互**

工具审批以内联 `⚠ 允许执行 …？[y/N]` 提示,上方附统一 diff 预览。subagent 运行以 live 区 spinner 行呈现,完成落为 ✓/✗/◌ scrollback 条目。底部三行:输入行(底边线随模式着色)、footer(模式徽标 + 快捷键提示)、metrics 行(模型 / token 用量 / 缓存命中率)。

**图片粘贴与终端预览**

`Ctrl+V`(或右键/终端菜单粘贴)读系统剪贴板图片——macOS `osascript`、Linux `wl-paste`/`xclip`、Windows PowerShell——并附图;粘贴内容像图片路径时改为加载该文件为附件。附件以 `📎 N images` 标记显示在输入行上方,提交后在用户气泡下方以终端内联图形渲染(kitty / iTerm2 协议)。气泡携带识图提示:支持识图的主控直接看图;text-only 主控配置了识图桥时先经视觉模型转描述;两者皆无时 TUI 警告图片未发送(且不提交图片)。

**视觉桥(可选)**

`dsh-vision-bridge` 让 text-only 主控仍能读到用户图片:`agent/pre-step` 时经独立视觉模型描述图片附件,描述作为 plugin-source user message 注入(Model-visible ⟺ logged;桥失败降级为可见提示,绝不整轮 failed)。启用方式:把插件加入装配并配置支持识图的 provider/model:

```yaml
# cordis.yml
- id: vision-bridge
  name: '@huiliyi37/dsh-vision-bridge'
  config:
    provider: deepseek-official   # any registered llm route that can see images
    model: <vision-capable model>
```

并在 `tui-runner` 组合包配置里设置 TUI 的 `vision` 状态使气泡提示与桥一致:`supportsVision: false`、`bridgeEnabled: true`。

**视觉副驾(`ask_image`,可选)**

`dsh-vision-ask` 比视觉桥更进一步:用户附的每张图片都以短 id(`img_1`、…)登记进会话级登记簿,`ask_image` 工具让主控对任意留存图片反复重询——不同问题、不同角度——无需用户重发。多模态主控会拿回原图;text-only 主控得到视觉模型对图片的回答。配置见 [`packages/tui/vision-ask`](packages/tui/vision-ask/README.md)。

**DeepSeek Spark 模式**

`deepseek-spark` provider route 在 wire 层把 assistant 推理截断为尾部 N token 回传(flash 300 / pro 需显式开启),保持模型上下文精炼;`dsh-spark-anchors` 与之成对,把被截断丢失的排除路径重新注入,防止模型重复推导已排除的选项。一次性启用(settings 热加载,无需重启):

```yaml
# settings.yaml
llm-deepseek:
  spark:
    enabled: true
```

然后用 `/model spark-flash` 或 `/model spark-pro` 切换(`deepseek-spark/deepseek-v4-flash` / `deepseek-spark/deepseek-v4-pro` 的别名)。Spark 与 DeepSeek 共用同一 API key——零额外配置。`dsh-spark-anchors` 随 `tui` 组合包装配,切到 `deepseek-spark` route 后锚点补偿即生效;自装配 profile 需显式添加(见[包 README](packages/context/spark-anchors/README.md))。

### Headless

运行一项任务,打印最终答案后退出:

```sh
oh-my-tianshu run "summarize this workspace"
```

### 自动化与 SDK

在源码检出中通过环境变量或根目录 `.env` 设置 `DEEPSEEK_API_KEY`,然后启动 ACP(Agent Client Protocol)自动化服务器:

```sh
pnpm run demo:acp
```

[Python SDK](python/README.md) 驱动随附的 JSON-RPC 运行时。[示例](examples/README.md)涵盖可运行的 headless、ACP、JSON-RPC、Code Mode 和自指组合。

## 架构

- **一切皆插件。** 模型、工具、策略、存储、上下文管理和界面均为可组合的 [Cordis 插件](docs/user/develop/basic/index.md),部署方无需 fork agent loop(智能体循环)即可扩展或替换行为。底层设计见[架构文档](docs/architecture.md)。
- **运行可重建。** 凡是模型可见的内容,都会记录在权威会话流中;持久化、恢复/fork/查询、回放、遥测和 UI 均从同一组事件派生。参见[会话日志架构](docs/architecture.md#session-log)。
- **Code Mode(需显式启用)。** 它会提供 `run_code` 工具和生成的 TypeScript SDK,只有程序输出会重新进入模型上下文。参见 [Code Mode](packages/core/tools/README.md#code-mode)。
- **自指 Cordis 工具需显式启用。** 这些工具可让 agent 检查自身的实时运行时,并在运行中挂载或卸载插件。参见 [Cordis 工具](packages/self-modification/tool-cordis/README.md)。

## 遥测

默认关闭——不会向任何地方上传任何内容。如需把会话遥测流式发送到**你自己的** OTLP/HTTP 收集器,设置 `DSH_TELEMETRY_OTLP_URL`(如 `https://collector.example.com/v1/logs`)。非空的 `DSH_TELEMETRY_DISABLED` 无条件强制关闭。

## 与上游 `dsh` 的关系与共存

本项目于 2026-08 基线从 DeepSeek Harness(MIT)分叉,独立演进——不追踪上游发布;
包发布在 `@huiliyi37/*` npm scope 下(CLI:`@huiliyi37/oh-my-tianshu`,bin 名 `oh-my-tianshu`)。
本仓库以 Apache License 2.0 发布;上游署名保留在 [NOTICE](NOTICE),TUI 包携带自己的
Apache-2.0 来源链([LICENSE](packages/tui/tui/LICENSE) / [NOTICE](packages/tui/tui/NOTICE) /
[SOURCE-MAP](packages/tui/tui/SOURCE-MAP.md))。

**两条发行线,可同时安装、互不干扰**:

| 发行线 | 定位 | 数据 home |
|---|---|---|
| 官方 `dsh` + [`dsh-tianshu-tui`](https://github.com/huiliyi37/dsh-tianshu-tui)(插件) | 官方 DeepSeek Harness 的 TUI 插件,装进官方 profile | `~/.dsh`(官方固定) |
| 本仓库(oh-my-tianshu,原 tianshu-public) | 独立集成发行,自带 CLI(`oh-my-tianshu`) | 独立 `$DSH_HOME`(默认值独立化计划中,将不再默认 `~/.dsh`) |

- 本仓库完全尊重 `$DSH_HOME`(优先级:显式配置 > `$DSH_HOME` > 默认 home):
  与官方 dsh 共存时设 `export DSH_HOME=~/.dsh-tianshu`(默认值独立化落地后无需手动设置)。
  会话 / profile / settings 各自独立,互不覆盖。
- **命名备忘(防止混淆)**:`dsh-tianshu-tui` = 官方 dsh 的 TUI 插件;
  `oh-my-tianshu` / `@huiliyi37/oh-my-tianshu` = 独立集成发行;`Tianshu-Tui` = 上游渲染核心
  来源(Apache-2.0,天枢)。
- **更名计划(第二批)**:仓库名统一为 `oh-my-tianshu`,启动命令与 npm 包名同步改名
  (`oh-my-tianshu` → 新命令名),消除与插件名 `dsh-tianshu-tui` 的语义混淆;本说明届时同步更新。

## 开发

请先阅读[开发指南](docs/development.md);修改包之前,请阅读[架构文档](docs/architecture.md)。

面向 agent:遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[Apache-2.0](LICENSE)。上游与第三方署名:[NOTICE](NOTICE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
