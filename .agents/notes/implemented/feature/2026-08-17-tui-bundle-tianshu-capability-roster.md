# Agent Note: TUI bundle mounts the tianshu-side capability roster

Status: implemented

English | [中文](2026-08-17-tui-bundle-tianshu-capability-roster.zh.md)

## Problem

The product scope is a terminal-only harness integrating the tianshu-side capabilities; the web client is out of scope. Yet the shipped TUI profile (dsh-base + the dsh-tui bundle patch) mounted only `tui-runner`, `spark-anchors`, and `vision-bridge`. The TUI already ships command surfaces that probe optional services — `/rewind` fails loud on `fsSnapshot.histories`, `/remember` and `/memory` degrade without the `memory` service, `/preset` degrades without `agentPresets` (its activation was explicitly deferred to "when a host assembles `dsh-agent-presets`" in [the /preset note](2026-08-16-session-list-titles-and-preset-command.md)) — while the differentiated tianshu ports (`dsh-evidence-gate`, `dsh-agent-router`, the `dsh-memory`/`dsh-tool-memory` pair, `dsh-tool-session-query`, `dsh-fs-snapshot`, `dsh-agent-presets`) appeared in no shipped composition at all: dead command surfaces in the product, and capabilities that never reach a user.

## Decision

The dsh-tui bundle patch (`packages/tui/tui/cordis.patch.yml`) now inserts seven more rows over dsh-base: `fs-snapshot`, `memory`, `tool-memory`, `tool-session-query`, `evidence-gate`, `agent-router`, and `agent-presets` (`default: standard`, mirroring the web-app bundle). `package.json` declares each as a workspace dependency (the resolver-manifest requirement for bare plugins in a patch), moving `dsh-agent-presets` from devDependencies to dependencies.

Every row mounts with library defaults, chosen after reading each plugin's config contract: fs-snapshot backs up to `$TMPDIR/dsh-fs-snapshot`; memory stores under `<cwd>/.dsh/memory/`; tool-memory's digest injection defaults off (static capability guidance only; `digest: true` is a debug switch that rewrites the request prefix after every save) and tools fail loud when the memory service is absent; tool-session-query rides the `sessionQuery` service that dsh-base's `session-query-sqlite` already provides; evidence-gate defaults are mild (edit interception only for model-created high bugfix obligations, TDD gate in `suggest` mode — advisory, never blocking); agent-router's dispatch follows the subagent default route. The shipped read-only preset root is injected by `composeProfile` keyed on row id `agent-presets`, profile-agnostic, so the tui profile gets it with no app changes.

## Alternatives considered

**Mount the roster in dsh-base instead.** Rejected: base is the upstream-parity spine shared by the headless and web profiles; the scope decision concentrates the tianshu flavor in the TUI product bundle, and base stays a neutral foundation.

**Wire `dsh-vision-ask` too.** Rejected: its vision model is a required config with no safe default — defaulting a paid vision endpoint is a deployment choice, and misconfiguration must fail loud. It stays a commented opt-in row in `examples/tui/cordis.yml`.

**Hold memory back until per-user isolation lands.** Rejected: the workspace-scoped store is the documented current contract of `dsh-memory`, and the TUI already ships the `/remember`/`/memory` surfaces that expect it.

## Consequences

The shipped TUI profile gains model-visible surfaces — the `memory_save`/`memory_search` tools plus the static memory-guidance prompt section, the five session-query tools, and evidence/TDD guard messages — all flowing through the existing logged tool and request vocabularies; no new event types. `/rewind` file restore, `/remember`, `/memory`, and `/preset` activate in the shipped product instead of degrading. The TUI README documents the bundle roster in its Assembly section, and two stale Known Limitations entries were corrected in the same change (image re-interrogation is ported as opt-in `dsh-vision-ask`; turn-summary/summary-state are driven by the App body per docs/projection-layer.md), with the translation pair re-recorded.
