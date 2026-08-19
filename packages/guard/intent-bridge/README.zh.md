# @huiliyi37/dsh-intent-bridge

[English](README.md) | 中文

意图对齐桥将新会话的首条消息拆分给两个角色。低成本**对齐模型**（路由可配置）在专用的对齐会话中与用户进行多轮澄清对话——都是普通轮次，无挂起机制；意图清晰后它调用 `finalize_alignment`，桥把结构化任务卡交给**全新主会话**。主会话从不继承对齐上下文：它只接收任务卡，而任务卡天然多行、超长，task-card 因此保持幂等（不改写），zen 的 triage 也不会跳过它——主会话自然 arm 禅相位，并在解锁全量工具面之前完成锚定。

对齐会话 seed 一组已完成的 `zen/phase` 序列，zen 因此绝不会 arm 它；它的工具面被限制为仅有 `finalize_alignment`（agent-scoped 注册绕过 restrict 的 allow 列表）；一条确定性的 `session/title` 为 tab 命名；`intent:policy` 系统提示词段落只在对齐会话存活期间渲染对齐契约。

决策记录：[意图对齐桥 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-18-intent-bridge.md)。

## 配置

```yaml
- id: intent-bridge
  name: '@huiliyi37/dsh-intent-bridge'
  config:
    enabled: true                    # default; false mounts the service with no behavior (routes still required)
    alignProvider: deepseek-official # REQUIRED alignment-agent route
    alignModel: deepseek-v4-flash
    execProvider: deepseek-official  # REQUIRED main-session route
    execModel: deepseek-v4-flash
    alignMaxRounds: 5                # default; steps before a template card is force-finalized
    # section: custom alignment contract text (optional; default = the built-in contract)
```

`resolveConfig` 在插件加载时对未知键、缺少 provider/model 对、或非正的 `alignMaxRounds` **响亮失败**。发货的 TUI bundle 按上述路由装配该插件（出厂 DeepSeek 适配器，与 `/model` 共用 `DEEPSEEK_API_KEY`）；部署从 `cordis.patch.yml` 覆盖它们。MiniMax 对齐路由是 overlay：先把 `llm-pi-ai` profile 和密钥加活，不是首次运行的第二把必填 key。

该默认的决策记录：[发货 TUI 对齐路由](../../../.agents/notes/implemented/architecture/2026-08-19-intent-bridge-shipped-align-flash.md)。

## createAlignedSession

`ctx.intentBridge.createAlignedSession(options)` 创建对齐会话并返回其 id 与调用方持有的 `AgentHandle`。两个选项均由调用方持有：`cwd` 让对齐会话**及其移交的主会话**都落入真实项目目录（省略 → 两者持久化到 `_no-cwd/` 下并从 Web 会话列表消失）；`exec` 覆盖本次对齐 handoff 的主会话路由（省略 → 配置中的 exec 路由）——TUI 传入它当前的 `/model` 选择，让主会话跟随用户的模型。

## 交接

`finalize_alignment` 在工具边界校验参数（非空 `title`/`goal`，约束与验收条目至多 4 条；非法调用被拒绝退回模型），在标记之下以逐字原文渲染任务卡，创建全新主会话，把任务卡作为其首条用户消息喂入，在主会话的日志上记录一条 log-only 的 `intent-bridge/handoff` 事件，并 emit `intent-bridge/handoff` 派发事件——UI 观察到该派发后切换会话。

## 失败路径

两条路径都不阻塞任务。对齐轮数耗尽时，桥强制产出模板任务卡并拒绝该步骤，使对齐模型绝不超出预算继续运行。对齐 agent（智能体）出错时，逐字原文直通主会话，由 task-card 的单轮改写兜底。

## 不变量

`@huiliyi37/dsh-intent-bridge/invariant` 从权威会话日志验证 handoff：每个会话至多一条 `intent-bridge/handoff` 记录，携带非空 `alignSessionId` 与已知 reason（`anchor` | `rounds-exhausted` | `alignment-error`）；handoff 后的带卡首条用户消息在标记之下保留非空逐字原文。

## 模型体验

### 对齐会话的首次请求

#### 模型看到的内容

对齐 agent 的请求携带固定的 `intent:policy` 契约段落和唯一工具 `finalize_alignment`；restrict 的 allow 列表被清空，任何全局工具都不可见。契约指示它复述、归类、澄清（每轮 1-3 个问题）并 finalize——绝不执行任务本身。

#### Token 影响

这段固定契约（约一千字符）随每一次对齐请求发送；澄清轮次是普通的短对话，步数受 `alignMaxRounds`（默认 5）约束。

#### KV Cache 影响

该段落的字节在每个对齐轮次完全一致，对齐会话的前缀因此保持缓存稳定；对齐会话消失后该段落即停止渲染。

### finalize_alignment 调用与结果

#### 模型看到的内容

一个工具，参数为 `title`、`goal` 与可选的 `constraints`/`acceptance` 列表（各至多 4 条）；非法调用以契约形状的错误被拒绝退回模型。接受时渲染 `Alignment accepted — the task card was handed to the main session.`

#### Token 影响

每次对齐一对小体量的调用／结果；被拒绝的非法调用增加一个错误轮次。

#### KV Cache 影响

仅追加。

### 主会话的首次请求

#### 模型看到的内容

主会话的首条用户消息是渲染好的任务卡，逐字原文位于标记之下；其提示词不携带任何对齐内容——zen 照常 arm、锚定面照常生效，与任何全新的顶层会话相同。

#### Token 影响

任务卡替换用户的原始首条消息（标题、目标、可选列表、保留的原文）——通常几百 token。

#### KV Cache 影响

任务卡在主会话首次请求之前就位，因此前缀绝不会在会话中途变动。

## 已知限制与后续工作

- **轮数计数器按 agent 步骤计数，而非用户轮次**——在单工具面上两者实际一致；多步骤的对齐轮次会更快消耗预算。
- **经桥接的主会话无法热切换模型**——exec 路由是创建对齐会话时的快照；registry 持有的 agent 不接收 TUI 的 model ref。
- **失败的 handoff 让对齐会话无法重试**——`finalize` 在创建主会话之前就把会话标记为已 finalize，创建失败即无重试路径（恢复方式：新建会话）。
- **对齐 tab 在 handoff 后留存**——它以普通聊天的形式留在 tab 列表中；自动 dispose 列为后续。
