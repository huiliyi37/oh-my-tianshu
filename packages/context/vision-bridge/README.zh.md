# @huiliyi37/dsh-vision-bridge

[English](README.md) | 中文

**视觉桥插件**：主控模型不识图时，把用户图片附件经独立视觉模型转文字描述，随 `agent/pre-step` 注入模型可见上下文。

TUI 输入框允许用户粘贴图片（data URL 以 `image` ContentBlock 进入会话）。主控模型支持识图时图片直发；不支持时若配置了独立视觉模型（本插件），图片经该模型转文字描述，描述作为 plugin-source user message 注入——**Model-visible ⟺ logged**：描述进 session 事件，从日志可重建；原图不落入 session（text-only 主控从未见过像素）。

## Config

```yaml
- id: vision-bridge
  name: '@huiliyi37/dsh-vision-bridge'
  config:
    provider: deepseek-official     # explicit vision model (omit when visionAutoBridge is on)
    model: deepseek-vl             # explicit vision model id (omit when visionAutoBridge is on)
    prompt: ''                     # optional; custom description prompt (auto mode otherwise)
    maxTokens: 1024                # optional; description output cap (default 1024)
    primarySupportsVision: false   # optional; whether the primary sees images (default false)
    enabled: true                  # optional; master switch (default true)
    fallback:                      # optional; backup vision model on error/aborted
      provider: deepseek-official
      model: deepseek-vl-backup
    visionAutoBridge: false        # optional; auto-pick the first supportsVision model when no explicit route
```

`provider`/`model` 在**开启 `visionAutoBridge` 时可省略**——未开自动桥且缺路由时装配即 fail loud。`visionAutoBridge: true` 时在调用期遍历已注册 provider 的 advisory catalog，取第一个 `supportsVision: true` 的模型（由所属 adapter 经 `LlmModelInfo.supportsVision` 声明）。`fallback` 可选；给出时其 `provider`/`model` 均必填，主视觉模型 error/aborted（5xx/超时）时经其兜底重试一次。

## 关键性质

- **主控能力声明**：`primarySupportsVision` 由装配方按主控模型事实配置；true 时本插件不干预，图片直发。
- **桥失败不炸轮**：视觉模型超时/报错/返回空描述，都降级为可见的桥接提示文本（`[图片桥接失败]` / `[图片桥接提示]`），让主控知道「有图但没读到」，绝不静默吞图或整轮 failed。
- **零干预透传**：无图消息、`enabled=false`、reject decision 一律原样透传。
- **描述模式自动选择**：未显式配置 `prompt` 时，随图文本命中 UI/报错关键词（`报错`/`error`/`终端`/`日志`…）→ OCR 级精确转写；否则通用结构化描述。

## Verification

```sh
NO_COLOR=1 pnpm vitest run packages/context/vision-bridge/tests/
```

## Model Experience

### 桥接描述消息

#### What the model sees

主控不识图时，含图用户消息被替换为一条 text 消息：`[图片描述]\n<描述文本>\n\n<原用户文本>`（或桥失败的降级提示）。主控识图时无感（图片直发）。无图会话完全无感。

#### Token effect

每条描述按视觉模型输出计入一次 `purpose: 'vision-description'` 的辅助调用（`maxTokens` 封顶，缺省 1024）；描述文本随后作为 user message 进入主控上下文。桥失败时不产生描述 token（只有几行降级提示）。

#### KV Cache effect

注入消息作为 user message 追加，行为与任何新消息一致。桥调用本身独立于主控会话缓存（`vision-description` purpose 不进入主控前缀）。

## Known Limitations and Deferred Work

- **ask_image 工具 / imageRegistry / 描述缓存未实现**：用户只能提交时经桥描述，不能对已发图片反复追问；同图同角度重复描述每次都会重调视觉模型（opencode-tui 的 vision-service 完整面含 registry + 缓存 + ask_image，超出输入框移植范围）。
- **主控能力靠配置声明**：`primarySupportsVision` 由装配方配置，而非从 llm provider 能力声明自动推导（llm service 尚无 vision capability 字段）。
- **TUI 提示一致性靠装配方**：`dsh-tui` 的 `vision.bridgeEnabled` 气泡提示与本插件配置同源派生，未做运行时联动校验。
