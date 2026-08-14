# Packages

English | [中文](README.zh.md)

Packages use the `@huiliyi37/dsh-*` scope. Cordis `Service` subclasses and function plugins contribute through `ctx.effect()`, `ctx.on()`, or `ctx.waterfall()`. Authoring rules: [package](AGENTS.md) and [root](../AGENTS.md#conventions).

## Hierarchy

Groups hold `packages/<group>/<pkg>/`; names stay `@huiliyi37/dsh-<pkg>`. **Group READMEs own package/ctx-key maps.**

| Group | Role | Release expectation |
|---|---|---|
| [`core/`](core/README.md) | Product API spine: sessions, prompts, tools, agent services, and the concrete loop | Product — stable surface |
| [`api/`](api/README.md) | Remote BFF assembly and TypeRT RPC gateway | Product — stable surface |
| [`typert/`](typert/README.md) | Type graph generation, artifact loading, and runtime registry | Product — stable surface |
| [`goal/`](goal/README.md) | Same-session goal persistence and lifecycle | Product — stable surface |
| [`feedback/`](feedback/README.md) | Human feedback | Product — stable surface |
| [`llm/`](llm/README.md) | LLM capability family: the abstract service + provider adapters | Product — stable surface |
| [`e2b/`](e2b/README.md) | E2B providers | POC |
| [`subprocess/`](subprocess/README.md) | Subprocess capability family: Service Definition + local process-tree provider | Product — stable surface |
| [`bash/`](bash/README.md) | Bash capability family: executor seam, local impl, model-facing tool | Product — stable surface |
| [`pty/`](pty/README.md) | Persistent PTY family: owner-scoped sessions, local impl, model-facing tools | Product — stable surface |
| [`code-runtime/`](code-runtime/README.md) | Code-execution capability family: Service Definition + worker-thread provider + Code Mode Consumer | Product — stable surface |
| [`sandbox/`](sandbox/README.md) | Process-confinement seam; bwrap/Landlock/Seatbelt backends | Product — stable surface |
| [`fs/`](fs/README.md) | Filesystem capability family: seam, local impl, model-facing file tools, bash-backed discovery tools | Product — stable surface |
| [`git/`](git/README.md) | Git capability family: service + local CLI provider + model-facing git tools | Product — stable surface |
| [`lsp/`](lsp/README.md) | LSP capability family: seam, generic stdio provider, and the `lsp` tool | Product — stable surface |
| [`skill/`](skill/README.md) | Skill capability family: the provider registry, local provider, and model-facing catalog/loader | Product — stable surface |
| [`compact/`](compact/README.md) | Compaction capability family: Service Definition + basic provider + command Consumer | Product — stable surface |
| [`context/`](context/README.md) | Model-visible request context, including workspace instructions and time context | Product — stable surface |
| [`subagent/`](subagent/README.md) | Subagent capability family: the provider-registry contract and the model-facing delegation tool | Product — stable surface |
| [`tasks/`](tasks/README.md) | Generic background-task runtime and model-facing `task_*` control tools | Product — stable surface |
| [`workflow/`](workflow/README.md) | Workflow seam, worker-thread engine, and model-facing `workflow`/`ralph` tools | Product — stable surface |
| [`web/`](web/README.md) | Web capability family: seam, search/fetch providers, model-facing web tools | Product — stable surface |
| [`spill/`](spill/README.md) | Spill capability family: storage seam, local impl, tool-result spill policy | Product — stable surface |
| [`todo/`](todo/README.md) | The model-facing `todo_write` tool | Product — stable surface |
| [`plan/`](plan/README.md) | Plan collaboration state with a direct entry command and reviewed exit | Product — stable surface |
| [`guard/`](guard/README.md) | Loop-hygiene guards: advisory repeat-call reminders + the `tools/execute` deadline enforcer | Product — stable surface |
| [`bundle/`](bundle/README.md) | Installable `tianshu --profile` patch layers | Product — stable surface |
| [`self-modification/`](self-modification/README.md) | Self-modifying runtime: inspect live plugins/services, mount/unmount model-written plugins ([design](../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)), restricted repository Plugin loading | Product — stable surface |
| [`hooks/`](hooks/README.md) | Hook bridges + the shared Claude Code / Codex wire-protocol library | Product — stable surface |
| [`session/`](session/README.md) | Durable session data plane: persistence seam + JSONL/SQLite backends, projections, log-backed titles, reporting | Product — stable surface |
| [`session-query/`](session-query/README.md) | Session retrieval: bounded corpus reads, lineage, event relationships, semantic filtering, SQLite full-text search | Product — stable surface |
| [`settings/`](settings/README.md) | User-settings seam + file-backed provider | Product — stable surface |
| [`credentials/`](credentials/README.md) | Credential-reference seam + env-over-`.env` provider | Product — stable surface |
| [`storage/`](storage/README.md) | Non-session storage hub + backends + domain form | Product — stable surface |
| [`workspace/`](workspace/README.md) | Workspace entity | Product — stable surface |
| [`scaffold/`](scaffold/README.md) | Create/launch/drive project tooling: helper, launcher, initializer, wire protocol, telemetry | Product — stable surface |
| [`acp/`](acp/README.md) | Automation-only Agent Client Protocol server | Product — stable surface |
| [`interaction/`](interaction/README.md) | Human-collaboration plane: approval/interaction seams, permission preset, commands, ask-user tool | Product — stable surface |
| [`boot/`](boot/README.md) | Shared app-bin boot glue | Product — stable surface |
| [`host/`](host/README.md) | Web-GUI host half: API gateway + HTTP route server | Product — stable surface |
| [`client/`](client/README.md) | Web-GUI browser half: shell, wire, object services, slots, `ui-*` plugins | Product — stable surface |
| [`tui/`](tui/README.md) | Interactive terminal UI: profile bundle + ported render core | Product — stabilizing |
| [`examples/`](examples/README.md) | Demo bundles (agent-spine + CLI/ACP/JSON-RPC bins) leaves load | Support — example infra |
| [`support/`](support/README.md) | Support infrastructure (testkits, invariants, replay, Loader smokes) | Support — lower compatibility expectations |
| [`util/`](util/README.md) | Low-level zero-dependency utilities shared across groups (`Branded<B>`, Harness home/path helpers, timeout, retention) | Support — small, stable, harness-dep-free |

New packages join existing groups; new groups update their README and this table.

## Dependencies

The dependency graph is generated: [docs/module-graph.md](../docs/module-graph.md) (`pnpm run gen-module-graph`, freshness-gated in CI).

**Extension plugins depend on Service Definitions, never concrete providers.** `dsh-agent-loop` is swappable; UI, hook, and tool plugins use `dsh-agent`. Composition bundles, including `dsh-agent-spine-demo`, may depend on spine plugins. Capabilities separate Service Definition / Service provider / Consumer roles when they evolve independently; see [capability seams](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md).

Package READMEs cover purpose, APIs, extension points, and [Model Experience](../docs/cookbook/adding-a-package.md#4-write-the-package-readme) unless on the model-agnostic [omission allowlist](../scripts/verify-package-readme-model-experience.ts). They also carry `## Known Limitations and Deferred Work` or use its [allowlist](../scripts/verify-package-readme-limitations.ts).
