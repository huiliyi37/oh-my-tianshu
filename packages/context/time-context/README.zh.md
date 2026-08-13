# @deepseek-ai/dsh-time-context

[English](README.md) | 中文

可选的持久上下文，包含模型请求准备期间采样的带时区的当前时间与经过时长。`dsh-agent-spine-demo` 与随附示例不挂载该插件。决策记录：[持久 time-context Agent Note](../../../.agents/notes/implemented/feature/2026-07-16-durable-per-step-time-context.md)。

## 配置

```yaml
- id: time-context
  name: '@deepseek-ai/dsh-time-context'
  config:
    timeZone: Asia/Shanghai  # optional IANA override; omit for the process zone
    refreshIntervalMs: 60000 # optional; omit or set to 0 for every eligible attempt
```

省略 `timeZone` 时，插件会在加载时解析一次 Node 进程的系统时区。Node 遵循 `TZ`；如果没有该覆盖，时区由宿主或容器提供。显式 `timeZone` 必须是 IANA 标识符，并在插件加载时验证。

`refreshIntervalMs` 必须是非负安全整数。省略或设为 `0` 时，会为每次信号尚未中止且会进入步骤的合格步骤前处理添加上下文。正数值只会在会话没有早先 time-context 注入、挂钟时间倒退，或自最新注入起已经过至少相应毫秒数时添加上下文。

## 时序语义

该插件会前置一个 `agent/pre-step` 监听器。需要注入且下游决策进入拟议步骤时，它会在返回批次中添加一条带来源的 `UserMessage`。AgentLoop 会在 `step/start` 之后、普通自动压缩（compaction）之前记录该上下文，其来源为 `{ kind: 'plugin', plugin: 'time-context' }`。被抑制、拒绝或失败的步骤前处理不会记录任何内容。

正间隔调度会扫描原始持久会话事件，查找最新的上述源 `user/message`，包括已被压缩遮蔽的时间读数。因此，调度可以跨轮次以及进程恢复持续生效，不需要进程本地缓存状态。它会降低追加频率与历史增长，但绝不移除现有时间读数，且每个会话独立调度。

第 1 步从前一条模型可见消息起测量，包括开启轮次的提示词。后续步骤从同一轮次中前一个 time-context 事件起测量。两种基线都使用持久会话事件时间戳；挂钟时间倒退时，经过时长限制为零。如果第一步缺少基线，或者后续步骤因间隔抑制而没有较早的同轮次时间读数，则报告 `unavailable`。

时间读数记录的是一个已进入步骤的步骤前批次，不是已完成步骤或已传输请求。后续请求准备失败时，该读数可能已留在历史中；但下游步骤前监听器拒绝或失败时，该读数不会被记录。

单独发布的 `./invariant` 配套模块会根据当前未结束的轮次、下一个步骤前位置、经过时长基线与持久事件时间检查每个归因于插件的时间读数。其渲染时间戳必须可解析，且不能晚于该事件；采样与追加之间的进程挂起不会使时间读数失效。

时间读数会保留在派生会话历史中，直到后续压缩遮蔽它。请求标头不含 time-context 状态。请求重建会在每个 `step/start` 之后使用完整持久表层前缀，因此已传输请求无需与时间读数一一对应：请求准备可能在进入步骤后失败，而间隔抑制可让请求复用现有历史，无需添加时间读数。

## 模型体验

### 准备期时间上下文

#### 模型看到的内容

每次执行注入的准备尝试都会生成一条带源标记的上下文消息，包含下方两行。`<timestamp>` 是带数字偏移与 IANA 时区、形如 ISO 的本地时间戳；持续时间使用紧凑的整秒单位。正间隔可能使某次步骤尝试没有新时间读数。

##### 第一步

```markdown
Time sampled while preparing turn <turn>, step 1: <timestamp>
Elapsed since the preceding model-visible message: <duration-or-unavailable>.
```

##### 后续步骤

```markdown
Time sampled while preparing turn <turn>, step <step>: <timestamp>
Elapsed since the preceding step context: <duration-or-unavailable>.
```

#### Token 影响

每条注入的两行消息都会累积，直到压缩遮蔽它。正间隔会减少添加；省略或设为 `0` 则会为每次合格准备尝试添加一条。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **整秒显示**：时间戳与持续时间省略亚秒精度，尽管持久事件时间保留毫秒。
- **会话事件基线**：经过时长从持久追加时间戳起计算，而非客户端传输的原始发送时间戳。
- **进程本地默认时区**：省略设置时，使用插件加载时捕获的 Node 进程 `TZ`、宿主或容器时区，而非远程用户的时区；两者不同时，请配置显式 IANA 时区。
- **压缩之间的历史成本**：省略设置或设为 `0` 会为每次合格准备尝试保留一条时间读数，包括后续取消或失败的尝试；正间隔可以降低但无法消除该成本。
