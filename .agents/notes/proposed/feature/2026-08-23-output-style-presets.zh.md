# Agent Note：输出风格预设

Status: proposed

[English](2026-08-23-output-style-presets.md) | 中文

## 问题

Tianshu 无法按需切换模型的作答风格。Claude Code 的输出风格——`default`、`Explanatory`、`Learning`——是一条命令切换 persona 的机制，用户在快速作答与教学深度之间切换时频繁使用。[系统提示组装](../../../../packages/core/system-prompt/README.md)已经支持有序 section，settings seam 支持热提交；产品只是没有在其上交付风格预设。

## 提案

新包 `@huiliyi37/dsh-output-style`，位于 `packages/interaction/output-style/`，注册一个 settings 驱动的提示 section，携带三份逐字固定的风格预设，并交付 `/style` 命令切换。挂载为 opt-in。

### Section 机制

该包注册名为 `output-style`、order 为 `10` 的 `systemPrompt.section`，位于部署 persona（order `0`）与工具指引（order `100`–`199`）之间。三份风格文本是固定的逐字块，由 keyless 快照锁定。settings 命名空间 `outputStyle` 保存 `default`、`explanatory` 或 `learning`；`Config.defaultStyle` 设定初始值，命名空间提交时 dispose 并重注册 section，因此切换从下一次组装生效、无需重载。

因为 section 属于提示组装，请求头天然覆盖它：model-visible ⟺ logged 成立，无需新增事件词汇表；一次风格切换恰好重写一次系统前缀，README 按标准 Model Experience 格式记录。

### 命令面

`/style`（无参）报告当前风格；`/style <default|explanatory|learning>` 提交命名空间。命令注册到 `ctx.commands`，并在 TUI 被组合时注入 `tui.commands`、注册一个调用 `ctx.commands.execute` 的转发壳——TUI 只消费自己的 facet，仅 harness 注册不会出现在斜杠菜单（[`/next-workflow` 模式](../../../../packages/workflow/next-workflow/README.md)）。

### 作用域

首版预设为部署全局。agent 级覆盖推迟：subagent 与路由拥有自己的档案，per-agent 风格通道目前没有明确的消费者。

## 备选方案

### 为什么不用提示变量？

`{{outputStyle}}` 插值会把大段文本推入变量路径，让变量的小事实契约与段落级内容混在一起，而且每次组装都重渲染，而不是每次切换渲染一次。

### 为什么不遮蔽 persona section？

order `0` 的 persona 是部署的身份，由 `dsh-system-prompt` 所有；风格是正交的预设，必须能与部署选择的任何 persona 叠加。

### 为什么不复用 model-roles pin？

角色 pin 按消费者路由模型，不携带提示内容。风格需要文本，两个 settings 命名空间保持分离，任何一个都能独立变更。

## 验收标准

- keyless 快照逐字锁定三份风格文本。
- 集成测试经 settings 命名空间提交每种风格，并断言下一次组装的 `output-style` section 包含对应文本。
- `/style` 的无参报告与切换回显有单测覆盖，TUI 快照覆盖命令面。
- HMR 安全测试销毁插件 fiber 并观察到 section 从组装中移除。
- 包 invariant 断言每次组装至多一个 `output-style` section；双语 README 对随包交付，本笔记随落地提交移入 `implemented/`。

## 风险

- 风格文本是模型可见的；任何措辞变更都要重录快照，笔记随之更新。
- 没有 settings provider 的部署回落到 `Config.defaultStyle`；README 说明回落路径，让失败模式在配置层响亮而非运行时静默。
- 无论禅相位工具面如何，section 始终存在，因为风格与工具暴露正交；想要不同行为的部署可以不挂载该包。

## 实现修订（2026-08-23）

已在工作区实现为 `packages/interaction/output-style`，含以下修正：

- settings 命名空间为 `output-style` 而非 `outputStyle`——camelCase 过不了 kebab-case 校验（`settings/src/index.ts:21`）。
- 热切换采用 model-roles 同款实时读模式：section 只注册一次，`text` 闭包在每次组装读取实时命名空间，取代 dispose+重注册（后者既非既有先例也存在空档态）。
- order-10 经核实生产源码中空置；位置由测试中的探针 section 钉住。
- 「恰好重写一次 system prefix」语义记载于 docs/subsystems/session.md 与 zen README，而非 system-prompt README。
- 三段预设正文由单测逐字节钉住；应用级 keyless 快照延后。
