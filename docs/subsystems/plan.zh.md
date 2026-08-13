# 计划模式

[English](plan.md) | 中文

计划模式是 [dsh-plan-mode](../../packages/plan/plan-mode) 拥有的、记录到日志的逐 agent（智能体）协作状态（`ctx.planMode`，`PlanModeService`）：激活期间，一段部署持有的指引段落会影响每个模型请求。它是**软性指引**，有意独立于[沙箱模式](sandbox.md)与[审批策略](approval.md)这两条强制执行轴：那些旋钮（knob）从不读写计划状态，需要硬边界的部署另行组合两者。该包（package）是一项可选能力，不属于 agent loop（智能体循环）主干；它的对外表面是 `plan:policy` 提示词段落、始终保持注册的 `exit_plan_mode` 工具和 `/plan` 命令。[设计说明](../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)负责决策依据；[包 README](../../packages/plan/plan-mode/README.md) 负责模型体验与限制细节。

源码：[`packages/plan/plan-mode/src/index.ts`](../../packages/plan/plan-mode/src/index.ts)

## 已记录状态与恢复

`plan/mode`（`{ active: boolean }`）是仅记日志、整值替换的[会话事件](session.md)：持久且可回放，绝不进入模型 transcript（文本记录）。`foldPlanMode(events, end?)` 返回前缀中最后一条已记录值，没有时返回 `false`：生效状态始终是会话日志的纯折叠，因此恢复、fork 与压缩（compaction）无需实时镜像即可将其复原，UI 通过 `session/event` 观察已提交的切换。完整事件声明见[持久化日志事件目录](../persistence-catalog.md)。

## 待定意图与步骤边界冲刷

由于每个会话事件都位于轮次之内，用户的选择会作为待定意图保留到下一个步骤边界——即下一次请求派生，落在哪个轮次就在哪个轮次生效（选择绝不强制续行，因此在某轮最后一步之后记录的意图会在之后的轮次落地）。`set(agent, active)` 记录待定选择（目标值与已记录或已在待定中的状态相同时不做任何事），`get(agent)` 返回 `{ active: boolean; pending?: boolean }`，即影响当前步骤的已记录状态，加上正在等待边界的乐观选择。

唯一的冲刷点是一个前置（prepend）注册的 `agent/step` 监听器——agent loop 的轮内拦截点，在每次请求派生之前运行，包括第 1 轮第 1 步和请求恢复重试。提示词提交本身绝不冲刷：它发生在轮次开启之前，此时追加 `plan/mode` 会落在任何开启的轮次之外，因此在提示词处做出的选择由它开启的轮次内的第一个步骤边界落地。前置注册意味着冲刷先于下游的 `agent/step` 监听器链运行。冲刷失败会被收容（计划策略绝不能阻塞轮次），追加失败的选择保持待定，等待后续边界。已冲刷的用户选择还会以一条插件来源的 `user/message` 通知叙述这次切换，但仅当最后记录的请求头描述的是另一种状态时才叙述，因此模型恰好在上下文变化时被告知，且绝不重复。空闲时做出的待定选择只存在于进程内，进程在下一个边界之前退出即丢失（[README 限制](../../packages/plan/plan-mode/README.md#known-limitations-and-deferred-work)）。

## 配置

```ts type-equiv
/** Deployment-owned plan guidance. */
interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
}
```

`section` 缺失、为空白或不是字符串，以及任何未知键，都会在插件加载时失败，而不是静默地不产生任何指引。计划模式激活期间，确切的 `section` 文本以 order 50 渲染为 `plan:policy` [系统提示词段落](system-prompt.md)；未激活的计划模式不贡献任何文本。

## 退出工具与 `/plan` 命令

[`exit_plan_mode`](../tool-catalog.md#deepseek-aidsh-plan-mode) 在计划模式未激活时仍保持注册，因此跨越边界只改变提示词段落，绝不改变请求的工具目录；在计划模式之外执行会失败。在计划模式中，它要求一份以 `#` 标题开头的完整 markdown 计划，并通过[用户交互 seam](user-interaction.md) 呈交评审。批准返回 `{ approved: true }`，并记录一个静默（不叙述）的待定退出，在该步骤之后冲刷：计划指引在 assistant 本批工具调用的剩余部分继续生效，而工具结果本身叙述这次转换。「继续规划」则是一次携带用户反馈的失败调用，模型据此修订并再次呈交；评审期间交互通道缺失或服务重载同样使调用失败，而不是静默离开计划模式。

当 [`ctx.commands`](commands.md) 被组合时，插件注册 `/plan [off|message]`：单独的 `/plan` 选择计划模式；任何其他非空消息先选择计划模式，再通过 `agent.steer()` 提交该文本，使其在计划指引下成为下一步骤的普通已记录用户消息；确切参数 `off` 选择未激活，这还会在计划模式尚未进入任何请求之前，取消尚未冲刷的待定条目。

## 服务

`ctx.planMode` 拥有已记录的计划状态、边界处的应用与叙述、`plan:policy` 段落、`/plan` 命令和稳定注册的退出工具；`get`/`set` 签名见生成的[服务目录](#ctxplanmode--planmodeservice)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis surface

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` surface lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxplanmode--planmodeservice"></a>

### `ctx.planMode` — `PlanModeService`

`ctx.planMode`: owns logged plan state, boundary application and narration, the `plan:policy` section, the `/plan` command, and the stable exit tool. UIs observe committed flips through `session/event`; there is no live mirror.

```ts cordis-catalog
/**
 * Read the logged plan state and any selected state awaiting a boundary.
 *
 * @param agent The agent to read.
 * @returns Current logged state plus a pending selection, when present.
 */
get(agent: Agent): { active: boolean; pending?: boolean }

/**
 * Select whether plan mode should be active. Between turns the change
 * commits immediately — no request boundary would arrive until the next
 * prompt, so a queued intent would hang (the open-turn fold is the idle
 * signal: agent status stays `running` through post-turn checkpointing,
 * where a boundary equally never comes). During an open turn the
 * selection is held as pending intent for the next in-turn request
 * boundary. Repeated selection of the current or already-pending state is
 * a no-op.
 *
 * @param agent The agent to switch.
 * @param active Whether plan mode should be active.
 * @returns what happened: `committed` (logged now), `queued` (awaiting the
 * next boundary), `cancelled` (an opposite pending selection was cleared;
 * the logged state already matches), or `noop` (already in that state).
 */
set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'
```

Types: [Agent](core.md)

Source: [`packages/plan/plan-mode/src/index.ts:183`](../../packages/plan/plan-mode/src/index.ts)
<!-- END GENERATED cordis-surface -->
