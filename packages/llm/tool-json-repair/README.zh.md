# @huiliyi37/dsh-tool-json-repair

[English](README.md) | 中文

这是一个修复插件，不是面向模型的工具，也不是适配器：它永远不会出现在工具列表中，也不会触及请求。它包装 `llm/stream` waterfall（瀑布式事件），把一种故障形态转换为真正的工具调用块：DeepSeek 响应把工具调用以 JSON 文本形式序列化进 `content`，而不是写入 `tool_calls` 协议字段。由此，agent loop（智能体循环）会执行模型原本意图的调用，而不是把它当作普通文本吞掉。检测是 fail-closed 的：只有恰好是一个 JSON 对象、且 `name` 为无首尾空白的非空字符串的文本块，才会被转换；普通文本、截断的 JSON、数组以及包含多个对象的块保持为文本。移植自 opencode-tui（`src/api/json-escape-repair.ts`，Apache-2.0）的无效转义修复，还会在解析前恢复 arguments 对象中的 Windows 路径反斜杠。

## 配置

```yaml
- id: tool-json-repair
  name: '@huiliyi37/dsh-tool-json-repair'
  config:
    enabled: true        # default; false registers nothing
    maxBlockChars: 65536 # default; text blocks longer than this never convert
    allowFenced: true    # default; accept one ```json … ``` fence around the object
```

`maxBlockChars` 在插件加载时快速失败：任何不是大于等于 1 的整数都会抛错，绝不静默回退。

## 转换语义

- **仅整块且单一对象。** 去掉一层可选的 ```json 围栏后，修剪过的块文本必须能解析为单个普通对象，且其 `name` 为无首尾空白的非空字符串。`arguments` 字段可选，缺省则成为 `{}`；任何其他形态都保持块原样。
- **解析前先修复转义。** 字符串字面量中的无效 JSON 转义会被加倍（`F:\智慧项目` → `F:\\智慧项目`），使 arguments 在模型写出未转义的 Windows 路径时仍能通过解析；合法的转义原样通过。
- **一旦出现真正的工具调用即跳过。** 流包装层在任何一个真正的 `tool-call` 块打开后便停止转换，因此已经携带协议级工具调用的响应会保持其文本原样。
- **修复后的流就是被记录的流。** agent loop 记录转换后的 `assistant/chunk` 事件和修复后的 `assistant/message`：「模型可见 ⟺ 已记录」依然成立，且无需新增事件类型。转换后的块复用源块的索引；其调用 id 是确定性的（`repair-<index>-<hash12>`，由 name 与 arguments 计算得出），因此重放同一流会产生相同的持久化日志。
- **schema 校验仍然生效。** 修复后的调用会经过 agent loop 既有的 `agent/pre-tool-commit` 校验：不符合工具参数 schema 的 arguments 会被丢弃并给出警告，与模型自行发起的调用完全一致。

## 模型体验

### 模型看到的内容

系统提示词和工具 schema 中没有任何新增内容。当文本块被转换时，该步骤会像模型发出协议级工具调用那样继续推进：同样的工具执行、同样的 `tool/result` 内容、同样的后续请求。

### Token 影响

没有块被转换时为零 token。被转换的块会把同一段文本移出消息历史（替换为已执行的调用及其结果），因此上下文的净效果就是模型原本意图的那次工具往返。

### KV Cache 影响

前缀不受影响：转换发生在流处理内部、请求发出之后，因此下一轮次缓存的提示词前缀不受影响。

## 已知限制与暂缓事项

- **仅做精确形态检测**：包含普通文本加 JSON、两个对象、数组、以 `tool`／`input` 为键的对象或未完成对象的块，都会保持为文本；扩展形态词汇，有待真实提供方产出这些变体的证据。
- **出现真正的工具调用块后即跳过转换**：混合响应（协议级工具调用加上 content 内的 JSON）保持文本原样；这种罕见的双形态情形交由 agent loop 的常规处理。
- **原始协议文本不被保留**：修复后的流会在记录前替换文本块，因此无法对原始提供方载荷做取证式差异比对；持久化日志始终呈现实际执行的内容。
- **推理块永不转换**：只有 `text` 块才是候选，与文档记载的故障形态一致。
