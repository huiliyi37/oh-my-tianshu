# Agent Note: Agent 角色定义——markdown 发现的委派角色

Status: implemented

[English](2026-08-16-agent-role-definitions.md) | 中文

## Problem

委派工具此前只能通过逐实例的部署配置组合子 agent 的 persona、工具过滤器、模型路由和深度：部署方想要的每种组合都得是一个独立命名的工具，模型无法逐调用选择组合。Claude Code 的对应面是 markdown agent 定义加 description 驱动的委派。同时，能力位显示只有进程内提供方才能真正兑现 `persona`/`toolFilter`；子 agent 回传父级的文本链路零消毒（读到不可信内容的子 agent 可以返回被父级解析为 harness 指令的标记）；也没有用于廉价探索委派的内置只读角色。

## Decision

**角色是启动请求输入的命名组合，不是新提供方**（`packages/subagent/agent-definitions`,`ctx.agentDefinitions`):

- **发现机制照抄 skill seam 的本地形态**：扁平 `<name>.md` 文件（frontmatter 必填 `name`/`description`，可选 `tools` allow 名单与 `model`；正文成为 persona)，分级目录——项目 `.dsh/agents` 100、`.agents/agents` 200、custom 300、用户 `~/.dsh/agents` 400、`~/.agents/agents` 500、bundled 600——同名 first-wins、chokidar 失效与 `fs/observed` 首方变更失效。这些原语是对 `dsh-skill-local` 私有实现的有意复制（已标注 jscpd)；运行时 `register()` 位于第 250 级。单个服务包同时拥有发现与注册；因为没有第二个来源，不设 provider 注册表。
- **模型经 durable 目录消息见到角色，而非 schema。**`agent` 参数是自由字符串；每个装配中一个工具实例（`agentCatalog: true`，基础 bundle 在 `subagent` 上启用）以 sha256 条目 digest 版本化和首发/替换/摘除三态发布 `<available_agents>` durable `catalog` 形式 user 消息，复制自 `dsh-tool-skill`。所属工具被 restrict 摘除时目录同步消失。这保持了「model-visible ⟺ logged」铁律：schema enum 会让每次请求变化而无会话事件对应。
- **角色绝不放宽部署。** 实例配置的 `toolFilter` 仍是与角色 allow 名单求交的上限（交集为空则响亮失败）;persona 与 model 替换实例配置；未知名称报错并指引查看目录。
- **`sandboxMode: 'read-only'` 加入启动请求能力集**(`SubagentCapabilities.sandboxMode`;spawn/fork 公布具备，进程外提供方在启动时拒绝）。进程内子 agent 在创建窗口追加 durable `sandbox/mode {source: 'delegation'}` 事件——一次性与可继续新建走同一追加——收窄记录在子 agent 日志上，冷恢复回放即生效。该字段只能收窄：字面量类型使放宽无从表达。描述符保持第 2 版：角色组合以解析后的 `persona`/`toolFilter` 加该日志事件持久化，绝不记录角色名。
- **内置 `explore` 角色从代码注册**(`builtinExplore: false` 可关闭）：只读 persona、基础装配只读工具的 allow 名单（`grep`、`read`、`glob`、`semantic_search`、`bash`——按现役工具名更新的 `code_scout` 先例），以及使其 shell 访问不可变更的只读沙箱收窄。
- **回传消毒**：子 agent 输出文本（前台结果、一次性后台任务输出）、`report` 投递和 `send_message` 跟进消息，在工具边界经 `escapeText` 伪 XML 转义，durable 记录保存的正是接收方模型看到的惰性文本。

## Alternatives considered

- **每个角色一个新提供方**：否决——提供方选择是部署接线（cordis.yml 的 `provider: spawn`)，而且只有进程内提供方能兑现 persona/toolFilter；角色作为请求输入可以不改动地复用 `applyChildComposition`、描述符与能力校验。
- **工具 schema 上用角色名 `enum`**：否决——仓内所有 enum 都是静态闭集，且按请求动态变化的 enum 违反「model-visible ⟺ logged」，因为会话日志无法重建模型当时看到的可选项。
- **每个工具实例各挂一个目录监听器**：出厂两个实例（`subagent`、`subagent_fork`）共享一个 `agent-catalog` source kind 时，restrict 摘除场景会在同一步内产生互相矛盾的发布/摘除决定；指定单一属主（`agentCatalog` 配置）保持 skill 目录语义的精确性。
- **描述符升第 3 版携带角色名或沙箱模式**：否决——冷恢复需要的是组合而非名字，且 `sandbox/mode` 事件已在子 agent 日志上 durable;continuable 路径也因此无需响亮失败分支。
- **把 skill/agent 发现原语提取为公共包**：推迟——skill 侧原语是私有的且仍在演进（目录包、调用策略）；扁平文件的窄复制比今天耦合两个包更便宜。
- **定向标签中和而非完整 `escapeText`**:skill 目录先例对 `&`、`<`、`>` 全部转义，彻底且可审计；角色回传文本对模型仍可读，且 durable 记录与模型所见一致。

## Consequences

- 覆盖：12 个新 `agent-definitions` 用例（发现/分级/frontmatter/监听/内置角色）、11 个新 `tool-subagent` 用例（角色合并、上限、未知名、目录三态、转义），以及 seam 层用例——能力拒绝、真实沙箱围墙下的一次性 `sandbox/mode` 追加、冷恢复前后的 continuable 持久化、`report`/`send_message` 转义。整个 `packages/subagent` 套件与受波及的 `workflow`/`scaffold` 套件保持全绿。
- `SubagentCapabilities` 新增字段对仓外提供方是破坏性形状变化（预发布立场：不加兼容垫片）；仓内所有字面量已更新。
- 已推迟并记录在新包 README：按角色裁剪作用域子工具（`report`)、`.claude/agents` 兼容源、markdown frontmatter 的沙箱收窄字段。
- 配置期 persona/toolFilter/depth 的组合控制设计理由仍归 [subagent 组合控制 Agent Note](2026-07-12-subagent-persona-tool-filter-and-depth.md)；本 note 拥有其上的逐调用角色层。
