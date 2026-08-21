# Agent Note: 内置 OpenRouter 路由与 pi-ai 图片输入声明

Status: implemented

[English](2026-08-21-builtin-openrouter-route-and-pi-ai-vision.md) | 中文

## Problem

开箱状态下产品只服务一个提供方：`llm-deepseek` 注册 `deepseek-official`，而 `llm-pi-ai` 按设计以休眠姿态挂载——「哪些适配器存在归组合面；哪些提供方在运行交给用户的设置文档」（[[2026-07-14-provider-routed-llm-adapters]]）。要让 OpenRouter 的 `stealth/ox-alpha`（免费的 1M 上下文推理模型）无需每个用户手写 settings 即可用，就得用一条随产品下发的 provider profile 打破这份休眠。

能力侧，多模态图片链路（[[2026-08-13-tui-image-paste-and-vision-bridge]]）始终到不了 pi-ai 路由。`PiAiModelProfile` 没有输入模态字段，手工声明的模型物化为 `input: ['text']`，pi-ai 会把它的图片静默降级成「(image omitted…)」占位文本；适配器也从不回报 `supportsVision`——连目录里本就接受图片的模型（`gpt-4.1` 一类）也不例外——于是 composer 的直发门控、视觉桥自动选型与 `ask_image` 都把每个 pi-ai 模型当纯文本对待。TUI 还有一处漂移雪上加霜：`app.ts` 的本地 `llm` facet 读取并不存在的 `inputModalities` 字段，切换模型后的识图刷新永远判为 false。

## Decision

base bundle 的 `llm-pi-ai` 行携带一条出厂 profile：路由 `openrouter`，`apiKeyEnv: OPENROUTER_API_KEY`，模型 `stealth/ox-alpha`，`contextWindow: 1048576`、`maxTokens: 131072`、`supportsVision: true`、`reasoningEfforts: {low, high, max}`——容量与档位词汇均取自 OpenRouter 官方发布的模型事实；`compat` 有意不写，因为 pi-ai 的提供方 id 探测本就说 OpenRouter 方言（嵌套 `reasoning.effort` 参数、不用 developer role），与它自带的 276 个 OpenRouter 目录模型完全一致。组合/设置的分工保留原规则、承认一个出厂例外；用户的 `llm-pi-ai:` 分节仍按提供方与该路由合并，`models` 数组整体替换，而路由本身无法从 settings 移除（既有的分层合并限制，从此有了活例）。没有密钥时路由照常注册并列出，仅在被使用时以 `MISSING_CREDENTIAL` 失败——与 `llm-deepseek` 出厂的无密钥姿态一致。

`PiAiModelProfile`（以及共享其字段的 `modelOverrides`）新增 `supportsVision`：缺省继承已安装条目的输入模态（手工声明模型即纯文本）；`true` 把 `['text', 'image']` 强加给目录以纯文本发布的模型；`false` 从目录以多模态发布的模型上剥除图片输入。它物化为 pi-ai 的 `Model.input`。适配器在 `listModels` 与 `resolveModelInfo` 两处回报 `supportsVision: input.includes('image')`——一个明确陈述的布尔值，因为 pi-ai 的 `input` 是权威事实——这使目录识图模型无需任何逐模型配置即可充当视觉桥。`stream()` 对发往纯文本模型的图片在解析凭据与网络 I/O 之前以 `UNSUPPORTED_CONTENT` 拒绝，镜像 `llm-deepseek` 的门控（[[2026-08-19-direct-deepseek-vision-input]]）：pi-ai 自身只会降级成占位文本，看起来就像模型已经看过它们。

TUI facet 改读 `supportsVision`；该声明的三态语义与 `reasoningEfforts` 平行（[[2026-08-08-pi-ai-per-model-reasoning-declarations]]）。

## Alternatives considered

- **纯 settings 接入提供方**（文档既定的休眠路径，零产品改动）。姿态最纯，但什么也没下发：每个用户重复推导同一份 profile。它保留为规则，出厂路由是审慎的例外——因为这个模型就该在第一天就产品可见。
- **独立的 `llm-openrouter` 适配器包**（`llm-deepseek` 模式）。重复了 pi-ai 目录已服务的提供方，还会撞车：用户一旦经 `llm-pi-ai` 配置 `openrouter` 路由，`DUPLICATE_ADAPTER` 会拒绝整个注册。
- **自由形态的模态数组**（pi-ai 的 `Model.input` 形状）作为 profile 字段。harness seam 的词汇是 `LlmModelInfo` 上的单一布尔 `supportsVision`；数组会把 pi-ai 词汇——包括 pi-ai 0.82.1 根本无法分派的 video 概念——export 给每个配置界面，却没有消费方。
- **只经 `resolveModelInfo` 暴露能力。** 选择器与视觉桥自动选型枚举的是 `listModels`；只暴露一半，所有 pi-ai 识图模型都选不成桥。
- **放任 pi-ai 的占位降级**（不加适配器门控）。违背 fail-loud，且 deepseek 适配器已经在拒绝；两个适配器之间不对称的沉默才是更坏的漂移。

## Consequences

- 每个 profile（tui/web/headless）开箱即服务 `openrouter`/`stealth/ox-alpha`；`shipped-composition` e2e 对真实组合钉住该路由、容量、识图标志与档位集合。
- 出厂模型 base 声明的 `reasoningEfforts` 被合并锁死：用户层可改写某档位的拼写，却移除不了档位，因此编辑该模型更稳妥的做法是重述其 `models` 列表（README 与 providers 指南有载）。
- Web 金样本随出厂行变化：Models 页从此总有一张 OpenRouter 卡片；`default-model.e2e` 的收尾重置不再终于空注册表——组合路由按设计在 `replace` 后存活。
- pi-ai 目录识图模型在一切读取 `supportsVision` 的地方都成为桥候选，零配置。
- [[2026-08-13-tui-image-paste-and-vision-bridge]] 记下的图片链路覆盖缺口（上游 keyless 图片快照未移植）依旧存在；本变更的协议路径由 mock-server 规格钉住。

## Testing

`catalog.spec` 覆盖 `supportsVision` 双向物化与继承；`adapter.spec` 覆盖能力上报、门控次序（先于凭据解析拒绝、零 HTTP）与图片 data URL 上线往返；TUI `app.spec` 按真实 facet 形状覆盖切换后识图刷新；`shipped-composition.e2e` 端到端钉住出厂路由；`models-settings` 与 onboarding 金样本承载组装页面的转录。
