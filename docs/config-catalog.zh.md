<!-- 英文源文件由 scripts/gen-config-catalog.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-config-catalog` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/config-catalog.md` 重新记录配对。 -->

# 插件配置目录

[English](config-catalog.md) | 中文

每个 `config:` 块均可由 `cordis.yml` 条目设置：针对每个可加载的 harness 包，原样列出其 `apply` 函数或服务构造函数接收的配置声明（包括 JSDoc），并附上所有引用类型——包内类型直接粘贴，其他类型则提供链接。粘贴的内容是插件声明的完整配置类型——运行时 schema 有意排除的字段是仅供运行时使用的 seam（其自身的 JSDoc 会如此说明），不能通过 `cordis.yml` 设置。这是以**部署**为轴的参考文档——插件作者所依据的连接方式请参阅各[子系统页面](subsystems/core.md)中的生成 `cordis-surface` 区域，面向模型的工具 schema 请参阅[工具目录](tool-catalog.md)，而 [subsystems/](subsystems/core.md) 则记录了这些声明所引用的类型。

英文源文件由源代码（`scripts/gen-config-catalog.ts`）生成，并通过 `pnpm run verify-config-catalog`（`doc-sync` 的一部分）验证新鲜度；本中文文件作为经评审对侧通过双语配对维护。声明块使用 `ts config-catalog` 围栏（doc-typecheck 会跳过它，因为单独引用导入项的声明无法独立编译）。英文生成器还会将运行时 schemastery schema 与粘贴的声明进行交叉核对——每个经 schema 验证的键（包括嵌套键）都必须能在声明的配置类型中找到——因此，粘贴内容无法隐藏加载器接受的字段。

`Requires:` 行列出插件通过 `inject` 注入的服务键：其 `cordis.yml` 树还必须加载这些服务的提供者。范围限定为 harness 层级（`packages/`）；配置树还可能加载的 vendored cordis 插件（`hmr`、控制台日志记录器等）固定为上游源代码（参见 [vendoring policy](../vendor/README.md)），未收录于此目录。

## `@huiliyi37/dsh-acp`

需要：`agents`

```ts config-catalog
/** Plugin config: the provider/model selection used for each ACP-created agent. */
export interface AcpConfig {
  /** Provider route for created agents. */
  provider?: string
  /** Model name for created agents. */
  model?: string
  /** Runtime-only transport override; production uses stdio. */
  stream?: Stream
}
```

依赖：`Stream`（`@agentclientprotocol/sdk`）

来源：[`packages/acp/acp/src/index.ts:70`](../packages/acp/acp/src/index.ts)

## `@huiliyi37/dsh-acp-demo`

```ts config-catalog
/**
 * App config: the swappable per-deployment values. `provider` and `model` configure
 * each agent the ACP bridge creates at `session/new`; `persona` is the
 * deployment persona (forwarded to the system-prompt plugin); `toolOrder` is
 * the explicit model-facing tool order (forwarded to the system-prompt plugin);
 * `tools` is the tool registry's config (its presentation `mode`, forwarded
 * through agent-spine-demo); `persistenceRoot` is the JSONL backend's directory.
 */
export interface Config {
  /** Provider route for ACP-created agents. */
  provider: string
  /** Model name for ACP-created agents (must have a registered adapter). */
  model: string
  /** Bundled agent-loop concurrency cap; `1` is serial and omission uses its default. */
  maxParallelToolCalls?: number
  /** Deployment persona (the system-prompt plugin's `persona` config). */
  persona?: string
  /** Explicit model-facing tool order (the system-prompt plugin's `toolOrder` config; see dsh-system-prompt). */
  toolOrder?: string[]
  /** Tool-registry config — its presentation `mode` (forwarded through agent-spine-demo; see dsh-tools). */
  tools?: ToolsConfig
  /** Tianshu Harness home directory exposed to bash and used for local skill discovery. */
  dshHome?: string
  /** Fallback session-title limits forwarded through agent-spine-demo. */
  sessionTitle?: NonNullable<agentCore.Config['sessionTitle']>
  /** Directory for JSONL sessions and the derived query index. Defaults to `./.sessions`. */
  persistenceRoot?: string
  /** Write delta-chunk runs as packed storage rows (the JSONL backend's `packChunks`). Defaults to `true`. */
  packChunks?: boolean
  /** JSONL artifact encoding; defaults to checksummed Zstandard frames. */
  persistenceCompression?: JsonlCompression
  /** Controls automatic AGENTS.md/CLAUDE.md loading; configure a byte budget or set `false`. */
  workspaceContext: agentCore.Config['workspaceContext']
  /** Skill registry, local-provider, and model-facing consumer config forwarded to agent-spine-demo. */
  skills?: agentCore.SkillConfig
  /** Model-facing bash tool config forwarded through agent-core. */
  toolBash?: NonNullable<agentCore.Config['toolBash']>
  /** Generic background-task controls forwarded through agent-core; set false to omit their tool surface. */
  toolTasks?: NonNullable<agentCore.Config['toolTasks']>
  /** Persisted same-session goals; owner defaults enable them, or false disables the stack and tools. */
  goals?: agentCore.GoalConfig | false
}
```

