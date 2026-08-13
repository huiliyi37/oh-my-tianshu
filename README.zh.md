# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是一款基于 DeepSeek Harness SDK 构建的开源 coding agent（智能体）。

它采用了**一切皆插件**的架构。

## 内测声明

DeepSeek Harness 正处于内部测试阶段，功能和接口可能发生变化。

为帮助诊断上报的问题，内测版本默认上传所有会话日志。设置 `DSH_TELEMETRY_DISABLED=1` 可关闭遥测。请通过内部企业微信群反馈问题和建议。

## 安装

克隆仓库，然后运行安装器：

```sh
git clone <repo-url>
cd deepseek-harness
scripts/install.sh
```

安装器要求系统已安装 `git` 和 Node `^22.19 || >=24`，缺少 `pnpm` 时可代为安装，并会提示输入 DeepSeek API 密钥，然后构建所需的仓库产物并启动 Web UI。

默认生效的检出位于 `~/.dsh/source/current`，启动器链接到 `~/.local/bin`。再次运行安装器即可更新。其他位置、更新机制和恢复选项由 [`scripts/install.sh`](scripts/install.sh) 负责。

## 使用 DeepSeek Harness

### Web UI

推荐在本地使用 Web UI；安装结束时，选择 Web UI 即可。以后需要启动时，或更新当前生效的检出后，请构建仓库并运行：

```sh
(cd ~/.dsh/source/current && pnpm run build)
dsh web
```

上述路径是安装器的默认位置。如果你设置过 `DSH_SOURCE` 或 `DSH_CURRENT`，或者复用了已有检出，请把 `~/.dsh/source/current` 换成该检出路径；详情见 [`scripts/install.sh`](scripts/install.sh)。Web UI 默认通过 `http://127.0.0.1:3080` 提供服务。

### Profile

`dsh` 启动 profile：按序叠放的插件组合包 patch 层，之上再叠加你在 `$DSH_HOME/profiles/<name>` 中的自有覆盖层：

```sh
dsh --profile web                       # the browser UI (same as: dsh web)
dsh plugin --profile tui add <package>  # install a plugin into a custom profile
dsh --profile tui                       # boot it
```

