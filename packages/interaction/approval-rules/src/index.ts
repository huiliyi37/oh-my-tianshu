/**
 * Persistent per-tool allow/deny approval rules — a policy layer over the
 * `ctx.approval` seam.
 *
 * The package registers an `approval/request` waterfall answerer that consults
 * a merged list of rules loaded from two YAML layers (user home first, then
 * project) and, on the first hit, settles the request deterministically
 * (`allow` → `allowed-always`, `deny` → `rejected`) without consulting any
 * interactive answerer. When no rule matches, the answerer delegates via
 * `next()` so the rest of the chain (including a later interactive answerer)
 * still decides. The whole thing is a strategy layer on the seam: it never
 * touches sandbox/mode, and the `'never'` policy still rejects before any
 * answerer is consulted.
 *
 * **Mount order contract.** A Cordis waterfall has no priority mechanism;
 * listeners run in registration order. The rule answerer only precedes an
 * interactive answerer if this package is assembled first. Deployments must
 * mount this package before any interactive approval answerer (the README and
 * the tests pin this ordering).
 *
 * Every automatic decision appends a log-only `approval/rule` event to the
 * owning session, so the asked → rule → decided audit stays complete and
 * replayable without entering the model transcript.
 *
 * @module @huiliyi37/dsh-approval-rules
 */

import { join } from 'node:path'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import { dshHomePath } from '@huiliyi37/dsh-paths'
import type { CommandDefinition, CommandInvocation, CommandResult, CommandService } from '@huiliyi37/dsh-commands'
import type {} from '@huiliyi37/dsh-commands'
import type { Agent } from '@huiliyi37/dsh-agent'
import type { ApprovalRequest, ApprovalOutcome } from '@huiliyi37/dsh-user-approval'
import type {} from '@huiliyi37/dsh-user-approval'
import type { CallId } from '@huiliyi37/dsh-llm'
import type { Session } from '@huiliyi37/dsh-session'
import type { FileRule, PermissionDecision, PermissionLayer, Rule } from './types.ts'
import { appendRule, loadRules, mergeRules, matchRule, removeRuleAtFile } from './rules.ts'
import { normalizeArguments } from './glob.ts'

export type * from './types.ts'
export { matchesPattern, normalizeArguments } from './glob.ts'
export {
  appendRule,
  loadRules,
  matchRule,
  mergeRules,
  parseRules,
  removeRuleAtFile,
  writeRules,
} from './rules.ts'

declare module '@huiliyi37/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A persistent rule settled an `approval/request` — log-only audit (NOT a
     * surface event, carries no `surfaceOp`, never enters the model
     * transcript). Appended to the owning session between the matching
     * `approval/asked` and `approval/decided`; `ruleIndex` is the zero-based
     * position in the effective (user-then-project) rule list that matched.
     */
    'approval/rule': {
      /** The rule's exact tool name. */
      tool: string
      /** The rule's full-string-anchored glob pattern (the matched value). */
      pattern: string
      /** The decision the matched rule settled the request with. */
      decision: PermissionDecision
      /** Zero-based index of the matched rule in the effective list. */
      ruleIndex: number
      /** Which storage layer owned the matched rule. */
      layer: PermissionLayer
    }
  }
}

/** Cordis plugin name. */
export const name = 'approval-rules'

/** Services this plugin consumes: the approval seam. The command plane and the
 * TUI slash menu attach through optional injects so a headless rules-only
 * composition can mount without them. */
export const inject = ['approval']

/** Plugin config: the two rule-layer files, overridable by a deployment. */
export interface Config {
  /** User-rule file; defaults to `<resolveDshHome()>/permissions.yaml`. */
  readonly userFile?: string
  /** Project-rule file; defaults to `<cwd>/.dsh/permissions.yaml`. */
  readonly projectFile?: string
}

/** Runtime schema for the plugin config. */
export const Config: z<Config> = z.object({
  userFile: z.string(),
  projectFile: z.string(),
})

/** Resolved, non-optional layer file paths. */
interface ResolvedConfig {
  readonly userFile: string
  readonly projectFile: string
}

/** Resolve the two layer files from config or their documented defaults. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    userFile: config.userFile ?? dshHomePath('permissions.yaml'),
    projectFile: config.projectFile ?? join(process.cwd(), '.dsh', 'permissions.yaml'),
  }
}

/** Minimal shape of the TUI slash facet consumed through the optional seam. */
interface TuiSlashFacet {
  register(command: {
    name: string
    description: string
    argsHint?: string
    run: (args: TuiSlashRun) => void | Promise<void>
  }): void
}

/** Arguments the TUI slash registry hands each command invocation. */
interface TuiSlashRun {
  text: string
  sessionId: string | null
  echo: (text: string) => void
  ctx: { agents?: { get(id: string): unknown } }
}

/**
 * Same-process facet for interactive answerers (the TUI approval card's
 * "永久允许"): persists the exact-match allow rule for one pending request.
 * Exposed under {@link PERSIST_ALLOW_KEY} via `ctx.provide`.
 */