依赖：[`agentCore`](../packages/examples/agent-spine-demo/src/index.ts) · [`JsonlCompression`](../packages/session/session-persistence-jsonl/src/index.ts) · [`ToolsConfig`](#huiliyi37dsh-tools)

来源：[`packages/examples/acp-demo/src/index.ts:39`](../packages/examples/acp-demo/src/index.ts)

## `@huiliyi37/dsh-agent-default-model`

```ts config-catalog
/** Composition entry for the default model selection. */
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}
```

来源：[`packages/core/agent-default-model/src/index.ts:41`](../packages/core/agent-default-model/src/index.ts)


## `@huiliyi37/dsh-agent-definitions`

```ts config-catalog
/** Agent definition registry and local discovery configuration. */
export interface Config {
  /** Whether project and user roots are included around custom roots. */
  includeDefaultRoots?: boolean
  /** Tianshu Harness config root. Defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Shared agent config root. Defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
  /** Additional agent roots scanned after project roots and before user roots. */
  customAgentDirs?: string[]
  /** Bundled agent root for installer-supplied roles; defaults to none. */
  bundledAgentDir?: string
  /** Register the built-in read-only `explore` role (default true). */
  builtinExplore?: boolean
  /** Maximum number of completed cwd catalogs kept in memory. */
  collectCacheMaxEntries?: number
  /** Whether host-local agent roots are watched for catalog changes. */
  watch?: boolean
  /** Whether Chokidar uses polling instead of native filesystem events. */
  watchUsePolling?: boolean
  /** Milliseconds a changed role file must remain stable before it is observed. */
  watchStabilityThresholdMs?: number
  /** Milliseconds between Chokidar stability or polling probes. */
  watchPollIntervalMs?: number
  /** Maximum distinct project roots whose agent directories remain watched. */
  watchMaxProjects?: number
  /** Whether watched symbolic links follow their target files. */
  watchFollowSymlinks?: boolean
}
```

来源：[`packages/subagent/agent-definitions/src/index.ts:107`](../packages/subagent/agent-definitions/src/index.ts)

## `@huiliyi37/dsh-agent-loop`

需要：`agents` · `sessions` · `llm` · `tools` · `systemPrompt`

```ts config-catalog
/** Agent-loop plugin configuration. */
export interface Config {
  /**
   * Maximum parallel-safe calls in flight per agent step. `1` is serial;
   * omission defaults to {@link DEFAULT_MAX_PARALLEL_TOOL_CALLS}.
   */
  maxParallelToolCalls?: number
  /** Agents created or resumed at plugin startup. */
  agents: (AgentOptions & {
    /** Stable config label used in logs and as the fresh combined-id prefix. */
    id: string
    /** Optional stable identity; remounts resume its materialized history, while first use creates it fresh. */
    sessionId?: SessionId
    /** Optional workspace for a fresh session. */
    cwd?: string
    /** Persisted session to resume instead of creating a fresh session. */
    resumeSessionId?: SessionId
  })[]
}
```

依赖：[`AgentOptions`](subsystems/core.md) · [`SessionId`](subsystems/core.md)

来源：[`packages/core/agent-loop/src/index.ts:236`](../packages/core/agent-loop/src/index.ts)

## `@huiliyi37/dsh-agent-presets`

需要：`loader`

```ts config-catalog
/** Plugin config: which preset is the default, and where presets live. */
export interface Config {
  /** Preset id mounted when a caller names none. Missing at mount time fails loud. */
  default: string
  /** Scanned roots in precedence order; an earlier root wins a duplicate id. */
  roots: PresetRoot[]
  /**
   * Append the harness home's `USER_PRESET_DIR` as a `user` root, after every
   * configured root. False mounts a roster over `roots` alone.
   */
  includeUserRoot: boolean
}

/** One directory scanned for preset subdirectories. */
export interface PresetRoot {
  /** Directory holding one subdirectory per preset; a leading `~` expands. */
  path: string
  /** Trust recorded on every preset discovered under this root. */
  trust: PresetTrust
}

/**
 * Where a preset's composition came from. A `system` preset ships with the
 * deployment; a `user` preset was authored locally, by a person or by an
 * agent, and therefore carries the same trust as shell access.
 */
export type PresetTrust = 'system' | 'user'
```

来源：[`packages/preset/agent-presets/src/preset.ts:52`](../packages/preset/agent-presets/src/preset.ts)


## `@huiliyi37/dsh-agent-router`

```ts config-catalog
/** 插件配置。 */
export interface AgentRouterConfig {
  /** 是否启用子代理派发（默认 true；false 时路由仍决策但只回显动作）。 */
  dispatchEnabled?: boolean
  /** 派发子代理所用 provider；缺省随子代理服务的默认路由。 */
  provider?: string
  /** 派发子代理所用模型名；缺省随子代理服务的默认路由。 */
  model?: string
}
```

来源：[`packages/guard/agent-router/src/index.ts:54`](../packages/guard/agent-router/src/index.ts)

## `@huiliyi37/dsh-agent-spine-demo`

```ts config-catalog
/**
 * Bundle config: each field forwarded verbatim to the child that owns it —
 * `agents` to the agent loop (an app that pre-creates no agents, like the ACP
 * bridge, simply omits it), `includeHarnessIdentity`, `persona`, and `toolOrder`
 * to the system-prompt plugin (the fixed opener, deployment persona, and explicit
 * model-facing tool order), the `tools` object to the tool registry (its presentation `mode`),
 * `dshHome` to bash environment and local skill discovery, `sessionTitle` to
 * the fallback title service, `skills` to the
 * skill registry/local provider/tool consumer, `workspaceContext` to the
 * workspace-context loader, and `toolBash`/`toolTasks` to the model-facing tool
 * plugins this bundle owns. Provider adapters own their `retryPolicy`; this
 * bundle always mounts its executor.
 * `goals` opts into and configures the persisted goal domain plus its model tool
 * and same-session driver; `invariants` configures global and package-filtered
 * relational checks. Owner schemas supply defaults for optional input;
 * workspace context instead requires an explicit byte budget or `false` because
 * it changes model-visible input. Producer opt-in stays producer-local:
 * `toolBash` configures bash only; independently composed producers keep their
 * own config. Set `toolBash: false` when another plugin owns the model-facing
 * `bash` name.
 */
export interface Config {
  /** The agent-loop `agents` list (see dsh-agent-loop's `Config`). */
  agents?: AgentLoopConfig['agents']
  /** Agent-loop concurrency cap; `1` is serial. */
  maxParallelToolCalls?: AgentLoopConfig['maxParallelToolCalls']
  /** Whether the system prompt includes the fixed Harness identity (default true). */
  includeHarnessIdentity?: SystemPromptConfig['includeHarnessIdentity']
  /** The deployment persona (see dsh-system-prompt's `Config`). */
  persona?: SystemPromptConfig['persona']
  /** The explicit model-facing tool order (see dsh-system-prompt's `Config`). */
  toolOrder?: SystemPromptConfig['toolOrder']
  /** The tool registry's config — its presentation `mode` (see dsh-tools' `Config`). */
  tools?: ToolsConfig
  /** Tianshu Harness home directory shared by shell context and local skill discovery. */
  dshHome?: string
  /** Deterministic fallback and accepted-title limits; omission uses the bundle's example policy. */
  sessionTitle?: SessionTitleConfig
  /** Workspace-context loader controls with an explicit byte budget; set `false` for hermetic prompts. */
  workspaceContext: workspaceContext.Config | false
  /**
   * Skill registry, local provider, and model-facing consumer config.
   * Skills use `enabled` because one nested config controls a provider stack;
   * single model-tool plugins use `Config | false` to disable that one consumer.
   */
  skills?: SkillConfig
  /** Model-facing bash tool config, or false when another plugin owns `bash`. */
  toolBash?: toolBash.Config | false
  /** Generic background-task controls; set false to keep the task service without model-facing task tools. */
  toolTasks?: toolTasks.Config | false
  /** Global enablement and package-name filters for invariant companions. */
  invariants?: InvariantConfig
  /** Opt-in persisted same-session goal stack; set false or omit to leave it unmounted. */
  goals?: GoalConfig | false
}

/** Skill bundle config forwarded to the registry, local provider, and model-facing consumer. */
export interface SkillConfig {
  /** Mount the bundled local skill provider and model-facing skill tool (default true). */
  enabled?: boolean
  /** Registry-level discovery cache settings. */
  registry?: SkillRegistryConfig
  /** Local filesystem skill provider settings. */
  local?: SkillLocal.Config
  /** Model-facing skill catalog and tool settings. */
  tool?: toolSkill.Config
}

/** Persisted goal domain, model-tool policy, and same-session driver config. */
export interface GoalConfig {
  /** Goal-domain creation defaults. */
  domain?: GoalDomainConfig
  /** Model-facing goal-tool authority policy. */
  tool?: toolGoal.Config
}
```

依赖：[`AgentLoopConfig`](#huiliyi37dsh-agent-loop) · [`GoalDomainConfig`](#huiliyi37dsh-goal) · [`InvariantConfig`](#huiliyi37dsh-invariants) · [`SessionTitleConfig`](#huiliyi37dsh-session-title) · [`SkillLocal`](../packages/skill/skill-local/src/index.ts) · [`SkillRegistryConfig`](#huiliyi37dsh-skill) · [`SystemPromptConfig`](#huiliyi37dsh-system-prompt) · [`toolBash`](../packages/bash/tool-bash/src/index.ts) · [`toolGoal`](../packages/goal/tool-goal/src/index.ts) · [`ToolsConfig`](#huiliyi37dsh-tools) · [`toolSkill`](../packages/skill/tool-skill/src/index.ts) · [`toolTasks`](../packages/tasks/tool-tasks/src/index.ts) · [`workspaceContext`](../packages/context/workspace-context/src/index.ts)

来源：[`packages/examples/agent-spine-demo/src/index.ts:90`](../packages/examples/agent-spine-demo/src/index.ts)
## `@huiliyi37/dsh-agent-tool-presentation`

需要：`tools`

```ts config-catalog
/** Plugin config. */
export interface Config {
  /**
   * The form this agent's model sees. `native` sends every visible schema,
   * `code` sends only `run_code` plus a generated SDK, `both` sends both.
   * Required rather than defaulted: the deployment default is what a preset
   * without this row already gets, so an omitted value would mean the row was
   * composed for nothing.
   */
  mode: ToolPresentationMode
}
```

依赖：[`ToolPresentationMode`](../packages/core/tools/src/index.ts)

来源：[`packages/core/agent-tool-presentation/src/index.ts:38`](../packages/core/agent-tool-presentation/src/index.ts)


## `@huiliyi37/dsh-attachment-local`

```ts config-catalog
/** Local attachment backend configuration. */
export interface Config {
  /** Explicit harness home; omitted follows `DSH_HOME`, then `~/.dsh`. */
  dshHome?: string
  /** Maximum encoded bytes accepted for one image. */
  maxImageBytes?: number
  /** Maximum image count accepted in one submitted message. */
  maxImagesPerMessage?: number
  /** Maximum aggregate encoded image bytes accepted in one submitted message. */
  maxMessageImageBytes?: number
  /** Maximum intrinsic width multiplied by height accepted for one image. */
  maxImagePixels?: number
}
```

来源：[`packages/attachment/attachment-local/src/index.ts:24`](../packages/attachment/attachment-local/src/index.ts)


## `@huiliyi37/dsh-bash-env`

```ts config-catalog
/** Plugin config (all optional — the built-in facts resolve without defaults). */
export interface Config {
  /** Tianshu Harness home directory exposed as `DSH_HOME`; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
}
```

来源：[`packages/bash/bash-env/src/index.ts:29`](../packages/bash/bash-env/src/index.ts)

## `@huiliyi37/dsh-bash-local`

需要：`subprocess`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Default working directory for commands (default: process.cwd()). */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-call timeout overrides. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow spills to a temp file. */
  maxOutputBytes?: number
  /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
  maxSpillBytes?: number
  /** Grace period for kill escalation and inherited pipes; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
}
```

来源：[`packages/bash/bash-local/src/index.ts:40`](../packages/bash/bash-local/src/index.ts)

## `@huiliyi37/dsh-bash-sandbox`

需要：`subprocess` · `sandbox` · `sandboxPolicy`

```ts config-catalog
/**
 * Plugin config: the local executor's knobs, verbatim. The sandbox policy —
 * the default mode and fallback `workspace-write` root — is NOT here: it lives
 * on `ctx.sandboxPolicy` (`@huiliyi37/dsh-sandbox-policy`), which resolves
 * each calling session's mode and cwd for every enforcing capability. The runner
 * choice is likewise the `ctx.sandbox` provider's config, not this executor's.
 */
export type Config = LocalConfig
```

依赖：[`LocalConfig`](#huiliyi37dsh-bash-local)

来源：[`packages/bash/bash-sandbox/src/index.ts:35`](../packages/bash/bash-sandbox/src/index.ts)

## `@huiliyi37/dsh-client-connection`

需要：`httpServer`

```ts config-catalog
/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by (the dsh CLI derives the machine's LAN IP literals itself). An entry
   * that is not a bare, canonical authority fails the plugin load.
   */
  trustedHosts?: string[]
}
```

来源：[`packages/client/connection/src/index.ts:32`](../packages/client/connection/src/index.ts)

## `@huiliyi37/dsh-client-hmr`

需要：`clientModuleHost` · `httpServer`

```ts config-catalog
/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Bundle stat-poll interval in milliseconds (default 500, the build-side watcher's polling default). */
  pollIntervalMs?: number
}
```

来源：[`packages/client/hmr/src/index.ts:29`](../packages/client/hmr/src/index.ts)

## `@huiliyi37/dsh-code-runtime-worker`

```ts config-catalog
/** Plugin config: every execution cap, changeable from `cordis.yml` (no hardcoded tunables). */
export interface Config {
  /**
   * Busy-time budget in milliseconds: the run fails with kind `'timeout'`
   * once the worker's MEASURED event-loop active time
   * (`worker.performance.eventLoopUtilization()`) exceeds this. Metering
   * measured busy time — not wall time, not host-side pending-call
   * bookkeeping — is what makes the budget both fair (a program awaiting a
   * slow tool accrues nothing) and ungameable (a hot loop accrues whether
   * or not a decoy dispatch is in flight).
   */
  computeMs?: number
  /**
   * Wall-clock ceiling in milliseconds; never pauses for anything. The
   * backstop for what busy-time cannot see (a program awaiting a promise
   * nobody will resolve). At most `2_147_483_647` (Node's maximum
   * `setTimeout` delay, about 24.9 days): a longer value is rejected at load
   * because `setTimeout` would clamp it to 1 ms.
   */
  maxWallMs?: number
  /**
   * Hard cap for serialized log-array, completion-value, and failure-message payloads;
   * fixed result-envelope syntax is excluded.
   */
  maxOutputBytes?: number
  /** The worker's max old-generation heap in MiB (`resourceLimits`); overflow kills the worker, surfacing as kind `'worker-exit'`. */
  maxOldGenerationSizeMb?: number
}
```

来源：[`packages/code-runtime/code-runtime-worker/src/index.ts:25`](../packages/code-runtime/code-runtime-worker/src/index.ts)

## `@huiliyi37/dsh-compact-basic`

需要：`llm` · `tokenMeter` · `sessions`

```ts config-catalog
/** Basic compaction configuration with an optional exact-target policy table. */
export interface BasicCompactConfig extends CompactPolicyConfig {
  /** Exact provider/model overrides; duplicate targets fail plugin load. */
  modelPolicies?: ModelCompactPolicyConfig[]
  /** Enable automatic step-boundary pressure and overflow-recovery listeners. Defaults to `true`. */
  auto?: boolean
}

/** Policy fields shared by the default policy and exact model overrides. */
export interface CompactPolicyConfig {
  /** Compact at this fraction of the model's context window. Defaults to `0.8`. */
  thresholdRatio?: number
  /** Recent context retained as a fraction of the model's window. Defaults to `0.16`. */
  retainRatio?: number
  /** Absolute recent-context budget; mutually exclusive with `retainRatio`. */
  retainTokens?: number
  /** Summary provider; set together with `summarizationModel`, or inherit the conversation target. */
  summarizationProvider?: string
  /** Summary model; set together with `summarizationProvider`, or inherit the conversation target. */
  summarizationModel?: string
  /** Provider generation cap for summarization. Defaults to `8192`. */
  maxTokens?: number
  /** Extra attempts after the first compaction when pressure remains above threshold. Defaults to `1`. */
  compactionRetries?: number
  /** Maximum retries after canonical context overflow; `0` disables recovery. Defaults to `1`. */
  maxOverflowRetries?: number
}

/** Exact provider/model override merged over the default compaction policy. */
export interface ModelCompactPolicyConfig extends CompactPolicyConfig {
  /** Registered provider route to match. */
  provider: string
  /** Exact routed model id to match within `provider`. */
  model: string
}
```

来源：[`packages/compact/compact-basic/src/types.ts:38`](../packages/compact/compact-basic/src/types.ts)

## `@huiliyi37/dsh-compact-tool-result-prune`

需要：`tokenMeter`

```ts config-catalog
/** Character-budget policy for deterministic tool-result pruning. */
export interface ToolResultPruneConfig {
  /** Prune when total text exceeds this many Unicode code points. Defaults to `8192`. */
  thresholdChars?: number
  /** Maximum leading Unicode code points retained. Defaults to `4096`. */
  headChars?: number
  /** Maximum trailing Unicode code points retained. Defaults to `1024`. */
  tailChars?: number
}
```

来源：[`packages/compact/compact-tool-result-prune/src/types.ts:4`](../packages/compact/compact-tool-result-prune/src/types.ts)

## `@huiliyi37/dsh-cordis-host-runner`

需要：`tools`

```ts config-catalog
/** Runner configuration. */
export interface Config {
  /** Maximum synchronous VM evaluation time in milliseconds. */
  vmTimeoutMs?: number
}
```

来源：[`packages/self-modification/cordis-host-runner/src/index.ts:88`](../packages/self-modification/cordis-host-runner/src/index.ts)


## `@huiliyi37/dsh-credentials-local`

```ts config-catalog
/** Plugin config: file location and hot-reload behavior. */
export interface Config {
  /** Credentials document path; defaults to `.credentials.yaml` under the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Watch the document and hot-publish external edits; defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; defaults to 100. */
  debounceMs?: number
}
```

来源：[`packages/credentials/credentials-local/src/index.ts:54`](../packages/credentials/credentials-local/src/index.ts)

## `@huiliyi37/dsh-e2b`

```ts config-catalog
/** Configuration for the shared E2B sandbox owner. */
export interface Config {
  /** API key; omission reads `E2B_API_KEY`. It is never forwarded into the sandbox. */
  apiKey?: string
  /** Shared remote working directory, created before adapters receive the sandbox. */
  cwd?: string
  /** E2B sandbox lifetime in milliseconds; expiry always deletes the sandbox. */
  timeoutMs?: number
}
```

来源：[`packages/e2b/e2b/src/index.ts:43`](../packages/e2b/e2b/src/index.ts)

## `@huiliyi37/dsh-evidence-gate`

```ts config-catalog
/** 插件配置。 */
export interface EvidenceGateConfig {
  /** 是否启用证据门编辑拦截（默认 true；false 时仅跟踪归账）。 */
  enabled?: boolean
  /** TDD 门模式：suggest（默认，提示不拦）| enforce（硬拦截）。 */
  tddMode?: TddMode
  /** TDD 门编辑阈值（默认 3）。 */
  tddThreshold?: number
}

/** 模式：suggest（默认，提示不拦）| enforce（硬拦截）。 */
export type TddMode = 'suggest' | 'enforce'
```

来源：[`packages/guard/evidence-gate/src/index.ts:94`](../packages/guard/evidence-gate/src/index.ts)

## `@huiliyi37/dsh-frontend-static`

需要：`httpServer`

```ts config-catalog
/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}
```

来源：[`packages/host/frontend-static/src/index.ts:28`](../packages/host/frontend-static/src/index.ts)

## `@huiliyi37/dsh-fs-local`

```ts config-catalog
/** Configuration for the local filesystem backend. */
export interface Config {
  /** Base directory for relative paths. Defaults to `process.cwd()`. */
  cwd?: string
}
```

来源：[`packages/fs/fs-local/src/index.ts:39`](../packages/fs/fs-local/src/index.ts)

## `@huiliyi37/dsh-fs-sandbox`

需要：`sandboxPolicy`

```ts config-catalog
/**
 * Plugin config: the local backend's knobs, verbatim (only `cwd`, the resolve
 * base for relative paths). The sandbox default (mode + `workspace-write`
 * fallback root) is NOT here — `ctx.sandboxPolicy` resolves each calling
 * session for every enforcing capability.
 */
export type Config = LocalConfig
```

依赖：[`LocalConfig`](#huiliyi37dsh-fs-local)

来源：[`packages/fs/fs-sandbox/src/index.ts:49`](../packages/fs/fs-sandbox/src/index.ts)

## `@huiliyi37/dsh-git`

```ts config-catalog
/** GitLocal provider 配置。 */
export interface GitLocalConfig {
  /** git 可执行文件（默认 `git`；测试可注入）。 */
  gitBin?: string
}
```

来源：[`packages/git/git/src/index.ts:120`](../packages/git/git/src/index.ts)

## `@huiliyi37/dsh-goal`

需要：`agents`

```ts config-catalog
/** Deployment defaults for goal creation. */
export interface Config {
  /** Total rounds used when a create request omits its own cap. */
  defaultMaxGoalRounds?: number
}
```

来源：[`packages/goal/goal/src/index.ts:116`](../packages/goal/goal/src/index.ts)

## `@huiliyi37/dsh-headless`

需要：`agentDefaultModel` · `agents` · `sessions`

```ts config-catalog
/** Plugin config: the task, patched in by the launcher. */
export interface Config {
  /** The prompt text for the single run. */
  task: string
}
```

来源：[`packages/bundle/headless/src/index.ts:29`](../packages/bundle/headless/src/index.ts)

## `@huiliyi37/dsh-hooks-claude`

需要：`bash`

```ts config-catalog
/** Plugin config: where the CC hook config lives + substitution roots. */
export interface Config {
  /**
   * Path to a `hooks.json` or a settings file whose `hooks` key holds the config.
   * Process-level: read once at load, a relative path resolves against the process
   * launch cwd, so one config applies to the whole process.
   * TODO(per-session-hook-config): per-session discovery of a project-local
   * `hooks.json` from each `session/new.cwd` is not yet implemented.
   */
  configPath: string
  /**
   * Replaces `${CLAUDE_PLUGIN_ROOT}` in command strings (the plugin's root dir).
   */
  pluginRoot?: string
  /**
   * Replaces `${CLAUDE_PROJECT_DIR}` in command strings AND is exported as the
   * `CLAUDE_PROJECT_DIR` env var for hook processes. When omitted, the env var
   * defaults per-run to the agent's session workspace (`session.header.cwd`, the
   * same dir the hook runs in) — Claude Code always exports this var, and common
   * unmodified hooks reference `$CLAUDE_PROJECT_DIR` for project-relative paths.
   */
  projectDir?: string
  /** Default per-hook timeout in ms when a hook sets none (CC default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
}
```

来源：[`packages/hooks/hooks-claude/src/index.ts:48`](../packages/hooks/hooks-claude/src/index.ts)

## `@huiliyi37/dsh-hooks-codex`

需要：`bash`

```ts config-catalog
/** Plugin config: where the Codex hooks.json lives + the model name for payloads. */
export interface Config {
  /**
   * Path to a Codex `hooks.json`. Process-level: read once at load, a relative
   * path resolves against the process launch cwd.
   * TODO(per-session-hook-config): per-session project-local discovery from each
   * `session/new.cwd` is not yet implemented.
   */
  configPath: string
  /** The model name stamped on every payload (Codex includes `model` on each event). */
  model?: string
  /** Default per-hook timeout in ms when a hook sets none (Codex default: 600000). */
  defaultTimeoutMs?: number
  /** Character cap for the `hook/result` event's persisted stderr summary. */
  stderrSummaryMaxChars?: number
}
```

来源：[`packages/hooks/hooks-codex/src/index.ts:44`](../packages/hooks/hooks-codex/src/index.ts)

## `@huiliyi37/dsh-host-apiproxy`

需要：`agentDefaultModel` · `agents` · `directoryPicker` · `llm` · `sessions` · `subagents` · `sessionQuery` · `tools` · `userInteraction` · `workspace`

```ts config-catalog
/** Gateway plugin config: the Host-only Workspace creation root. */
export interface Config {
  /** Parent directory for name-created Workspaces; defaults to the Host cwd. */
  workspaceRoot?: string
}
```

来源：[`packages/host/apiproxy/src/index.ts:38`](../packages/host/apiproxy/src/index.ts)

## `@huiliyi37/dsh-host-directory-picker-browse`

```ts config-catalog
/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level; see {@link BrowseDirectoryPicker.Config}. */
  maxEntries: number
}
```

来源：[`packages/host/directory-picker-browse/src/index.ts:181`](../packages/host/directory-picker-browse/src/index.ts)

## `@huiliyi37/dsh-host-webserver`

```ts config-catalog
/** Gateway config: the listen address. */
export interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
}
```

来源：[`packages/host/webserver/src/index.ts:47`](../packages/host/webserver/src/index.ts)

## `@huiliyi37/dsh-invariants`

```ts config-catalog
/** Runtime invariant selection configured on the service plugin. */
export interface Config {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean
  /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
  readonly package_allowlist?: string[]
  /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
  readonly package_blocklist?: string[]
}
```

来源：[`packages/support/invariants/src/index.ts:15`](../packages/support/invariants/src/index.ts)

## `@huiliyi37/dsh-jsonrpc`

需要：`agents`

```ts config-catalog
/** JSON-RPC deployment config plus runtime-only test hooks. */
export interface JsonRpcConfig {
  /** Report max-token turn/subagent termination as a successful SDK result. */
  maxTokensAsSuccess?: boolean
  /** Transport input override; production uses `process.stdin`. */
  input?: Readable
  /** Transport output override; production uses `process.stdout`. */
  output?: Writable
  /** Process-exit override; production uses `process.exit`. */
  exit?: (code: number) => void
}
```

依赖：`Readable`（`node:stream`）· `Writable`（`node:stream`）

来源：[`packages/scaffold/server/src/index.ts:29`](../packages/scaffold/server/src/index.ts)

## `@huiliyi37/dsh-llm-deepseek`

需要：`llm`

```ts config-catalog
/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-deepseek` settings-section shape. Every field is optional in
 * yml: a missing API key resolves through {@link Config.apiKeyEnv} at each
 * request (a request without any key fails with `MISSING_CREDENTIAL`, not at
 * plugin load), omitted thinking mode uses the provider default, and omitted
 * reasoning effort resolves to `high`.
 */
export interface Config {
  /** Credential reference (environment-variable name) resolved per request; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; falls back to $DEEPSEEK_BASE_URL from a trusted environment layer, then the public API. */
  baseURL?: string
  /** Deployment thinking policy; `disabled` limits every conversation request to `off`. */
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort (default `high`); `off` disables thinking per request. */
  reasoningEffort?: 'off' | 'high' | 'max'
  /** Default per-request output cap (default 256,000); a model's own cap and explicit request values win. */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
  defaultContextWindow?: number
  /** Advisory models shown by discovery consumers; defaults to V4 Flash and V4 Pro. */
  models?: DeepSeekCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
  /**
   * spark 推理尾部截断（内部能力，公开前决策去留）。enabled 时仅
   * {@link SPARK_PROVIDER} route 生效；truncateN 按模型档取 N（flash 300 /
   * pro 0 = 需显式开启）。缺省 = 不启用，非 spark 路径 wire 字节不变。
   */
  spark?: SparkRequestPolicy
}

/** One optional model entry advertised by the direct-fetch adapter. */
export interface DeepSeekCatalogModel {
  /** Wire model id accepted by the configured endpoint. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector detail for deployments with similar model variants. */
  description?: string
  /** Known combined request/response context capacity; omitted when deployment metadata is unavailable. */
  contextWindow?: number
  /** Per-request output cap for this model; omission falls back to the profile's {@link DeepSeekConnectionOptions.maxTokens}. */
  maxTokens?: number
  /** Adapter-declared image-input capability; absent = text-only. */
  supportsVision?: boolean
}

/** spark 请求策略：enabled 开启后仅 SPARK_PROVIDER route 生效。 */
export interface SparkRequestPolicy {
  /** 总开关；false（缺省）时任何 route 都不截断。 */
  enabled: boolean
  /** 按模型档的截断 N（flash 300 / pro 0）。 */
  truncateN: SparkTruncatePolicy
}

/** spark 截断档位：按模型档取 N（flash 300 / pro 0 = 需显式开启）。 */
export interface SparkTruncatePolicy {
  /** flash 档保留的尾部 token 数（默认 300）。 */
  flash: number
  /** pro 档保留的尾部 token 数（默认 0 = 不截断，需显式开启）。 */
  pro: number
}
```

