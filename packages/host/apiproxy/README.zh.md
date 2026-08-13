# @deepseek-ai/dsh-host-apiproxy

[English](README.md) | 中文

所有客户端形态共用的 API 网关：TS 约定（`src/api/`，不依赖 Node，可从浏览器导入）、fetch 载体对（`src/fetch/`：宿主侧的 `toFetchHandler`，以及客户端侧的 `AbstractApiClient` 与平台子类）和宿主侧实现（`src/api-proxy.ts`：`createApiProxy` 加上默认导出的 `ApiProxyService` 网关插件，其配置为 `{workspaceRoot?}`，提供 `ctx.apiProxy`）。该包在设计上与传输方式无关，不注册任何路由；HTTP 等载体自行包装 `ctx.apiProxy`。随发行版交付的 Web 组合位于 [`packages/bundle/web-app/cordis.patch.yml`](../../bundle/web-app/cordis.patch.yml)，其默认 Agent（智能体）模型选择属于 base 组合包中的 [`@deepseek-ai/dsh-agent-default-model`](../../core/agent-default-model/README.md)。

## 共享 Agent 默认值（`agent-default-model` Settings 分节）

`ApiProxyService` 消费 `ctx.agentDefaultModel`；它不持有提供方／模型配置或 Settings 分节。共享服务在 `agent-default-model` 下注册 `{provider, model, reasoningEffort?}`：base 组合包的组合条目是底层，`settings.yaml` 把用户选择叠加其上。`workspaceRoot` 仍属于 ApiProxy 配置，因为它是 Host 启动器事实，而不是模型偏好。

会话每次访问时都按三级解析模型选择：本进程内作出的选择，其次是该会话日志中最新的 `request/header`，最后是这个默认值。已经跑过一轮的会话从自己的日志推导选择，空白会话则能观察到创建之后保存的默认值。

`session.selectModel` 会把接受的切换保存为部署默认值；没有单独的选择动作。它存储已解析的 `ModelSelection`，包括适配器实体化的默认推理强度。完整分节写入会在所选模型没有推理强度时清除已存值。存储失败只记日志，不会撤销会话选择。没有设置提供方的部署保留组合条目，切换只对当前会话生效。

Settings 分节中的 `reasoningEffort` 在 agent-default-model 插件配置中刻意没有对应字段：seam 按字段把用户层合并到组合条目之上，因此缺席的键无法覆盖已有键，组合层中的推理强度会在以后选择没有推理强度的模型时继续存在。推理强度的部署默认值属于按模型解析的适配器 profile。

存储的选择独立于目录成员关系。默认值指向不可用的提供方时，它仍会作为会话的 `current` 送到 `session.models`，让选择器请求用户重新选择，而不是静默选用其他模型。反过来，适配器也可以服务其目录中未公布的模型。

## 约定层（`/api`）

协议消息组成一个四象限可辨识联合：发起方 × 请求／响应，与物理通道解耦。四种消息分别是 `ClientRequest`（POST `/api/<method>` 的请求体）、`ServerResponse`（该 POST 的响应体）、`ServerRequest`（SSE 帧）和 `ClientResponse`（POST `/api/respond` 的请求体）。响应始终回显对应请求的 `rpcId`，绝不签发新值。方法的参数与返回值结构只存在于领域接口签名（`SessionsApi`、`HostApi`、`EventsApi`）中；`RpcMethodMap` 注册方法，其他所有位置均通过 `RequestPayload<K>`／`ResponseValue<K>` 派生。Zod schema 以 `satisfies z.ZodType<Wire<T>>` 锚定类型，并分两层解析：先解析信封，再解析业务载荷，随后按方法分发。业务错误由 `RpcResult` 的错误分支承载（`RpcErrorDetailsMap` 封闭错误码集合）；HTTP 状态只表达载体层结果。每个 `/api` POST 都必须声明 `application/json` 媒体类型——否则在分发前即以 415 拒绝，因此跨站「简单请求」（浏览器不经 CORS 预检就会发出）永远无法盲目执行有副作用的方法。

分层与协议决策记录在 [GUI 分层与 RPC 协议 RFC](../../../.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)中；浏览器侧消费架构记录在 [Web 客户端架构 RFC](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md)中。

首个回答认领待处理请求之前，系统会对照该请求校验问题响应。多选题的回答项可以同时携带 `selected` 中的请求选项标签与非空 `custom` 文本；单选题的回答项必须二选一。标签重复、标签未知、id 不匹配、批次不完整以及自定义文本为空都会以 `bad-response` 拒绝。

