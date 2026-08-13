# Agent Note: Client Tool 展示所有权

Status: implemented

[English](2026-08-08-client-tool-presentation-ownership.md) | 中文

## Problem

Client Runtime 已经按 `callId` 配对 Tool call/result，并能从 Code Dispatch 事件恢复 root/subcall 拓扑，但 Chat view 曾同时拥有 Tool 在对话流中的放置、递归调用树、按 Tool 名称分发、Generic fallback、card model 和第一方 Tool renderer。`ui-conversation` 因此必须解释每个业务 Tool 名称；只移动单个 React 组件不会改变这层所有权，移走原子 renderer 后 subcall 也会成为无主逻辑。

Tool presentation 需要一个独立所有者，同时不能建立与 Client slot 平行的第二套注册表，也不能让每个原子 Tool renderer 自己理解 root/subcall 结构。

## Decision

Tool 是 Client UI 的一级展示概念，由 `@deepseek-ai/dsh-client-ui-tool` 统一拥有 root/subcall 编排、按 wire Tool name 的原子 renderer 分发、Generic fallback、card model 和 details output。业务插件只注册自己的原子 Tool renderer，不修改 conversation 或 Session。

Conversation 数据组装遵循后续的 [Conversation 业务节点决策](2026-08-09-client-conversation-node-assembly.md)。`ui-conversation` 的 Tool Definition 从 Session Event 配对 root call/result，把 Code Dispatch edge fold 成递归 `ToolCallBlock.subCalls`，并生成一个稳定的 `tool-call` Chat Node；这里的数据职责只处理官方 Tool identity 和拓扑，不解释具体 Tool 名称的展示。

[`ChatView`](../../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx) 只按 Chat snapshot 的 `order` 放置通用 [`ChatNodeSeat`](../../../../packages/client/ui-conversation/src/client/chat/ChatNodeSeat.tsx)。Seat 以 `node.kind` 分发 `'conversation.chat.node'`；[`ui-tool`](../../../../packages/client/ui-tool/src/client/apply.ts) 注册 `tool-call` entry，并由 [`ToolCallTree`](../../../../packages/client/ui-tool/src/client/tool/ToolCallTree.tsx) 递归遍历 root block。每一层 root 或 child 都通过同一个 keyed/session `'tool.call.toolview'` 子 slot 以 `entryKey: toolName` 分发，缺少注册时渲染 `GenericToolCard`。

业务 Tool 插件接收一个标准 `ToolCallBlock`、identity、workspace cwd 和宿主动作，不读取 Session、Context 或 Conversation assembler。Skill 仍是普通 Tool；它和其他业务 Tool 使用同一 keyed slot 注册路径。

details panel 是第二个 Tool 展示点，但不是调用树所有者。`ui-conversation` 定位 selected call，并通过 `'conversation.details.tool'` 委托 output body；`ui-tool` 复用 card model，插件缺席时 conversation fallback 保留 raw result text。

## Runtime and render path

```text
Session Event window
  -> Tool Definition -> tool-call Chat Node (recursive ToolCallBlock)
  -> ChatView -> ChatNodeSeat(entryKey = tool-call)
  -> ToolCallTree
       -> root/subCalls[] recursion
       -> tool.call.toolview(entryKey = toolName)
            |- registered atomic view
            `- GenericToolCard fallback
```

## Ownership boundary

| 所有者 | 拥有 | 明确不拥有 |
|---|---|---|
| Client Runtime Conversation engine | Context identity、Location、历史重放、view Node 发布 | Tool 事件含义、调用树、Tool renderer |
| `ui-conversation` Tool Definition | call/result 配对、Code Dispatch 拓扑、running/settled/interrupted `ToolCallBlock`、Chat 排序 anchor | Tool 名称分发、card model、递归 React 结构 |
| `ui-conversation` Chat view | keyed Node 顺序、scroll anchor、selection 与宿主动作 | Tool lifecycle、subcall 组合、原子 Tool renderer |
| `ui-tool` | root/subcall 递归渲染、原子 keyed dispatch、fallback、card model 与 details output | Session Event fold、Chat 排序 |
| 业务 Tool 插件 | 一个或多个 wire Tool name 的原子 renderer | root/subcall 位置、生命周期配对、Session projector |

## Verification

`ui-conversation` 测试固定 Tool Definition 的 call/result、Code Dispatch、interruption 和 running-to-settled keyed identity，不导入 `ui-tool` 的生产 renderer。`ui-tool` 测试挂载真实 conversation 宿主，固定 root/subcall 递归、keyed dispatch、Generic fallback、selection、details 和具体 Tool card。组装后的 Web 测试覆盖两侧插件共同装载的路径。

## Alternatives considered

**在每个 conversation view 下保留原子 Tool slot。** 拒绝：每个 view 都要重复 root/subcall 编排，Tool 注册也会按 view 分裂。整个 Tool renderer 占据 view 的一个业务 Node slot，原子分发由 Tool 自己拥有。

**只移动 Tool React 组件与 card model。** 拒绝：conversation 仍会按 Tool 名称分发并递归 subcall，文件位置变化不产生所有权边界。

**为 Tool 建立专属 projector/fold registry。** 拒绝：通用 Conversation assembler 已拥有 Context identity、历史窗口和发布；第二个 Runtime registry 会制造生命周期的双重权威。

**让每个原子 Tool renderer 递归自己的 subcall。** 拒绝：原子注册方只应理解一个 Tool call，不应知道自己是 root 还是 child。递归结构统一由 `ToolCallTree` 处理。

**让 `ui-conversation` 直接导入 `ui-tool` 组件。** 拒绝：这会反转 feature 依赖并把 Tool 展示变成必选能力。slot 保留独立装载、生命周期和 fallback。

## Consequences

`ui-conversation` 不再依赖 Tool 名称对应的业务展示，root 与 subcall 也不会漂移到不同分发路径。业务包可以独立拥有原子 Tool renderer；`ui-tool` 缺席时，Conversation 数据组装仍然成立，Chat Node 使用通用 fallback，details 保留 raw result。

代价是 `ui-tool` 明确依赖 conversation 声明的业务 Node slot 和 locale namespace，并拥有一个 Tool 专属子 slot。Tool Definition 暂时位于 `ui-conversation`，因为本次没有拆 package；它以后可以沿 Conversation registry seam 移动，而不会改变本 Note 规定的展示所有权。