依赖：[`RetryPolicyConfig`](../packages/llm/llm/src/index.ts)

来源：[`packages/llm/llm-deepseek/src/index.ts:61`](../packages/llm/llm-deepseek/src/index.ts)

## `@huiliyi37/dsh-llm-pi-ai`

需要：`llm`

```ts config-catalog
/** Plugin configuration: the provider routes this instance owns. */
export interface Config {
  /**
   * pi-ai provider routes, keyed by provider. An empty (or omitted) dict is
   * the dormant settings-driven posture: the adapter mounts with no routes
   * and registers them the moment a settings section supplies profiles.
   */
  providers?: Record<string, PiAiProviderProfile>
}

/** Configuration for one pi-ai provider route; the `providers` dict key IS the route. */
export interface PiAiProviderProfile {
  /** Credential reference (environment-variable name) resolved per request through `ctx.credentials`. */
  apiKeyEnv?: string
  /** Name shown by configuration surfaces; defaults to the route key. */
  displayName?: string
  /**
   * Wire protocol every model on this route speaks. Omission keeps each
   * installed catalog model's own protocol, which is why a catalog route needs
   * no protocol at all; a route the catalog does not ship must name one.
   */
  api?: string
  /** Endpoint for this route's models; defaults to the installed catalog's endpoint. */
  baseURL?: string
  /**
   * This route's model catalog. Omission serves the installed catalog for the
   * route unchanged; an explicit list replaces it, each entry defaulting its
   * unset fields from the installed model of the same id.
   */
  models?: PiAiModelProfile[]
  /**
   * Installed-catalog customizations by model id: each entry reshapes that
   * one model with the same fields a {@link models} entry takes, while the
   * rest of the catalog keeps serving untouched. Only meaningful on a catalog
   * route with no `models` list — `models` already replaces the catalog, so
   * an override beside it, on a route the catalog does not ship, or naming a
   * model the catalog does not describe is refused rather than skipped.
   */
  modelOverrides?: Record<string, PiAiModelOverride>
  /**
   * Reasoning-dispatch switches for every `openai-completions` model on this
   * route; each model's own `compat` overrides per field. What neither sets
   * keeps the installed catalog entry's value, then pi-ai's baseURL-derived
   * detection.
   */
  compat?: PiAiCompatProfile
  /**
   * Context capacity for a model this route lists that neither the entry nor
   * the installed catalog sizes (default 262,144). A guess by construction, so
   * a deployment whose gateway serves smaller models corrects it here.
   */
  defaultContextWindow?: number
  /**
   * Output capability for a model this route lists that neither the entry nor
   * the installed catalog sizes (default 32,768). This sizes the model; it
   * never becomes a per-request cap on its own.
   */
  defaultMaxTokens?: number
  /** Provider request headers; Harness attribution wins reserved names. */
  headers?: Record<string, string>
  /** Provider-neutral pi-ai reasoning level. */
  reasoning?: ModelThinkingLevel
  /** Token budgets used by reasoning providers that support them. */
  thinkingBudgets?: ThinkingBudgets
  /** Prompt-cache retention preference. */
  cacheRetention?: CacheRetention
  /** Streaming transport preference. */
  transport?: Transport
  /** HTTP/provider SDK timeout in milliseconds. */
  timeoutMs?: number
  /** WebSocket connection timeout in milliseconds. */
  websocketConnectTimeoutMs?: number
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

/** One configured model entry: an id plus the catalog fields it overrides. */
export interface PiAiModelProfile {
  /** Model id sent to the provider and accepted by {@link GenerateOptions.model}. */
  id: string
  /** Display name for selectors; defaults to the catalog name, then the id. */
  name?: string
  /** Maximum combined request and response context in tokens. */
  contextWindow?: number
  /**
   * Maximum output tokens. Configuring one also makes it this model's
   * per-request default; a value inherited from the installed catalog, or the
   * route's fallback, is the model's capability and never becomes a request
   * default on its own.
   */
  maxTokens?: number
  /**
   * Selectable reasoning efforts. Absent inherits the installed catalog
   * entry's capability (a hand-declared model has none and does not reason);
   * `false` declares a non-reasoning model, which is how a profile strips
   * reasoning from a catalog model its gateway cannot serve; a non-empty dict
   * declares the offered levels and their wire spellings.
   */
  reasoningEfforts?: false | PiAiReasoningEfforts
  /** Reasoning-dispatch switches for this model, winning over the route's. */
  compat?: PiAiCompatProfile
}

/**
 * Customization of one installed catalog model, keyed by its id in the
 * route's `modelOverrides` dict — the same fields a `models` entry may set,
 * with the id living in the key. Unlike a `models` list, overrides leave the
 * rest of the catalog serving untouched, which is what makes "correct one
 * model, keep the other thirty-seven" a three-line edit.
 */
export type PiAiModelOverride = Omit<PiAiModelProfile, 'id'>

/**
 * Reasoning-dispatch compatibility switches, set on the route (its models'
 * default) or per model (winning over the route). Only the switches pi-ai's
 * reasoning dispatch reads are offered; the rest of pi-ai's compat surface
 * keeps its baseURL-derived auto-detection. pi-ai types both fields only on
 * `OpenAICompletionsCompat` — the other wire protocols carry their reasoning
 * shape in the protocol itself — so resolution rejects a model-level switch
 * anywhere else, while a route-level default skips past models it cannot fit.
 */
export interface PiAiCompatProfile {
  /** Reasoning parameter shape the endpoint expects; absent keeps the catalog entry's, then pi-ai's baseURL-derived guess. */
  thinkingFormat?: PiAiThinkingFormat
  /** Whether the endpoint accepts `reasoning_effort`; absent keeps the catalog entry's, then pi-ai's baseURL-derived guess. */
  supportsReasoningEffort?: boolean
}

/**
 * Selectable reasoning efforts for one model: each key is a level the model
 * offers (and selectors show), and its value is the wire spelling dispatch
 * sends for it. `off` alone may leave its value empty — "supported, send
 * nothing" — because for most providers not thinking is the parameter's
 * absence; every other declared level must name a wire value. A level absent
 * from the dict is not offered.
 */
export type PiAiReasoningEfforts = Partial<Record<ModelThinkingLevel, string | null>>

/** One reasoning-dispatch wire format a profile may name. */
export type PiAiThinkingFormat = Exclude<PiThinkingFormat, WithheldThinkingFormat>

/** The `compat.thinkingFormat` spellings pi-ai accepts on an `openai-completions` model. */
type PiThinkingFormat = NonNullable<OpenAICompletionsCompat['thinkingFormat']>

/**
 * pi-ai thinking formats a profile cannot name: both drive the request through
 * `chatTemplateKwargs`, which this configuration does not expose, so offering
 * them would hand back a format with nothing to say.
 */
type WithheldThinkingFormat = 'chat-template' | 'qwen-chat-template'
```

依赖：`CacheRetention`（`@earendil-works/pi-ai`）· `ModelThinkingLevel`（`@earendil-works/pi-ai`）· `OpenAICompletionsCompat`（`@earendil-works/pi-ai`）· [`RetryPolicyConfig`](../packages/llm/llm/src/index.ts) · `ThinkingBudgets`（`@earendil-works/pi-ai`）· `Transport`（`@earendil-works/pi-ai`）

来源：[`packages/llm/llm-pi-ai/src/config.ts:142`](../packages/llm/llm-pi-ai/src/config.ts)

## `@huiliyi37/dsh-llm-replay`

需要：`llm`

```ts config-catalog
/** Plugin config: the {@link ReplayConfig} inputs, each defaulting to its `DSH_SNAPSHOT_*` env var in `apply`. */
export interface Config {
  /** Override the fixture path; defaults to `$DSH_SNAPSHOT_FILE`. */
  file?: string
  /** Override the sidecar path; defaults to `$DSH_SNAPSHOT_OVERRIDE`. */
  overrideFile?: string
  /**
   * Override the child-log paths; defaults to `$DSH_SNAPSHOT_CHILD_FILES` (a
   * path-separator-delimited list). Each is a recorded subagent session log for
   * a nested-agent scenario; absent/empty for a single-session scenario.
   */
  childFiles?: string[]
  /** Optional replay-only provider catalog; absent or empty selects catch-all waterfall replay. */
  providers?: ReplayProviderConfig[]
  /** Optional per-chunk pacing delay in ms (see {@link ReplayConfig.paceMs}); absent keeps burst yield. */
  paceMs?: number
}

/** One provider route exposed by the replay adapter. */
export interface ReplayProviderConfig {
  /** Provider route used for replay requests. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Advisory models exposed to replay scenarios that exercise discovery. */
  models?: ReplayModelConfig[]
  /** Optional provider-owned retry policy used by assembled recovery snapshots. */
  retryPolicy?: RetryPolicyConfig
}

/** One model exposed by a replay-only provider catalog. */
export interface ReplayModelConfig {
  /** Model id used for replay requests. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector description. */
  description?: string
  /** Optional positive integer context capacity published by the replay adapter. */
  contextWindow?: number
}
```

依赖：[`RetryPolicyConfig`](../packages/llm/llm/src/index.ts)

来源：[`packages/support/llm-replay/src/index.ts:744`](../packages/support/llm-replay/src/index.ts)

## `@huiliyi37/dsh-llm-retry`

需要：`agents`

```ts config-catalog
/** This policy executor has no config; providers own `retryPolicy`. */
export type Config = Readonly<Record<string, never>>
```

来源：[`packages/llm/llm-retry/src/index.ts:46`](../packages/llm/llm-retry/src/index.ts)

## `@huiliyi37/dsh-lsp-local`

需要：`fs` · `lsp` · `subprocess`

```ts config-catalog
/** Plugin configuration: provider id → local language-server configuration. */
export interface Config {
  /** Non-empty table of stable provider ids to independent local server configurations. */
  servers: Record<string, LspLocalServerConfig>
}

/** One configured local language server and its host bounds. */
export interface LspLocalServerConfig {
  /** Executable to spawn (absolute, or resolved on PATH at load). */
  command: string
  /** Lowercase leading-dot extension → LSP language id (e.g. `{ '.ts': 'typescript' }`). */
  extensionToLanguage: Record<string, string>
  /** Arguments passed to the executable (no shell). Default `[]`. */
  args?: string[]
  /** Extra env vars merged on top of the scrubbed ambient env. Default `{}`. */
  env?: Record<string, string>
  /** Static `initialize` options forwarded to the server. Default `null`. */
  initializationOptions?: unknown
  /** Static answer to every `workspace/configuration` item. Default `null`. */
  configuration?: unknown
  /** Largest single framed message accepted from the server (bytes). Default 16000000. */
  maxMessageBytes?: number
  /** Largest stderr tail retained for diagnostics (bytes). Default 1000000. */
  maxStderrBytes?: number
  /** Largest source file this host will open (bytes). Default 4000000. */
  maxDocumentBytes?: number
  /** Graceful `shutdown`/`exit` budget before escalation (ms). Default 5000. */
  shutdownTimeoutMs?: number
  /** Request-cancel and SIGTERM→SIGKILL grace (ms). Default 2000. */
  killGraceMs?: number
}
```

来源：[`packages/lsp/lsp-local/src/index.ts:82`](../packages/lsp/lsp-local/src/index.ts)

## `@huiliyi37/dsh-mcp-client`

需要：`tools`

```ts config-catalog
/** Configuration for one stdio or Streamable HTTP MCP server. */
export type Config = StdioConfig | StreamableHttpConfig

/** Config for connecting to an MCP server via a spawned child process over stdio. */
export interface StdioConfig {
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
}

/** Config for connecting to an MCP server over Streamable HTTP (SSE). */
export interface StreamableHttpConfig {
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
}
```

来源：[`packages/mcp/mcp-client/src/index.ts:100`](../packages/mcp/mcp-client/src/index.ts)

## `@huiliyi37/dsh-permission`

需要：`bash` · `approval` · `sessions`

```ts config-catalog
/** The {@link PermissionService} config: preset table and composition default. */
export interface Config {
  /**
   * The preset table: name → knob bundle. Defaults to `workspace-write`
   * (workspace-write + ask) and `danger-full-access` (danger-full-access +
   * never). The name `custom` is reserved for the derived not-a-preset state.
   */
  presets?: Record<string, PresetSpec>
  /**
   * Default for new sessions. When omitted, the preset matching the composed
   * sandbox and approval defaults is used.
   */
  defaultPreset?: string
}

/** One preset's sandbox/approval bundle and optional client presentation. */
export interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: ApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string
  /** One user-facing sentence on what the preset means; omitted when not configured. */
  description?: string
}
```

依赖：[`ApprovalPolicy`](subsystems/approval.md) · [`SandboxMode`](subsystems/sandbox.md)

来源：[`packages/interaction/permission/src/index.ts:140`](../packages/interaction/permission/src/index.ts)

## `@huiliyi37/dsh-persona`

需要：`systemPrompt`

