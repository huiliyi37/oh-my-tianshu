# @huiliyi37/dsh-vision-ask

[English](README.md) | 中文

**视觉副驾插件**：会话级图片注册表 + `ask_image` 工具。用户发送图片（任意入口——TUI、子代理、工具注入的消息）后，其内联 data URL 被登记为短 id（`img_1` …）；主控模型可对已保留的任意图片反复提问、换角度再看，无需用户重发。

## 为什么需要专用 adapter

text-only 的主控 wire route 载不动视觉副驾的描述调用。本插件注册自己的 llm provider route（默认 `vision-ask`），内置 OpenAI 兼容 adapter：把 image block 自带的 data URL 直通序列化为 `image_url` content parts。描述调用因此走标准 `ctx.llm.stream` 路径——重试/错误/取消语义保留，描述文本落入工具结果与会话日志（Model-visible ⟺ logged）。

## 配置

```yaml
- id: vision-ask
  name: '@huiliyi37/dsh-vision-ask'
  config:
    model: deepseek-vl           # vision model id (required)
    provider: vision-ask         # provider route this plugin registers (default)
    baseUrl: https://api.deepseek.com  # optional; OpenAI-compatible endpoint
    apiKeyEnv: DEEPSEEK_API_KEY   # optional; env var holding the API key
    maxTokens: 1024              # optional; description output cap (default 1024)
    primarySupportsVision: false # optional; force forwarding / describing
    registryMaxImages: 8         # optional; images kept per session
    registryMaxBytes: 25165824   # optional; total byte cap per session (24 MiB)
```

`model` 必填（装配即 fail loud）。`primarySupportsVision` 可选：省略时工具经模型目录的 `supportsVision` 声明动态判定调用 agent 的模型能力；设置时覆盖动态判定（true=始终把原图附给主控，false=始终走视觉描述）。

## 关键性质

- **会话隔离 + 硬边界** — 图片按 session id 分桶；条目持有已入日志 image block 的内存态 data URL（不新增事件词汇）。注册表不进会话日志、不落盘；LRU 容量控制（默认每会话 8 张 / 24 MiB）。
- **自动注册，TUI 零改动** — 插件监听 `session/event` 的 `user/message` 事件，图片到达即登记，覆盖所有图片入口。
- **双应答路径** — 多模态主控收到原图 image block，直接看像素；text-only 主控拿到配置视觉模型的定向描述。同图同角度重复提问命中 per-image 描述缓存（零额外调用；缓存键归一化问题文本）。
- **失败可见、绝不致命** — 无图、图 id 未知、无视觉路由、视觉模型失败均以结构化工具错误上抛（带可行动文案），模型看到原因并可据此行动。

## 验证

```sh
# behavior suite (runs against the workspace monorepo)
vitest run packages/tui/vision-ask
```

## Model Experience

### `ask_image` 工具

#### 模型看到什么

有图会话里 `ask_image(question, imageId?)` 可用。多模态主控收到「文本提示 + 原图 image block」；text-only 主控收到描述文本（缓存命中带 `（缓存）` 标记）。无图会话收到结构化错误，提示模型先请用户发图。

#### Token 效应

每次未命中缓存的提问消耗一次辅助模型调用（`maxTokens` 上限，默认 1024）；描述文本以工具结果进入主控上下文。缓存命中零 token。

#### KV 缓存效应

描述调用是独立 one-shot 请求（不设 purpose），与主控会话前缀无关；工具结果与普通工具结果一样追加。

## 已知限制与后续

- **无视觉模型自动选择** — 视觉模型必须显式配置（`model`；可选 `fallback` 链属后续）。主控自身能力已经由 `supportsVision` 动态判定。
- **描述缓存仅内存** — 不跨重启持久化；恢复会话的首次未命中提问会重新描述。
- **注册表对 TUI 不可见** — 图片 id 只经工具错误/答案文本呈现；TUI 徽标展示保留图片列表属后续工作。
- **视觉 adapter 只讲最小 OpenAI 兼容方言** — 文本/图片输入、文本输出、流式；reasoning 流与工具调用超出描述调用范围。
