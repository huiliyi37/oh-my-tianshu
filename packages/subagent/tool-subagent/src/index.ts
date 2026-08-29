/**
 * Model-facing delegation through one configured `ctx.subagents` provider.
 * Provider lifecycle controls tool registration and context-sensitive schema
 * wording. Foreground calls always dispose the run after collection.
 * Background policy is selected by this plugin's configuration: one-shot
 * calls own a plain Task, while continuable calls use
 * `ctx.subagents.startContinuable()`.
 *
 * The optional `agent` parameter delegates as a named role resolved through
 * the optional `ctx.agentDefinitions` service: the role supplies the child's
 * persona, tool allow list, model route, and sandbox narrowing. With
 * `agentCatalog` enabled, the instance also publishes a durable
 * `<available_agents>` catalog message, versioned by entry digest. Child text
 * returning to the parent (foreground output, one-shot background task
 * output) is pseudo-XML-escaped at this boundary.
 * @module @huiliyi37/dsh-tool-subagent
 */

import { createHash } from 'node:crypto'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { defineTool } from '@huiliyi37/dsh-tools'
import type { ToolDefinition } from '@huiliyi37/dsh-tools'
import type { Agent, AgentOptions, PreStepDecision } from '@huiliyi37/dsh-agent'
import { createUserMessage } from '@huiliyi37/dsh-llm'
import type { ContentBlock } from '@huiliyi37/dsh-llm'
import type { JsonValue, UserMessage } from '@huiliyi37/dsh-session'
import { escapeText } from '@huiliyi37/dsh-skill'
import { assertSubagentMaxDepth, MAX_SUBAGENT_RUN_TIMEOUT_MS, parentAgentOptionsForDelegation, settleRun } from '@huiliyi37/dsh-subagent'
import type { SubagentProvider, SubagentResult, SubagentRun } from '@huiliyi37/dsh-subagent'
import type { TaskOutcome } from '@huiliyi37/dsh-tasks'
// Type-only: resolve the optional `ctx.agentDefinitions` service when the
// deployment loads role definitions; the tool works unchanged without it.
import type { AgentDefinition, AgentDefinitionSummary } from '@huiliyi37/dsh-agent-definitions'
// Type-only: resolve the optional `ctx.modelRoles` role-pin service when
// composed; the subagent pin is consumed opportunistically, never a hard dep.
import type { ModelRoleSelection } from '@huiliyi37/dsh-model-roles'
import { scopeOf } from '@huiliyi37/dsh-scope'
import {
  assertAllowedModelSelection,
  hasConfiguredLlmSelection,
  hasDelegationModelRequest,
  preflightChildLlmRoute,
  requestedAgentOptions,
} from './model-selection.ts'
import type { DelegationModelRequest, ModelSelectionPolicy } from './model-selection.ts'
import { registerListSubagentModels } from './list-models.ts'
import { appendSubagentModelSelection, subagentModelSelectionPolicy } from './model-selection-state.ts'

export const name = 'tool-subagent'
export const inject = ['tools', 'subagents']

/** Config: which registered provider this tool delegates to, plus child defaults. */
export interface Config {
  /**
   * Sample the Host `subagent-model-selection` user setting for each new
   * top-level session and inherit that decision in its child sessions
   * (requires the `subagent-model-selection-settings` entry in the
   * composition). Route fields are then advertised and enforced per Session
   * policy; the decision itself is recorded once in the session log.
   */
  modelSelectionSettings?: boolean
  /** The `ctx.subagents` provider name to start runs on (e.g. `spawn`, `acp`). */
  provider: string
  /**
   * Model-facing tool name (default `subagent`). Each loaded instance must use
   * a distinct name.
   */
  toolName?: string
  /**
   * Expose `run_in_background` (default true). Disabled instances omit the
   * parameter and reject forced background calls.
   */
  enableRunInBackground?: boolean
  /**
   * Background execution policy (default `one-shot`). `continuable` requires a
   * provider with the `prepareContinuable` capability and returns the durable
   * child id; follow-up adapters remain independently optional.
   */
  backgroundMode?: 'one-shot' | 'continuable'
  /**
   * Agent options applied to every child; omitted fields use child-loop defaults.
   */
  agentOptions?: AgentOptions
  /**
   * Per-child persona that shadows `deployment:persona`. Requires the
   * provider's `persona` capability; omission preserves the deployment persona.
   */
  persona?: string
  /**
   * Tool filter applied to every child. Filtered tools disappear from its
   * prompt and reject execution. Requires the provider's `toolFilter`
   * capability; unknown names fail startup.
   */
  toolFilter?: {
    /** Global tool names the child keeps; everything else is removed. */
    allow?: string[]
    /** Global tool names removed from the child. */
    deny?: string[]
  }
  /**
   * Maximum child depth: a non-negative safe integer (default `3`; `0` forbids
   * delegation entirely), or `'provider-managed'` to send no cap. A numeric cap
   * requires the provider's `depthLimit` capability (mount fails loud
   * otherwise). The provider checks the calling agent's current depth at every
   * start; the tool remains model-visible so runtime policy owns rejection.
   * `'provider-managed'` is for an out-of-process provider whose recursion
   * budget belongs to the child runtime or its own deployment.
   */
  maxDepth?: number | 'provider-managed'
  /**
   * Optional bound for each one-shot foreground or background child. Omission
   * leaves the run provider-managed; a configured value requires the
   * provider's `runBudget` capability.
   */
  runBudget?: {
    /** Maximum child model steps. */
    maxSteps: number
    /** Maximum child wall-clock duration in milliseconds. */
    timeoutMs: number
  }
  /**
   * Publish the durable `<available_agents>` catalog message on sessions whose
   * agent can see this exact tool instance (default false). The catalog follows
   * the optional `ctx.agentDefinitions` service: absent service, no catalog.
   * Enable on at most ONE delegation tool instance per assembly — each enabled
   * instance owns an identical catalog, and this instance's visibility alone
   * decides publication.
   */
  agentCatalog?: boolean
  /**
   * Maximum normalized description length rendered in the session agent
   * catalog; minimum 3 (default 500).
   */
  catalogDescriptionMaxLength?: number
}