```ts config-catalog
/** Plugin config: the persona text this composition contributes. */
export interface Config {
  /**
   * Persona prose rendered as the `deployment:persona` section. A template:
   * complete `{{…}}` groups interpolate strictly against registered prompt
   * variables. Empty text drops the section at render, matching the registry.
   */
  text: string
  /** Make this persona the complete system prompt, suppressing every other section. */
  complete?: boolean
  /** Suppress dynamic runtime-context snapshots for this persona's agent scope. */
  includeRuntimeContext?: boolean
}
```

来源：[`packages/preset/persona/src/index.ts:34`](../packages/preset/persona/src/index.ts)


## `@huiliyi37/dsh-plan-mode`

需要：`tools` · `systemPrompt`

```ts config-catalog
/** Deployment-owned plan guidance. */
export interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
  /**
   * Extra tool names the plan-mode guard denies on top of the built-in
   * mutation families (fs writes, git commits, persistent-terminal control).
   * Shell exploration (bash/pwsh) is intentionally not blocked by default —
   * list them here for a stricter deployment.
   */
  blockedTools?: readonly string[]
}
```

来源：[`packages/plan/plan-mode/src/index.ts:89`](../packages/plan/plan-mode/src/index.ts)

## `@huiliyi37/dsh-pty-local`

需要：`pty` · `sandboxPolicy` · `subprocess`

```ts config-catalog
/** Public plugin configuration. */
export interface Config {
  /** Backend registry type (default: `shell`). */
  backendType?: string
  /** Interactive shell executable (default: `/bin/bash`). */
  shellPath?: string
  /** Shell arguments (default: `--noprofile --norc -i`). */
  shellArgs?: string[]
  /** Terminal rows. */
  rows?: number
  /** Terminal columns. */
  cols?: number
  /** Maximum retained logical lines. */
  scrollbackLines?: number
  /** Maximum retained UTF-8 bytes. */
  scrollbackMaxBytes?: number
  /** Maximum bytes returned by one read or settled viewport. */
  maxReadBytes?: number
  /** Readiness polling interval. */
  pollIntervalMs?: number
  /** Delay before Linux exact syscall probes. */
  exactProbeAfterMs?: number
  /** Silence duration that yields `inferred_idle`. */
  idleSilenceMs?: number
  /**
   * Extra wait beyond `idleSilenceMs`, once a prompt marker was seen, for the shell to
   * regain the foreground before `inferred_idle` settles; at least one `pollIntervalMs`.
   */
  handoffGraceMs?: number
  /** Absolute send wait bound. */
  timeoutMs?: number
  /** Grace before teardown escalates to `SIGKILL`. */
  disposeGraceMs?: number
}
```

来源：[`packages/pty/pty-local/src/config.ts:6`](../packages/pty/pty-local/src/config.ts)

## `@huiliyi37/dsh-pwsh-local`

需要：`subprocess`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** Default working directory for commands (default: process.cwd()). */
  cwd?: string
  /** Default foreground timeout in milliseconds. */
  timeoutMs?: number
  /** Upper bound for per-call timeout overrides. */
  maxTimeoutMs?: number
  /** Per-stream in-memory output cap; overflow spills to a temp file. */
  maxOutputBytes?: number
  /** Per-stream spill-file cap; larger streams retain only their in-memory tail. */
  maxSpillBytes?: number
  /** Grace period for kill escalation and inherited pipes; at most `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
  /**
   * Explicit pwsh executable. When omitted, well-known Windows install
   * locations and PATH entries are probed in order (PowerShell 7 install,
   * PATH entries such as the Microsoft Store install, then Windows
   * PowerShell 5.1), falling back to a bare `pwsh` resolved through PATH.
   */
  pwshPath?: string
}
```

来源：[`packages/bash/pwsh-local/src/index.ts:54`](../packages/bash/pwsh-local/src/index.ts)

## `@huiliyi37/dsh-pwsh-sandbox`

需要：`subprocess` · `sandbox` · `sandboxPolicy`

```ts config-catalog
/**
 * Plugin config: the local executor's knobs, verbatim. The sandbox policy —
 * the default mode and fallback `workspace-write` root — is NOT here: it lives
 * on `ctx.sandboxPolicy` (`@huiliyi37/dsh-sandbox-policy`), which resolves
 * each calling session's mode and cwd for every enforcing capability. The
 * runner choice is likewise the `ctx.sandbox` provider's config, not this
 * executor's.
 */
export type Config = LocalConfig
```

依赖：[`LocalConfig`](#huiliyi37dsh-pwsh-local)

来源：[`packages/bash/pwsh-sandbox/src/index.ts:40`](../packages/bash/pwsh-sandbox/src/index.ts)


## `@huiliyi37/dsh-repeat-tool-guard`

```ts config-catalog
/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud: an empty
 * `thresholds` list, a non-integer, a value below 2, or a duplicate throws at
 * plugin load, never a silent fall-back). `include`/`exclude` entries are
 * `*`-wildcard predicates over tool names at call time, not references to
 * registry entries — a pattern matching no currently registered tool is valid
 * (`exclude: [mcp_*]` must stay legal in a deployment that loads no MCP tools).
 */
export interface Config {
  /** Consecutive-repeat counts that trigger a reminder (default `[3, 5, 8]`). */
  thresholds?: number[]
  /** Tool-name patterns to track; empty means every tool is tracked. */
  include?: string[]
  /** Tool-name patterns transparent to the chain (neither count nor reset). */
  exclude?: string[]
  /**
   * Maximum characters of canonical arguments quoted in the DETAILED reminder
   * (default 500). Large payloads (a `write` body, a long command) would
   * otherwise ride into the next request unbounded — precisely in a loop
   * scenario; the cap bounds the reminder, never the detection (the chain key
   * always compares the FULL canonical string).
   */
  argumentsPreviewChars?: number
}
```

来源：[`packages/guard/repeat-tool-guard/src/index.ts:28`](../packages/guard/repeat-tool-guard/src/index.ts)

## `@huiliyi37/dsh-sandbox-local`

```ts config-catalog
/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * Override the runner argv; bwrap-shaped profile arguments are appended. A
   * non-empty override asserts full enforcement and skips built-in selection and
   * probing. A runner that starts but refuses its profile must be identifiable by
   * {@link runnerFailureSignatures}. Consumers classify a spawn rejection only after
   * confirming the workdir is usable. `ENOENT` or `EACCES` identifies the runner when
   * `error.path` equals argv[0] and `error.syscall` is `spawn` or `spawn <runner>`, or
   * when `error.path` is absent and `error.syscall` is exactly `spawn <runner>`.
   */
  runnerCommand?: string[]
  /**
   * Case-insensitive stderr substrings emitted when a configured
   * {@link runnerCommand} refuses its profile before executing the wrapped
   * command. Required and non-empty with `runnerCommand`; rejected without
   * it. Each entry is a non-empty, single-line, case-insensitive substring
   * covering the executable runner's own failure dialect.
   */
  runnerFailureSignatures?: string[]
  /** Positive timeout for each functional probe; zero would mean unbounded to Node. */
  probeTimeoutMs?: number
}
```

来源：[`packages/sandbox/sandbox-local/src/index.ts:24`](../packages/sandbox/sandbox-local/src/index.ts)

## `@huiliyi37/dsh-sandbox-policy`

```ts config-catalog
/**
 * Plugin config: the deployment's sandbox default. All optional — `Config`
 * supplies the defaults (`mode: 'read-only'` is the fail-safe default; a
 * deployment that wants a workspace-writable agent opts in explicitly). The
 * runner choice is NOT here (it is the `ctx.sandbox` provider's config), nor
 * is any per-family knob: this is the one shared policy home.
 */
export interface Config {
  /** File-sandbox mode a session starts from (default: `read-only`). */
  mode?: SandboxMode
  /**
   * Fallback root for agentless calls and sessions without a cwd (default:
   * `process.cwd()`). Normal agent calls use their session cwd instead.
   */
  workspaceRoot?: string
}
```

依赖：[`SandboxMode`](subsystems/sandbox.md)

来源：[`packages/sandbox/sandbox-policy/src/index.ts:67`](../packages/sandbox/sandbox-policy/src/index.ts)

## `@huiliyi37/dsh-session-persistence-jsonl`

需要：`sessions`

```ts config-catalog
/** Plugin config: where the JSONL backend keeps its session logs, and the packed-row write switch. */
export interface Config {
  /**
   * Root directory for all session files. Required (no default): a default of
   * `process.cwd()` would scatter session files as the process's cwd changes
   * (bash calls, subprocesses). Sessions group under human-readable project
   * directories, then per-session directories. An existing root must be a
   * readable directory; an absent root is created on first materialization.
   */
  root: string
  /**
   * Write runs of consecutive `assistant/chunk` delta events as packed
   * `text-chunks`/`reasoning-chunks`/`tool-call-chunks` rows (lossless,
   * ~60% smaller logs measured on a real session). Defaults to true; false
   * keeps one `SessionEvent` per line for diagnostics. Reading packed rows is
   * unconditional: a log's layout never depends on this switch.
   */
  packChunks?: boolean
  /** Physical encoding; defaults to checksummed Zstandard frames. */
  compression?: JsonlCompression
  /** Maximum cold Session preparations retained for history-to-resume reuse. */
  preparedSessionCacheSize?: number
  /** Fixed live-event coalescing window; not a backend completion deadline. */
  writeBatchMaxDelayMs?: number
}

/** Physical encoding selected for JSONL session artifacts. */
export type JsonlCompression = 'zstd' | 'none'
```

来源：[`packages/session/session-persistence-jsonl/src/index.ts:59`](../packages/session/session-persistence-jsonl/src/index.ts)

## `@huiliyi37/dsh-session-persistence-sqlite`

需要：`sessions`

```ts config-catalog
/** Plugin configuration. */
export interface Config {
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests). On filesystems with POSIX modes,
   * missing directories and databases are created owner-only; existing path
   * modes are preserved. Filesystem setup errors other than an existing database
   * fail initialization. The backend does not protect confidentiality or
   * integrity when another principal can replace the database entry in its
   * parent directory.
   */
  path: string
  /**
   * SQLite `journal_mode` pragma. `wal` (the default) is the recorded
   * durability model; pick a rollback-journal mode (`delete`/`truncate`/
   * `persist`) on filesystems where WAL's shared-memory files do not work
   * (network mounts). See {@link JournalMode}.
   */
  journalMode?: JournalMode
  /** Maximum cold Session preparations retained for history-to-resume reuse. */
  preparedSessionCacheSize?: number
  /** Fixed live-event coalescing window; not a backend completion deadline. */
  writeBatchMaxDelayMs?: number
}

/**
 * Journal modes the backend will run under. `wal` is the default and the
 * durability model the persistence ADR records; the rollback-journal modes
 * (`delete`/`truncate`/`persist`) exist for filesystems where WAL's
 * shared-memory files do not work (network mounts). `memory`/`off` are
 * excluded: dropping journal durability silently contradicts what this
 * backend promises.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'
```

来源：[`packages/session/session-persistence-sqlite/src/index.ts:67`](../packages/session/session-persistence-sqlite/src/index.ts)

## `@huiliyi37/dsh-session-projection-cache`

需要：`storageDomain` · `sessionProjections` · `sessionPersistence` · `sessions`

```ts config-catalog
/**
 * Plugin config. Both throttle triggers are deployment choices with no
 * universally correct value, so the composition states them explicitly
 * (cordis.yml); the two mandatory write points (`turn/end` and session
 * disposal) are policy, not tunables, and always fire.
 */
export interface Config {
  /** Committed events per session that force a durable checkpoint write between mandatory points. */
  writeEveryEvents: number
  /** Longest time (milliseconds) a dirty checkpoint may stay unwritten between mandatory points. */
  writeIntervalMs: number
}
```

来源：[`packages/session/session-projection-cache/src/index.ts:42`](../packages/session/session-projection-cache/src/index.ts)

## `@huiliyi37/dsh-session-query-sqlite`

需要：`sessions`

```ts config-catalog
/** Combined session-query configuration backed by SQLite full-text search. */
export interface Config extends SessionQueryConfig {
  /**
   * Dedicated derived-index path; `:memory:` is supported for ephemeral
   * indexes. Missing directories and database files are created owner-only on
   * POSIX filesystems; existing modes are preserved.
   */
  path: string
  /** Open the SQLite module and handle at service activation or the first search. Defaults to `startup`. */
  openAt?: OpenAt
  /** SQLite journal mode. Defaults to `wal`. */
  journalMode?: JournalMode
  /** Page size when a request omits `limit`. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 20. */
  defaultLimit?: number
  /** Largest accepted page size. At most `Number.MAX_SAFE_INTEGER - 1`; defaults to 100. */
  maxLimit?: number
  /** Maximum snippet length in Unicode code points. Defaults to 240. */
  snippetChars?: number
  /** Maximum concurrent persisted-log inspections in one inherited batch read. Defaults to 4. */
  persistedInspectConcurrency?: number
}

/** SQLite module/handle opening phase. */
export type OpenAt = 'startup' | 'first-search'

/** Supported SQLite journal modes. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'
```

依赖：[`SessionQueryConfig`](../packages/session-query/session-query/src/index.ts)

来源：[`packages/session-query/session-query-sqlite/src/index.ts:89`](../packages/session-query/session-query-sqlite/src/index.ts)

## `@huiliyi37/dsh-session-reference`

需要：`sessionQuery`

```ts config-catalog
/** Session-reference service configuration. */
export interface Config {
  /** Maximum distinct source sessions referenced by one message, from one to three. */
  maxReferences?: number
  /** Default host candidate-list limit. */
  candidateLimit?: number
  /** Maximum rendered UTF-8 bytes for one source snapshot. */
  maxReferenceBytes?: number
}
```

来源：[`packages/context/session-reference/src/config.ts:11`](../packages/context/session-reference/src/config.ts)

## `@huiliyi37/dsh-session-telemetry-otel`

需要：`sessions`

```ts config-catalog
/**
 * Plugin configuration: one sharing policy, two verbatim SDK option shapes,
 * and one DSH-owned shutdown bound. Uploading modes validate their endpoint
 * and shutdown deadline at plugin load; `DISABLED` reads neither.
 */
export interface Config {
  /** Sharing policy; defaults to immediate `FULL` delivery. */
  mode?: TelemetryMode
  /**
   * Passed verbatim to the SDK's OTLP/HTTP log exporter — the complete
   * `OTLPExporterNodeConfigBase` shape (`headers`, `timeoutMillis`,
   * `compression`, `keepAlive`, …), owned and documented by the SDK. `url`
   * is the one field this package requires and validates itself.
   */
  exporter?: OTLPExporterNodeConfigBase & {
    /** Full logs endpoint (e.g. `https://collector.example.com/v1/logs`). Required outside `DISABLED`; validated at load. */
    url?: string
  }
  /**
   * Passed verbatim to `BatchLogRecordProcessor` (minus the exporter slot,
   * which this plugin fills); the SDK owns and documents these knobs.
   */
  processor?: Omit<BatchLogRecordProcessorOptions, 'exporter'>
  /** Maximum time spent awaiting the SDK provider's complete shutdown path. */
  shutdownTimeoutMillis?: number
}

