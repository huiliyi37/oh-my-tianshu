# Agent Note:工具前入参改写——一致性设计

Status: implemented

[English](2026-06-30-pre-tool-input-rewrite.md) | 中文

## Problem

[拦截扩展点 Agent Note](2026-06-30-interception-extension-points.md) 把 `tools/pre-execute` 定义为对"身份已受保护、入参已深冻结"的执行体的 allow/deny/ask 闸门。Claude Code 的 `PreToolUse` hook 还提供 `updatedInput`,忠实的桥需要显式的改写机制。改写不能是既有执行对象上的可变逃生舱:它必须保持持久历史、审计记录、展示与被执行值四者一致。

## The problem: three readers of pre-execution arguments

在 loop 中,工具调用的入参在工具执行前就已落账并被多个活读者消费:

1. **`assistant/message`** 在工具派发前落账——它是 `deriveMessages()` 回放派生历史的来源,携带模型自己发出的工具调用入参。
2. **`tool/call`** 是持久审计记录,在 `ctx.tools.execute()` 之前落账。
3. **面向人的展示读 `tool/call.arguments`**:UI 渲染器把它传给 `presentResult`;`dsh-tool-bash` 从它推导卡片标题、rawInput、cwd 与前台/后台形态。

仅执行层改写会让 UI 显示一条命令而实际跑了另一条,并按错误的入参渲染结果。注册表今天阻止这种失败:对 `arguments` 做结构化克隆加深冻结,执行身份属性不可写,不留任何测试旁路或监听改写路径。改写设计必须保住这个受保护的身份边界,而不是削弱它。

## Decision

改写是 pre-identity 一致性事务,落地为 `agent/pre-tool-commit` waterfall(声明于 `packages/core/agent/src/runtime-types.ts`,由 loop 在 `packages/core/agent-loop/src/agent.ts::rewriteToolCalls` 发射):

- 该相位在响应组装完成之后、`assistant/message` 落账之前运行。由于 `deriveEventMessage` 只投影 `assistant/message`(逐字)与 `tool/result`——`tool/call` 是纯审计——以**生效入参**落账消息,派生历史天然与被执行值一致(CC 语义:模型看到改写已生效)。
- `tool/call` 审计事件记录改写后入参,模型自己的原始字符串收进新增的 `originalArguments` sidecar 字段。
- 展示仍读 `tool/call.arguments`,渲染的是实际跑的那次调用。
- 监听返回的集合必须保持相同 call id、相同顺序(否则抛错);每个改写值必须是无损 JSON 且通过工具自身参数 schema(新增 `ToolRegistry.validateArguments`)——失败则丢弃改写并警告,绝不记录工具会拒绝的调用。
- Claude 桥只在此相位触发一次 `PreToolUse`,按 call id 备忘合并结果;其 `tools/pre-execute` 监听重放备忘决定(deny/ask 不变),hook 进程绝不跑两次。绕过该相位的调用(code-mode 子调用、直接注册表执行)仍按原路径在注册表边界触发,但入参已冻结——改写请求保留忠实的降级警告。
- 多个改写 hook 的折叠是确定性的:声明序后者整体覆盖(`hook-protocol/src/merge.ts`)——把 CC 的"最后完成者生效、顺序未定"定死。

## Alternatives considered

### 为什么不直接改执行对象?

允许 pre-execute 监听赋值 `exec.arguments` 只得到执行层改写,模型历史、审计、展示都留在原值。保持身份受保护,就是让这种半成品行为无从表达。

### 为什么不对 assistant 消息做 surface 替换?

`surfaceOp: 'replace'` 今天只支持 `tool/result` 节点(core/session/src/surface.ts:291-313)。把它扩展到改写 assistant 工具块会惊动 surface 不变量却毫无收益:落账时直接写生效入参,同样的历史,零 surface 手术。

### 为什么不用事后更正消息?

单独一条"hook 把 X 改写为 Y"的通知让持久 assistant 轮次与审计永久不一致,每次回放还白烧 token;pre-commit 落点使更正失去必要。

### 为什么不触发两次(早期改写 + 注册表决定)?

command hook 是用户任意进程,有副作用;触发两次既不忠实也不安全。备忘式单发保住了一次执行与两个决定点。

## Consequences

- 提案的验收标准全部成立:改写在 `ToolExecution` 身份创建前解析;`tool/call` 记录改写后入参并保留 `originalArguments`;派生历史与执行一致(桥的 coverage 套件断言下一请求携带改写后的调用);展示读改写后入参;生效的 `ToolExecution.arguments` 全程深冻结。
- provider replay 风险从结构上落定:provider 按 id 配对工具调用与结果,入参是不透明 JSON,携带生效入参的 assistant 轮次回放合法;loop 级测试断言精确的序列化形状。
- 注册表新增公开面 `ToolRegistry.validateArguments`(不执行的合法性校验)。
- 新持久面:`tool/call.originalArguments`(log-only 审计;persistence catalog 已重生成)。新活事件:`agent/pre-tool-commit`(scoped waterfall;scoped-events 解析器已重生成)。
- 残余如实记录:code-mode 子调用与直接注册表执行不可改写(触发点在冻结之后),桥在该路径警告而非假装生效。