/** Default cap for one normalized role description line in the agent catalog. */
const DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500

export const Config: z<Config> = z.object({
  provider: z.string().required(),
  toolName: z.string().default('subagent'),
  modelSelectionSettings: z.boolean().default(false),
  enableRunInBackground: z.boolean().default(true),
  backgroundMode: z.union(['one-shot', 'continuable'] as const).default('one-shot'),
  // Prevent Schemastery from materializing omitted agentOptions as `{}`.
  agentOptions: z.object({
    provider: z.string(),
    model: z.string(),
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  }).default(undefined as unknown as { provider: string; model: string; maxTokens: number }),
  persona: z.string(),
  // Preserve omission; Schemastery's `{ allow: [] }` default would deny every tool.
  toolFilter: z.object({
    allow: z.array(z.string()).default(undefined as unknown as string[]),
    deny: z.array(z.string()).default(undefined as unknown as string[]),
  }).default(undefined as unknown as { allow: string[]; deny: string[] }),
  maxDepth: z.union([z.natural().max(Number.MAX_SAFE_INTEGER), z.const('provider-managed' as const)]).default(3),
  runBudget: z.object({
    maxSteps: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    timeoutMs: z.number().step(1).min(1).max(MAX_SUBAGENT_RUN_TIMEOUT_MS).required(),
  }).default(undefined as unknown as { maxSteps: number; timeoutMs: number }),
  agentCatalog: z.boolean().default(false),
  catalogDescriptionMaxLength: z.number().default(DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH),
})

/**
 * Durable item records for one published session agent catalog. The catalog is
 * a `catalog`-form context, so it records the entries it published beside the
 * model-facing prose: a consumer presenting the list must not re-parse the
 * `<available_agents>` block, whose framing exists for the model.
 */
export interface AgentCatalogSource {
  readonly kind: 'agent-catalog'
  readonly form: 'catalog'
  /** Marks a replacement catalog rather than this session's first publication. */
  readonly update?: true
  /** Exactly the entries this message published, in catalog order. */
  readonly entries: readonly { readonly name: string; readonly description: string }[]
}

declare module '@huiliyi37/dsh-llm' {
  interface MessageSourceMap {
    /** One published session agent catalog for the delegation tool that owns it. */
    'agent-catalog': AgentCatalogSource
  }
}

/** Render text blocks from the canonical JSON block array without trusting arbitrary values. */
function outputValueText(values: JsonValue[]): string {
  return values
    .filter((value): value is { type: 'text'; text: string } =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
      && value.type === 'text' && typeof value.text === 'string')
    .map(value => value.text)
    .join('')
}

/** Settle pending startup without rejecting the task producer contract. */
async function settleStart(start: Promise<SubagentRun>, signal: AbortSignal): Promise<TaskOutcome> {
  try {
    const outcome = await settleRun(await start)
    // The one-shot background result crosses the same parent-boundary as the
    // foreground collection, so its final text gets the same pseudo-XML escape.
    return outcome.status === 'completed' && outcome.output !== undefined
      ? { ...outcome, output: escapeText(outcome.output) }
      : outcome
  } catch (error: unknown) {
    return signal.aborted
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
}

/** A non-`completed` stop reason means the child did not finish cleanly. */
function stopReasonError(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'subagent run was cancelled'
    case 'error':
      return 'subagent run failed'
    case 'max-tokens':
      return 'subagent run hit its token limit before finishing'
    case 'refusal':
      return 'subagent declined the task'
    // Merge-extensible union: a backend may add stop reasons. Treat an unknown
    // terminal reason as a failure rather than reporting partial output as success.
    default:
      return `subagent run ended abnormally (${result.stopReason})`
  }
}