/** Session-sharing policy selected by {@link Config.mode}. */
export enum TelemetryMode {
  FULL = 'FULL',
  FEEDBACK_ONLY = 'FEEDBACK_ONLY',
  DISABLED = 'DISABLED',
}
```

依赖：`BatchLogRecordProcessorOptions`（`@opentelemetry/sdk-logs`）· `OTLPExporterNodeConfigBase`（`@opentelemetry/otlp-exporter-base`）

来源：[`packages/session/session-telemetry-otel/src/index.ts:80`](../packages/session/session-telemetry-otel/src/index.ts)

## `@huiliyi37/dsh-session-title`

需要：`sessions`

```ts config-catalog
/** Required deterministic fallback and accepted-title limits. */
export interface Config {
  /** Maximum whitespace-delimited words in the built-in fallback. */
  readonly fallbackMaxWords: number
  /** Maximum UTF-8 bytes in the built-in fallback. */
  readonly fallbackMaxBytes: number
  /** Maximum UTF-8 bytes in any accepted title. */
  readonly maxTitleBytes: number
}
```

来源：[`packages/session/session-title/src/index.ts:79`](../packages/session/session-title/src/index.ts)

## `@huiliyi37/dsh-session-title-all-messages-llm`

需要：`sessionTitle` · `llm` · `sessions`

```ts config-catalog
/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
```

依赖：[`SessionTitleLlmConfig`](../packages/session/session-title-llm/src/index.ts)

来源：[`packages/session/session-title-all-messages-llm/src/index.ts:15`](../packages/session/session-title-all-messages-llm/src/index.ts)

## `@huiliyi37/dsh-session-title-first-message-llm`

需要：`sessionTitle` · `llm` · `sessions`

```ts config-catalog
/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
```

依赖：[`SessionTitleLlmConfig`](../packages/session/session-title-llm/src/index.ts)

来源：[`packages/session/session-title-first-message-llm/src/index.ts:15`](../packages/session/session-title-first-message-llm/src/index.ts)

## `@huiliyi37/dsh-settings-local`

```ts config-catalog
/** Plugin config: file location and hot-reload behavior. */
export interface Config {
  /** Settings document path; defaults to `settings.yaml` under the harness home. */
  path?: string
  /** Harness home used when `path` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Watch the document and hot-publish external edits; defaults to true. */
  watch?: boolean
  /** Watcher write-settle window in milliseconds; defaults to 100. */
  debounceMs?: number
}
```

来源：[`packages/settings/settings-local/src/index.ts:21`](../packages/settings/settings-local/src/index.ts)

## `@huiliyi37/dsh-skill`

```ts config-catalog
/** Skill registry configuration. */
export interface Config {
  /** Maximum number of completed cwd/provider catalogs kept in memory. */
  readonly collectCacheMaxEntries?: number
}
```

来源：[`packages/skill/skill/src/index.ts:266`](../packages/skill/skill/src/index.ts)

## `@huiliyi37/dsh-skill-local`

需要：`skills`

```ts config-catalog
/** Local filesystem skill provider configuration. */
export interface Config {
  /** Unique provider name. Defaults to `local`. */
  providerName?: string
  /** Whether project and user roots are included around custom roots. */
  includeDefaultRoots?: boolean
  /** Tianshu Harness config root. Defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Shared agent config root. Defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
  /** Additional skill roots scanned after project roots and before user roots. */
  customSkillDirs?: string[]
  /** Whether host-local skill roots are watched for catalog changes. */
  watch?: boolean
  /** Whether Chokidar uses polling instead of native filesystem events. */
  watchUsePolling?: boolean
  /** Milliseconds a changed skill entry must remain stable before it is observed. */
  watchStabilityThresholdMs?: number
  /** Milliseconds between Chokidar stability or polling probes. */
  watchPollIntervalMs?: number
  /** Maximum distinct project roots whose skill directories remain watched. */
  watchMaxProjects?: number
  /** Whether watched symbolic links follow their target files. */
  watchFollowSymlinks?: boolean
  /** Bundled skill root; defaults to `$DSH_BUNDLED_SKILL_DIR` when default roots are included, otherwise mounts none. */
  bundledSkillDir?: string
}
```

来源：[`packages/skill/skill-local/src/index.ts:49`](../packages/skill/skill-local/src/index.ts)

## `@huiliyi37/dsh-spark-anchors`

需要：`agents`

```ts config-catalog
/** 锚点聚合上限与总开关。 */
export interface Config {
  /** 总开关；false 时不注册监听（缺省 true）。 */
  enabled?: boolean
  /** 去重后锚点条数上限；溢出淘汰最旧（缺省 20）。 */
  maxAnchors?: number
}
```

来源：[`packages/context/spark-anchors/src/index.ts:44`](../packages/context/spark-anchors/src/index.ts)

## `@huiliyi37/dsh-spill-local`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /**
   * Root directory for spill files. Omitted uses a lazily-created private
   * (0700) per-process directory under the OS temp dir — the safe default for
   * a local deployment. Set it to keep spill files under a known location.
   */
  root?: string
}
```

来源：[`packages/spill/spill-local/src/index.ts:22`](../packages/spill/spill-local/src/index.ts)

## `@huiliyi37/dsh-spill-policy`

需要：`tools`

```ts config-catalog
/** Plugin config. */
export interface Config {
  /**
   * The model-facing context cap for a plain-text tool result, in UTF-8 bytes.
   * Omitted disables the policy entirely (no-op). When set, a result larger than
   * this is spilled and replaced with a preview derived from this same budget.
   */
  maxInlineBytes?: number
}
```

来源：[`packages/spill/spill-policy/src/index.ts:60`](../packages/spill/spill-policy/src/index.ts)

## `@huiliyi37/dsh-storage-domain`

需要：`storage`

```ts config-catalog
/**
 * Plugin config. Which backend serves which domain is decided here, not
 * globally on the hub: `backend` is the default route and `routes` overrides
 * it per domain name. A route naming an unregistered backend fails loud at
 * `open` with `backend-not-found`.
 */
export interface Config {
  /** Default backend name for every domain without an explicit route. Required: there is no universally correct medium. */
  backend: string
  /** Per-domain overrides: domain name → backend name. */
  routes?: Record<string, string>
}
```

来源：[`packages/storage/storage-domain/src/index.ts:52`](../packages/storage/storage-domain/src/index.ts)

## `@huiliyi37/dsh-storage-json`

需要：`storage`

```ts config-catalog
/**
 * Plugin configuration.
 * `root` has NO default on purpose: a `process.cwd()` fallback would scatter
 * unit files wherever the process happens to start; assemblies state the
 * location explicitly.
 */
export interface Config {
  /** Directory holding one `<unit>.json` file per unit. */
  root: string
}
```

来源：[`packages/storage/storage-json/src/index.ts:27`](../packages/storage/storage-json/src/index.ts)

## `@huiliyi37/dsh-storage-sqlite`

需要：`storage`

```ts config-catalog
/** Plugin configuration. */
export interface Config {
  /**
   * Filesystem path to the SQLite database file. The special value `:memory:`
   * opens an in-process database (tests). On filesystems with POSIX modes,
   * missing directories and databases are created owner-only; existing path
   * modes are preserved. Filesystem setup errors other than an existing
   * database fail the open. The backend does not protect confidentiality or
   * integrity when another principal can replace the database entry in its
   * parent directory.
   */
  path: string
  /**
   * SQLite `journal_mode` pragma. `wal` (the default) suits local disks; pick
   * a rollback-journal mode (`delete`/`truncate`/`persist`) on filesystems
   * where WAL's shared-memory files do not work (network mounts). See
   * {@link JournalMode}.
   */
  journalMode?: JournalMode
}

/**
 * Journal modes the backend will run under. `wal` is the default; the
 * rollback-journal modes (`delete`/`truncate`/`persist`) exist for
 * filesystems where WAL's shared-memory files do not work (network mounts).
 * `memory`/`off` are excluded: dropping journal durability silently
 * contradicts the durability clause of the KV backend contract.
 */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'
```

来源：[`packages/storage/storage-sqlite/src/index.ts:24`](../packages/storage/storage-sqlite/src/index.ts)

## `@huiliyi37/dsh-subagent-acp`

需要：`subagents` · `subprocess`

```ts config-catalog
/** Config: how to spawn and drive the child ACP agent process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `acp`). */
  providerName: string
  /** The executable to spawn for each run (the child ACP agent). */
  command: string
  /** Arguments passed to {@link command}. */
  args: string[]
  /**
   * Working directory override for the child process and its ACP session.
   * Must be non-empty; a relative path resolves against the harness launch
   * directory at load, and the result must be an existing directory. When
   * omitted, each child inherits its delegating parent session's cwd — and
   * starting one from a parent session that has no cwd fails.
   */
  cwd?: string
  /**
   * How to auto-answer the child's `session/request_permission` prompts:
   * `reject` (default — decline every prompt) or `allow` (approve via the first
   * allow-shaped option). The first cut surfaces no prompt to a human.
   */
  permission: PermissionPolicy
  /**
   * Extra environment variables for the child process — e.g. the child
   * harness's own `DEEPSEEK_API_KEY`. Forwarded on top of a credential-scrubbed
   * copy of the parent env, so an explicit key here reaches the child while
   * ambient secrets do not leak implicitly.
   */
  env: Record<string, string>
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal. Must not exceed
   * `MAX_TIMER_DELAY_MS`.
   */
  disposeEofGraceMs?: number
  /** Termination-escalation grace (ms); must not exceed `MAX_TIMER_DELAY_MS`. */
  disposeGraceMs?: number
}

/** Fixed response to child permission requests: reject by default, or select the first allow option. */
export type PermissionPolicy = 'allow' | 'reject'
```

来源：[`packages/subagent/subagent-acp/src/index.ts:27`](../packages/subagent/subagent-acp/src/index.ts)

## `@huiliyi37/dsh-subagent-claude-code`

需要：`subagents` · `subprocess`

```ts config-catalog
/** Deployment-owned environment and process-release bound. */
export interface Config {
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /** Grace in milliseconds for Claude Code process-tree termination. */
  disposeGraceMs?: number
}
```

来源：[`packages/subagent/subagent-claude-code/src/index.ts:32`](../packages/subagent/subagent-claude-code/src/index.ts)

## `@huiliyi37/dsh-subagent-codex`

需要：`subagents` · `subprocess`

```ts config-catalog
/** Deployment-owned environment and process-release bound. */
export interface Config {
  /**
   * Explicit environment entries layered over the subprocess seam's
   * credential-scrubbed parent environment.
   */
  env?: Record<string, string>
  /** Grace in milliseconds for app-server process-tree termination. */
  disposeGraceMs?: number
}
```

来源：[`packages/subagent/subagent-codex/src/index.ts:30`](../packages/subagent/subagent-codex/src/index.ts)

## `@huiliyi37/dsh-subagent-dsh-sdk`

需要：`subagents`

```ts config-catalog
/** Config: how to spawn and drive the child SDK runtime process. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `dsh-sdk`). */
  providerName: string
  /** The executable to spawn for each run (the child runtime bin or packaged exe). */
  command: string
  /** Arguments passed to {@link command} (typically the child's `cordis.yml` path). */
  args: string[]
  /**
   * Working directory override for the child process and its SDK session
   * workspace. Must be non-empty; a relative path resolves against the
   * harness launch directory at load, and the result must be an existing
   * directory. When omitted, each child inherits its delegating parent
   * session's cwd — and starting one from a parent session that has no cwd
   * fails.
   */
  cwd?: string
  /** Provider route the child runtime initializes with (default `deepseek-official`). */
  provider: string
  /** Model the child runtime initializes with (default `deepseek-v4-flash`). */
  model: string
  /** Optional per-request output-token cap for the child runtime. */
  maxTokens?: number
  /**
   * Extra environment variables for the child process — e.g. the child
   * runtime's own `DEEPSEEK_API_KEY`, or `DSH_CORDIS_CONFIG` naming its
   * config. Forwarded on top of a credential-scrubbed copy of the parent
   * env, so an explicit key here reaches the child while ambient secrets do
   * not leak implicitly.
   */
  env: Record<string, string>
  /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
  shutdownTimeoutMs?: number
  /**
   * Grace period (ms) for the child's EOF-driven quiesce on dispose — its
   * window to flush persistence and tear down its own nested subprocesses
   * before the parent escalates to a signal.
   */
  disposeEofGraceMs?: number
  /** Termination confirmation window (ms), including forced exit on every platform. */
  disposeGraceMs?: number
}
```

来源：[`packages/subagent/subagent-dsh-sdk/src/index.ts:29`](../packages/subagent/subagent-dsh-sdk/src/index.ts)

## `@huiliyi37/dsh-subagent-fork`

需要：`subagents`

```ts config-catalog
/** Config: the registry name to register the provider under. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `fork`). */
  providerName: string
}
```

来源：[`packages/subagent/subagent-fork/src/index.ts:31`](../packages/subagent/subagent-fork/src/index.ts)

## `@huiliyi37/dsh-subagent-spawn`

需要：`subagents`

```ts config-catalog
/** Config: the registry name to register the provider under. */
export interface Config {
  /** Provider name on `ctx.subagents` (default `spawn`). */
  providerName: string
}
```

来源：[`packages/subagent/subagent-spawn/src/index.ts:25`](../packages/subagent/subagent-spawn/src/index.ts)

## `@huiliyi37/dsh-subprocess-e2b`

需要：`e2b`

```ts config-catalog
/** Configuration for the E2B subprocess adapter. */
export interface Config {
  /** Remote status/liveness poll cadence in milliseconds; each tick is one control-plane request. */
  pollMs?: number
}
```

来源：[`packages/e2b/subprocess-e2b/src/index.ts:25`](../packages/e2b/subprocess-e2b/src/index.ts)

## `@huiliyi37/dsh-system-prompt`

```ts config-catalog
/** Plugin config: the deployment-authored fragment of the system prompt (see {@link Config.persona} for its contract). */
export interface Config {
  /** Include the fixed Tianshu Harness identity before the deployment persona (default true). */
  includeHarnessIdentity?: boolean
  /**
   * Deployment-wide order-0 persona template. A scoped section named
   * `deployment:persona` shadows it; `{{variable}}` references are strict.
   */
  persona?: string
  /**
   * Model-facing tool names in order, with {@link TOOL_ORDER_REST} exactly once.
   * Shape errors fail at load and unknown names fail at assembly; known names
   * hidden in one scope may be absent there. Omitted means lexicographic order.
   */
  toolOrder?: string[]
}
```

来源：[`packages/core/system-prompt/src/index.ts:179`](../packages/core/system-prompt/src/index.ts)

## `@huiliyi37/dsh-time-context`

需要：`agents`

```ts config-catalog
/** Request-preparation clock formatting and append scheduling. Invalid values fail plugin load. */
export interface Config {
  /** IANA time zone used for the rendered timestamp. Omit to resolve the Node process's system zone at plugin load. */
  timeZone?: string
  /** Minimum milliseconds between durable injections in one session. Omit or set to 0 to inject at every eligible step. */
  refreshIntervalMs?: number
}
```

来源：[`packages/context/time-context/src/index.ts:20`](../packages/context/time-context/src/index.ts)

## `@huiliyi37/dsh-tmux-context`

需要：`agents`

```ts config-catalog
/** Per-turn tmux-location scheduling. Invalid values fail plugin load. */
export interface Config {
  /** Minimum milliseconds between durable injections in one session. Omit or set to 0 to inject on every eligible change. */
  refreshIntervalMs?: number
}
```

来源：[`packages/context/tmux-context/src/index.ts:34`](../packages/context/tmux-context/src/index.ts)

## `@huiliyi37/dsh-token-meter`

```ts config-catalog
/** Token-meter plugin configuration; the fixed estimator has no settings. */
export type TokenMeterConfig = Record<string, never>
```

来源：[`packages/llm/token-meter/src/types.ts:12`](../packages/llm/token-meter/src/types.ts)

## `@huiliyi37/dsh-tool-bash`

需要：`tools` · `bash` · `systemPrompt` · `bashEnv`

```ts config-catalog
/** Configuration for the bash tool. */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
}
```

来源：[`packages/bash/tool-bash/src/index.ts:34`](../packages/bash/tool-bash/src/index.ts)

## `@huiliyi37/dsh-tool-bash-persistent`

