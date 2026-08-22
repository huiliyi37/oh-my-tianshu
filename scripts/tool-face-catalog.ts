/**
 * Intent groups for the shipped tool catalog, plus the partition the coverage
 * gate checks: every registered name belongs to one group, and every group is
 * on the self-sufficient base face, a mountable product-face layer, or an
 * explicit exclusion.
 *
 * @module
 */

/** One intent group: names that serve the same user intent, plus whether bash can stand in. */
export interface CapabilityGroup {
  /** Group id shared with the face-partition tables. */
  readonly id: string
  /** Tool names; each must appear in `docs/tool-catalog.md`. */
  readonly tools: readonly string[]
  /**
   * Whether bash can stand in for this group. `false` groups are either on the
   * face or unreachable for that run — they are not substitution candidates.
   */
  readonly substitutable: boolean
}

/**
 * Every intent group covering `docs/tool-catalog.md`.
 *
 * The first two are the self-sufficient base face: `bash` (or `pwsh` on Windows)
 * plus `todo_write`. Remaining `substitutable: true` groups overlap bash.
 */
export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  { id: 'shell', tools: ['bash', 'pwsh'], substitutable: false },
  { id: 'bookkeeping', tools: ['todo_write'], substitutable: false },
  { id: 'fs-read', tools: ['read'], substitutable: true },
  { id: 'fs-write', tools: ['write'], substitutable: true },
  { id: 'fs-edit', tools: ['edit', 'str_replace_editor'], substitutable: true },
  { id: 'fs-search', tools: ['grep', 'glob'], substitutable: true },
  { id: 'file-info', tools: ['file_info'], substitutable: true },
  { id: 'git', tools: ['git'], substitutable: true },
  { id: 'web', tools: ['web_fetch', 'web_search'], substitutable: true },
  {
    id: 'persistent-shell',
    tools: ['terminal_open', 'terminal_send', 'terminal_read', 'terminal_close', 'terminal_list', 'terminal_signal'],
    substitutable: true,
  },
  { id: 'background-task', tools: ['task_list', 'task_output', 'task_kill'], substitutable: true },
  // run_code replaces the whole tool transport; `node -e` is shell, not a stand-in.
  { id: 'code-mode', tools: ['run_code'], substitutable: false },
  { id: 'code-intel', tools: ['lsp', 'semantic_search', 'repo_graph'], substitutable: false },
  {
    id: 'session-query',
    tools: ['session_search', 'session_trace', 'session_event_read', 'session_event_search', 'session_event_trace'],
    substitutable: false,
  },
  { id: 'memory', tools: ['memory_deep_recall', 'memory_save', 'memory_search'], substitutable: false },
  { id: 'skill', tools: ['skill'], substitutable: false },
  { id: 'goal', tools: ['create_goal', 'get_goal', 'update_goal'], substitutable: false },
  { id: 'subagent', tools: ['subagent', 'interrupt_agent', 'list_agents', 'send_message', 'report'], substitutable: false },
  { id: 'workflow', tools: ['workflow', 'ralph'], substitutable: false },
  { id: 'schedule', tools: ['schedule_create', 'schedule_delete', 'schedule_list'], substitutable: false },
  { id: 'self-modification', tools: ['cordis_inspect', 'cordis_mount', 'cordis_unmount'], substitutable: false },
  { id: 'interaction', tools: ['ask_user_question'], substitutable: false },
  { id: 'routing-adoption', tools: ['router_adopt'], substitutable: false },
  { id: 'plan-mode', tools: ['exit_plan_mode'], substitutable: false },
  { id: 'tests', tools: ['run_tests', 'related_tests'], substitutable: false },
]

/** Self-sufficient base names any product face must include. */
export const BASE_FACE: readonly string[] = ['bash', 'todo_write']

const GROUP_BY_TOOL: ReadonlyMap<string, CapabilityGroup> = new Map(
  CAPABILITY_GROUPS.flatMap(group => group.tools.map(tool => [tool, group] as const)),
)

const GROUP_BY_ID: ReadonlyMap<string, CapabilityGroup> = new Map(
  CAPABILITY_GROUPS.map(group => [group.id, group] as const),
)

/**
 * Look up the intent group for a registered tool name.
 * @param tool - registered tool name.
 * @returns the group, or undefined when ungrouped.
 */
export function groupOfTool(tool: string): CapabilityGroup | undefined {
  return GROUP_BY_TOOL.get(tool)
}

/** One bash-command shape that stands in for an intent group. */
type CapabilitySignature =
  | { readonly kind: 'command'; readonly capability: string; readonly commands: readonly string[] }
  | { readonly kind: 'pattern'; readonly capability: string; readonly pattern: RegExp }

/**
 * Conservative bash stand-in table: only `substitutable: true` groups.
 * Prefer a miss over counting ordinary shell use as substitution.
 */