type ForegroundToolResult = {
  readonly kind: 'foreground'
  readonly runId: SubagentRun['id']
  readonly output: JsonValue[]
}

/**
 * Collect and release one foreground run without letting disposal replace an
 * independent result failure.
 */
async function settleForegroundRun(run: SubagentRun): Promise<ForegroundToolResult> {
  const [execution] = await Promise.allSettled([
    run.result.then((result): ForegroundToolResult => {
      const error = stopReasonError(result)
      if (error !== undefined) {
        // The registry converts this throw to isError; partial output is not success.
        throw new Error(error)
      }
      return {
        kind: 'foreground',
        runId: run.id,
        // Text is escaped at this parent boundary (pseudo-XML neutralized);
        // the registry then performs the authoritative lossless snapshot here.
        output: escapeOutputBlocks(result.output as unknown as JsonValue[]),
      }
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/**
 * Model-facing wording from the provider's conversation-history descriptor
 * ({@link SubagentProvider.inheritsParentContext}).
 * A fresh child needs a standalone prompt; a forked child already sees the
 * conversation's completed turns — telling the model to restate everything
 * (or, worse, that the child "does not see this conversation") would be false
 * for a fork.
 * @param inheritsConversation - whether the child's conversation is seeded
 *   with the parent's completed turns; this says nothing about tool, service,
 *   scope, or authority inheritance.
 * @returns the tool `description` and the `prompt` parameter description.
 */
function providerWording(inheritsConversation: boolean): { description: string; promptDescription: string } {
  if (inheritsConversation) {
    return {
      description:
        'Delegate a task to a subagent that inherits this conversation: a child agent seeded with all '
        + 'completed turns so far (it does not see the current in-flight turn), returning only its final '
        + 'result. Use this when the subtask builds on this conversation\'s context — a follow-up analysis, '
        + 'a review, a continuation — without consuming this conversation\'s context for the work itself. '
        + 'You receive only its final answer, not its intermediate steps.',
      promptDescription:
        'The task for the subagent. It already sees this conversation\'s completed turns, so build on them '
        + 'freely and state only what is new.',
    }
  }
  return {
    description:
      'Delegate a self-contained task to a subagent (a separate agent that works in its own context) '
      + 'and return its final result. Use this to offload focused, independent work — research, a scoped '
      + 'implementation, an analysis — so it does not consume this conversation\'s context. The subagent '
      + 'runs to completion and you receive only its final answer, not its intermediate steps. Give it a '
      + 'complete, standalone prompt: it does not see this conversation.',
    promptDescription:
      'The complete, self-contained task for the subagent. It does not share this '
      + 'conversation\'s context, so include everything it needs.',
  }
}

export function apply(ctx: Context, config: Config): void {
  // Direct apply() bypasses Schemastery's numeric constraints. A direct-apply
  // omission stays capless (the schema default only runs through the loader).
  if (config.maxDepth !== 'provider-managed') { assertSubagentMaxDepth(config.maxDepth) }
  if (config.runBudget !== undefined) {
    if (!Number.isSafeInteger(config.runBudget.maxSteps) || config.runBudget.maxSteps < 1) {
      throw new Error('tool-subagent: runBudget.maxSteps must be a positive safe integer')
    }
    if (!Number.isSafeInteger(config.runBudget.timeoutMs)
      || config.runBudget.timeoutMs < 1
      || config.runBudget.timeoutMs > MAX_SUBAGENT_RUN_TIMEOUT_MS) {
      throw new Error(`tool-subagent: runBudget.timeoutMs must be a positive safe integer <= ${MAX_SUBAGENT_RUN_TIMEOUT_MS}`)
    }
  }
  // Reject an empty explicit filter at load instead of failing every delegation.
  if (config.toolFilter !== undefined && config.toolFilter.allow === undefined && config.toolFilter.deny === undefined) {
    throw new Error('tool-subagent: `toolFilter` is configured but names neither `allow` nor `deny` — remove the key or fill the filter')
  }
  const toolName = config.toolName ?? 'subagent'
  const selectionCapable = config.modelSelectionSettings === true
  /**
   * 解析调用方 Session 的路由选择策略（本仓分叉 B-β）：部署级单实例没有上游的
   * per-Agent 发布点，故在首次委派时解析——读已录事件（决策锚定在日志里）→
   * 缺席且父 agent 可达的子会话继承父会话事件（父子一致优先）→ 其余无锚定
   * 会话（顶层新会话、resume 的旧顶层会话、父不可达的子会话）采样设置并记录
   * 一次。父不可达子会话的采样与上游 per-Agent 发布采样等价，可能与该父会话
   * 的已锚定决策分叉（父进程已不可问询）。设置服务缺席在首次可解析点 fail
   * loud。见阶段 4 浪级 Note。
   */
  const resolveSelectionPolicy = (parent: Agent): ModelSelectionPolicy | undefined => {
    if (!selectionCapable) return undefined
    const recorded = subagentModelSelectionPolicy(parent.session)
    let allowedModels = recorded
    if (allowedModels === undefined) {
      const parentId = parent.session.header.origin === 'subagent'
        ? parent.session.header.parentSession
        : undefined
      const parentAgent = parentId === undefined ? undefined : ctx.get('agents')?.get(parentId)
      if (parentAgent !== undefined) {
        allowedModels = subagentModelSelectionPolicy(parentAgent.session)
      }
      if (allowedModels === undefined) {
        const settings = ctx.get('subagentModelSelection')
        if (settings === undefined) {
          throw new Error(
            'tool-subagent: `modelSelectionSettings` requires the '
            + '@huiliyi37/dsh-tool-subagent/model-selection-settings entry in the composition',
          )
        }
        const current = settings.current()
        allowedModels = current.enabled ? current.allowedModels : undefined
      }
      if (allowedModels !== undefined) {
        // 本会话刚确认无已录策略事件（recorded === undefined）：直接落盘，
        // 不为幂等性重扫一遍事件日志。已录会话复用 recorded，同样不扫第二遍。
        appendSubagentModelSelection(parent.session, allowedModels)
      }
    }
    return allowedModels === undefined ? undefined : { routes: allowedModels }
  }
  const catalogDescriptionMaxLength = config.catalogDescriptionMaxLength ?? DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH
  assertPositiveInteger('catalogDescriptionMaxLength', catalogDescriptionMaxLength, 3)
  // Mirror provider lifecycle because sibling load order and HMR replacement
  // can change provider availability while this fiber remains active.
  let disposeTool: (() => void) | undefined
  // The exact registration the catalog listener compares visibility against;
  // cleared while the provider is absent so the catalog disappears with it.
  let activeTool: ToolDefinition | undefined
  const mount = (provider: SubagentProvider): void => {
    // A numeric cap the provider cannot enforce is a misconfiguration — fail at
    // mount (the earliest point the provider's capabilities are known), not on
    // the first delegation.
    if (typeof config.maxDepth === 'number' && !provider.capabilities.depthLimit) {
      throw new Error(
        `tool-subagent: provider "${provider.name}" cannot enforce maxDepth (no depthLimit capability) — `
        + 'set maxDepth: \'provider-managed\' to leave the recursion budget to the provider',
      )
    }
    if (config.runBudget !== undefined && !provider.capabilities.runBudget) {
      throw new Error(
        `tool-subagent: provider "${provider.name}" cannot enforce runBudget (no runBudget capability)`,
      )
    }
    if (config.agentOptions !== undefined && !provider.capabilities.agentOptions) {
      throw new Error(
        `tool-subagent: provider "${provider.name}" cannot honor agentOptions (no agentOptions capability) — `
        + 'the configured child route would be silently ignored; remove agentOptions or switch providers',
      )
    }
    const wording = providerWording(provider.inheritsParentContext)
    const backgroundEnabled = config.enableRunInBackground !== false
    const continuable = (config.backgroundMode ?? 'one-shot') === 'continuable'
    if (continuable && provider.prepareContinuable === undefined) {
      throw new Error(
        `tool-subagent: provider "${provider.name}" does not support \`backgroundMode: continuable\``,
      )
    }
    const definition = defineTool({
      name: toolName,
      description: wording.description + (backgroundEnabled
        // The return channel is a separately installed capability this package
        // cannot observe, so this describes only this call's result.
        ? continuable
          ? ' Set `run_in_background: true` to start a background subagent that keeps its conversation:'
          + ' you receive only its subagent id, never its result, and it works on its own. Use this for'
          + ' work whose result you do not need returned by this call; `send_message` sends it more work.'
          : ' Set `run_in_background: true` to return a task id; collect with `task_output` and stop with `task_kill`.'
        : ''),
      parameters: {
        description: {
          type: 'string',
          required: true,
          description: 'A short (3-5 word) description of the delegated task, for display.',
        },
        prompt: {
          type: 'string',
          required: true,
          description: wording.promptDescription,
        },
        agent: {
          type: 'string',
          description: 'Optional role to delegate as: an exact name from this session\'s available agents '
          + 'catalog (<available_agents>). The role supplies the child\'s instructions, tool set, and sandbox. '
          + 'Omit for a general-purpose subagent.',
        },
        ...selectionCapable ? {
          provider: {
            type: 'string' as const,
            description: 'LLM provider route for the child. Supply together with model; omit both '
            + 'to use configured child defaults or inherit the parent route.',
          },
          model: {
            type: 'string' as const,
            description: 'Model id interpreted by provider. Supply together with provider; omit both '
            + 'to use configured child defaults or inherit the parent route.',
          },
          reasoning_effort: {
            type: 'string' as const,
            description: 'Adapter-owned reasoning effort for the effective child route. Omit to '
            + 'inherit a compatible configured/parent effort or use a newly selected model\'s default.',
          },
        } : {},
        ...backgroundEnabled ? {
          run_in_background: {
            type: 'boolean' as const,
            description: continuable
              ? 'Run as a background subagent that keeps its conversation and return only its subagent id. '
              + 'This call never returns its result; send it more work with send_message.'
              : 'Run as a background task and return its id; collect with task_output or stop with task_kill.',
          },
        } : {},
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'background' },
                taskId: { type: 'string', required: true },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'continuable' },
                subagentId: { type: 'string', required: true },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'foreground' },
                runId: { type: 'string', required: true },
                output: { type: 'array', required: true, items: { type: 'json' } },
              },
            },
          ],
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.kind === 'background'
            ? `started background subagent task ${value.taskId}`
            : value.kind === 'continuable'
              ? `started subagent ${value.subagentId}`
              : outputValueText(value.output),
        }],
      },
      async execute(args, exec) {
        const parent = exec.agent
        if (!parent) {
          // Non-agent callers provide no parent for delegation ownership.
          throw new Error('subagent tool requires a calling agent (exec.agent was undefined)')
        }

        const role = await resolveAgentRole(ctx, args.agent, parent, exec.signal)
        const maxDepth = typeof config.maxDepth === 'number' ? config.maxDepth : undefined
        const agentOptions = resolveRoleAgentOptions(
          config.agentOptions,
          role,
          ctx.get('modelRoles')?.resolve('subagent'),
        )
        // 模型可见路由选择（回流上游弧）：合并 → Session 策略强制 → 活适配器预检。
        // 父选项仅在确需路由解析时读取（上游 per-Agent 发布点恒有完整 session；
        // 本仓直接调用/测试替身的 agent 可能只携带 id——惰性化等价且省一次头读取）。
        const selectionPolicy = resolveSelectionPolicy(parent)
        const modelRequest = args as DelegationModelRequest
        let childAgentOptions = agentOptions
        if (selectionPolicy !== undefined
          || hasDelegationModelRequest(modelRequest)
          || hasConfiguredLlmSelection(agentOptions)) {
          const parentOptions = parentAgentOptionsForDelegation(parent)
          const requiresRoutePreflight = hasDelegationModelRequest(modelRequest)
            || hasConfiguredLlmSelection(agentOptions)
          childAgentOptions = requestedAgentOptions(
            parentOptions,
            agentOptions,
            modelRequest,
            selectionPolicy !== undefined,
          )
          assertAllowedModelSelection(selectionPolicy, parentOptions, childAgentOptions, modelRequest)
          if (requiresRoutePreflight) {
            const llm = ctx.get('llm')
            if (llm === undefined) {
              throw new Error('cannot resolve the selected child LLM route because the `llm` service is unavailable')
            }
            await preflightChildLlmRoute(llm, parentOptions, childAgentOptions, exec.signal)
            // 预检跨 await：确认同一 provider 仍在位，HMR 不能把一个 provider 的默认值配另一个进程。
            if (ctx.subagents.getProvider(config.provider) !== provider) {
              throw new Error(`subagent provider "${config.provider}" changed while resolving the child LLM route; retry the delegation`)
            }
          }
        }
        const toolFilter = resolveRoleToolFilter(config.toolFilter, role)
        const persona = role?.content ?? config.persona
        const request = {
          label: args.description,
          prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
          parent,
          ...childAgentOptions !== undefined ? { agentOptions: childAgentOptions } : {},
          ...persona !== undefined ? { persona } : {},
          ...toolFilter !== undefined ? { toolFilter } : {},
          ...role?.sandbox !== undefined ? { sandboxMode: role.sandbox } : {},
          ...maxDepth !== undefined ? { maxDepth } : {},
        }

        if (args.run_in_background === true) {
          // The validator permits undeclared keys, so schema omission also needs
          // execution-time enforcement.
          if (!backgroundEnabled) {
            throw new Error('run_in_background is disabled for this tool instance (enableRunInBackground: false)')
          }
          if (continuable) {
            // Resolves at inbox acceptance: the child owns its own turns from
            // there, so this call neither waits for nor collects a result.
            const started = await ctx.subagents.startContinuable({
              provider: config.provider,
              label: args.description,
              request,
              signal: exec.signal,
            })
            return { kind: 'continuable' as const, subagentId: started.childId }
          }
          const tasks = ctx.get('tasks')
          if (tasks === undefined) {
            throw new Error('background tasks unavailable: load @huiliyi37/dsh-tasks and @huiliyi37/dsh-tool-tasks')
          }
          // One-shot background child: task preflight finishes before the
          // starter can spawn, and the task-owned signal covers startup.
          const id = tasks.start({
            kind: 'subagent',
            label: args.description,
            owner: parent,
            run: () => {
              const controller = new AbortController()
              const start = ctx.subagents.start(config.provider, {
                ...request,
                ...(config.runBudget !== undefined ? { runBudget: config.runBudget } : {}),
                signal: controller.signal,
              })
              return {
                cancel: (reason?: string) => {
                  controller.abort(reason ?? 'background subagent task killed')
                },
                done: settleStart(start, controller.signal),
                // No readOutput: the child session owns intermediate detail.
              }
            },
          })
          return { kind: 'background' as const, taskId: id }
        }

        const run: SubagentRun = await ctx.subagents.start(config.provider, {
          ...request,
          ...(config.runBudget !== undefined ? { runBudget: config.runBudget } : {}),
          signal: exec.signal,
        })
        return settleForegroundRun(run)
      },
    })
    disposeTool = ctx.tools.register(definition)
    // Scoped visibility: a preset-mounted tool lives in the standing scope's
    // layer, so the registration check reads through the calling scope rather
    // than the global view.
    activeTool = ctx.tools.get(definition.name, scopeOf(ctx))
    /* v8 ignore next 3 -- register() publishes synchronously or throws; this guards future registry drift. */
    if (activeTool === undefined) {
      throw new Error('dsh-tool-subagent: registered subagent tool is not visible in the calling scope')
    }
  }

  // The discovery tool depends only on the live LLM directory and the calling
  // Session's policy, never on the subagent provider, so it registers once with
  // this fiber instead of following provider availability: a provider
  // disappear/reappear cycle neither orphans nor re-registers it (re-inserting
  // the global-singleton name inside `mount()` would throw on re-add). The
  // resolver is per-calling-Session, so multiple selection-capable instances
  // are interchangeable — a concurrent sibling's registration is shared.
  if (selectionCapable) {
    try {
      registerListSubagentModels(ctx, agent => resolveSelectionPolicy(agent))
    } catch (error) {
      // Loader starts siblings concurrently: another selection-capable
      // instance may have registered the same name between our check and
      // insert. Its resolver is equivalent (policy is resolved per calling
      // Session), so sharing its tool is correct; anything else rethrows.
      if (ctx.tools.get('list_subagent_models', scopeOf(ctx)) === undefined) throw error
    }
  }

  // Register listeners before checking presence so no synchronous change is missed.
  // TODO(subagent-dup-toolname): two WAITING fibers configured with the same
  // toolName collide when their provider appears, and the duplicate-name throw
  // rolls back the provider registration. Add an intent registry if this occurs.
  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === config.provider && disposeTool === undefined) mount(provider)
  })
  ctx.on('subagent/provider-removed', (name) => {
    if (name !== config.provider || disposeTool === undefined) return
    disposeTool()
    disposeTool = undefined
    activeTool = undefined
  })
  const present = ctx.subagents.getProvider(config.provider)
  if (present !== undefined) {
    mount(present)
  } else {
    // A backend fiber may activate later; a misspelled provider remains visible in this log.
    ctx.logger.info(`subagent provider "${config.provider}" not registered yet; the "${toolName}" tool will register when it appears`)
  }

  // Register after the provider listeners so reverse teardown removes guidance
  // first. Exact definition identity prevents a scoped shadow merely named like
  // this tool from inheriting the catalog.
  /* jscpd:ignore-start -- intentional copy of dsh-tool-skill's digest-versioned catalog listener. */
  if (config.agentCatalog === true) {
    ctx.on('agent/pre-step', async (
      { agent, signal },
      next,
    ): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      signal.throwIfAborted()
      const definitions = activeTool !== undefined && ctx.tools.get(toolName, agent) === activeTool
        ? ctx.get('agentDefinitions')
        : undefined
      const snapshot = definitions !== undefined
        ? await definitions.snapshot({ cwd: agent.session.header.cwd, signal })
        : { definitions: [], complete: true }
      signal.throwIfAborted()
      if (!snapshot.complete) return decision
      const entries = catalogSourceEntries(snapshot.definitions, catalogDescriptionMaxLength)
      const digest = digestCatalogEntries(entries)
      const history = catalogHistory(agent)
      const existing = catalogMessage(decision.messages)
      if (history.visibleDigest === digest) {
        return existing === undefined
          ? decision
          : { kind: 'enter', messages: decision.messages.filter(message => message.id !== existing.message.id) }
      }
      if (existing !== undefined && digestCatalogEntries(existing.entries) === digest) return decision
      if (!history.published && snapshot.definitions.length === 0) {
        return existing === undefined
          ? decision
          : { kind: 'enter', messages: decision.messages.filter(message => message.id !== existing.message.id) }
      }
      const catalog = history.published
        ? renderCatalogUpdate(entries, toolName)
        : renderCatalogMessage(entries, toolName)
      return {
        kind: 'enter',
        messages: existing === undefined
          ? [...decision.messages, catalog]
          : decision.messages.map(message => message.id === existing.message.id ? catalog : message),
      }
    })
  }
  /* jscpd:ignore-end */
}