export interface PersistAllowFacet {
  /**
   * Derive the exact-match allow rule for a pending approval request (tool +
   * the request's normalized argument string, `match: 'exact'`) and append it
   * to the project layer.
   * @param req - the pending request the user chose to allow permanently.
   * @returns the persisted rule (layer-stamped).
   */
  persistAllowRule(req: ApprovalRequest): Promise<Rule>
}

/** Context key for the {@link PersistAllowFacet} same-process facet. */
export const PERSIST_ALLOW_KEY = 'approvalRules.persistAllow'

/** The command's mutation surface, shared by the host handler and the answerer. */
interface PermissionsControls {
  readonly effective: () => readonly Rule[]
  addRule(rule: FileRule): Promise<void>
  removeRuleAt(index: number): Promise<void>
}

/** Extract the exact `arguments` string of the `tool/call` event a request references. */
function toolCallArguments(req: ApprovalRequest): string {
  const callId: CallId | undefined = req.callId
  if (callId === undefined) return ''
  const session: Session = req.agent.session
  for (const event of session.events) {
    if (event.type === 'tool/call' && event.data.callId === callId) return event.data.arguments
  }
  return ''
}

/** One line of the `/permissions` bare list, in effective-index order. */
function formatRuleLine(index: number, rule: Rule): string {
  return `${index}  ${rule.layer}  ${rule.tool}  ${rule.pattern}  ${rule.decision}`
}

/** Render the effective rule list for the `/permissions` bare listing. */
function formatEffective(rules: readonly Rule[]): string {
  if (rules.length === 0) return 'No approval rules configured.'
  return rules.map((rule, index) => formatRuleLine(index, rule)).join('\n')
}

/**
 * Settle one request from the effective rules, or delegate to the chain.
 * @param req - the pending approval decision.
 * @param next - delegates to the remaining waterfall listeners.
 * @param effective - the current merged rule list.
 * @returns the settled outcome, or the chain's own answer via `next()`.
 */
async function answer(
  req: ApprovalRequest,
  next: () => Promise<ApprovalOutcome>,
  effective: () => readonly Rule[],
): Promise<ApprovalOutcome> {
  const found = matchRule(effective(), req.toolName, normalizeArguments(toolCallArguments(req)))
  if (found === undefined) return next()
  req.agent.session.append('approval/rule', {
    tool: found.rule.tool,
    pattern: found.rule.pattern,
    decision: found.rule.decision,
    ruleIndex: found.index,
    layer: found.rule.layer,
  })
  // A matching allow rule is a standing grant, not a one-shot: the same rule
  // settles every future matching request without re-asking. The distinct
  // outcome keeps the audit trail honest ('allowed-always' in approval/decided).
  return found.rule.decision === 'allow' ? 'allowed-always' : 'rejected'
}

/** Execute the `/permissions` host command against the shared mutation surface. */
async function executePermissions(invocation: CommandInvocation, controls: PermissionsControls): Promise<CommandResult> {
  const text = invocation.rawInput.trim()
  const parts = text.split(/\s+/)
  const [sub, first, second, third] = parts
  if (sub === undefined || sub === '') {
    return { kind: 'success', text: formatEffective(controls.effective()) }
  }
  if (sub === 'add') {
    if (parts.length !== 4 || first === undefined || second === undefined || third === undefined) {
      return { kind: 'error', text: 'Usage: permissions add <tool> <pattern> <allow|deny>' }
    }
    if (third !== 'allow' && third !== 'deny') {
      return { kind: 'error', text: `Invalid decision "${third}" (must be "allow" or "deny")` }
    }
    try {
      await controls.addRule({ tool: first, pattern: second, decision: third })
    } catch (error: unknown) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
    return { kind: 'success', text: `Added ${third} rule: ${first} ${second} (project)` }
  }
  if (sub === 'remove') {
    if (parts.length !== 2 || first === undefined) {
      return { kind: 'error', text: 'Usage: permissions remove <index>' }
    }
    const index = Number(first)
    if (!Number.isSafeInteger(index) || index < 0) {
      return { kind: 'error', text: `Invalid index "${first}" (must be a non-negative integer)` }
    }
    try {
      await controls.removeRuleAt(index)
    } catch (error: unknown) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
    return { kind: 'success', text: `Removed rule at index ${index}` }
  }
  return { kind: 'error', text: 'Usage: permissions [add <tool> <pattern> <allow|deny> | remove <index>]' }
}

/** Build the host `/permissions` command definition. */
function buildPermissionsCommand(controls: PermissionsControls): CommandDefinition {
  return {
    name: 'permissions',
    description: 'List or manage persistent approval rules (distinct from /permission preset switching)',
    input: { hint: '[add <tool> <pattern> <allow|deny> | remove <index>]' },
    handler: invocation => executePermissions(invocation, controls),
  }
}

