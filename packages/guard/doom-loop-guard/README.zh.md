# @huiliyi37/dsh-doom-loop-guard

[English](README.md) | 中文

这是一个仅提供建议的循环中断器，而非面向模型的工具：它不会出现在工具列表中，不会否决或改写调用，只增加一种行为：监视每个 agent（智能体）的工具调用流，当流中出现 [repeat-tool-guard](../repeat-tool-guard/README.md) 的相同调用链不覆盖的循环模式（交替出现的调用对、同一文件上的连续失败编辑、输出不变的失败测试运行）时，注入逐级增强的建议性提醒。决定权仍完全在模型手中：合理的调用序列既不会延迟，也不会受阻。它绝不重复「完全相同调用」提醒。那条链属于 repeat-tool-guard。

## 配置

```yaml
- id: doom-loop-guard
  name: '@huiliyi37/dsh-doom-loop-guard'
  config:
    oscillationPairs: 2       # default; A,B,A,B trips the oscillation detector
    editRetryThreshold: 3     # default; consecutive failed same-file edits
    testChurnThreshold: 3     # default; consecutive identical failing test runs
    exclude: []               # extra tool-name patterns transparent to every detector
    argumentsPreviewChars: 200 # default; cap on the churn reminder's command preview
    reminderBudget: 3         # default; reminders per agent per user-turn
```

所有数字字段都会在插件加载时明确报错（必须是整数且大于等于 2，`argumentsPreviewChars`／`reminderBudget` 为大于等于 1），绝不静默回退。`exclude` 条目支持 `*` 通配符，并对调用发生时实际存在的工具执行谓词判断，而不是引用注册表条目。内置排除列表覆盖只读的探查类工具（`read`、`glob`、`grep`、`file_info`、`related_tests`、`task_output`、`task_list`、会话／记忆／网络搜索、`skill`），因此合理的「先搜索再行动」节奏不会触发任何检测。

## 检测器

- **振荡（oscillation）**：最近的 `2 × oscillationPairs` 次调用恰好由两个工具交替构成（A,B,A,B，……），且每个工具各自的规范化身份始终相同，同时至少有一次调用失败或报告了失败。纯成功的交替可能是合理的「先搜索再行动」节奏，绝不会触发。
- **编辑螺旋（edit spiral）**：同一路径上编辑类工具（`str_replace_editor`、`edit`）的连续失败（`isError`）调用。该路径上的一次成功编辑会清除标记，因此下一次真正的螺旋仍能触发。
- **测试空转（test churn）**：同一测试命令（`run_tests`，或包含 `test` 的 `bash` 命令）的连续运行，其规范化输出哈希保持不变，且输出报告了失败。哈希规范化会剥离耗时标记（`in 1.2s`），因此相同的失败运行会得到相同的哈希。

每个检测器按模式去重，直到该模式中断；每个用户轮次的 `reminderBudget` 限制提醒数量，但观察在预算用尽后仍会继续。没有 agent 的调用会被忽略；链按 agent 隔离，遇到用户消息时重置。

## 提醒传递

提醒通过 post-execute 决策的 `additionalContexts`（来源为 `{kind: 'plugin', plugin: 'doom-loop-guard'}`）传递，绝不替换 `content`：`tool/result` 事件仍保留工具自己的输出，供审计使用。循环会缓冲这段上下文，并在该步骤的工具结果之后将其作为注入的 `user/message` 追加；会话将它渲染为普通的合成用户消息：对模型可见、带有来源归属，且无需新增会话事件即可从会话日志重建。guard 始终通过 `next()` 委派，并把自己的提醒放在下游决策的上下文数组之前（两种决策变体都适用：被阻止的调用同样会收到提醒）。

## 模型体验

### 模型看到的内容

不会添加工具 schema 或正常调用文本。检测触发时，对应 agent 会收到一条建议性提醒，指出命中的模式、涉及的工具或路径，以及换一种做法的建议。

### Token 影响

检测器触发前为零 token。每条提醒都有长度上限：测试空转提醒对规范化命令身份的预览以 `argumentsPreviewChars` 为上限；振荡与编辑提醒为固定长度。

### KV Cache 影响

仅追加；新出现的内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **仅覆盖精确模式**：三个检测器覆盖振荡、失败编辑螺旋与输出不变的失败测试；更缓慢的漂移（近似变体、长周期循环）可以绕过它们。
- **压缩（compaction）不会重置状态**：跨越压缩检查点的窗口会继续计数。
- **仅提供建议**：尚未实现达到较高阈值后升级为 `block`，但 `PostToolDecision` 已支持阻止调用。
- **测试空转的哈希是文本级**：规范化只剥离耗时标记；其他易变输出（时间戳、时长）会让两次相同的失败运行得到不同的哈希。
- **超过阈值后，合理的重复轮询仍会收到提醒**：可通过阈值、`exclude` 与 `reminderBudget` 配置释放压力。
