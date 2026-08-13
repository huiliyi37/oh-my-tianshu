# @deepseek-ai/dsh-tool-cordis

English | [中文](README.zh.md)

The self-referential Cordis toolset: three model-facing tools over the live runtime in the current DSH process. Design home — sandbox semantics, temporary-plugin lifecycle and composition, the generated API catalog, standing decisions: [the toolset Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md).

## What it does

- `cordis_inspect` — read-only report over the current process: services, all live plugin fibers, registered tools, the `cordis_mount` temporary-Plugin subset, and the catalog-backed `api` / `events` references. An exact `name` with `what: "api"` or `what: "events"` narrows the report and adds the original source JSDoc.
- `cordis_mount` — evaluates model-written JavaScript now and saves it nowhere; the code must return an in-memory temporary Plugin tracked as `dyn-<n>`.
- `cordis_unmount` — unmounts one `dyn-<n>` temporary Plugin and returns only after its owned effects reach quiescence. It cannot remove Loader, configured, or installed Plugins.

Exact model-facing schemas: [the generated tool catalog](../../../docs/tool-catalog.md).

Canonical successes are the inspection string, mount `{ id, pluginName, state, provides, waitingFor }`, and unmount `{ id, pluginName }`. Native rendering says whether the temporary Plugin is running or pending and that it remains available until unmounted or DSH restarts; unmount confirms that it was removed.

Temporary Plugins live only in the shared DSH process memory. They remain active across later turns and may affect other sessions in that process, but disappear after `cordis_unmount`, toolset unload, or DSH restart. They create no Plugin file, install no package, change no `cordis.yml` or personal/project configuration, do not survive restart, and cannot be promoted automatically. To keep an experiment, ask the Agent to implement a normal local, project, or repository Plugin through the regular development workflow.

## Trust stance

The sandbox isolates globals but is not a security boundary. Node globals are absent or redirect to Cordis services such as `ctx.fs`, `ctx.web`, and `ctx.bash`, and writes to `globalThis` stay local, but host-realm helpers make escape possible. Mounted plugins receive a façade without framework internals, yet its allowed services affect the live runtime. Dynamic tool schemas and annotations cross the realm through iterative JSON cloning and schema normalization, so valid deep declarations are memory-bounded rather than call-stack-bounded; records with JSON-invisible keys and subclassed or decorated schema arrays reject before normalization. Treat this toolset like bash access; see the [design and trust stance](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md).

## Config

| Field | Default | Meaning |
|---|---|---|
| `vmTimeoutMs` | `5000` | Bound on the SYNCHRONOUS portion of temporary-Plugin code evaluation; an async body escapes it |

## The generated API catalog

`src/api-catalog.ts` is generated from the same Typert `FaceModel` projection as the [subsystem pages' generated regions](../../../docs/subsystems/core.md) and freshness-gated by `pnpm run verify-cordis-api` (in `doc-sync`) — never edit it by hand. `scripts/gen-cordis-api.ts` is a compatibility entry point for that unified projection, not a second collector. `cordis_inspect` intersects the committed catalog with the live service store at call time; it has no runtime Typert dependency. Broad `api` / `events` reports render summaries and signatures only; an exact `name` opts into the retained method/event JSDoc, and unknown or non-running service targets fail loud.

## Rendering

All three tools render `generic` cards (`read` / `execute` / `delete`); `cordis_mount` carries the temporary-Plugin code as `rawInput`. Presenters are pure functions of the args; results keep the default text rendering.

## Export shape

Namespace plugin: named exports `name` / `inject` / `Config` / `apply`, no default export ([docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Model Experience

### Tool schemas

#### What the model sees

The conversation model sees the generated [`cordis_inspect`, `cordis_mount`, and `cordis_unmount` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-cordis) whenever this plugin is visible.

#### Token effect

Fixed schema cost on every request in that tool view.

#### KV Cache effect

Prefix-stable while this tool view is unchanged. Scoping or plugin lifecycle changes that hide these definitions may invalidate reuse from the first changed schema token.

### Tool-call history and results

#### What the model sees

Inspect joins selected sections exactly as `## <section>` then a newline and the data-dependent body, with one blank line between sections; `what: "temporary"` uses the `## Temporary Plugins` heading. Each temporary-Plugin row reports running/pending state, provided and awaited services, and its lifetime until unmounted or DSH restart. The empty state explains that `cordis_mount` Plugins disappear on restart. Broad API/event reports omit JSDoc; `name` with `what: "api"` or `what: "events"` returns one exact target with its original JSDoc. Mount returns `Temporary Plugin <id> is running (...)` or `Temporary Plugin <id> is pending (...)`; unmount returns `Temporary Plugin <id> was unmounted and removed.` The submitted program remains in assistant tool-call history.

#### Token effect

Inspect output and mount code are data-dependent and resent until compaction; lifecycle acknowledgements are small.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Later requests after cordis_mount

#### What the model sees

A temporary Plugin may register tools, prompt contributions, or listeners that change later requests for the scopes it targets; `cordis_unmount` removes those contributions after quiescence.

#### Token effect

Indirect token impact equals the temporary Plugin's contributions and lasts only for its process-local lifetime.

#### KV Cache effect

Mounting or unmounting a prompt or tool contribution changes later request prefixes and may invalidate reuse from the first changed contribution; an unchanged temporary-Plugin set remains prefix-stable.

## Known Limitations and Deferred Work

- **The sandbox is containment for honest code, not a security boundary** — host-realm helpers on the sandbox global are reachable, so mount code can reach Node; load this plugin as deliberately as you would grant a bash tool (see § Trust stance).
- **The `ctx` façade exposes no `effect()`** — mount code cannot register a bespoke disposer; `on`/`provide`/`tools.register` are the supported cleanup paths.
- **`vmTimeoutMs` bounds only synchronous evaluation** — an async mount body escapes it; there is no async budget on mount code.