/** Build the TUI slash-menu mirror, delegating execution to the host command service. */
function buildTuiCommand(host: () => CommandService | undefined): {
  name: string
  description: string
  argsHint: string
  run: (args: TuiSlashRun) => Promise<void>
} {
  return {
    name: 'permissions',
    description: '查看或管理持久化审批规则（区别于 /permission 预设切换）',
    argsHint: '[add <tool> <pattern> <allow|deny> | remove <index>]',
    run: async ({ text, ctx: runCtx, sessionId, echo }) => {
      const input = text.trim() === '' ? '/permissions' : `/permissions ${text.trim()}`
      const commands = host()
      if (sessionId === null) {
        echo('⚠ /permissions 需要活动会话')
        return
      }
      if (commands === undefined) {
        echo('⚠ /permissions 命令服务不可用')
        return
      }
      const agent = runCtx.agents?.get(sessionId)
      if (agent === undefined) {
        echo('⚠ /permissions 需要活动会话')
        return
      }
      const execution = await commands.execute(agent as Agent, input, new AbortController().signal)
      if (execution === undefined) {
        echo(`未知命令: ${input}`)
        return
      }
      if (execution.result.kind === 'success') {
        echo(execution.result.text ?? '已执行')
      } else {
        echo(`⚠ 命令执行失败: ${execution.result.text}`)
      }
    },
  }
}

/**
 * Apply the approval-rules plugin: load both rule layers (failing loud on a
 * malformed file), register the rule answerer, and attach the `/permissions`
 * host command plus its TUI slash-menu mirror.
 * @param ctx - plugin context (injects `approval`).
 * @param config - the two rule-layer file paths.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const { userFile, projectFile } = resolveConfig(config)
  let userRules: FileRule[] = await loadRules(userFile)
  let projectRules: FileRule[] = await loadRules(projectFile)

  const effective = (): readonly Rule[] => mergeRules(userRules, projectRules)

  ctx.on('approval/request', (req, next) => answer(req, next, effective))

  // Disk is the authoritative rule store: mutations commit to the layer file
  // first, then mirror the in-memory snapshot the answerer reads. A failed
  // write therefore never leaves memory holding a rule the disk lost, and an
  // externally edited file can only diverge from the snapshot until the next
  // mutation re-reads it (no filesystem watching — restart picks up edits).
  const addRule = async (rule: FileRule): Promise<void> => {
    await appendRule(projectFile, rule)
    projectRules = await loadRules(projectFile)
  }
  const removeRuleAt = async (index: number): Promise<void> => {
    // Resolve the listed index against a fresh disk read, so the rule the
    // command deletes is the one the user just saw in the listing even when
    // the on-disk layer changed after this plugin loaded.
    const freshUser = await loadRules(userFile)
    const target = mergeRules(freshUser, await loadRules(projectFile))[index]
    if (target === undefined) {
      throw new Error(`approval-rules: no rule at effective index ${index}`)
    }
    if (target.layer === 'user') {
      await removeRuleAtFile(userFile, index)
    } else {
      await removeRuleAtFile(projectFile, index - freshUser.length)
    }
    userRules = await loadRules(userFile)
    projectRules = await loadRules(projectFile)
  }
  const controls: PermissionsControls = { effective, addRule, removeRuleAt }

  // Same-process facet: the TUI approval card settles "永久允许" by persisting
  // the exact-match rule first, then settling the request — so the grant a
  // later identical request receives comes from the rule answerer, not from
  // any in-memory always-flag.
  ctx.provide(PERSIST_ALLOW_KEY, {
    persistAllowRule: async (req: ApprovalRequest): Promise<Rule> => {
      const pattern = normalizeArguments(toolCallArguments(req))
      if (pattern === '') {
        // The rules schema forbids an empty pattern, and an unrestricted
        // wildcard is not something a single keypress should grant — the
        // user can still write the rule deliberately via /permissions add.
        throw new Error('approval-rules: this request carries no call arguments to match; use /permissions add for a tool-wide rule')
      }
      const rule: FileRule = {
        tool: req.toolName,
        pattern,
        decision: 'allow',
        match: 'exact',
      }
      await addRule(rule)
      const merged = mergeRules(userRules, projectRules)
      const stamped = merged.find(candidate =>
        candidate.tool === rule.tool
        && candidate.pattern === rule.pattern
        && (candidate.match ?? 'glob') === (rule.match ?? 'glob'))
      if (stamped === undefined) {
        throw new Error(`approval-rules: persisted rule not visible after append: ${rule.tool} ${rule.pattern}`)
      }
      return stamped
    },
  } satisfies PersistAllowFacet)

  // Host command plane (optional): register /permissions when commands exists.
  let hostCommands: CommandService | undefined
  ctx.inject(['commands'], (commandCtx) => {
    hostCommands = commandCtx.get('commands')
    commandCtx.commands.register(buildPermissionsCommand(controls))
  })

  // TUI slash menu (optional seam): mirror /permissions, delegating to the host
  // registry so the command/run + command/done lifecycle stays intact.
  ctx.inject(['tui.commands'], (tuiCtx) => {
    const tui = tuiCtx.get('tui.commands') as TuiSlashFacet
    tui.register(buildTuiCommand(() => hostCommands))
  })
}
