# Agent Note: Upstream alpha.1 backflow wave 1 — prompt order table, JSONL provenance ranges

Status: implemented

English | [中文](2026-08-28-upstream-alpha-backflow-wave1.zh.md)

Scope: `packages/core/system-prompt`, `packages/core/session`, `packages/session/session-persistence-jsonl`, plus every first-party prompt-section registration site

## Problem

Upstream `deepseek-ai/deepseek-harness` cut `dsh-v0.1.2-alpha.1` — 1,079 commits past `dsh-v0.1.1-rc.2`, the exact point of this fork's last upstream fetch. Three shared-package hotspots were selected for a first small-step backflow wave: the system-prompt sparse order table, the persistence storage reduction (#3048), and the subagent model-routing arc. This note records what landed, and why the third item did not.

## Decision

**Sparse first-party section orders (upstream `43ac97b554`).** `FIRST_PARTY_SECTION_ORDER` centralizes every repository-owned prompt-section placement in one table whose adjacent values differ by at least ten, so inserting a new first-party section never renumbers its neighbors. Assembly sorting now breaks equal orders by section name in code-unit order — previously JS's stable sort delegated ties to registration order, which is composition-dependent; the `tool:git`/`tool:read`, `tool:bash`/`tool:pwsh`, and `tool:tasks`/`tool:pty` pairs had duplicate values and therefore nondeterministic cross-composition render order. The table gives those pairs explicit, distinct placements while preserving every previously-unique value's relative order. All 28 first-party registration sites now reference the table; `PERSONA_ORDER` aliases `DEPLOYMENT_PERSONA`; output-style's exported constant forwards to the table. External plugins may still use any finite order. A spec pins the table invariants (finite integers, unique, adjacent gap ≥ 10) so the design constraint fails mechanically rather than by review.

**JSONL provenance range encoding (upstream `df76bc695b`, JSONL side only).** `core/session` gains `seq-ranges.ts`: strictly increasing `sourceEventSeqs` fold runs of three or more into inclusive `[start, end]` pairs; everything else stays verbatim. The JSONL writer encodes provenance before serialization and the scanner expands it back, validating well-formedness (ranges strictly increasing, expansion bounded by the event's own seq). Old logs containing plain arrays read unchanged, so the optimization is read/write backward compatible and invisible downstream. Upstream's 501-session corpus measured −14.1% stored size with no material latency regression.

**Deliberately not ported from #3048: the SQLite side.** Schema 19 (zstd dictionary, 64 KiB pages, tagged delta/run encodings) stacks on the schema 15–18 compression line. This fork's `session-persistence-sqlite` sits at schema 14 with no compression layer; adopting #3048's SQLite half means migrating the physical format across five schema versions and re-training the dictionary against this fork's event shapes. That is a standalone decision, not a backflow step.

**Deliberately deferred: the subagent model-routing arc.** `user-authorized subagent model routes` (upstream `aefc083be7` and companions) is two stacked notes deep: it presumes the model-selected subagent routes base layer (route arguments on the delegation call, adapter preflight, a `list_subagent_models` discovery tool, fork cache restriction), plus a Host settings section, a composition-time policy event with child inheritance and resume replay, executor-level authorization enforcement, the generated persistence-catalog infrastructure, and a Web settings card served through remotes this fork does not run. This fork has the configured `agentOptions.provider/model` route but no discovery tool and no route-selection surface. Porting the authorization half alone would leave a half-built capability seam (Service Definition / Provider / Consumer roles split across repos); it needs its own wave with the base layer ported first, and a decision about which settings/UI surface carries the allowlist here.

**Also deferred: fail-closed session event vocabulary** (upstream `42dc2a46c2`). Our `core/session` has neither the generated `known-event-types.ts` nor the `ignorable` envelope marker nor the persistence-catalog generator that feeds them; the guard arrives with that generator and its doc-sync gate.

## Alternatives considered

### Why renumber the section table instead of keeping the old values verbatim?

Keeping `100–116` with gaps of 1 preserves the exact byte layout but recreates the problem the table exists to solve: the next tool section forces renumbering. The only behavior deltas are the three duplicate pairs, whose previous order was registration-dependent anyway — there was no stable behavior to preserve.

### Why not port #3048 wholesale by first porting the compression stack?

The compression stack is five schema versions of physical format evolution, each fail-loud against on-disk databases (`user_version` mismatch refuses to open). Porting it is a format migration with data-compat consequences for every existing local session, plus a dictionary re-training question — a project, not a step.

### Why not port just the executor enforcement of the model-routing arc?

Enforcement without the settings section, policy event, and discovery tool yields a seam that can only deny, never authorize or list: the Consumer role would exist with no Provider. The fork's "explicit at boundaries" rule applies to porting too.

## Consequences

Bought: a prompt-order table that makes section placement reviewable and insertion cheap, deterministic cross-composition section order, and a 14% JSONL storage reduction with full read compatibility. Owed: the model-routing wave (base layer first), the sqlite compression decision, and the fail-closed vocabulary decision — each now has its dependency inventory written down instead of rediscovered.