需要：`tools` · `pty`

```ts config-catalog
/** Configuration for the persistent Bash tool. */
export interface Config {
  /** PTY backend used for each owner-isolated persistent shell (default `shell`). */
  backendType?: string
  /** Wall-clock limit for one command (default 300000). */
  timeoutMs?: number
  /** Maximum returned command-output characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description; deployments may describe their environment. */
  description?: string
}
```

来源：[`packages/pty/tool-bash-persistent/src/index.ts:405`](../packages/pty/tool-bash-persistent/src/index.ts)

## `@huiliyi37/dsh-tool-cordis`

需要：`tools`

```ts config-catalog
/** Config for the tool-cordis plugin: the sandbox evaluation bound. */
export interface Config {
  /**
   * Milliseconds the SYNCHRONOUS portion of mount code may run in the vm
   * before evaluation is aborted (default 5000). An async body escapes this
   * bound — see .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md for the trust stance.
   */
  vmTimeoutMs?: number
}
```

来源：[`packages/self-modification/tool-cordis/src/index.ts:25`](../packages/self-modification/tool-cordis/src/index.ts)
## `@huiliyi37/dsh-tool-file-info`

需要：`tools` · `fs`

```ts config-catalog
/** Plugin config; the workspace root defaults to the deployment workdir. */
export interface Config {
  /** Workspace root (must exist — fails loud at load). */
  root?: string
  /** Cooperative tool-call timeout budget (ms). */
  timeoutMs?: number
}
```

来源：[`packages/fs/tool-file-info/src/index.ts:40`](../packages/fs/tool-file-info/src/index.ts)

## `@huiliyi37/dsh-tool-fs`

需要：`tools` · `fs` · `systemPrompt`

```ts config-catalog
/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Default and maximum number of lines returned by one `read` call. */
  readLimit?: number
  /** Maximum characters returned for a single line before truncation. */
  readMaxLineLength?: number
  /** Maximum bytes returned for the selected lines of one `read` call. */
  readMaxBytes?: number
  /** Files at or above this size stream instead of loading whole into memory. */
  readStreamMinSize?: number
}
```

来源：[`packages/fs/tool-fs/src/index.ts:24`](../packages/fs/tool-fs/src/index.ts)

## `@huiliyi37/dsh-tool-fs-search`

需要：`tools` · `systemPrompt` · `subprocess`

```ts config-catalog
/** Plugin config; over-cap glob sampling is an explicit deployment choice and the remaining fields have defaults. */
export interface Config {
  /** Whether an over-cap `glob` page is sampled across top-level entries instead of taking the modification-time head. */
  sampleOverCapGlobResults: boolean
  /** Max paths one `glob` call retains inline; later paths go to the formatted spill file. */
  globMaxResults?: number
  /** Max flat matches one `grep` call retains inline; later matches go to the formatted spill file. */
  grepMaxMatches?: number
  /** Max bytes retained for one matched-line preview (the cut preserves UTF-8 boundaries). */
  grepMaxLineBytes?: number
  /** Max bytes of one search's serialized `presentationMeta`; trailing groups/paths drop past it so the persisted card stays bounded. */
  searchMetaMaxBytes?: number
  /** Max complete raw `rg` stdout bytes a search will parse; larger raw output fails with `SEARCH_RAW_OUTPUT_OVERFLOW`. */
  rawOutputMaxBytes?: number
  /** Terminate-escalation grace (ms), handed to the subprocess seam and bounded by `MAX_TIMER_DELAY_MS`. */
  graceMs?: number
  /** Max bytes retained for one search's stderr tail; the excerpt is embedded in `SEARCH_*` error messages, never shown on success. */
  stderrMaxBytes?: number
  /** Cooperative tool-call timeout budget (ms) on both tools, enforced by `@huiliyi37/dsh-timeout-policy` through `exec.signal`. */
  timeoutMs?: number
}
```

来源：[`packages/fs/tool-fs-search/src/index.ts:73`](../packages/fs/tool-fs-search/src/index.ts)

## `@huiliyi37/dsh-tool-git`

需要：`tools` · `git` · `systemPrompt`

```ts config-catalog
/** 工具配置：无部署可变项（单工具无 tunables）。 */
export interface Config {
  /** 是否启用工具；false 时不注册（默认 true）。 */
  enabled?: boolean
}
```

来源：[`packages/git/tool-git/src/index.ts:21`](../packages/git/tool-git/src/index.ts)

## `@huiliyi37/dsh-tool-goal`

需要：`agents` · `goals` · `tools` · `systemPrompt`

```ts config-catalog
/** Model policy and hard lower bounds for goal-state updates. */
export interface Config {
  /** Minimum admitted goal rounds before the model may self-report `blocked`. */
  blockedAfterConsecutiveRounds?: number
}
```

来源：[`packages/goal/tool-goal/src/index.ts:26`](../packages/goal/tool-goal/src/index.ts)

## `@huiliyi37/dsh-tool-lsp`

需要：`tools` · `lsp` · `systemPrompt`

```ts config-catalog
/** Plugin configuration: result caps and the timeout budget. */
export interface Config {
  /** Largest number of rendered locations before an omission marker (default 100). */
  maxLocations?: number
  /** Largest complete rendered result in characters, including truncation metadata (default 16000). */
  maxResultChars?: number
  /** Tool-call timeout budget in ms (default 60000). */
  timeoutMs?: number
}
```

来源：[`packages/lsp/tool-lsp/src/index.ts:58`](../packages/lsp/tool-lsp/src/index.ts)

## `@huiliyi37/dsh-tool-memory`

需要：`tools` · `systemPrompt`

```ts config-catalog
/** 插件配置。 */
export interface ToolMemoryConfig {
  /** 摘要注入开关（缺省 true）。 */
  digest?: boolean
}
```

来源：[`packages/memory/tool-memory/src/index.ts:60`](../packages/memory/tool-memory/src/index.ts)

## `@huiliyi37/dsh-tool-meridian`

需要：`tools` · `systemPrompt`

```ts config-catalog
/** Plugin config; the index root defaults to the deployment workdir. */
export interface Config {
  /** Workspace root the index scans (must exist — fails loud at load). */
  root?: string
  /** 首次 repo_graph 调用是否触发后台全量索引（默认 true）。 */
  backfillOnDemand?: boolean
  /** 后台全量索引文件数上限（默认 2000）。 */
  backfillMaxFiles?: number
  /** 启动即回填（默认 false，对应天枢 RIVET_MERIDIAN_BACKFILL=1）。 */
  backfillOnStart?: boolean
}
```

来源：[`packages/search/tool-meridian/src/index.ts:38`](../packages/search/tool-meridian/src/index.ts)

## `@huiliyi37/dsh-tool-pty`

需要：`pty` · `tools` · `systemPrompt`

```ts config-catalog
/** Model-facing terminal tool configuration. */
export interface Config {
  /** Expose `run_in_background` and accept background sends (default true). */
  enableRunInBackground?: boolean
  /** Maximum UTF-8 bytes in one complete terminal or task-output result. */
  maxResultBytes?: number
}
```

来源：[`packages/pty/tool-pty/src/index.ts:35`](../packages/pty/tool-pty/src/index.ts)

## `@huiliyi37/dsh-tool-pwsh`

需要：`tools` · `bash` · `systemPrompt` · `bashEnv`

```ts config-catalog
/** Configuration for the pwsh tool. */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
}
```

来源：[`packages/bash/tool-pwsh/src/index.ts:43`](../packages/bash/tool-pwsh/src/index.ts)

## `@huiliyi37/dsh-tool-ralph`

需要：`tools` · `workflows` · `subagents` · `systemPrompt`

```ts config-catalog
/** Deployment policy for the fixed Ralph workflow. */
export interface Config {
  /** Fresh structured-output provider used for every round (default `spawn`). */
  subagentProvider?: string
  /** Default and deployment ceiling for one call's round count (default 256). */
  maxRounds?: number
  /** Maximum serialized characters in one structured handoff (default 16384). */
  maxHandoffChars?: number
  /** Maximum characters in a successful parent-facing terminal text (default 16384). */
  maxResultChars?: number
}
```

来源：[`packages/workflow/tool-ralph/src/index.ts:23`](../packages/workflow/tool-ralph/src/index.ts)

## `@huiliyi37/dsh-tool-semantic-search`

需要：`tools` · `systemPrompt`

```ts config-catalog
/** Plugin config; the index root defaults to the deployment workdir. */
export interface Config {
  /** Workspace root the index scans (must exist — fails loud at load). */
  root?: string
  /** Max source files indexed in one pass. */
  maxFiles?: number
  /** Staleness-verdict cache window (ms) reused by each refresh. */
  staleTtlMs?: number
  /** Cooperative tool-call timeout budget (ms). */
  timeoutMs?: number
}
```

来源：[`packages/search/tool-semantic-search/src/index.ts:36`](../packages/search/tool-semantic-search/src/index.ts)

## `@huiliyi37/dsh-tool-session-query`

需要：`tools` · `systemPrompt` · `sessionQuery`

```ts config-catalog
/** Deployment-owned search count and timeout bounds. */
export interface Config {
  /** Maximum authorized hits returned by one search call. Defaults to 100. */
  maxSearchResults?: number
  /** Cooperative full-text search deadline in milliseconds. Defaults to 30000. */
  searchTimeoutMs?: number
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts:29`](../packages/session-query/tool-session-query/src/index.ts)

## `@huiliyi37/dsh-tool-skill`

需要：`agents` · `tools` · `skills`

```ts config-catalog
/** Model-facing skill catalog configuration. */
export interface Config {
  /** Maximum normalized description length rendered in the session catalog; minimum 3. */
  catalogDescriptionMaxLength?: number
}
```

来源：[`packages/skill/tool-skill/src/index.ts:62`](../packages/skill/tool-skill/src/index.ts)

## `@huiliyi37/dsh-tool-str-replace-editor`

需要：`tools` · `fs`

```ts config-catalog
/** Configuration for the string-replacement editor tool. */
export interface Config {
  /** Maximum returned view characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description. */
  description?: string
}
```

来源：[`packages/fs/tool-str-replace-editor/src/index.ts:497`](../packages/fs/tool-str-replace-editor/src/index.ts)

## `@huiliyi37/dsh-tool-subagent`

需要：`tools` · `subagents`

```ts config-catalog
/** Config: which registered provider this tool delegates to, plus child defaults. */
export interface Config {
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
```

依赖：[`AgentOptions`](subsystems/core.md)

来源：[`packages/subagent/tool-subagent/src/index.ts:41`](../packages/subagent/tool-subagent/src/index.ts)

## `@huiliyi37/dsh-tool-subagent-report`

需要：`subagents` · `tools`

```ts config-catalog
/** Config: how accepted reports are scheduled on the parent. */
export interface Config {
  /**
   * Parent scheduling (default `quiet`). `quiet` adds context without waking;
   * `wakeup` creates one ordinary later parent turn.
   */
  reportDelivery?: SubagentReportDelivery
}
```

依赖：[`SubagentReportDelivery`](subsystems/subagent.md)

来源：[`packages/subagent/tool-subagent-report/src/index.ts:23`](../packages/subagent/tool-subagent-report/src/index.ts)

## `@huiliyi37/dsh-tool-tasks`

需要：`tools` · `tasks` · `systemPrompt`

```ts config-catalog
/** Configures bounded `task_output` waits. */
export interface Config {
  /** Wait duration applied when `task_output` sets `wait` without `timeout_ms` (default 30s). */
  waitTimeoutMs?: number
  /** Hard cap on any single wait; a larger model-supplied `timeout_ms` is clamped down to it (default 10min). */
  maxWaitTimeoutMs?: number
}
```

来源：[`packages/tasks/tool-tasks/src/index.ts:23`](../packages/tasks/tool-tasks/src/index.ts)

## `@huiliyi37/dsh-tool-todo`

需要：`tools`

```ts config-catalog
/** Model-facing todo tool configuration. */
export interface Config {
  /**
   * Required deployment choice for whether several todos may be `in_progress` at once. True suits
   * agents that run work concurrently — subagents, background commands, workflow fan-out — and the
   * description then instructs the model to mark every actively worked task. False restores the
   * single-active discipline: the description asks for exactly one, and a call marking more is
   * rejected.
   */
  allowParallelInProgress: boolean
}
```

来源：[`packages/todo/tool-todo/src/index.ts:29`](../packages/todo/tool-todo/src/index.ts)

## `@huiliyi37/dsh-tool-web`

需要：`tools` · `web` · `systemPrompt`

```ts config-catalog
/** Plugin config: which web tools to register, the source cap, per-tool budgets, and the fetch output cap. */
export interface Config {
  /** Register `web_search`. Defaults to true. */
  search?: boolean
  /** Register `web_fetch`. Defaults to true. */
  fetch?: boolean
  /** Upper bound on sources returned by one `web_search` call. */
  searchMaxResults?: number
  /** Cooperative timeout budget (ms) for `web_fetch`. Defaults to 30000. */
  fetchTimeoutMs?: number
  /** Cooperative timeout budget (ms) for `web_search`. Defaults to 30000. */
  searchTimeoutMs?: number
  /** Cap on source characters converted and complete `web_fetch` output characters. Defaults to 200000. */
  fetchMaxOutputChars?: number
}
```

来源：[`packages/web/tool-web/src/index.ts:37`](../packages/web/tool-web/src/index.ts)

## `@huiliyi37/dsh-tool-workflow`

需要：`tools` · `workflows` · `systemPrompt`

```ts config-catalog
/** Config: the model-facing tool name plus result rendering caps. */
export interface Config {
  /** The model-facing tool name to register (default `workflow`). */
  toolName?: string
  /** Rendered-result ceiling, in characters: a longer JSON value is truncated with a notice (default 50000). */
  maxResultChars?: number
}
```

来源：[`packages/workflow/tool-workflow/src/index.ts:27`](../packages/workflow/tool-workflow/src/index.ts)

## `@huiliyi37/dsh-tools`

需要：`systemPrompt`

```ts config-catalog
/** Plugin config: how the registered tools are presented to the model. */
export interface Config {
  /**
   * Model presentation. `native` (default) sends every visible schema; `code`
   * sends only `run_code` plus a generated SDK prompt; `both` sends both forms.
   * Code modes require a `ctx.codeRuntime` whose `language` has a registered
   * SDK renderer (TypeScript or Python) and fail prompt assembly when it is
   * absent or has no renderer. Under `code`, native names in `toolOrder` are invalid.
   */
  mode?: ToolPresentationMode
  /**
   * Concurrency cap for a `run_code` program's overlapping sub-calls
   * (default 10, the loop scheduler's own default). Sub-calls follow the
   * native scheduling contract — only calls whose tools classify
   * concurrency-safe overlap; exclusive calls form barriers — so `1`
   * restores strictly serial dispatch. Must be a positive integer.
   */
  maxParallelSubCalls?: number
}

/** How the registry presents its tools to the model (see {@link Config.mode}). */
export type ToolPresentationMode = 'native' | 'code' | 'both'
```

来源：[`packages/core/tools/src/index.ts:616`](../packages/core/tools/src/index.ts)

## `@huiliyi37/dsh-tui`

