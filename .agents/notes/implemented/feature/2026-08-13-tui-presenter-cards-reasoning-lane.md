# Agent Note: TUI session rendering parity — presenter tool cards + reasoning lane

Status: implemented

English | [中文](2026-08-13-tui-presenter-cards-reasoning-lane.zh.md)

## Problem

Three session-rendering surfaces fell short of the Claude Code benchmark. Settled tool output was invisible: `app.ts` `handleStreamEvent` fed `tool/result` only into fluency stats, so the live pending card vanished the moment a result arrived and nothing entered scrollback; `renderToolRows` ran once at attach, and in the wrong order (all messages, then all tool cards, not interleaved by event sequence). The harness presenter contract (`packages/core/tools` `presentCall`/`presentResult` → `diff`/`terminal`/`generic` cards, implemented by the fs/bash/git/web tools and consumed by apiproxy `viewFor` on the Web surface) was entirely unconsumed by the TUI, which instead sniffed result text for diff-likeness. And think/reasoning was dropped on the floor: the live path discarded `reasoning-delta` chunks, and transcript folding dropped `ReasoningBlock`s from committed messages while mixing reasoning into the streaming text on resume.

## Decision

Tool settlement and reasoning now flow through dedicated pure-function layers, consuming the harness presenter intent with soft degradation everywhere:

