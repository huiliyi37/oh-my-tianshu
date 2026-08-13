# Plan Mode

English | [中文](plan.zh.md)

Plan mode is logged per-agent collaboration state owned by [dsh-plan-mode](../../packages/plan/plan-mode) (`ctx.planMode`, `PlanModeService`): while active, a deployment-owned guidance section shapes each model request. It is **soft guidance**, deliberately independent of the [sandbox mode](sandbox.md) and [approval policy](approval.md) enforcement axes — those knobs never read or write plan state, and deployments needing a hard boundary combine them separately. The package is one optional capability, not part of the agent-loop spine; its surfaces are the `plan:policy` prompt section, the always-registered `exit_plan_mode` tool, and the `/plan` command. The [design note](../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md) owns the rationale; the [package README](../../packages/plan/plan-mode/README.md) owns the model-experience and limitation detail.

Source: [`packages/plan/plan-mode/src/index.ts`](../../packages/plan/plan-mode/src/index.ts)

## Logged state and recovery

`plan/mode` (`{ active: boolean }`) is a log-only, whole-value-replace [session event](session.md): durable and replayable, never in the model transcript. `foldPlanMode(events, end?)` returns the last logged value in the prefix, or `false` when there is none — the state in force is always a pure fold of the session log, so resume, fork, and compaction recover it with no live mirror, and UIs observe committed flips through `session/event`. The complete event declaration is in the [persistence log event catalog](../persistence-catalog.md).

## Pending intent and the step-boundary flush

Because every session event is turn-enclosed, a user selection is held as pending intent until the next step boundary — the next request derivation, in whichever turn it occurs (selection never forces continuation, so an intent recorded after a turn's final step lands in a later turn). `set(agent, active)` records the pending selection (a no-op when the target equals the logged-or-already-pending state), and `get(agent)` returns `{ active: boolean; pending?: boolean }` — the logged state shaping the current step, plus the optimistic selection awaiting a boundary.

The sole flush point is a prepended `agent/step` listener — the loop's in-turn interception point that runs before every request derivation, including turn 1 step 1 and request-recovery retries. Prompt admission itself never flushes: it happens pre-turn, where a `plan/mode` append would land outside any open turn, so a selection made at the prompt is landed by the first step boundary inside the turn it starts. The prepend means the flush runs before the downstream `agent/step` listener chain. A flush failure is contained — plan policy can never block a turn — and the failed append stays pending for a later boundary. A flushed user selection also narrates the switch as one plugin-sourced `user/message` notice, but only when the last logged request header described the other state, so the model is told exactly when its context changed and never redundantly. A pending selection made while idle is process-local and lost on exit before the next boundary ([README limitation](../../packages/plan/plan-mode/README.md#known-limitations-and-deferred-work)).

## Configuration

```ts type-equiv
/** Deployment-owned plan guidance. */
interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
}
```

A missing, blank, or non-string `section` and any unknown key fail at plugin load rather than silently shaping nothing. While plan mode is active, the exact `section` text renders as the `plan:policy` [system-prompt section](system-prompt.md) at order 50; inactive plan mode contributes no text.

## The exit tool and the `/plan` command

[`exit_plan_mode`](../tool-catalog.md#deepseek-aidsh-plan-mode) stays registered while plan mode is inactive, so crossing the boundary changes only the prompt section, never the request tool catalog; execution outside plan mode fails. In plan mode it requires a complete markdown plan starting with a `#` heading and presents it for review through the [user-interaction seam](user-interaction.md). Approval returns `{ approved: true }` and records a silent (non-narrated) pending exit that flushes after the step — plan guidance holds for the rest of the assistant's tool batch, and the tool result itself narrates the transition. Keep-planning is a failed call carrying the user's feedback, so the model revises and presents again; a missing interaction channel and a service reload during review also fail the call rather than silently leaving plan mode.

When [`ctx.commands`](commands.md) is composed, the plugin registers `/plan [off|message]`: bare `/plan` selects plan mode, any other non-empty message selects it and then submits the text through `agent.steer()` so it becomes the next step's ordinary logged user message under plan guidance, and the exact argument `off` selects inactive — which also cancels a not-yet-flushed pending entry before plan mode ever reaches a request.

## The service

`ctx.planMode` owns the logged plan state, boundary application and narration, the `plan:policy` section, the `/plan` command, and the stable exit tool; `get`/`set` signatures are in the generated [service catalog](#ctxplanmode--planmodeservice).

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