/**
 * Resolve the optional `agent` argument to a registered role definition. An
 * unknown name fails loud toward the catalog rather than silently delegating
 * a general-purpose child under a misspelled role.
 * @param ctx - plugin context carrying the optional agent-definitions service.
 * @param name - the model-supplied role name, or undefined for a general-purpose child.
 * @param parent - the calling agent, whose session cwd selects project roles.
 * @param signal - tool execution cancellation.
 * @returns the winning role definition, or undefined when no role was requested.
 */
async function resolveAgentRole(
  ctx: Context,
  name: string | undefined,
  parent: Agent,
  signal: AbortSignal,
): Promise<AgentDefinition | undefined> {
  if (name === undefined) return undefined
  const definitions = ctx.get('agentDefinitions')
  if (definitions === undefined) {
    throw new Error('agent roles are unavailable: the agent-definitions service is not loaded — omit `agent` or load @huiliyi37/dsh-agent-definitions')
  }
  const role = await definitions.get(name, { cwd: parent.session.header.cwd, signal })
  if (role === undefined) {
    throw new Error(`unknown agent "${name}" — omit \`agent\` or use an exact name from the session's <available_agents> catalog`)
  }
  return role
}

/**
 * Merge one delegation's child route in ascending precedence: the role's
 * frontmatter `model:`, then the subagent-role pin, then the instance's
 * configured `agentOptions` on top. The pin is the live user-level override
 * from the optional `modelRoles` service, read per call so a committed
 * settings change applies to the next delegation with no restart.
 * @param configAgentOptions - the instance's configured child options (top layer).
 * @param role - the resolved role definition, whose `model:` sits at the bottom.
 * @param rolePin - the subagent-role pin, when the optional service carries one.
 * @returns the merged request options, or undefined when no layer contributes.
 */