```ts config-catalog
/** 装配选项：流与起始会话可注入（测试替身），缺省走 process 全局流。 */
export interface TuiRunnerConfig {
  /** 键盘输入流；缺省 process.stdin。 */
  stdin?: ReadStream
  /** 渲染输出流；缺省 process.stdout。 */
  stdout?: WriteStream
  /** 启动即切入的会话 id；缺省新建会话。 */
  initialSessionId?: SessionId
  /** 外部编辑器触发键（Phase 6.4）；缺省 ctrl_e（ctrl+o 已恢复为推理展开）。 */
  editorKey?: KeyName
  /** 是否启用 Vim 键位（Phase 6.5）；缺省 false。 */
  vimEnabled?: boolean
  /** 主控模型的识图能力与视觉桥状态（图片附件气泡提示数据源）。 */
  vision?: {
    /** 主控模型是否原生支持识图（图片直发）。 */
    supportsVision?: boolean
    /** 是否配置了独立识图桥模型（主控不识图时经桥转文字描述）。
     *  未传入时按宿主 `visionBridge` 服务（dsh-vision-bridge 装配时应 provide）
     *  的存在性自动探测。 */
    bridgeEnabled?: boolean
    /** 识图桥来源（configured=显式配置 / auto=自动选用）。 */
    bridgeSource?: 'configured' | 'auto' | 'none'
  }
  /** 已结算 workflow run 缓存条数上限（/workflow 面板历史），超限 drop-oldest；正整数，缺省 50。 */
  workflowHistoryLimit?: number
  /** LSP 诊断桥（本地语言服务）：懒启动——agent 触碰文件时拉取该文件诊断。
   *  诊断只进 TUI 本地展示缓存（工具卡徽标 + /lsp 面板），不写会话事件、
   *  不注册任何模型面。缺省启用。 */
  lsp?: {
    /** 是否启用诊断拉取；缺省 true。 */
    enabled?: boolean
    /** 单次诊断拉取超时（毫秒）；缺省 2000。 */
    timeoutMs?: number
  }
}

/** 可识别的按键语义名称；未映射的可打印字符与无法识别的序列为 'unknown'。 */
export type KeyName =
  | 'return'
  | 'escape'
  | 'tab'
  | 'backspace'
  | 'delete'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'home'
  | 'end'
  | 'pageup'
  | 'pagedown'
  | 'insert'
  | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8' | 'f9' | 'f10' | 'f11' | 'f12'
  | 'space'
  | 'ctrl_c'
  | 'ctrl_d'
  | 'ctrl_h'
  | 'ctrl_j'
  | 'ctrl_z'
  | 'ctrl_l'
  | 'ctrl_u'
  | 'ctrl_a'
  | 'ctrl_e'
  | 'ctrl_k'
  | 'ctrl_w'
  | 'ctrl_n'
  | 'ctrl_o'
  | 'ctrl_p'
  | 'ctrl_r'
  | 'ctrl_s'
  | 'ctrl_t'
  | 'ctrl_v'
  | 'ctrl_b'
  | 'ctrl_f'
  | 'ctrl_x'
  | 'ctrl_]'
  | 'ctrl_minus'
  | 'ctrl_.'
  | 'ctrl_y'
  | 'ctrl_q'
  | 'shift_tab'
  | 'unknown'
```

依赖：`ReadStream`（`node:tty`）· [`SessionId`](subsystems/core.md) · `WriteStream`（`node:tty`）

来源：[`packages/tui/tui/src/index.ts:23`](../packages/tui/tui/src/index.ts)

## `@huiliyi37/dsh-typert-loader`

需要：`typert` · `loader`

```ts config-catalog
/** Additional package artifacts whose owning plugins are nested behind another Loader entry. */
export interface Config {
  /** Exact npm package names that must resolve and export `./typert`. */
  packages?: string[]
}
```

来源：[`packages/typert/loader/src/index.ts:47`](../packages/typert/loader/src/index.ts)

## `@huiliyi37/dsh-user-approval`

```ts config-catalog
/** Plugin config. All optional — `static Config` supplies the defaults. */
export interface Config {
  /**
   * The deployment's default {@link ApprovalPolicy} for sessions without an
   * `approval/policy` override — `'ask'` delegates to the composed answerers
   * (fail-closed with none); `'never'` auto-rejects every ask without
   * prompting (the deterministic CI/unattended stance).
   */
  readonly policy?: ApprovalPolicy
}

/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`
 *   (exactly today's behavior).
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
export type ApprovalPolicy = 'ask' | 'never'
```

来源：[`packages/interaction/user-approval/src/index.ts:178`](../packages/interaction/user-approval/src/index.ts)

## `@huiliyi37/dsh-vision-ask`

需要：`llm` · `tools`

```ts config-catalog
/** Vision co-pilot configuration. */
export interface Config {
  /** Master switch; false disables registration, tool, and listener (default true). */
  enabled?: boolean
  /**
   * Provider route the plugin registers for vision calls (default 'vision-ask').
   * Independent of the primary model's provider — the adapter serializes
   * image blocks that the text-only baseline route cannot carry.
   */
  provider?: string
  /** Vision model id sent on the wire (required). */
  model: string
  /** OpenAI-compatible endpoint base (default https://api.deepseek.com). */
  baseUrl?: string
  /** Environment variable holding the API key (default DEEPSEEK_API_KEY). */
  apiKeyEnv?: string
  /** Description output token cap (default 1024). */
  maxTokens?: number
  /**
   * Primary-model vision capability override. Omitted: resolved dynamically
   * from the calling agent's model via inputModalities. true: always forward
   * the original image to the primary. false: always describe via the vision
   * adapter.
   */
  primarySupportsVision?: boolean
  /** Registry image-count cap per session (default 8). */
  registryMaxImages?: number
  /** Registry total-byte cap per session (default 24 MiB). */
  registryMaxBytes?: number
}
```

来源：[`packages/tui/vision-ask/src/index.ts:33`](../packages/tui/vision-ask/src/index.ts)

## `@huiliyi37/dsh-vision-bridge`

需要：`llm`

```ts config-catalog
/** 视觉桥配置：描述模型路由（显式或自动）+ 主控能力声明。 */
export interface Config {
  /** 总开关；false 时不注册监听（缺省 true）。 */
  enabled?: boolean
  /** 显式视觉模型的 provider route；缺省时配合 visionAutoBridge 自动选择。 */
  provider?: string
  /** 显式视觉模型名；缺省时配合 visionAutoBridge 自动选择。 */
  model?: string
  /** 自定义描述 prompt；缺省按随图文本自动选通用/精确转写模式。 */
  prompt?: string
  /** 描述输出 token 上限（缺省 1024）。 */
  maxTokens?: number
  /** 主控模型是否原生支持识图（缺省 false；true 时本插件不干预，图片直发）。 */
  primarySupportsVision?: boolean
  /** 备用视觉模型（主视觉模型 error/aborted 时兜底重试一次；缺省不启用）。 */
  fallback?: {
    /** 备用视觉模型的已注册 llm provider 路由。 */
    provider: string
    /** 备用视觉模型 id。 */
    model: string
  }
  /** 未显式配置 provider/model 时，自动选第一个声明 supportsVision 的已注册模型。 */
  visionAutoBridge?: boolean
}
```

来源：[`packages/context/vision-bridge/src/index.ts:49`](../packages/context/vision-bridge/src/index.ts)

## `@huiliyi37/dsh-web`

```ts config-catalog
/**
 * Config for the web seam. `searchProvider` / `fetchProvider` pin which provider
 * wins for each capability; both are optional (a single registered usable
 * provider auto-selects). Operational overrides such as environment variables
 * must feed these same fields rather than introduce a hidden priority chain.
 */
export interface WebServiceConfig {
  /** Explicit search provider id. Omitted = auto-select when exactly one usable. */
  readonly searchProvider?: string
  /** Explicit fetch provider id. Omitted = auto-select when exactly one usable. */
  readonly fetchProvider?: string
}
```

来源：[`packages/web/web/src/index.ts:55`](../packages/web/web/src/index.ts)

## `@huiliyi37/dsh-web-app`

需要：`httpServer`

```ts config-catalog
/** Plugin config: the surface facts the launcher patches over this bundle's defaults. */
export interface Config {
  /** Whether this process mounted the client-plugin HMR receiver (`tianshu web --dev`). */
  mode: WebMode
  /** Print the URL line on activation; a headless layer over this bundle turns it off. */
  printUrl: boolean
  /**
   * Register the model-visible surface context (the `app:web-surface` prompt
   * section and the `DSH_WEB_URL`/`DSH_WEB_MODE` bash variables). A one-shot
   * layer turns it off: its user is not interacting through the GUI, so the
   * orientation text would be false.
   */
  surfaceContext: boolean
  /**
   * LAN IPv4 addresses sampled once by the launcher when the effective bind
   * is all-interfaces — the exact snapshot the /api trust fence was
   * configured with, so the printed LAN URL can never name an address the
   * fence rejects. Empty on a loopback bind.
   */
  lanAddresses: string[]
}

/** Web runtime mode: production, or development when the client-plugin HMR receiver is active. */
export type WebMode = 'production' | 'development'
```

来源：[`packages/bundle/web-app/src/index.ts:32`](../packages/bundle/web-app/src/index.ts)

## `@huiliyi37/dsh-web-fetch-local`

需要：`web`

```ts config-catalog
/** Plugin config: the provider's transport and size limits plus its `User-Agent` (all defaulted). */
export interface Config {
  /** Maximum accepted request URL length. */
  maxUrlLength?: number
  /** Maximum response body size in bytes. */
  maxResponseBytes?: number
  /** Maximum decoded body length in characters. */
  maxBodyChars?: number
  /** Default fetch timeout in milliseconds, within Node's timer range. */
  timeoutMs?: number
  /** Maximum number of same-origin redirect hops to follow. */
  maxRedirects?: number
  /** `User-Agent` header sent on every request. */
  userAgent?: string
}
```

来源：[`packages/web/web-fetch-local/src/index.ts:34`](../packages/web/web-fetch-local/src/index.ts)

## `@huiliyi37/dsh-web-search-deepseek`

需要：`web`

```ts config-catalog
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal DeepSeek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each search; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv?: string
  /** Anthropic-compatible endpoint base; `/messages` is appended. */
  baseURL?: string
  /** Anthropic-format model name. Defaults to `deepseek-v4-flash`. */
  model?: string
  /** `anthropic-version` header value. Defaults to `2023-06-01`. */
  apiVersion?: string
  /** Upper bound on generated tokens for the Messages request. Defaults to 4096. */
  maxTokens?: number
  /** Maximum `web_search` server-tool uses per request. Defaults to 5. */
  maxUses?: number
}
```

来源：[`packages/web/web-search-deepseek/src/index.ts:44`](../packages/web/web-search-deepseek/src/index.ts)

## `@huiliyi37/dsh-web-search-exa`

需要：`web`

```ts config-catalog
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Exa API key. Falls back to `$EXA_API_KEY`. Empty → provider unavailable. */
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  searchType?: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Highlight sentences requested per result. Defaults to 1. */
  highlightsPerResult?: number
}
```

来源：[`packages/web/web-search-exa/src/index.ts:38`](../packages/web/web-search-exa/src/index.ts)

## `@huiliyi37/dsh-web-search-perplexity`

需要：`web`

```ts config-catalog
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Perplexity API key. Falls back to `$PERPLEXITY_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** Endpoint base; `/chat/completions` is appended. Defaults to the public API. */
  baseURL?: string
  /** Search model name. Defaults to `sonar`. */
  model?: string
  /** Upper bound on generated answer tokens. Defaults to 1024. */
  maxTokens?: number
  /** Recency window sent as `search_recency_filter`. Omitted = no filter. */
  searchRecency?: 'day' | 'week' | 'month' | 'year'
}
```

来源：[`packages/web/web-search-perplexity/src/index.ts:32`](../packages/web/web-search-perplexity/src/index.ts)

## `@huiliyi37/dsh-workflow-workerthread`

需要：`subagents`

```ts config-catalog
/** Plugin config (all optional — `static Config` supplies the defaults). */
export interface Config {
  /** The `ctx.subagents` provider children run on (default `spawn`). */
  provider?: string
  /** Concurrent `agent()` ceiling; `0` (the default) auto-resolves to `min(16, max(1, cores - 2))`. */
  maxConcurrentAgents?: number
  /** Total `agent()` calls one run may start — the runaway-loop backstop (default 1000). */
  maxTotalAgents?: number
  /** Items accepted by a single `parallel()`/`pipeline()` call (default 4096). */
  maxItemsPerCall?: number
  /** vm timeout for the script's initial synchronous slice, inside the worker (default 5000 ms). */
  syncTimeoutMs?: number
  /**
   * How long after a cancellation an unsettled script may keep running before
   * the run force-settles `cancelled` and its worker is TERMINATED (default
   * 5000 ms); also bounds `dispose()`.
   */
  disposeGraceMs?: number
}
```

来源：[`packages/workflow/workflow-workerthread/src/index.ts:32`](../packages/workflow/workflow-workerthread/src/index.ts)

## `@huiliyi37/dsh-workspace-context`

```ts config-catalog
/** User-facing workspace instruction loader configuration. */
export interface Config {
  /** Harness home containing the fixed user-global `AGENTS.md`; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Directory entries that identify the project root while walking upward from the session cwd. */
  projectRootMarkers?: string[]
  /** UTF-8 byte cap for one rendered baseline or dynamic batch; non-positive or non-finite disables loading. */
  maxBytes: number
  /** Maximum UTF-8 bytes read from one instruction file; larger files are ignored. */
  maxSourceBytes?: number
  /**
   * Ordered same-directory project candidates; every existing file loads, with
   * per-directory trimmed-content duplicates collapsed to the earliest candidate.
   */
  instructionFileCandidates?: string[]
  /**
   * Ordered same-directory local-overlay candidates loaded after the base files
   * under the same per-directory trimmed-content dedup; empty disables the overlay.
   */
  localInstructionFileCandidates?: string[]
}
```

来源：[`packages/context/workspace-context/src/config.ts:18`](../packages/context/workspace-context/src/config.ts)

## 无配置的可加载插件

这些插件通过 `cordis.yml` 中不含 `config:` 块的条目加载；它们未声明任何配置接口。