`session.history` 会读取已附加 Session 的内存状态，或通过持久化检查冷日志，而不会恢复或发布 agent，然后按追加来源的消息边界分页：`maxMessages` 统计以追加方式进入 surface 的 `user/message` 和 `assistant/message` 事件，因此仅供模型使用的替换副本不占用配额。每一页仍是一段连续的原始事件区间，从而让压缩（compaction）的仅日志 `compact/summary` 记录与引用它的替换留在同一页。

`session.history` 的尾页（不带 `beforeSeq`）额外携带一个可选的 `projections` 块——`ctx.sessionProjections`（`@deepseek-ai/dsh-session-projection`）上每个已注册单元的水位线快照，`asOfSeq` = 这些值共同反映到的最后一个事件 seq（空日志为 `-1`）。网关还订阅注册表的变更流，为每个状态发生变化的单元生成一个 `session/projection` mux 帧（`{sessionId, key, value, seq}`——实时推送状态，绝不入日志；客户端按 seq 高者胜维护一个按会话的通用值仓）。载体不持有任何领域知识（每个值在注册表内部已过其单元自己的 schema；协议 schema 对 `values`/`value` 保持宽松）；loadOlder 页永不携带该块，未装注册表的组合则两个面都不提供。

会话标题与其他所有领域一样搭乘这对通用投影机制——历史尾页的 `projections` 块外加 `title` 键下的 `session/projection` 帧（专设的 `session/title` 帧已下线）。标题不会加入 `session.list`；冷会话在其中仍只有元数据，直到打开或恢复操作附加其日志。`session.rename` 接受用户显式标题（冷会话先恢复），委托给 `ctx.sessionTitle.rename`——被接受的 `session/title` 事件将标题钉住、不再被自动生成覆盖——并返回规范化后的标题及其事件 seq，让 client 在推送帧到达前就结算自己的 `title` 投影格；规范化后为空的标题返回 `title-invalid`。

`session.fork` 将可选事件锚点映射到该锚点处或其后的首个 `turn/end`，使消息操作可包含该消息所在的完整轮次。锚点省略或超过末尾时，选择最后一个已完成轮次；若锚点已在日志中，而其所在轮次仍开放，则返回 `fork-unavailable`，不会向较早位置裁剪。发布后的子会话会先继承源会话的种子历史、cwd、日志中最新的 `ModelSelection` 及谱系，再加入源 Workspace。如果附加到 Workspace 失败，`workspace-attach-failed` 会携带已发布的子会话 id，供客户端对账。[SessionStore fork 决策](../../../.agents/notes/implemented/feature/2026-06-30-session-store-fork-api.md)给出边界设计的理由。

会话模型选择属于会话领域约定。`session.models` 将当前 `ModelSelection` 与按提供方分组的建议性模型、精确模型的推理（reasoning）元数据和逐提供方查询失败记录分开返回。该选择可能不在这些分组中，也绝不会作为合成行注入；客户端可以提示用户作出另一项选择，而无需把目录变成路由白名单。`session.selectModel` 校验由适配器持有的可选推理强度，并指定将在下一提示词组装边界使用的完整选择。目录成员关系不构成校验：适配器可以解析未列出的模型，而不可用的提供方或不受支持的推理强度会返回 `model-unavailable`。`session.models` 还会报告 `routable`，即当前是否有适配器为所选提供方提供服务。该值刻意不从分组推导，因为适配器可以服务未公布的模型。`session.prompt` 会依据同一事实，在开启轮次之前以 `model-unavailable` 拒绝；客户端禁用 composer 只是提示性设计，这个方法始终可被调用。

待处理的 queued 输入属于实时控制平面约定，而非对话历史。网关根据持久 `agent/inbox/spliced` 变更派生完整的 `next-turn` 队列，并在每次变更后及重连时广播权威 `session/queue` 快照；待处理的 `next-step` steering（中途引导）不进入此 Web 投影。在 `next-step` 内，用户来源的消息携带 `steering` placement，而注入上下文（审批通知、任务完成、附加快照）携带 `context`，领取前不对外呈现。面向单条消息的 `agent/inbox/inserted`、`claimed` 与 `discarded` 通知仍供生命周期观察方使用，但不用于构建队列视图。`session.updateQueue` 通过 `MessageId` 寻址单个项；编辑和移除经已挂载 Agent 的 `Inbox.splice()` 修改队列。claim 的纯删除 splice 会在 pre-step 准入前赢得竞态，因此之后的操作返回 `queue-item-not-found`。`session.cancel` 仅中止活动轮次并保留待处理 inbox 工作；取消达到完全停稳且结束中的轮次完成 flush 后，AgentLoop 按 FIFO 顺序认领下一条可唤醒消息，浏览器绝不重发或提升它。队列操作绝不恢复冷会话，客户端也绝不根据轮次或状态事件推断某项已退出队列。

