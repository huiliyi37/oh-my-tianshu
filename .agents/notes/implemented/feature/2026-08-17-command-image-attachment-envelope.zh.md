# Agent Note: Command 图片附件信封

Status: implemented

[English](2026-08-17-command-image-attachment-envelope.md) | 中文

## Problem

TUI composer 的一次提交是一个信封——草稿文本加上已附加图片——但两条提交平面对它的消费是不对称的。普通消息会把图片序列化进 prompt 内容；斜杠命令则走 `ctx.commands.execute(agent, line, signal)`，一个纯文本事务：`/plan` 带上参考截图时，命令执行、草稿清空，图片却静默滞留。模型从未看到它们，也没有任何界面提示。这个缺陷在契约层面而非某个漏掉的调用点：命令注册表中没有任何环节建模附件，因此任何命令都可能消费提交的文本一半而丢弃其余部分。composer 还会把 `/plan off` 这类纯插件命令误判为文件路径，使它们根本到不了 cordis 命令平面。

合并两个平面从未在考虑范围内——[插件命令注册 Agent Note](2026-07-19-plugin-command-registration.md)刻意让人类命令留在模型平面之外，这个分离是正确的。问题在于信封在平面分叉处被拆散了。

## Decision

提交信封被端到端建模，每条命令路径要么整体消费它，要么响亮拒绝。

**声明。**`CommandDefinition.input.images: boolean`（缺省为 false）声明 composer 图片是否可以随调用提交。该标志在注册时校验为布尔值，并随冻结的 `CommandDescriptor` 经 `commands/list` 到达每个客户端。

**无准入存储的载荷。**composer 在图片进入草稿时已完成校验，因此命令路径原样携带 data URL：被接受的调用会以冻结、有序的 `ImageBlock` 数组挂在 `invocation.attachments` 上交给处理器。这条路径上没有附件存储、准入批量或内容寻址；图片仍是唯一已经定义模型块语义的非文本附件。

**执行器强制。**`CommandRuntime.execute(agent, line, signal, images)` 以可选第四参数（缺省为空）携带本次提交的图片，因此既有的三参调用点——包括位于本次变更不拥有的包内的调用点——都无需改动即可编译；上游的 `(agent, line, images, signal)` 参数序被刻意放弃。强制执行声明的是执行器而非 composer：把图片发给未声明的命令，会在处理器运行前以记录在案的 `command/done` 错误结算。

**模型可见性由生产方负责。**注册表自身绝不调度这些图片。`/goal` 在 create 或 edit 成功后通过 `agent.followup` 提交一条用户消息——图片块加固定文本 `Reference images for the goal objective.`——后续 Goal Round 从普通会话历史读取图片，goal 领域不存储附件状态。`/plan <message>` 把图片并入其 steer 的文本消息；不带参数的 `/plan` 则 steer 一条只含图片的用户消息，因为图片可能包含全部任务内容。不会发送模型输入的控制形式（`/goal pause`、`/plan off`）会直接返回错误，composer 的图片原地保留。plan 投影会把 `command/run` 视为候选选择，并在配对的 `command/done` 报错时丢弃它，因此被拒绝的带图 `/plan off` 不会留下待退出状态。

**TUI 载体。**composer 的斜杠路径把已附图的 data URL 转成图片块并传给 `execute`；草稿图片只在成功 outcome 后清除，出错或抛异常时保留。斜杠命令识别现在回退到 cordis 注册表的 `find`，因此 `/plan` 这类纯插件命令不再被误读为文件路径。仍有一处已知遮蔽：TUI 内置的 `/goal` 命令拦截了该名字，因此 goal 信封无法从 TUI composer 到达，改经注册表层覆盖。

## Testing

注册表声明校验、执行器强制与冻结的调用附件由 `packages/interaction/commands/tests/commands.spec.ts` 覆盖；生产方行为在 `packages/goal/command-goal/tests/command-goal.spec.ts` 与 `packages/plan/plan-mode/tests/plan-mode.spec.ts`（含投影的命令结算用例）；TUI 载体的透传、成功清除与出错保留路径在 `packages/tui/tui` 的 `app.spec.ts`。

## Alternatives considered

- **附加图片时一律拦截命令（没有接受路径）**——被拒绝：可预测，但带参考图的 `/goal` 正是驱动这次修复的用例，用户的图片将完全没有通往模型的路径。
- **任何命令后把滞留图片自动作为后续用户消息发送**——被拒绝：对宿主状态命令（`/model`、`/compact`）令人意外，且把消息契约从生产方挪到 composer，违反命令注册表「生产方负责模型可见工作」的规则。
- **在 goal 领域存储附件引用并渲染进 Round 提示词**——被拒绝：需要持久化 goal schema 变更，且要么把图片块复制进每轮提示词，要么引入仅首轮的提示词形态；round 提示词不变量将需要附件状态。一条普通的已记录用户消息达到同样的模型可见性。
- **只要命令成功就消费图片，不管语法**——被拒绝：`/goal pause` 带图会把图片静默丢弃，在更深一层重演原始缺陷。消费与生产方的显式成功绑定，语法不匹配返回错误。
- **只在客户端强制**——被拒绝：没有执行器强制的声明只是建议；直接调用 `ctx.commands.execute` 的调用方可以绕过 composer。执行器自己结算声明。
- **上游的必填第三参数 `execute(agent, line, images, signal)`**——本地拒绝：它迫使每个调用方显式陈述信封，但有三处调用点位于本次变更不拥有的包内，其余数十处也会为一个多数用不到的参数翻动。带默认值的第四参数以零调用点改动携带同一信封；参数序是本地对上游唯一刻意的偏离。
- **把命令载荷泛化成多媒体附件联合类型**——被拒绝：文件和视频尚无共同的录入规则与模型可见语义，一个不带类型标记的联合类型也无法提供这些信息。出现第二种受支持附件时再引入泛化：信封扩展为带类型标记的联合类型，命令声明接受的类型。

## Consequences

- 任何命令路径都不可能消费提交的文本而滞留图片：契约强制整信封消费或可见拒绝，对现有与未来命令一体适用。
- commands 包新增对 `dsh-llm` 的依赖，`commands/execute` 携带可选的第四 `images` 参数——既有三参调用方默认陈述空信封。
- `/goal` 与 `/plan` 获得参考图输入，代价是一条额外的已记录用户消息（goal）与 steer 消息中的图片块（plan），其中不带参数的 `/plan` 会产生只含图片的消息；所有这些输入的计费都与常规图片提示词相同。
- 命令路径上的图片有效性由 composer 负责：没有准入存储，直接调用 `execute` 的插件可以把任意 data URL 交给声明了图片的命令。等出现第二个载体时，再考虑在此引入 attachment 包的准入。
- TUI 内置 `/goal` 遮蔽意味着信封的 goal 生产方目前只能经 cordis 命令平面到达，而非 TUI composer；解除遮蔽是关于该内置命令自有语法的另一个决定。
