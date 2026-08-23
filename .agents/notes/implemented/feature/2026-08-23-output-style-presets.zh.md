# Agent Note：输出风格预设

Status: implemented

[English](2026-08-23-output-style-presets.md) | 中文

## 问题

Tianshu 无法按需切换模型的作答风格。Claude Code 的输出风格——`default`、`Explanatory`、`Learning`——是一条命令切换 persona 的机制，用户在快速作答与教学深度之间切换时频繁使用。[系统提示组装](../../../../packages/core/system-prompt/README.md)已经支持有序 section，settings seam 支持热提交；产品只是没有在其上交付风格预设。

## 决策

新包 `@huiliyi37/dsh-output-style`，位于 `packages/interaction/output-style/`，注册一个 settings 驱动的提示 section，携带三份逐字固定的风格预设，并交付 `/style` 命令切换。挂载为 opt-in；出厂默认组合不包含本包。

### Section 机制

该包注册名为 `output-style`、order 为 `10` 的 `systemPrompt.section`，位于部署 persona（order `0`）与工具指引（order `100`–`199`）之间——该 order 已核实为生产源中的空槽，由测试中的探针 section 钉位。三份风格文本是固定的逐字块，由测试逐字节锁定。settings 命名空间为 `output-style`（kebab-case；camelCase 过不了 settings 命名空间校验）。热切换采用 model-roles 的实时读模式：section 只注册一次，其 `text` 闭包在每次组装时读取实时命名空间，因此一次提交从下一次组装起生效，没有 dispose/重注册空档。`Config.defaultStyle` 设定初始值，并作为未装配 settings provider 时的永久回退。

因为 section 属于提示组装，请求头天然覆盖它：model-visible ⟺ logged 成立，无需新增事件词汇表；一次风格切换恰好重写一次系统前缀——包 README 按标准 Model Experience 格式记录。

### 命令面

`/style`（无参）报告当前风格；`/style <default|explanatory|learning>` 提交命名空间，未知风格或缺 settings provider 时 fails loud。命令注册到 `ctx.commands`（顶层注入已保证可用），并在 TUI 被组合时注入 `tui.commands`、注册一个调用 `ctx.commands.execute` 的转发壳——[`/next-workflow` 模式](../../../../packages/workflow/next-workflow/README.md)，因为 TUI 斜杠菜单的数据源是该 facet，不是 `ctx.commands`。

### 作用域

预设为部署全局。agent 级覆盖推迟：subagent 与路由拥有自己的档案，per-agent 风格通道目前没有明确的消费者。

## 备选方案

### 为什么不用提示变量？

`{{outputStyle}}` 插值会把大段文本推入变量路径，让变量的小事实契约与段落级内容混在一起，而且每次组装都重渲染，而不是每次切换渲染一次。

### 为什么不遮蔽 persona section？

order `0` 的 persona 是部署的身份，由 `dsh-system-prompt` 所有；风格是正交的预设，必须能与部署选择的任何 persona 叠加。

### 为什么不复用 model-roles pin？

Role pin 按消费者路由模型，不承载提示内容；风格需要文本，且两个 settings 命名空间各自独立，互不牵连。

## 后果

- 风格文本是模型可见的；任何措辞变更都是快照可见的契约变更，本笔记随其更新。
- HMR 安全测试销毁插件 fiber 并观察 section 从组装中移除；集成测试经 settings 命名空间提交各风格并断言下一次组装的文本，含无 provider 与 provider 脱离两种回退。
- 包不变量伴生断言每次组装至多一个 `output-style` section——在伴生自身 waterfall 监听器下游的组装终值上、以及伴生装载时的全链上各断言一次——负例测试证明出现重复 section 的组装会失败。
- 未装配 settings provider 的部署永久渲染 `Config.defaultStyle`；README 写明回退，让失败方式在配置处响亮呈现，而不是运行期静默。
- 无论 zen 阶段的工具面如何该 section 都渲染，因为风格与工具暴露正交；不希望如此的部署直接不挂载本包。
- 应用级 keyless 快照延后；逐字文本已由包内测试经真实组装管线逐字节钉住。
