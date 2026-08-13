# Subsystems

English | [中文](README.zh.md)

One page per subsystem of the DeepSeek Harness: what it is, the data structures it moves, and — where a `ctx` service or event scope backs it — a generated **Cordis surface** section carrying its service and event reference. The folder complements [architecture.md](../architecture.md), which describes *behavior* across subsystems (the service map, the session/turn/step lifecycle, the event taxonomy); each page here is the reference for one subsystem's vocabulary and wiring.

| Page | Owns |
|---|---|
| [core.md](core.md) | the `packages/core` control spine: the package-by-package loop map, agent creation and ownership (`AgentHandle`), the `Agent` handle with its delivery/cancellation/interception contracts, and the repo-wide type patterns (`…Map → derived-union`, branded ids) |
| [llm-streaming.md](llm-streaming.md) | the `packages/llm` conversation vocabulary — `Message`/`ContentBlock`, the assembled model request, the `StreamChunk` wire protocol + adapter contract, `BlockAssembler`, the `LlmAdapter` provider contract |
| [token-meter.md](token-meter.md) | immutable scalar and positional replay measurements with consumed-log revisions |
| [scope.md](scope.md) | scoped registration identity, dispatch carriers, and the owned `Scope` context |
| [typert.md](typert.md) | Remote invocation descriptors, lookup/Context declarations, TypeRT registries, and the Host Gateway/Client API boundaries |
| [goal.md](goal.md) | persisted goal identity, lifecycle snapshots, activation, change records, and round attribution |
| [commands.md](commands.md) | the human-command registry service: definitions, adapter discovery, direct invocation, results, and parsing views |
| [session.md](session.md) | the full `SessionEventMap` variant catalog, `TurnTrigger`/`TurnEndReason`, `deriveMessages()`, execution enclosure, and standalone events |
| [persistence.md](persistence.md) | the durability seam: `SessionPersistence`, JSONL + SQLite backends, `session/flush`, crash recovery, `SessionHeader` |
| [settings.md](settings.md) | the user-settings seam: `SettingsNamespace` registration, layered resolution (defaults → composition `base` → user document), owner scopes, hot commits |
| [credentials.md](credentials.md) | the credential seam: `CredentialRef` references (never values) in configuration, per-operation resolution, UI-safe `CredentialInfo`, provider source layers |
| [session-query.md](session-query.md) | logical records, bounded exact-event reads, relationship traces, semantic filters/documents, and full-text result pages |
| [session-title.md](session-title.md) | durable title snapshots, cited source-message seqs, and the asynchronous provider contract |
| [session-reference.md](session-reference.md) | structured cross-session references: `SessionReferenceInput`/`Candidate`, prepared message contexts, the stable error taxonomy |
| [system-prompt.md](system-prompt.md) | per-assembly context, tool-provider results, prompt sections, and cooperative assembly |
| [tools.md](tools.md) | `ToolDefinition` full fields, the schema DSL, `ToolExecution`/`ToolResult`, tool-presentation UI types, and the guarded execution pipeline |
| [user-interaction.md](user-interaction.md) | the UI-backed human question/answer seam: `AskUserQuestionRequest`, answer/options vocabulary, provider API, error taxonomy |
| [approval.md](approval.md) | the one-shot user-approval seam: `ApprovalRequest`, `ApprovalOutcome`, per-session policy, audit and answerer contracts |
| [bash.md](bash.md) | the bash executor seam: `BashExecRequest`/`Spec`, `BashRunResult`, background `BashProcess` handles |
| [subprocess.md](subprocess.md) | the subprocess seam: fully-explicit `SubprocessSpawnSpec`, offset-based output readers, unclassified `SubprocessOutcome`, and the managed `DSH_*` environment vocabulary |
| [pty.md](pty.md) | persistent terminal ids, backend/session contracts, send readiness, bounded reads, and owner-visible snapshots |
| [sandbox.md](sandbox.md) | per-session policy resolution and the process-confinement seam: file-effect modes, execution/provider policies, `ConfinedArgv`, enforcement and fail-closed errors |
| [code-runtime.md](code-runtime.md) | the code-execution seam: `CodeRunRequest`/`Result`, binding namespaces, captured logs, the `CodeRunFailure` taxonomy |
| [filesystem.md](filesystem.md) | the filesystem seam: `FsTarget`, read/write/edit outcomes, observed-file state, `FsErrorCode` |
| [lsp.md](lsp.md) | the LSP navigation seam: `LspQueryRequest`/`Result`, `LspProvider`/`Service`, four operations, `LspError` |
| [skills.md](skills.md) | the skill service: discovery priority, `SkillSummary`/`SkillDefinition`, session-prefix catalog, model-facing `skill` loading |
| [compaction.md](compaction.md) | the compaction seam: the `compact/*` session events, `CompactionResult`, the `CompactService` interface |
| [subagent.md](subagent.md) | the subagent seam: the named-provider registry, `SubagentStartRequest`/`Result`/`Run`, the start-time-vs-runtime capability split |
| [web.md](web.md) | the web access seam: `WebSearchRequest`/`Result`, `WebFetchRequest`/`Result`, `WebFetchBody`, provider availability, `WebError` |
| [spill.md](spill.md) | the spill storage seam: `SaveTextSpill`, `SpillOwner`/`SpillSource`, `SpillRef`, the branded `SpillLocator` |
| [workflow.md](workflow.md) | the workflow seam: `WorkflowStartRequest`, `WorkflowMeta`, `WorkflowRun`/`Result`, the `workflow/*` event payloads, `WorkflowError` fatality |
| [tasks.md](tasks.md) | the background-task runtime: branded `TaskId`s, the producer contract, consumer views, `ctx.tasks` service behavior |
| [permission.md](permission.md) | the permission-preset layer: `PresetSpec`/`PresetOption`, the derived `custom` state, the log-only `permission/preset` event |
| [plan.md](plan.md) | plan mode: the log-only `plan/mode` state, pending-selection flush, `PlanModeConfig`, the `exit_plan_mode` review arc |
| [invariants.md](invariants.md) | the runtime-invariant registry: selection `Config`, `InvariantInstaller`/`InvariantFailure`, the empty-companion contract |
| [http-server.md](http-server.md) | the HTTP carrier: `WebRouteKind`/`WebRoute`, match order, the claimable fallback seat, index taps |
| [storage.md](storage.md) | the storage subsystem: the backend contract (`StorageBackend`), `StorageForms`, `DomainSpec`/`Domain`, `domain/changed` |
| [workspace.md](workspace.md) | the workspace registry: `Workspace`/`WorkspaceId`, registration and resolution, the session `cwd` relationship |
| [client-modules.md](client-modules.md) | the web plugin table: `dshClient` declarations, `WebBootGraph` wire composition, the bundle route and index tap |
| [session-projection.md](session-projection.md) | the projection seam: `SessionProjectionMap`, the pure `ProjectionDefinition` unit, `ProjectionSnapshot`'s consistent cut, the change feed |
| [telemetry.md](telemetry.md) | the session-telemetry capability seam: `TelemetryRecord`/`TelemetrySeverity`, the `TelemetryBackend` contract, the `telemetry/record` redact waterfall |

> Type declarations and their JSDoc on these pages are source-equivalent and drift-checked by `pnpm run verify-type-equiv` (see [development.md](../development.md#documenting-types-verbatim-ts-type-equiv)). Ordinary blocks preserve complete declarations; `public-api` blocks preserve body-stripped public class declarations. Cordis services and events use each page's generated **Cordis surface** section.