Workspace 列表与 Session 列表是相互独立的重连基线。`workspace.create({ name })` 会在配置根目录下创建显示标题唯一的目录，而 `workspace.create({ path })` 会接纳已有的规范目录，并允许由 basename 派生的标题重复。`workspace.delete` 只移除 Workspace 注册记录，`session.create` 接受可选的预分配 Session id，`host/workspace-changed`、`host/workspace-removed` 与 `host/session-added` 则以任意到达顺序携带已提交的增量。`workspace.archiveSession` 向注册表级全局归档集合添加一个会话，并应答完整的更新后集合；`workspace.list` 携带该集合作为重连基线，`host/archived-sessions-changed` 在每次持久变更后推送完整快照。归档只把会话从各分组视图中隐藏，不触碰其日志和 workspace 记账；既非实时也未持久化的会话以 `session-not-found` 失败。删除注册记录会保留目录和会话日志；相关 Session 仍留在 `session.list` 中，并进入 Ungrouped。`SessionSummary.blank` 与 `host/session-added` 帧携带派生的零事件位：客户端隐藏空白会话并按 workspace 复用它们，在首个 `host/session-status(running:true)` 时翻转 blank，并以 `session.list` 作为重连权威；冷会话摘要永远不是空白：惰性持久化让从未追加过事件的会话根本不出现在 `list()` 中。

`session.search` 是以 `session.list` 所列会话为范围的有界内容搜索投影。网关向可选的 `ctx.sessionQuery` 服务请求全局排序后的当前内容视图中的 user、assistant 和 steering 匹配项，并持续消费该结果流，直到获得至多 20 个可见会话／snippet 对及一个前瞻项；返回前仍会依据从列表推导的授权集合重新校验每个命中。提供方分页初始请求 20 个命中；如果第一页请求因这一上限被拒绝，网关会依次探测 10、5、2、1，并在续传和陈旧世代重启中沿用探测所得的页面大小。返回的 snippet 最多包含 240 个 Unicode 码点，响应 schema 则会在每个客户端边界独立强制执行该上限。将授权集合保留在宿主内存中，可在不削弱可见性或排序的前提下避开有效大型语料库的 SQLite 变量上限。

陈旧的续传会丢弃该提供方尝试中的所有部分结果、去重条目和游标，然后依据最初从列表推导的可见性快照从第一页重新开始，但不会丢弃探测所得的提供方页面大小。上限探测与陈旧重试共用最多 100 次提供方调用的限制（因此最多检查 2,000 个命中）；如果某页命中数超过其请求的上限、续传游标重复，或用尽该调用预算后结果流仍未耗尽，都会直接返回 `internal` 业务错误，不返回部分结果。载体请求信号可取消持久化列表枚举、冷会话摘要收集和每一次搜索调用；即使同时收到上限拒绝或陈旧拒绝，也以取消为准。部署若未挂载该服务，或索引／查询故障无法恢复，也会返回 `internal` 业务错误，以便客户端保留仅基于元数据的匹配项。

目录选择委托给组合的 `ctx.directoryPicker` 后端（[目录选择 seam](../directory-picker/README.md)）；调用组合能力 kind 之外的方法会以 `directory-picker-unavailable` 失败（客户端不需要广播——组合的选择器包自己的 client half 渲染匹配的交互）。在 `native` 下，`host.pickDirectory` 打开一个原生选择器并返回选中路径（取消为 `null`）；该方法需等待用户完成操作，不使用默认的 30 秒一元调用超时，而调用方与连接的中止仍会传播至原生进程。在 `browse` 下，`host.listDirectory` 返回一个按名称排序的目录层级，携带面包屑祖先链、`home` 锚点与宿主判定的 `hidden` 标志（不带路径即家目录），`host.createDirectory` 创建一个经校验的子段；后端的类型化失败 1:1 映射为 `directory-unreadable`／`directory-exists`／`directory-create-failed` 错误码。浏览器载体的前缀级信任栅栏（dsh-client-connection）像覆盖其他所有 `/api` 请求一样覆盖上述全部方法。

