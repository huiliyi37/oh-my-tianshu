# @deepseek-ai/dsh-client-ui-deliverables

[English](README.md) | 中文

产出文件功能的属主：把已完成轮次末尾的产出文件行注册到 chat 视图的 `conversation.chat.turnTail` slot 中。全部策略都在本包内；从 cordis.yml 中删去本插件那一行即可整体移除该界面，属主视图无需额外开销即可渲染空 slot。

`deliverablesDefinition` 把每个 Turn 中成功的修改调用折叠进引擎发布的 `DeliverablesTurnData`；`producedForClosing` 结合收尾 Assistant 的 seq 读取这份数据。依据的是修改工具自身附带的 `locations`，而不是收尾正文：无论模型是否记得点名，产出文件都会被列出。修改操作按渲染意图而非工具名识别：diff 卡片，或 `kind` 为 `edit` 的通用卡片（即 `str_replace_editor` 的 insert 操作所呈现的形态）；因此新的修改工具只需声明自身行为即可加入。读取、删除和失败的调用不贡献任何条目；同一路径在一个 Turn 内按首见顺序只出现一次。Conversation Location 索引拥有 Turn 成员关系，因此一个 Turn 即使先修改文件、随后没有正文内容就结束，也不会溢进下一个 Turn 的行里。

`ProducedFiles` 在收尾消息正文与其 IconActions 之间渲染该行：一个低调的标签、至多六个标签项（文本为文件名，完整路径作为 `title`），超出上限则显示一个明确的剩余计数。每个标签项经由属主提供的 `openFile` 打开——与工具行相同的 Host 打开器，chat 视图会把相对路径按会话 cwd 解析。设计原理：[workspace 文件链接 Agent Note](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md)。

收尾正文承载同一份词表。本插件提供供 chat 视图按收尾消息查询的 `chatFileMentions` 服务：`producedFileMentions` 按精确路径解析行内代码 token，或当 token 恰好是且仅是一条产出路径的 basename 时解析——两条路径共享同一 basename 时，文本保持不可点击而不作猜测，因此提及链接永远不会打开错误的文件或 404。解析成功的提及保留代码标签，并采用 Markdown 样式表的链接样式：静止时为链接蓝色，悬停时显示下划线，与 URL 提升的行内代码完全一致——完整路径作为其 `title`；提及绝不会渲染在链接内部或流式文本中。决策记录：[行内文件提及 Agent Note](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md)。

## 模型体验

无。该行是对已记录工具元数据的纯客户端派生，这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **提及匹配只认精确路径或唯一 basename。**后缀式提及（`out/index.html` 写作 `index.html` 可解析；`deep/out/index.html` 写作 `out/index.html` 则不行）保持不可点击；等真实的收尾消息形态产生需求后再放宽匹配规则。