- **Presenter bridge** (`src/adapter/tool-view.ts`): mirrors apiproxy `viewFor` — optional `tools` service via `ctx.reflect.get`, `JSON.parse` the raw arguments, call `presentCall`/`presentResult` inside one try/catch. Missing service, unregistered tool, unparsable args, presenter throw, or presenter `undefined` all yield an empty intent and the renderer falls back to text cards; presentation failure never interrupts the session stream.
- **Card renderers** (`src/format/tool-view-card.ts`): `renderFileDiff` renders a structured `FileDiff` via `structuredPatch` (Myers, ±3 context) with `+`/`−`/context/gap rows; `oldText: null` renders as pure additions. The diff card folds >10 changed lines into a stats line (`N 处修改 (+A −D)`), full on `expanded`; the terminal card renders command title + `cwd` header + exit/signal badge + family-height output folding; `generic` and every other card kind fall back to `formatToolCard` text folding (a `generic` `content` block overrides the model-facing text). `permission-diff.ts` now uses the same `renderFileDiff`, so approval previews and settled cards share one diff dialect (`+ `/`- ` prefixes carry a space). Header and body vocabulary (`formatToolCardHeader`, `indentToolBody`) is shared with `formatToolCard`.
- **Settle commit** (`app.ts` `tool/result` branch): look up the paired call in the transcript, resolve views through the bridge, render, then chain the commit after `flushStream()` so streamed text precedes its card in scrollback; the live pending card's title takes the `presentCall` title when present (`pendingCallTitles`), falling back to the `toolArgSummary` heuristic.
- **Reasoning lane** (`src/format/reasoning.ts` + `app.ts`): `reasoning-delta` accumulates in a dedicated buffer; the live area renders a shimmer header (`✻ 思考中… (Ns)`) plus the last 3 lines in dim italic above the stream tail. Segment boundaries — first `text-delta`, `tool/call`, `assistant/message`, or a non-aborted `turn/end` — commit a static header plus the full reasoning text (dim italic, never the markdown pipeline) into scrollback and clear the buffer; aborted turns discard it. `compactMode` keeps the header line only, in both states.
- **Shimmer header** (`src/format/shimmer.ts`, style source: the user-provided deep-diving.gif): tick-driven (the existing 120ms loop; 15-tick period ≈ 1.8s matches the GIF), per-display-column cosine falloff interpolating base → highlight (base = `theme.primary`, highlight = base mixed 65% toward white), quantized to 7 steps with adjacent same-color runs merged into one escape. CJK-wide characters occupy 2 columns in band positioning. 16-color track (unparsable hex) degrades to a static colored line; scrollback settle freezes the header to static dim (the GIF's extinguish frame — animation physically cannot exist in committed text).
- **Transcript/resume consistency** (`src/adapter/transcript.ts` + `src/ui/render.ts`): `TranscriptMessage`/`TranscriptStream` carry a separate `reasoning` field; `TranscriptToolCall` gains `seq`/`time`. `renderTranscript` interleaves messages and tool cards by `seq` and renders the reasoning block before the body; the resume path resolves cards through the same presenter bridge (presenters are pure functions of args, and the bridge soft-degrades, so replay is safe).

## Testing

- New specs: `tool-view.spec.ts` (bridge degradation paths + meta passthrough), `tool-view-card.spec.ts` (diff modify/create/fold/expand/compact/multi-file; terminal badge/cwd/fold/empty; generic override and fallback), `reasoning.spec.ts` (both states, compact, truncation), `shimmer.spec.ts` (determinism, period wrap, off-text tick, CJK band positioning, named-color degradation).
- `render.spec.ts` asserts seq interleave (text → card → text), reasoning-before-body, and presenter injection via `resolveViews`; `adapter-transcript.spec.ts` asserts reasoning/text separation in streaming and committed folds.
- `app.spec.ts` integration: `tool/result` → settled card in scrollback with streamed text preceding it; presenter wiring through a mocked `tools` service renders a structured diff card; `reasoning-delta` → live visibility then full-text settle on the first `text-delta`; aborted turn discards the buffer. Full tui suite green (`env -u DEEPSEEK_API_KEY`; the footer `API ✗` case reads the real environment). `tsc` host face clean.

## Files

- `packages/tui/tui/src/adapter/tool-view.ts` (new), `src/format/tool-view-card.ts` (new), `src/format/reasoning.ts` (new), `src/format/shimmer.ts` (new)
- `src/ui/app.ts` (settle commit, reasoning lane, pending titles), `src/ui/render.ts` (seq interleave + presenter cards), `src/adapter/transcript.ts` (reasoning/text separation, tool seq/time)
- `src/format/tool-card.ts` (shared header/body/verb exports, live title override), `src/format/permission-diff.ts` (shared `renderFileDiff`), `src/format/tool-meta.ts` (canonical `parseToolArguments`), `src/engine/ansi.ts` (`hexToRgb` export)
- `packages/tui/tui/package.json` + `tsconfig.json` (dsh-tools peer/dev dependency + project reference)

## Alternatives considered

**Keep sniffing result text for diff shape** — rejected: the harness already declares render intent per tool; text sniffing misclassifies, cannot carry structured `FileDiff` (old/new text), and has no channel for exit codes or cwd.

**Render reasoning through the markdown pipeline** — rejected: reasoning is the model's scratch stream; markdown re-wrapping mangles partial syntax mid-stream and costs a per-frame re-measure. Dim italic raw text matches the Claude Code look and is cheaper.

**Animate the reasoning header in scrollback** — rejected as physically impossible: scrollback is committed text. The header freezes to a static dim line on settle, which also matches the GIF loop's extinguish frame.

**Structured cards for search/read/web in this batch** — deferred: generic text folding already covers them acceptably; a second batch follows once presenter coverage and the fold vocabulary stabilize.

**Hardcode the GIF's blue for shimmer** — rejected: colors derive from `theme.primary` so every theme keeps its identity; the default theme lands near the GIF palette anyway.

## Consequences

- Tool results and full reasoning text now persist in scrollback, matching Claude Code; scrollback volume grows accordingly, and `compactMode` keeps reasoning to a single header line as the relief valve.
- Approval previews and settled diff cards share one renderer, so the diff dialect changed once (`+ text` with a space); the old `+text` assertions were updated with the behavior.
- Presenter failures are deliberately invisible (soft degradation, no logging): a broken presenter shows up as a plain text card. Debugging one requires the Web surface or unit tests, which is the accepted price for never letting presentation break the session stream.
- Resume/attach and live streaming now render through the same bridge and the same seq interleave, eliminating the attach-order divergence as a class of bug.