`host.openPath` 会用操作系统的默认应用打开一个文件系统路径（macOS 为 `open`，Windows 为 `Invoke-Item`，桌面 Linux 为 `xdg-open`）。对于 `.html`、`.htm`、`.xhtml` 与 `.svg`，macOS 和桌面 Linux 会优先使用能够确定的默认浏览器；无法确定时回退到上述应用交接。WSL 会通过 `wslpath -w` 转换每个 Linux 路径，并将所得 Windows/UNC 路径交给 Windows `Invoke-Item`，浏览器可渲染的文档也不例外，而非假定存在 Linux 桌面文件关联。浏览器载体对其施加与 `host.pickDirectory` 相同的回环、同源限制。

`command.*` 与 `skill.*` 领域向客户端暴露宿主命令注册表和 skill（技能）目录。每个方法都通过 `sessionId` 寻址一个会话的 Agent（被服务的会话必有 Agent；`command.*` 经由与 `session.*` 相同的路径恢复冷会话，而 `skill.list` 从会话头解析项目根目录，不触碰 Agent 注册表）。`skill.list` 服务于 composer 的菜单：它返回每一个用户可调用的 skill 及其 `modelInvocable` 标志，让菜单能够标出仅限用户（`disable-model-invocation`）的条目——斜杠手势是这类条目唯一的入口。列表是 skill 领域唯一的 RPC——调用本身就是一次普通的 `session.prompt`，`dsh-tool-skill` 会在 pre-step 边界识别其中以空白为界的 `/name` token，并以注入的 `<skill_content>` 上下文作答，因此每一种前端（web、TUI、ACP（Agent Client Protocol）、手动键入的文本）共享同一条确定性路径，没有专设的调用协议。`command.execute` 在宿主侧运行一条斜杠命令行，语义为纯准入：响应报告该行是否解析到处理器，并在解析到时回带铸造的生命周期 `commandId`（将本次确认与流节点关联）；结局经由持久落账并在 mux 流广播的 `command/run`/`command/done` 生命周期事件对承载。命令处理器运行超过 30 秒的传输健康时限仍属正常，因此 `command.execute` 仅携带调用方／连接取消信号；该信号可取消正在运行的处理器。`host/commands-changed` 是目录失效帧：客户端重新拉取 `command.list` 而不是做差分。

`settings.*`、`credentials.*` 与 `llm.*` 领域是配置页协议。settings 领域服务于已注册可配置提供方所指向的 namespace（`ctx.llm.listConfigurableProviders()`），并额外服务于一份小型、显式的 allowlist——Web 偏好 `permission` 与产品持有的 `ui-onboarding`；仅新增一项 Settings 注册，绝不会使其可被远程读取或写入。其他任何 namespace 都只会得到 `settings-not-exposed`——未注册的 namespace 得到的是同一个答复，因此没有调用方能靠逐个探测把注册表枚举出来。`settings.describe` 为每个已暴露 namespace 提供其序列化 schemastery schema、脱敏后的分层值（resolved/`base`/`user`——字段出现在 `user` 中即标记其被用户覆盖）、`secrets` 槽位列表、该分节的 `revision`，以及布尔型 `hasDocument` 能力标志。浏览器不会收到 Host 路径：无路径参数的 `settings.openDocument` 会请求提供方准备文档，再把由 Host 解析出的结果交给原生打开器，因此任何浏览器载荷都无法选择任意文件系统目标。`settings.update`/`settings.replace` 写入用户层；`settings.mutate` 则在已存分节上施加路径 op（`set`/`unset`），这是持有脱敏视图的客户端的删除路径——据此重建分节再整体替换，会删掉协议从未回传过的那些机密。任何写入都可携带 `expectedRevision`；陈旧的期望值会以 `settings-conflict` 连同两个 revision 作答，而不是覆盖先落地的那个写方，其余每种 seam 拒绝则折叠为 `settings-rejected`。secret 角色的值绝不在任何一层搭乘任何响应；secret 只沿一个方向跨越协议——在 `update`/`mutate` 载荷或 `credentials.set` 之内。`credentials.describe` 返回不含值的视图（`configured`/`source`/`writable`），`credentials.set`/`credentials.unset` 则把被遮蔽引用的拒绝映射为 `credential-rejected`。`llm.providers` 把可配置提供方目录与存活路由合并（休眠条目携带 `active: false`；未声明的存活路由追加在后，不带 settings 地址），`llm.models` 则是与会话无关的目录。`llm.discoverModels` 询问页面尚在起草的提供方端点：`settingsNs` 选出懂得读取该列表的适配器家族，端点、协议与密钥则来自表单而非存储。它什么都不写——回复是候选，只有随后的 `settings.mutate` 才决定路由服务什么——因此其 `apiKey` 是 secret 可以搭乘的第三个载荷（另两个是 `settings.update`/`mutate` 与 `credentials.set`），且绝不被存储或回显。host 从不存储或回传它；与另两者一样，它确实会搭乘客户端的出站信封，`subscribeEnvelopes()` 的观察者能看到——为该 tap 做脱敏是整个配置面的改动，而非本方法一家的事。每一种拒绝（无人服务的 namespace、没有可读列表的协议、不可达端点、被拒凭据）都折叠为 `model-discovery-failed`，其消息是适配器自己的文本，details 点名被询问的端点，绝不点名所提供的凭据。三个失效帧让每个面无需轮询即保持收敛：`host/settings-changed {ns}`（`settings/document-updated` 透传，因此解析值未变的原始变更同样能到达客户端）、`host/credentials-changed {ref}`（只带引用名，绝不带值），以及 `host/models-changed`——它由 `llm/adapters-updated` 和可配置提供方 namespace 的变更触发，因为该提供方的设置正承载着它的目录与端点；`permission` 或 `ui-onboarding` 变更只会发出自身的 settings 失效通知。浏览器载体把整个配置面（含读取与原生操作：`settings.describe`/`openDocument`/`update`/`replace`/`mutate` 与 `credentials.describe`/`set`/`unset`）限制为仅接受来自回环地址的同源请求——即 `host.pickDirectory` 所在的特权集合。未装 settings 或凭据 provider 的组合会以指名缺失插件、包含解决建议的 `internal` 错误应答这些领域。

