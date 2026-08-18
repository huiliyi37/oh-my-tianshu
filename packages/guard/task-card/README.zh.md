# @huiliyi37/dsh-task-card

[English](README.md) | 中文

任务卡把会话的**第一条用户消息**改写成结构化任务卡再交给模型：`# 标题`、`## 目标`、可选的 `## 约束` 与 `## 验收`，以及 `—— 原始请求 ——` 下的逐字原文。模型拿到更清晰的语义，用户获得更清晰的任务框定——而且任务卡天然多行、超长，改写后的首条消息不会被 zen 相位的 triage 误判为琐碎提示（改写本身在 triage 之后判定，两者正交组合）。

生成阶梯（绝不阻塞第一步）：**LLM**（一次有界调用、显式路由、短超时、零重试）→ **语义模板**（纯函数、必然成功）→ **原样放行**（不满足触发条件的消息原样通过）。每种模式下原文都逐字保留在分隔线之后：会话日志只保存改写后的消息，原文段保证用户输入可重建、可追溯。

决策记录：[任务卡 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-18-task-card-first-message.md)。

## 配置

```yaml
- id: task-card
  name: '@huiliyi37/dsh-task-card'
  config:
    enabled: true                # default; false mounts the service with no behavior
    mode: llm                    # default; llm = one model call with template fallback, template = zero-cost template only
    provider: deepseek           # REQUIRED when mode: llm (the first message has no assistant message to derive a route from)
    model: deepseek-chat
    timeoutMs: 5000              # default; card-generation deadline before the template fallback
    maxInputChars: 4000          # default; longer first messages are left untouched
    maxOutputTokens: 300         # default; card-generation output budget
```

`resolveConfig` 在插件加载时对未知键、非法 `mode`、非正整数预算、以及 `mode: 'llm'` 缺少 provider/model 对**响亮失败**。改写挂在 `agent/pre-step`——唯一返回值生效的 waterfall——所以改写后的消息既是模型所见、也落进会话日志（`model-visible ⟺ logged` 免费闭合）。

## 触发条件（全部满足才改写）

- `decision.messages` 的第一条是用户消息（`source.kind === 'user'`）。
- 会话是顶层会话（无 `header.parentSession`）——子代理的派发提示已经是锚定结构。
- 消息文本非空、尚无任务卡标记（幂等）、且不超过 `maxInputChars`。
- 会话日志尚无 `user/message`——改写只发生在首条，resume/fork 会话绝不重复改写。

## 任务卡形状

```markdown
# {one-line title}

## 目标
{1-2 sentences restating the goal}

## 约束
- {constraint}      (omitted when none)

## 验收
- {verifiable criterion}   (omitted when none)

—— 原始请求 ——
{the user's verbatim original}
```

LLM 契约（`src/llm.ts` 的固定 system 提示）禁止编造消息不支持的约束或验收——没有就省略整节。解析器（`parseLlmCard`）在模型边界校验形状：缺标题或目标即回退模板，绝不带病出货。

## 不变量

`@huiliyi37/dsh-task-card/invariant` 从权威会话日志验证归属关系：带任务卡标记的消息必须保留非空逐字原文、保持 `source.kind === 'user'`、且是会话的第一条用户消息（这同时使第二张卡不可能出现）。

## 模型体验

### 卡片生成调用（LLM 模式）

#### 模型看到的内容

一次有界的辅助模型调用，携带固定的卡片生成契约作为系统提示词、用户首条消息（至多 `maxInputChars`）作为输入；在 `timeoutMs` 截止时间下零重试。

#### Token 影响

每会话一次调用，输出以 `maxOutputTokens`（默认 300）封顶；模板模式完全不调用。

#### KV Cache 影响

一个独立的短生命周期请求；它的任何内容都不进入会话前缀。

### 改写后的首条消息

#### 模型看到的内容

会话的首条用户消息变成任务卡：`# 标题`、`## 目标`、可选的 `## 约束` 与 `## 验收`，以及 `—— 原始请求 ——` 之下的逐字原文。

#### Token 影响

任务卡原地替换原始首条消息；增量是叠加在保留原文之上的卡片骨架（标题与列表标记）。

#### KV Cache 影响

改写挂在 `agent/pre-step`、先于会话首次请求，因此任务卡从第一个请求起就是前缀的一部分——对话中途无扰动。

## 已知限制与后续工作

- **无 re-entry**——只改写第一条消息；会话中途的「新任务」重构不在范围内。
- **模板模式不增加语义**——它结构化消息（标题 + 目标）但不推断约束/验收；那是 LLM 模式的职责。
- **无 UI 卡片面**——TUI transcript 以普通用户消息样式显示改写后文本；专属卡片渲染列为后续。
- **子代理从不改写**——派发提示已经是锚定。