function resolveRoleAgentOptions(
  configAgentOptions: AgentOptions | undefined,
  role: AgentDefinition | undefined,
  rolePin: ModelRoleSelection | undefined,
): AgentOptions | undefined {
  if (role?.model === undefined && rolePin === undefined) return configAgentOptions
  return {
    ...role?.model !== undefined ? { model: role.model } : {},
    ...rolePin,
    ...configAgentOptions,
  }
}

/**
 * Merge a role's tool allow list with the instance's configured filter. The
 * deployment filter is a CEILING the model-chosen role cannot exceed: the
 * effective allow list is the role's list intersected with the configured
 * allow list and minus the configured denies. A role that keeps no tool fails
 * the call loud instead of delegating a helpless child.
 */
function resolveRoleToolFilter(
  configFilter: { allow?: string[]; deny?: string[] } | undefined,
  role: AgentDefinition | undefined,
): { allow?: string[]; deny?: string[] } | undefined {
  if (role?.tools === undefined) return configFilter
  if (configFilter === undefined) return { allow: [...role.tools] }
  const allow = role.tools.filter(tool =>
    (configFilter.allow === undefined || configFilter.allow.includes(tool))
    && configFilter.deny?.includes(tool) !== true)
  if (allow.length === 0) {
    throw new Error(`agent "${role.name}" keeps no tools under this tool instance's \`toolFilter\` ceiling`)
  }
  return { allow }
}