## 载体层（`/client` + 根路径）

`AbstractApiClient` 持有全部协议不变量：签发 rpcId、包装／解包信封、Zod 解析、SSE 帧解码、一元请求超时，以及按微任务批处理的信封观测（`subscribeEnvelopes`）；平台子类只提供 `doFetch` 传输环节。`InProcessApiClient` 以 `toFetchHandler(api)` 为基础，仍是同构接点：它运行完整的协议序列化与校验路径而不经过网络，供需要该路径的调用方和载体测试使用。产品的 `dsh run` 是直连 core 的入口，不挂载本包。

## 模型体验

无。该包定义客户端与宿主间的协议约定和载体，其中没有任何内容会进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **待处理交互状态位于宿主侧**：协议形状为 POST `/api/respond` 加 `RpcReceipt`；`src/api-proxy.ts` 中的表只处理问题，不包含审批条目。
- **预留 seam 不进入 `RpcMethodMap`**：`prompt.mode: 'inject'`、`task.list` 和描述字段 `hostInstanceId` 都是已记录的预留项；模型发现使用 `llm.models`。未知方法会在信封解析时直接失败，而不会返回「尚未实现」错误码。
- **没有协议版本字段**：客户端与宿主一同发布；只有出现独立发布的客户端后，`host.describe` 才会增加版本协商字段。
- **搜索失败会包含提供方诊断信息**：网关是单用户本地服务。将其暴露给多名用户的载体必须用可安全公开的诊断信息替代内部搜索细节。
- **Linux 原生选择器依赖桌面工具**：在 `native` 能力下，Zenity 和 KDialog 均未安装时，`host.pickDirectory` 会给出包含解决建议的错误提示；组合层面的回退是 browse 后端（见 [native 后端 README](../directory-picker-native/README.md)）。
- **冷会话的 `updatedAt` 会把一次单纯的拾起算作写入（仅逐文件后端）**：已附加投影排除了 `session/end-seed` 边界，因为接手一个会话不算活动；但冷会话的 `updatedAt` 取自其日志文件的 mtime，而每一次持久写入都会刷新它，包括这条边界。`agentFor()` 会在首次触碰时恢复一个冷会话，因此在客户端里仅仅打开一个会话就会写入它。这只适用于 `locate()` 能解析出逐会话产物的场景，即 JSONL；SQLite 返回 `undefined`，因此它的冷会话回退到 `createdAt`，偏差方向相反——偏旧而不是偏新——且与这条边界无关。于是一个被触碰过却没有在里面工作过的会话，在重新附加之前会按晚于其最后一次真实活动的时间排序。要把两者区分开需要读取日志，而这恰恰是 mtime 路径存在的目的；在索引中存储一个最后活动字段可以从源头修好它，范围见[最后活动索引 Agent Note](../../../.agents/notes/proposed/architecture/2026-07-29-durable-last-activity-index.md)。