profile 布局、层语义与配置输出命令详见 [CLI（命令行界面）约定](apps/cli/README.md#profiles)。

### 终端 UI（`dsh-tui`）

启动全屏终端界面：

```sh
dsh tui          # or: dsh --profile tui
```

TUI 是天枢（opencode-tui）渲染核心适配 dsh 接缝的移植。输入 `/` 打开命令菜单——↑↓ 选择、Tab 接受、Enter 提交、Esc 关闭；随时按 `Ctrl+.` 查看键位表。

**Slash 命令**

| 命令 | 作用 |
|---|---|
| `/session` | 会话管理（列表 / 切换） |
| `/fork [directive]` | 分叉当前会话（复制历史）并切换；可带首条消息 |
| `/branch` | `/fork` 别名 |
| `/model [provider/model]` | 查看/切换模型（热切当前会话；`spark-flash` / `spark-pro` 别名一键切 DeepSeek Spark） |
| `/theme [name]` | 切换主题 |
| `/clear` | 清空当前会话滚动区 |
| `/compact` | 压缩当前会话上下文 |
| `/steer <text>` | 中轮转向（不中断地纠正方向） |
| `/status` | 状态面板（5 域投影快照） |
| `/config` | 设置面板（settings / permission / credentials） |
| `/skills` | 技能浏览面板 |
| `/subagents` | 委派树面板 |
| `/workflow` | workflow 运行中面板 |
| `/tasks` | 任务窗格（后台任务） |
| `/goal` | 目标管理（创建 / 暂停 / 恢复 / 完成 / 阻塞） |
| `/memory` | 记忆浏览器（列表 / 过滤 / 删除 / 预览） |
| `/remember <text>` | 保存一条记忆 |
| `/rewind` | 两阶段回滚（消息列表 → 粒度） |
| `/btw <question>` | 向后台 agent 侧问 |
| `/doctor` | 终端诊断 + 修复指引 |
| `/mcp` | 列出已连接 MCP server 与工具 |
| `/export [path]` | 导出当前会话转录为 Markdown 文件 |
| `/density` | 切换紧凑工具卡渲染 |
| `/permission` | 切换权限预设（workspace-write / danger-full-access） |

**快捷键**

| 按键 | 作用 |
|---|---|
| `Ctrl+N` | 新会话 |
| `Ctrl+S` | 恢复最近会话 |
| `Ctrl+Q` | 退出 |
| `Ctrl+P` | 命令面板 |
| `Ctrl+.` | 键位表 overlay |
| `Ctrl+F` | 历史搜索（n/N 跳转） |
| `Ctrl+O` | 用 `$EDITOR` 打开输入行 |
| `Ctrl+T` | 中轮转向 |
| `Ctrl+V` | 粘贴系统剪贴板图片（剪贴板无图时 fallback 剪贴板文本） |
| `Alt+W` | 把选区复制到系统剪贴板（OSC52） |
| `Shift+Tab` | 模式循环：normal → plan → always-approve |
| `Tab` | `@`-路径补全；接受 slash 菜单选中项 |
| `↑/↓` | 输入历史（slash 菜单打开时为选择） |
| `PageUp/PageDown` | slash 菜单翻页 |
| `Esc` | 关闭 slash 菜单或 overlay |

**交互**

工具审批以内联 `⚠ 允许执行 …？[y/N]` 提示，上方附统一 diff 预览。subagent 运行以 live 区 spinner 行呈现，完成落为 ✓/✗/◌ scrollback 条目。底部三行：输入行（底边线随模式着色）、footer（模式徽标 + 快捷键提示）、metrics 行（模型 / token 用量 / 缓存命中率）。

**图片粘贴与终端预览**

`Ctrl+V`（或右键/终端菜单粘贴）读系统剪贴板图片——macOS `osascript`、Linux `wl-paste`/`xclip`、Windows PowerShell——并附图；粘贴内容像图片路径时改为加载该文件为附件。附件以 `📎 N images` 标记显示在输入行上方，提交后在用户气泡下方以终端内联图形渲染（kitty / iTerm2 协议）。气泡携带识图提示：支持识图的主控直接看图；text-only 主控配置了识图桥时先经视觉模型转描述；两者皆无时 TUI 警告图片未发送（且不提交图片）。

**视觉桥（可选）**

`dsh-vision-bridge` 让 text-only 主控仍能读到用户图片：`agent/pre-step` 时经独立视觉模型描述图片附件，描述作为 plugin-source user message 注入（Model-visible ⟺ logged；桥失败降级为可见提示，绝不整轮 failed）。启用方式：把插件加入装配并配置支持识图的 provider/model：

```yaml
# cordis.yml
- id: vision-bridge
  name: '@huiliyi37/dsh-vision-bridge'
  config:
    provider: deepseek-official   # any registered llm route that can see images
    model: <vision-capable model>
```

并在 `tui-runner` 组合包配置里设置 TUI 的 `vision` 状态使气泡提示与桥一致：`supportsVision: false`、`bridgeEnabled: true`。

**DeepSeek Spark 模式（内部能力）**

`deepseek-spark` provider route 在 wire 层把 assistant 推理截断为尾部 N token 回传（flash 300 / pro 需显式开启），保持模型上下文精炼；`dsh-spark-anchors` 与之成对，把被截断丢失的排除路径重新注入，防止模型重复推导已排除的选项。一次性启用（settings 热加载，无需重启）：

```yaml
# settings.yaml
llm-deepseek:
  spark:
    enabled: true
```

然后用 `/model spark-flash` 或 `/model spark-pro` 切换（`deepseek-spark/deepseek-v4-flash` / `deepseek-spark/deepseek-v4-pro` 的别名）。Spark 与 DeepSeek 共用同一 API key——零额外配置。

### Headless

运行一项任务，打印最终答案后退出：

```sh
dsh run "summarize this workspace"
```

### 自动化与 SDK

在源码检出中通过环境变量或根目录 `.env` 设置 `DEEPSEEK_API_KEY`，然后启动 ACP（Agent Client Protocol）自动化服务器：

```sh
pnpm run demo:acp
```

[Python SDK](python/README.md) 驱动随附的 JSON-RPC 运行时。[示例](examples/README.md)涵盖可运行的 headless、ACP、JSON-RPC、Code Mode 和自指组合。

## 为什么选择 DeepSeek Harness

内置功能涵盖文件读取、编辑与搜索、shell 和持久 PTY 执行、可复用 skill（技能）、任务跟踪、目标、计划、待办事项与后台任务、subagent 与工作流、沙箱与审批、设置与凭据、可持久化、恢复、fork 与查询的会话、LSP 与 Web 访问、上下文压缩（context compaction）、循环卫生 guard（RED-first 验证、失败路由、重复调用提醒、单次调用超时），以及遥测。每个组合只选用适合其使用方式的能力子集。Web UI 包含 Plan Mode。

- **一切皆插件。** 模型、工具、策略、存储、上下文管理和界面均为可组合的 [Cordis 插件](docs/user/develop/basic/index.md)，部署方无需 fork agent loop（智能体循环）即可扩展或替换行为。底层设计见[架构文档](docs/architecture.md)。
- **运行可重建。** 凡是模型可见的内容，都会记录在权威会话流中；持久化、恢复／fork／查询、回放、遥测和 UI 均从同一组事件派生。参见[会话日志架构](docs/architecture.md#session-log)。
- **Code Mode（需显式启用）。** 它会提供 `run_code` 工具和生成的 TypeScript SDK，只有程序输出会重新进入模型上下文。参见 [Code Mode](packages/core/tools/README.md#code-mode)。
- **自指 Cordis 工具需显式启用。** 这些工具可让 agent 检查自身的实时运行时，并在运行中挂载或卸载插件。参见 [Cordis 工具](packages/self-modification/tool-cordis/README.md)。

## 社区

扫描二维码，或打开 <a href="https://wj.qq.com/s2/27234598/03eb/">DeepSeek Harness 微信社区申请页面</a> 申请加入。

<p>
  <img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 微信社区二维码" width="240">
</p>

## 开发

请先阅读[开发指南](docs/development.md)；修改包之前，请阅读[架构文档](docs/architecture.md)。

面向 agent：遵循 [AGENTS.md](AGENTS.md)。

DeepSeek Harness 目前处于内测阶段。

## 许可证

BSD 3-Clause（`LICENSE` 文件未包含在本私有快照中）

第三方依赖及其许可证在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 中披露。