/**
 * Neutralize pseudo-XML framing (`<system-reminder>`, `<system>`, …) in child
 * output text before it enters the parent conversation as a tool result: the
 * child may have read hostile content, and the parent model must not parse
 * returning markup as harness instructions. The escape runs once at this
 * boundary, so the durable tool/result record holds exactly what the parent
 * model sees. Non-text blocks pass through unchanged.
 */
function escapeOutputBlocks(blocks: JsonValue[]): JsonValue[] {
  return blocks.map((block) => {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) return block
    if (block.type !== 'text' || typeof block.text !== 'string') return block
    return { ...block, text: escapeText(block.text) }
  })
}

/* jscpd:ignore-start -- intentional copy of dsh-tool-skill's catalog mechanics
   (plan C7-5/C2): durable digest-versioned catalog with first/replace/remove
   states, re-anchored to the `agent-catalog` source kind. */
function renderCatalogMessage(entries: AgentCatalogSource['entries'], toolName: string): UserMessage {
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'An agent role is a named subagent composition: the child runs with the role\'s own instructions, tool set, and sandbox. The following agent roles are available in this session:',
        '',
        '<available_agents>',
        ...renderCatalogEntries(entries),
        '</available_agents>',
        '',
        `When the task clearly matches a role's description, call the \`${toolName}\` tool with \`agent\` set to the exact role name. The role applies only to the child that call starts; omit \`agent\` for a general-purpose subagent. This catalog contains summaries only; a role's full instructions bind the child, not you.`,
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: 'agent-catalog',
      form: 'catalog',
      entries,
    },
  })
}

