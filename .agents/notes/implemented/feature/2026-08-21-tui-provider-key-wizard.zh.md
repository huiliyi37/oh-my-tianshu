# Agent Note: TUI 供应商密钥向导

Status: implemented

[English](2026-08-21-tui-provider-key-wizard.md) | 中文

## Problem

`/key` 焊死在 DeepSeek 上：硬编码的 `DEEPSEEK_API_KEY` 引用、DeepSeek 专属探测、DeepSeek 专属文案。多供应商组合发布后（内置 OpenRouter 路由 + 约 45 个 pi-ai 目录供应商），TUI 用户在终端里没有任何配置或轮换非 DeepSeek 密钥的途径——只剩 web 模型页或手改 `~/.dsh-tianshu/.credentials.yaml`，首启自动引导也只检查 DeepSeek key。竞品流程（opencode-tui 的 `/connect`）给出了用户期待的形状：选供应商 → 粘贴掩码 key → 探测 → 热保存。

服务侧有两个缺口挡住了 seam 原生实现。发现探针只要 `provider` 点名目录路由就短路到已安装目录，草稿 key 根本到不了线上、得不到鉴权判定；且 401/403 与网络故障共用 `DISCOVERY_FAILED` 码，测试密钥的界面没有机判「坏 key」与「坏端点」的手段（解析消息违背错误处理教义）。

## Decision

向导就是 `/key` 本身，而非新命令：先开供应商 picker（由 `ctx.llm.listConfigurableProviders()` 构建：默认供应商以 `current` 标记置首、经 `credentials.describe` 解析到密钥的条目加 ` ✓` 后缀），然后——在 picker overlay 失活之后经微任务链转，因为引擎是切换不是栈——进入既有的掩码输入对话框，现以 `KeyDialogTarget`（供应商、显示名、引用、探测、可选 `afterSave`）参数化。引用按 profile 优先解析：已解析 settings 段的 `apiKeyEnv`，否则 `deriveKeyRef(provider)`（大写、非字母数字连串折叠为 `_`、`_API_KEY` 后缀——与 web 模型页同一规则）。尚无 profile 的 pi-ai 路由在 key 保存后经 settings seam 补写最小 `{ apiKeyEnv }`，路由即时注册、`/model` 立即可选；DeepSeek 命名空间保留其 schema 缺省引用与自有端点探测。首启引导与欢迎行/footer 就绪标志从「DeepSeek key 在否」泛化为「默认供应商的 key 在否」。

服务侧：发现探针现在把草稿 `apiKey` 视为对目录应答的退出——请求在未提供端点时从目录解析端点并带认证打上线——401/403 抛 `LlmError(…, 'AUTH')`（端点拒绝凭据的既有码），向导据此映射 `AUTH`/`INVALID_CREDENTIAL` → invalid、其余 → unknown（保留可强存的逃生口）。

## Alternatives considered

- **新 `/connect` 命令**（竞品命名）。否决：`/key`/`/login` 是既定入口且行为是同一件事；第二个名字毫无收益还分裂发现。
- **TUI 侧供应商→端点表做探测。** 否决：复制 pi-ai 目录的 URL 且会漂移；发现 seam 本就认识每个目录端点，草稿 key 语义让它成为真鉴权探针。
- **保留目录短路、目录路由跳过探测。** 否决：未验证的保存违背向导的核心承诺（竞品的探测优先设计），坏 key 会推迟成会话中途的失败。
- **TUI 里解析消息区分 401/403。** 否决：错误教义禁止；修正属于 seam 的码。
- **把 `deriveKeyRef` 挪进共享包。** 暂否：一行规则由两侧测试钉死、注释互链；为它建微包的代价高于消除的漂移风险。

## Consequences

- 任何可配置供应商的密钥都能在 TUI 里配置、轮换、验证；保存经凭据 seam 热发布（无需重启），休眠 pi-ai 路由保存即激活。
- 发现的目录短路现在是有条件的（`apiKey === undefined`），对「同时传目录 `provider` 与草稿 `apiKey` 却期待缓存应答」的面是行为变化——web 模型页只在编辑自己的密钥框时传草稿，那里线判正是它要的。
- 发现的 `AUTH` 是新的机判结论；web 各面今天不按发现码分支，错误展示仍是纯消息、不受影响。
- key 对话框保持不认识供应商（目标注入）；其构造期 probe 覆盖保留为目标探测之上的测试位。
- 未做：TUI 内 OAuth 登录流（web 经 authorization seam 已有）、`/disconnect`、向导草稿续填——刻意的范围裁剪。
