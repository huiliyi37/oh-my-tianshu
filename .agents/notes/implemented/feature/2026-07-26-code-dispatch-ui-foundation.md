# Agent Note: Code Mode UI foundation — run_code description and native-parity dispatch logging

Status: implemented

English | [中文](2026-07-26-code-dispatch-ui-foundation.zh.md)

> Scope: the host-side contract changes that let a UI render a Code Mode turn with the same fidelity as native tool calls — the first PR of the Code Mode web-UI stack. The [Code Mode foundation](2026-06-15-code-mode.md) owns the transport design; this note owns the model-visible `description` parameter, the full-content `tool/code-dispatch` payload, and the temporary `DSH_TOOLS_MODE` enablement switch for the `dsh` config tree.

## Problem

A `run_code` turn was opaque in every product surface. The call card's title was the raw program text — unreadable at row width, and unlike `bash` (whose required `description` labels the card while the command rides the expanded input) there was no model-authored label at all. The `tool/code-dispatch` event carried only a 200-char, cwd-normalized `resultSummary` of each sub-call, so no UI could ever show what a sub-call actually returned: the planned web conversation view renders sub-calls through the exact components that render native `tool/result` cards, and a bounded summary cannot feed a native-parity card. And the `dsh web` composition had no way to enable Code Mode at all — the `tools` row pinned the schema default and the runtime was absent from the tree.

## Decision

Three changes, one per obstacle:

1. **`run_code` gains a required `description` parameter** (bash's exact contract: active voice, 5-10 words, shown in the UI; whitespace-only rejected at execute). `presentCall` now titles the card with the description and moves the program to `rawInput`. The prompt-side cost is a few tokens per call; the return is that every surface — TUI card, ACP title, web row — gets a human-readable label without parsing TypeScript.
2. **`tool/code-dispatch` logs the sub-call's complete model-facing outcome** — `content: ContentBlock[]` + `isError`, the `tool/result` vocabulary — replacing `resultSummary` and deleting the summarize/cwd-normalization machinery outright. A UI renders a sub-call through the identical code path as a native result, including error text and non-text blocks. The event stays log-only (`deriveMessages()` ignores it): nothing about model context changes.
3. **`DSH_TOOLS_MODE` env var on the `dsh` config tree** (`native`|`code`|`both`; unset keeps the schema default): the `tools` row reads it via `!!js`, and the worker code runtime is mounted unconditionally (Loader metadata is static, so no conditional row exists; a native boot only registers the service — workers spawn per run). This is an explicitly temporary configuration hook: per-session tool-mode selection owned by the web UI is the design goal, and the env var dies when that lands.

## Alternatives considered

**Keep a bounded summary (raised cap, or a cap + `truncated` flag).** Rejected: the stack's settled requirement is that sub-call rows and details render *identically* to native calls; any cap forces a second, degraded render path plus truncation UI. The cost accepted instead: a program that reads a large file logs the rendered content verbatim on the dispatch event — uncapped, outside spill policy, growing the session log by the same bytes. Spill integration for the logged copy is deferred to a later PR of this stack (the projection exists; wiring it into the bridge is mechanical once the event shape settles with the start/end pair).

**A `--tools-mode` CLI flag or profile key.** Deferred, not rejected: the flag grammar suggests permanence, and the profile json is user config — both would harden a seam the per-session design intends to remove. An env var reads as the workaround it is.

**Log the canonical `value` instead of rendered `content`.** Rejected: `tool/result` persists content, not values (the [canonical output contract](../architecture/2026-07-20-canonical-tool-output-contract.md)), and native parity means matching that exactly; values remain execution-local everywhere.

## Consequences

Session format keeps `SESSION_FORMAT_VERSION` 0 (pre-release churn does not bump; old logs with `resultSummary` simply carry an extra unread field and lack `content` — v0 makes no compatibility promise). Existing code-mode snapshot fixtures were re-recorded. Model-visible surface grew: the `run_code` schema (one required parameter) and every code-mode system prompt/tool-schema snapshot changed. The web UI stack (subsequent PRs) builds directly on the new event payload; live per-sub-call running state needs a dispatch start/end pair that will reshape this event again.