const CAPABILITY_SIGNATURES: readonly CapabilitySignature[] = [
  { kind: 'command', capability: 'fs-read', commands: ['cat', 'head', 'tail', 'less', 'more', 'nl'] },
  { kind: 'command', capability: 'fs-search', commands: ['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'fd', 'ls'] },
  { kind: 'pattern', capability: 'fs-search', pattern: /\bls\s+-\w*R/ },
  { kind: 'command', capability: 'fs-write', commands: ['tee', 'touch'] },
  { kind: 'pattern', capability: 'fs-write', pattern: /<<-?\s*['"]?[A-Za-z_]/ },
  { kind: 'pattern', capability: 'fs-write', pattern: />>?\s*[^\s&|>]/ },
  { kind: 'command', capability: 'fs-edit', commands: ['patch'] },
  { kind: 'pattern', capability: 'fs-edit', pattern: /\b(?:sed|perl|ruby)\s+(?:-\w+\s+)*-\w*i/ },
  { kind: 'command', capability: 'file-info', commands: ['stat', 'wc', 'file', 'du'] },
  { kind: 'command', capability: 'git', commands: ['git'] },
  { kind: 'command', capability: 'web', commands: ['curl', 'wget'] },
  { kind: 'command', capability: 'persistent-shell', commands: ['tmux', 'screen', 'nohup'] },
  { kind: 'command', capability: 'background-task', commands: ['jobs', 'ps', 'kill', 'pkill'] },
]

/**
 * Check that every registered tool sits in one group and the signature table
 * only names substitutable groups.
 * @param registered - every tool name in `docs/tool-catalog.md`.
 * @returns readable violations; empty means the catalog holds.
 */
export function capabilityCoverageViolations(registered: readonly string[]): string[] {
  const violations: string[] = []
  for (const tool of [...new Set(registered)].sort()) {
    if (!GROUP_BY_TOOL.has(tool)) {
      violations.push(`tool '${tool}' is registered but not assigned to a capability group`)
    }
  }
  const known = new Set(registered)
  for (const group of CAPABILITY_GROUPS) {
    for (const tool of group.tools) {
      if (!known.has(tool)) {
        violations.push(`capability group '${group.id}' names '${tool}', which no package registers`)
      }
    }
  }
  for (const signature of CAPABILITY_SIGNATURES) {
    const group = GROUP_BY_ID.get(signature.capability)
    if (group === undefined) {
      violations.push(`signature references unknown capability '${signature.capability}'`)
    } else if (!group.substitutable) {
      violations.push(`signature maps a bash command to '${group.id}', which is marked not substitutable`)
    }
  }
  return violations
}

/** One mountable product-face layer: the tools and intent groups it contributes. */
export interface FaceLayer {
  /** Layer id. */
  readonly id: string
  /** Tool names this layer registers. */
  readonly tools: readonly string[]
  /** Intent-group ids this layer contributes. */
  readonly capabilities: readonly string[]
}

/** Product-face layers that can be mounted independently of the base face. */
export const REAL_LAYERS: readonly FaceLayer[] = [
  { id: 'fs', tools: ['read', 'write', 'edit'], capabilities: ['fs-read', 'fs-write', 'fs-edit'] },
  { id: 'str-replace', tools: ['str_replace_editor'], capabilities: ['fs-edit'] },
  { id: 'fs-search', tools: ['glob', 'grep'], capabilities: ['fs-search'] },
  { id: 'file-info', tools: ['file_info'], capabilities: ['file-info'] },
  { id: 'git', tools: ['git'], capabilities: ['git'] },
  { id: 'tasks', tools: ['task_kill', 'task_list', 'task_output'], capabilities: ['background-task'] },
  { id: 'code-intel', tools: ['lsp', 'semantic_search'], capabilities: ['code-intel'] },
  { id: 'memory', tools: ['memory_deep_recall', 'memory_save', 'memory_search'], capabilities: ['memory'] },
  {
    id: 'session-query',
    tools: ['session_event_read', 'session_event_search', 'session_event_trace', 'session_search', 'session_trace'],
    capabilities: ['session-query'],
  },
  { id: 'tests', tools: ['run_tests', 'related_tests'], capabilities: ['tests'] },
]

/** An intent group left off the product face, with the reason. */
export interface ExcludedCapability {
  /** Intent-group id. */
  readonly capability: string
  /** Why the group is not required on the product face. */
  readonly reason: string
}

/** Intent groups that are not a product-face partition home. */
export const EXCLUDED_CAPABILITIES: readonly ExcludedCapability[] = [
  {
    capability: 'persistent-shell',
    reason: 'its only real backend (dsh-pty-local) injects ctx.sandboxPolicy, whose service registers a '
      + 'system-prompt section, so mounting it changes the prompt independently of the tool face.',
  },
  {
    capability: 'web',
    reason: 'needs live network egress and a provider credential.',
  },
  {
    capability: 'skill',
    reason: 'the skill tool injects replacement catalogs into user messages, changing the prompt surface.',
  },
  {
    capability: 'goal',
    reason: 'goal mutations require direct-human root authority.',
  },
  {
    capability: 'subagent',
    reason: 'needs a child-process provider outside the catalog partition.',
  },
  {
    capability: 'workflow',
    reason: 'needs a subagent provider behind the workflow engine.',
  },
  {
    capability: 'schedule',
    reason: 'agent-scoped and durable-persistence-bound; tools exist only on root agents created after load.',
  },
  {
    capability: 'self-modification',
    reason: 'cordis_* is in no shipped tree (deliberate opt-in).',
  },
  {
    capability: 'interaction',
    reason: 'ask_user_question blocks until a human answers.',
  },
  {
    capability: 'routing-adoption',
    reason: 'router_adopt exists only on a dispatch-capable agent-router assembly and is actionable only with pending outcomes.',
  },
  {
    capability: 'code-mode',
    reason: 'run_code exists only under a non-native registry mode that replaces the whole tool transport.',
  },
  {
    capability: 'plan-mode',
    reason: 'exit_plan_mode comes with a turn-policy change, not just a face entry.',
  },
]

/** A single tool left off the product face while its group remains. */
export interface ExcludedTool {
  /** Tool name. */
  readonly tool: string
  /** Why this name is excluded. */
  readonly reason: string
}

/** Per-name exclusions inside an otherwise-mounted group. */
export const EXCLUDED_TOOLS: readonly ExcludedTool[] = [
  {
    tool: 'repo_graph',
    reason: 'its dynamic context contribution opens a meridian SQLite state dir under the indexer root.',
  },
]