function renderCatalogUpdate(entries: AgentCatalogSource['entries'], toolName: string): UserMessage {
  const availability = entries.length === 0
    ? [
      `No agent roles are currently available through the \`${toolName}\` tool. Do not use names from earlier agent catalogs.`,
    ]
    : [
      `Use only names in this replacement catalog. When the task clearly matches a listed role's description, call the \`${toolName}\` tool with \`agent\` set to the exact name.`,
    ]
  return createUserMessage({
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'The available agent catalog changed. This complete catalog replaces every earlier available-agents list in this session:',
        '',
        '<available_agents>',
        ...renderCatalogEntries(entries),
        '</available_agents>',
        '',
        ...availability,
        '</system-reminder>',
      ].join('\n'),
    }],
    source: {
      kind: 'agent-catalog',
      form: 'catalog',
      update: true,
      entries,
    },
  })
}

/**
 * Model-facing catalog lines, projected from the same entries the source records.
 * The pseudo-XML escaping belongs to this frame, not to the published fact, so it
 * is applied here and never stored. Names are kebab-case-validated and carry
 * no escapable character.
 */
function renderCatalogEntries(entries: AgentCatalogSource['entries']): string[] {
  return entries.map(entry => `- \`${entry.name}\`: ${escapeText(entry.description)}`)
}

