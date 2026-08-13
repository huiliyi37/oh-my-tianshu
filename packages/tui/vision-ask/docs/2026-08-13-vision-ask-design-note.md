# Agent Note: ask_image 工具 + 会话图片注册表（dsh-vision-ask）

Status: implemented（行为套件 32/32 绿；类型面待公开版环境 tsc 复核）

## Problem

用户发图后，text-only 主控只能拿到一次性的图片描述（若装配了视觉桥）；想就图中细节再确认、或换角度再看，只能让用户重发。opencode-tui 以「会话图片注册表 + ask_image 工具」解决（agent/image-registry.ts + tools/ask-image.ts，Apache-2.0 上游），dsh 公开版基线（0812 快照）缺此能力且缺 vision-bridge。

## 公开版基线的硬约束（决定设计的事实）

- `llm-deepseek` 的 wire route **text-only**：serialize 显式拒绝 image block（"The DeepSeek chat-completions adapter does not support image content"）——图片到不了任何模型，视觉调用必须绕行。
- 图片 block 是 **attachment 引用**（`ImageAttachmentRef`），字节在附件服务（`AttachmentStore.saveImage/readImage`）；不是内部版的 dataUrl 直通。
- `LlmModelInfo` 无 `supportsVision`（内部版 0813 才加），但有 **`inputModalities`**（`['text']`）——主控识图可动态判定。
- 插件可 `ctx.llm.registerAdapter(providers, adapter)` 注册自己的 provider route。

## 设计决策

1. **独立插件包 `@huiliyi37/dsh-vision-ask`**，与 dsh-tui 同仓（`vision-ask/` 子目录），将来可整体拆独立仓。理由：dsh-tui 是 UI 插件（虽非纯展示层，识图是 TUI 必备能力），工具/注册表是宿主侧能力；独立包使版本与装配各自演进。
2. **registry 存 attachment 引用而非 dataUrl**：字节留在附件服务（隐私 + 容量边界由附件层保证）；注册表内存 Map 只持 ref + 描述缓存；LRU 8 张/24MiB；**不进 session 日志、不落盘**（opencode 同款硬边界）。
3. **专用 `VisionAdapter`**（注册 provider route `vision-ask`）：OpenAI 兼容 `image_url` 序列化 + SSE 流式。被否方案：改造 llm-deepseek（基线改动，违背插件立场）；依赖 eventsource-parser（SSE 解析内联 ~40 行，零运行时依赖，任何环境可测）。
4. **主控识图动态判定**：`exec.agent.agentOptions` → `ctx.llm.resolveModel().inputModalities` 含 `image` → 原图引用直发（工具结果 content 带 image block）；否则走视觉描述。`primarySupportsVision` 配置仅作覆盖。判定失败（模型未知）保守降级描述路径，不炸轮。这顺带消解了内部版 vision-bridge 的「主控能力靠配置」限制。
5. **描述缓存键**（visionCacheKey）：问题折叠空白+小写；无问题按模式归类。同图同角度重复问零调用。
6. **注册监听走 `session/event` 的 `user/message`**：覆盖所有图片入口（TUI/子代理/工具注入），TUI 零改动。
7. **结构化错误**（HarnessError）：无 agent / 会话无图 / id 未知 / 视觉失败——模型看到原因可行动，绝不静默吞图。

## 验证契约

- 行为：registry.spec（LRU/缓存/非法跳过）、ask-tool.spec（三路径/错误）、vision-adapter.spec（SSE 帧解析/纯函数/finish 单发裁决/mock fetch）——32/32。
- 边界：SSE 截断 → STREAM_CLOSED finish；stop 无文本 → EMPTY_RESPONSE；401 → AUTH；缺 key → AUTH（不发起请求）。
- 未覆盖（诚实标注）：真实视觉模型调用（需 key，e2e 属后续）；`inputModalities` 类型面（内部版 types 无此字段，行为经可选链降级；公开版 tsc 复核在安装修复后执行）。

## Known Limitations（详见包 README）

- 无 visionAutoBridge（基线无 supportsVision 字段）；描述缓存仅内存；注册表对 TUI 不可见；adapter 只讲最小 OpenAI 兼容方言。