- `@huiliyi37/dsh-agent`（[`packages/core/agent/src/index.ts`](../packages/core/agent/src/index.ts)）
- `@huiliyi37/dsh-api-gateway` — 需要 `typert`（[`packages/api/gateway/src/index.ts`](../packages/api/gateway/src/index.ts)）
- `@huiliyi37/dsh-api-remotes`（[`packages/api/remotes/src/index.ts`](../packages/api/remotes/src/index.ts)）
- `@huiliyi37/dsh-client-locale`（[`packages/client/locale/src/index.ts`](../packages/client/locale/src/index.ts)）
- `@huiliyi37/dsh-client-modules` — 需要 `httpServer` · `loader`（[`packages/client/modules/src/index.ts`](../packages/client/modules/src/index.ts)）
- `@huiliyi37/dsh-client-runtime`（[`packages/client/runtime/src/index.ts`](../packages/client/runtime/src/index.ts)）
- `@huiliyi37/dsh-client-ui-command`（[`packages/client/ui-command/src/index.ts`](../packages/client/ui-command/src/index.ts)）
- `@huiliyi37/dsh-client-ui-conversation`（[`packages/client/ui-conversation/src/index.ts`](../packages/client/ui-conversation/src/index.ts)）
- `@huiliyi37/dsh-client-ui-deliverables`（[`packages/client/ui-deliverables/src/index.ts`](../packages/client/ui-deliverables/src/index.ts)）
- `@huiliyi37/dsh-client-ui-goal`（[`packages/client/ui-goal/src/index.ts`](../packages/client/ui-goal/src/index.ts)）
- `@huiliyi37/dsh-client-ui-input-trigger`（[`packages/client/ui-input-trigger/src/index.ts`](../packages/client/ui-input-trigger/src/index.ts)）
- `@huiliyi37/dsh-client-ui-layout`（[`packages/client/ui-layout/src/index.ts`](../packages/client/ui-layout/src/index.ts)）
- `@huiliyi37/dsh-client-ui-model`（[`packages/client/ui-model/src/index.ts`](../packages/client/ui-model/src/index.ts)）
- `@huiliyi37/dsh-client-ui-models`（[`packages/client/ui-models/src/index.ts`](../packages/client/ui-models/src/index.ts)）
- `@huiliyi37/dsh-client-ui-permission`（[`packages/client/ui-permission/src/index.ts`](../packages/client/ui-permission/src/index.ts)）
- `@huiliyi37/dsh-client-ui-plan`（[`packages/client/ui-plan/src/index.ts`](../packages/client/ui-plan/src/index.ts)）
- `@huiliyi37/dsh-client-ui-question` — 需要 `tools` · `userInteraction`（[`packages/client/ui-question/src/index.ts`](../packages/client/ui-question/src/index.ts)）
- `@huiliyi37/dsh-client-ui-settings`（[`packages/client/ui-settings/src/index.ts`](../packages/client/ui-settings/src/index.ts)）
- `@huiliyi37/dsh-client-ui-settings-general`（[`packages/client/ui-settings-general/src/index.ts`](../packages/client/ui-settings-general/src/index.ts)）
- `@huiliyi37/dsh-client-ui-sidebar`（[`packages/client/ui-sidebar/src/index.ts`](../packages/client/ui-sidebar/src/index.ts)）
- `@huiliyi37/dsh-client-ui-skill`（[`packages/client/ui-skill/src/index.ts`](../packages/client/ui-skill/src/index.ts)）
- `@huiliyi37/dsh-client-ui-slash`（[`packages/client/ui-slash/src/index.ts`](../packages/client/ui-slash/src/index.ts)）
- `@huiliyi37/dsh-client-ui-subagent`（[`packages/client/ui-subagent/src/index.ts`](../packages/client/ui-subagent/src/index.ts)）
- `@huiliyi37/dsh-client-ui-theme`（[`packages/client/ui-theme/src/index.ts`](../packages/client/ui-theme/src/index.ts)）
- `@huiliyi37/dsh-client-ui-tool`（[`packages/client/ui-tool/src/index.ts`](../packages/client/ui-tool/src/index.ts)）
- `@huiliyi37/dsh-client-ui-trajectory`（[`packages/client/ui-trajectory/src/index.ts`](../packages/client/ui-trajectory/src/index.ts)）
- `@huiliyi37/dsh-client-ui-workspace`（[`packages/client/ui-workspace/src/index.ts`](../packages/client/ui-workspace/src/index.ts)）
- `@huiliyi37/dsh-command-compact` — 需要 `commands` · `compact`（[`packages/compact/command-compact/src/index.ts`](../packages/compact/command-compact/src/index.ts)）
- `@huiliyi37/dsh-command-feedback` — 需要 `commands`（[`packages/feedback/command-feedback/src/index.ts`](../packages/feedback/command-feedback/src/index.ts)）
- `@huiliyi37/dsh-command-goal` — 需要 `commands` · `goals`（[`packages/goal/command-goal/src/index.ts`](../packages/goal/command-goal/src/index.ts)）
- `@huiliyi37/dsh-commands`（[`packages/interaction/commands/src/index.ts`](../packages/interaction/commands/src/index.ts)）
- `@huiliyi37/dsh-cordis-client-runner`（[`packages/self-modification/cordis-client-runner/src/index.ts`](../packages/self-modification/cordis-client-runner/src/index.ts)）
- `@huiliyi37/dsh-fs-e2b` — 需要 `e2b`（[`packages/e2b/fs-e2b/src/index.ts`](../packages/e2b/fs-e2b/src/index.ts)）
- `@huiliyi37/dsh-fs-policy`（[`packages/fs/fs-policy/src/index.ts`](../packages/fs/fs-policy/src/index.ts)）
- `@huiliyi37/dsh-goal-session` — 需要 `agents` · `goals` · `sessions`（[`packages/goal/goal-session/src/index.ts`](../packages/goal/goal-session/src/index.ts)）
- `@huiliyi37/dsh-host-directory-picker-auto` — 需要 `httpServer` · `loader`（[`packages/host/directory-picker-auto/src/index.ts`](../packages/host/directory-picker-auto/src/index.ts)）
- `@huiliyi37/dsh-host-directory-picker-native`（[`packages/host/directory-picker-native/src/index.ts`](../packages/host/directory-picker-native/src/index.ts)）
- `@huiliyi37/dsh-llm`（[`packages/llm/llm/src/index.ts`](../packages/llm/llm/src/index.ts)）
- `@huiliyi37/dsh-lsp`（[`packages/lsp/lsp/src/index.ts`](../packages/lsp/lsp/src/index.ts)）
- `@huiliyi37/dsh-pty`（[`packages/pty/pty/src/index.ts`](../packages/pty/pty/src/index.ts)）
- `@huiliyi37/dsh-schedule` — 需要 `agents` · `sessions` · `tools` · `sessionPersistence`（[`packages/schedule/schedule/src/index.ts`](../packages/schedule/schedule/src/index.ts)）
- `@huiliyi37/dsh-session`（[`packages/core/session/src/index.ts`](../packages/core/session/src/index.ts)）
- `@huiliyi37/dsh-session-checkpoint-policy` — 需要 `llm` · `sessionPersistence` · `sessions` · `tools`（[`packages/session/session-checkpoint-policy/src/index.ts`](../packages/session/session-checkpoint-policy/src/index.ts)）
- `@huiliyi37/dsh-session-projection`（[`packages/session/session-projection/src/index.ts`](../packages/session/session-projection/src/index.ts)）
- `@huiliyi37/dsh-skill-badge` — 需要 `skills`（[`packages/skill/skill-badge/src/index.ts`](../packages/skill/skill-badge/src/index.ts)）
- `@huiliyi37/dsh-storage`（[`packages/storage/storage/src/index.ts`](../packages/storage/storage/src/index.ts)）
- `@huiliyi37/dsh-subagent`（[`packages/subagent/subagent/src/index.ts`](../packages/subagent/subagent/src/index.ts)）
- `@huiliyi37/dsh-subprocess-local`（[`packages/subprocess/subprocess-local/src/index.ts`](../packages/subprocess/subprocess-local/src/index.ts)）
- `@huiliyi37/dsh-tasks-local`（[`packages/tasks/tasks-local/src/index.ts`](../packages/tasks/tasks-local/src/index.ts)）
- `@huiliyi37/dsh-timeout-policy` — 需要 `tools`（[`packages/guard/timeout-policy/src/index.ts`](../packages/guard/timeout-policy/src/index.ts)）
- `@huiliyi37/dsh-tool-ask-user` — 需要 `tools` · `userInteraction`（[`packages/interaction/tool-ask-user/src/index.ts`](../packages/interaction/tool-ask-user/src/index.ts)）
- `@huiliyi37/dsh-tool-subagent-control` — 需要 `tools` · `subagents`（[`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)）
- `@huiliyi37/dsh-ui-cordis`（[`packages/self-modification/ui-cordis/src/index.ts`](../packages/self-modification/ui-cordis/src/index.ts)）
- `@huiliyi37/dsh-user-interaction`（[`packages/interaction/user-interaction/src/index.ts`](../packages/interaction/user-interaction/src/index.ts)）
- `@huiliyi37/dsh-workspace` — 需要 `storageDomain` · `sessionPersistence`（[`packages/workspace/workspace/src/index.ts`](../packages/workspace/workspace/src/index.ts)）

## Seam 包（不可直接加载）

抽象服务类——部署时应改为加载具体的实现包（参见[能力 seam](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)）。

- `@huiliyi37/dsh-attachment` — 抽象 `AttachmentStore`（[`packages/attachment/attachment/src/index.ts`](../packages/attachment/attachment/src/index.ts)）
- `@huiliyi37/dsh-bash` — 抽象 `BashExecutor`（[`packages/bash/bash/src/index.ts`](../packages/bash/bash/src/index.ts)）
- `@huiliyi37/dsh-code-runtime` — 抽象 `CodeRuntime`（[`packages/code-runtime/code-runtime/src/index.ts`](../packages/code-runtime/code-runtime/src/index.ts)）
- `@huiliyi37/dsh-compact` — 抽象 `CompactService`（[`packages/compact/compact/src/index.ts`](../packages/compact/compact/src/index.ts)）
- `@huiliyi37/dsh-credentials` — 抽象 `Credentials`（[`packages/credentials/credentials/src/index.ts`](../packages/credentials/credentials/src/index.ts)）
- `@huiliyi37/dsh-fs` — 抽象 `FileSystem`（[`packages/fs/fs/src/index.ts`](../packages/fs/fs/src/index.ts)）
- `@huiliyi37/dsh-host-directory-picker` — 抽象 `DirectoryPicker`（[`packages/host/directory-picker/src/index.ts`](../packages/host/directory-picker/src/index.ts)）
- `@huiliyi37/dsh-sandbox` — 抽象 `SandboxProvider`（[`packages/sandbox/sandbox/src/index.ts`](../packages/sandbox/sandbox/src/index.ts)）
- `@huiliyi37/dsh-session-persistence` — 抽象 `SessionPersistence`（[`packages/session/session-persistence/src/index.ts`](../packages/session/session-persistence/src/index.ts)）
- `@huiliyi37/dsh-session-query` — 抽象 `SessionQueryService`（[`packages/session-query/session-query/src/index.ts`](../packages/session-query/session-query/src/index.ts)）
- `@huiliyi37/dsh-settings` — 抽象 `Settings`（[`packages/settings/settings/src/index.ts`](../packages/settings/settings/src/index.ts)）
- `@huiliyi37/dsh-spill` — 抽象 `SpillStore`（[`packages/spill/spill/src/index.ts`](../packages/spill/spill/src/index.ts)）
- `@huiliyi37/dsh-subprocess` — 抽象 `SubprocessService`（[`packages/subprocess/subprocess/src/index.ts`](../packages/subprocess/subprocess/src/index.ts)）
- `@huiliyi37/dsh-tasks` — 抽象 `TaskService`（[`packages/tasks/tasks/src/index.ts`](../packages/tasks/tasks/src/index.ts)）
- `@huiliyi37/dsh-workflow` — 抽象 `WorkflowService`（[`packages/workflow/workflow/src/index.ts`](../packages/workflow/workflow/src/index.ts)）
## 库包（无插件入口）

由其他包作为库导入；`cordis.yml` 无法加载它们。

- `@huiliyi37/dsh-acp-snapshot`（[`packages/support/acp-snapshot/src/index.ts`](../packages/support/acp-snapshot/src/index.ts)）
- `@huiliyi37/dsh-agent-loop-testkit`（[`packages/support/agent-loop-testkit/src/index.ts`](../packages/support/agent-loop-testkit/src/index.ts)）
- `@huiliyi37/dsh-anonymous-user-id`（[`packages/identity/anonymous-user-id/src/index.ts`](../packages/identity/anonymous-user-id/src/index.ts)）
- `@huiliyi37/dsh-app-boot`（[`packages/boot/app-boot/src/index.ts`](../packages/boot/app-boot/src/index.ts)）
- `@huiliyi37/dsh-atomic-write`（[`packages/util/atomic-write/src/index.ts`](../packages/util/atomic-write/src/index.ts)）
- `@huiliyi37/dsh-base`（[`packages/bundle/base/src/index.ts`](../packages/bundle/base/src/index.ts)）
- `@huiliyi37/dsh-brand`（[`packages/util/brand/src/index.ts`](../packages/util/brand/src/index.ts)）
- `@huiliyi37/dsh-client-schema-form`（[`packages/client/schema-form/src/index.ts`](../packages/client/schema-form/src/index.ts)）
- `@huiliyi37/dsh-client-test-runtime`（[`packages/client/test-runtime/src/index.ts`](../packages/client/test-runtime/src/index.ts)）
- `@huiliyi37/dsh-client-ui-primitives`（[`packages/client/ui-primitives/src/index.ts`](../packages/client/ui-primitives/src/index.ts)）
- `@huiliyi37/dsh-client-ui-slots`（[`packages/client/ui-slots/src/index.ts`](../packages/client/ui-slots/src/index.ts)）
- `@huiliyi37/dsh-client-web`（[`packages/client/web/src/index.ts`](../packages/client/web/src/index.ts)）
- `@huiliyi37/dsh-client-web-react`（[`packages/client/web-react/src/index.ts`](../packages/client/web-react/src/index.ts)）
- `@huiliyi37/dsh-environment`（[`packages/util/environment/src/index.ts`](../packages/util/environment/src/index.ts)）
- `@huiliyi37/dsh-fs-snapshot`（[`packages/fs/fs-snapshot/src/index.ts`](../packages/fs/fs-snapshot/src/index.ts)）
- `@huiliyi37/dsh-hook-protocol`（[`packages/hooks/hook-protocol/src/index.ts`](../packages/hooks/hook-protocol/src/index.ts)）
- `@huiliyi37/dsh-jsonrpc-demo`（[`packages/examples/jsonrpc-demo/src/index.ts`](../packages/examples/jsonrpc-demo/src/index.ts)）
- `@huiliyi37/dsh-llm-mock-server`（[`packages/support/llm-mock-server/src/index.ts`](../packages/support/llm-mock-server/src/index.ts)）
- `@huiliyi37/dsh-loader-smoke`（[`packages/support/loader-smoke/src/index.ts`](../packages/support/loader-smoke/src/index.ts)）
- `@huiliyi37/dsh-memory`（[`packages/memory/memory/src/index.ts`](../packages/memory/memory/src/index.ts)）
- `@huiliyi37/dsh-meridian`（[`packages/search/meridian/src/index.ts`](../packages/search/meridian/src/index.ts)）
- `@huiliyi37/dsh-native-command`（[`packages/util/native-command/src/index.ts`](../packages/util/native-command/src/index.ts)）
- `@huiliyi37/dsh-paths`（[`packages/util/paths/src/index.ts`](../packages/util/paths/src/index.ts)）
- `@huiliyi37/dsh-pheromone`（[`packages/guard/pheromone/src/index.ts`](../packages/guard/pheromone/src/index.ts)）
- `@huiliyi37/dsh-retention`（[`packages/util/retention/src/index.ts`](../packages/util/retention/src/index.ts)）
- `@huiliyi37/dsh-scope`（[`packages/core/scope/src/index.ts`](../packages/core/scope/src/index.ts)）
- `@huiliyi37/dsh-sdk-client`（[`packages/scaffold/client/src/index.ts`](../packages/scaffold/client/src/index.ts)）
- `@huiliyi37/dsh-sdk-protocol`（[`packages/scaffold/protocol/src/index.ts`](../packages/scaffold/protocol/src/index.ts)）
- `@huiliyi37/dsh-semantic-index`（[`packages/search/semantic-index/src/index.ts`](../packages/search/semantic-index/src/index.ts)）
- `@huiliyi37/dsh-session-telemetry`（[`packages/session/session-telemetry/src/index.ts`](../packages/session/session-telemetry/src/index.ts)）
- `@huiliyi37/dsh-session-title-llm`（[`packages/session/session-title-llm/src/index.ts`](../packages/session/session-title-llm/src/index.ts)）
- `@huiliyi37/dsh-subagent-inprocess`（[`packages/subagent/subagent-inprocess/src/index.ts`](../packages/subagent/subagent-inprocess/src/index.ts)）
- `@huiliyi37/dsh-timeout`（[`packages/util/timeout/src/index.ts`](../packages/util/timeout/src/index.ts)）
- `@huiliyi37/dsh-type-meta`（[`packages/typert/type-meta/src/index.ts`](../packages/typert/type-meta/src/index.ts)）
- `@huiliyi37/dsh-typert-generator`（[`packages/typert/generator/src/index.ts`](../packages/typert/generator/src/index.ts)）
- `@huiliyi37/dsh-typert-registry`（[`packages/typert/registry/src/index.ts`](../packages/typert/registry/src/index.ts)）