/**
 * Catalog identity over the durable entry list rather than the rendered prose.
 * The entries are what changes; the surrounding `<system-reminder>` framing is
 * written for the model and must not decide whether a republish is needed.
 */
function digestCatalogEntries(entries: AgentCatalogSource['entries']): string {
  // JSON per entry rather than a separator character: every separator is itself
  // a legal description character, so only quoting makes the boundary exact.
  const canonical = entries.map(entry => JSON.stringify([entry.name, entry.description])).join('\n')
  return createHash('sha256')
    .update(canonical)
    .digest('hex')
}

/**
 * Entries of one durable catalog message, or undefined when the record is not a
 * usable catalog. An unreadable record is treated as "not this plugin's
 * catalog" rather than throwing inside the step listener, which would fail
 * every subsequent turn of that session.
 */
function readCatalogEntries(source: unknown): AgentCatalogSource['entries'] | undefined {
  const entries = (source as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return undefined
  const readable: { name: string; description: string }[] = []
  for (const entry of entries as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const { name, description } = entry as { name?: unknown; description?: unknown }
    if (typeof name !== 'string' || name === '' || typeof description !== 'string') return undefined
    readable.push({ name, description })
  }
  return readable
}

function catalogHistory(agent: Agent): { visibleDigest?: string; published: boolean } {
  const visible = new Set(agent.session.surface.nodes)
  const events = agent.session.events
  let published = false
  for (let index = events.length - 1; index >= 0; index -= 1) {
    // The loop bounds prove the read-only event view contains this index.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = events[index]!
    if (event.type !== 'user/message' || event.data.source.kind !== 'agent-catalog') continue
    const entries = readCatalogEntries(event.data.source)
    if (entries === undefined) continue
    const digest = digestCatalogEntries(entries)
    published = true
    if (visible.has(event.seq)) return { visibleDigest: digest, published }
  }
  return { published }
}

function catalogMessage(
  messages: readonly UserMessage[],
): { message: UserMessage; entries: AgentCatalogSource['entries'] } | undefined {
  for (const message of messages) {
    if (message.source.kind !== 'agent-catalog') continue
    const entries = readCatalogEntries(message.source)
    if (entries !== undefined) return { message, entries }
  }
  return undefined
}

/** Durable entry list mirroring the rendered catalog lines, for non-model consumers. */
function catalogSourceEntries(
  definitions: readonly AgentDefinitionSummary[],
  descriptionMaxLength: number,
): AgentCatalogSource['entries'] {
  return definitions.map(definition => ({
    name: definition.name,
    description: catalogDescription(definition.description, descriptionMaxLength),
  }))
}

/** Normalized, length-bounded description exactly as the catalog publishes it (unescaped). */
function catalogDescription(value: string, maxLength: number): string {
  const normalized = value.replaceAll(/\s+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`
}

function assertPositiveInteger(name: string, value: number, minimum = 1): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`tool-subagent: ${name} must be an integer greater than or equal to ${minimum}`)
  }
}
/* jscpd:ignore-end */
