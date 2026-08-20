# Agent Note: 直接 DeepSeek 视觉输入

Status: implemented

[English](2026-08-19-direct-deepseek-vision-input.md) | 中文

## Problem

DeepSeek 视觉部署使用 chat-completions 图片协议，但直接 `deepseek-official` 适配器此前把所有 catalog 与原样传递模型都声明为仅文本，并拒绝每一个 `ImageBlock`。部署方完全无法通过直接提供方传递用户上传或包含图片的工具结果。

## Decision

直接适配器允许已配置 catalog 条目通过 `supportsVision: true` 选择加入；校验会拒绝非布尔值。Flash、Pro、未列出的原样传递 id，以及省略该标志的已配置条目仍明确仅支持文本。随附目录不公布任何视觉模型，因此模型选择器不会提供不可用路由；部署方自行启用其确切视觉模型。

`ImageBlock` 以 data URL 形式把图片保存在持久历史中，因此适配器不需要附件存储：它把每张保留的 user 与工具结果图片块按顺序序列化为 OpenAI 兼容的 `image_url` 部分，字节直接取自已记录的消息。纯文本 user 消息保留字符串内容。工具结果保留仅字符串的 `tool` 消息；仅含图片的结果使用 `(see attached image)`，连续工具结果中的图片随后合并进一条以 `Attached image(s) from tool result:` 开头的 `user` 消息。System 与 assistant 历史图片会在凭据或网络 I/O 前以 `UNSUPPORTED_CONTENT` 失败。

直接适配器与 pi-ai 转换共享确定性的[请求级图片载荷上限](../bug-fix/2026-08-18-request-image-payload-bound.md)。两者都以 20 MiB 累计 base64 payload 为默认值，并用相同的固定占位文本替换最旧的图片出现位置。直接 HTTP 413 响应归类为 `INVALID_REQUEST`。

规范消息自身携带 data URL，因此无需修改会话事件、持久化格式、API schema 或 SDK 投影。图片块的协议 MIME 类型来自其 `mime` 字段，缺省回退到 data URL 标头；录入校验（格式、大小、数量）仍由撰写端客户端负责。不支持外部图片 URL、Files API 和图片输出。

## Alternatives considered

- **只使用 pi-ai DeepSeek 提供方。** 其通用多模态路径验证了内容转换，但无法让直接官方路由如实公布能力，也无法让它配合官方模型 id 使用。
- **把整个提供方声明为支持图片。** 这样会让 Flash、Pro 和未知的原样传递 id 接受图片，但其确切协议模型无法承诺消费这些图片。能力仍属于确切模型元数据。
- **在 `tool` 消息内容中发送图片。** 已记录的兼容形式要求工具内容保持字符串。随后发送 user 消息可避免依赖未记录的多模态 tool role 形式，同时保留调用结果顺序。
- **增加外部 URL 或 Files 上传。** 两者都需要新的规范输入、授权、生命周期、清理和重放决策。内联 data URL 复用现有持久消息约定，不扩展这些问题。

## Verification

包测试固定模型能力门控、配置校验与存活 settings 更新、user 与工具结果协议消息、413 分类以及确切的图片上限行为；共享的 offload 转换在 dsh-llm 中固定，并在 pi-ai 适配器套件中再次覆盖。

## Consequences

已配置的 DeepSeek 视觉路由可以消费 user 与工具结果图片，而无需改变会话持久性或响应流。重复历史仍会扩张请求正文，但确定性的最旧优先 offload 会限制主导 payload，并在官方 30 MiB 请求正文上限下保留余量。由于官方图片 token 公式尚不可用，图片 token 定价仍由提供方掌握。
