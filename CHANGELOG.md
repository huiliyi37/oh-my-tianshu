# Changelog

English | [中文](CHANGELOG.zh.md)

## 2026-08-19 — 0.3.0

0.3.0 is the first product cut after the 2026-08-12 TUI landing. New top-level TUI sessions start in a zen phase, first messages can become task cards or pass through an intent-alignment bridge, test runs and JSON-in-content tool calls have dedicated plugins, and the live area uses one card language for tools, subagents, and background tasks.

### Zen phase (`dsh-zen`)

A fresh top-level session's first steps run on a minimal anchored face — DeepSeek's evaluation recipe (`bash`, `str_replace_editor`, `todo_write`) plus agent-scoped `zen_anchor` — until a host-verified predicate promotes to the full face (`d0345e66`). Promotion is `zen_anchor` (goal + landmarks + evidence), a step-budget timeout, or first-message triage for trivially short prompts; the model's own claim of readiness is never trusted. After promotion the TUI hides stacks that compete with `bash` (`promoteDeny`) and clips tool descriptions (`c9b3641a`). Subagent sessions never arm. Alignment sessions from the intent bridge are seeded already-promoted so they do not re-enter zen.

### Task card and intent bridge

`dsh-task-card` rewrites the session's first user message into a structured card (`# title`, goal / constraints / acceptance, verbatim original under a marker) via a bounded LLM call with a semantic-template fallback (`1dcaac77`, `387f940c`). `dsh-intent-bridge` splits a fresh session: a low-cost alignment model clarifies in a dedicated session, then `finalize_alignment` hands the card to a fresh main session that never inherits the alignment context (`b4af3a63`, `08d0dbcf`). The main session follows the parent's cwd and the live `/model` selection, including reasoning effort (`545cf209`, `a9ea3806`). The shipped TUI mounts both; the product alignment route uses DeepSeek flash (`5de8be64`).

### Memory family

`dsh-tool-memory-recall` adds `memory_deep_recall` on the shipped TUI full face (not the zen face): a read-only in-process reader subagent distills session-query hits so raw transcripts never enter the main context (`256fa609`). `/remember` and `/memory` on the shipped Web bundle are owned by `dsh-command-memory` (`a46dcb56`); TUI keeps its private registry and does not mount that plugin. `dsh-memory-sqlite`, `dsh-adaptive-memory`, and `dsh-memory-consolidate` are on the tree and out of every shipping composition (`635ce8e7`, `7482e836`). `tool-memory` digest injection is off by default (`dc5e12a5`).

### Test runner, JSON repair, doom-loop guard

`dsh-tool-run-tests` registers `run_tests` and `related_tests` on `ctx.tools` and is wired into `dsh-base` (`45e7d2ab`). `run_tests` executes through the bash seam with framework detection; evidence-gate accounts an explicit command as-is, a path-only call as `run_tests <paths…>`, and a bare call as `run_tests`. `related_tests` fails loud when the target resolves outside the session cwd (`94e30c0e`). `dsh-tool-json-repair` wraps `llm/stream`: a text block that is exactly one JSON object with a tool `name` is re-emitted as a tool-call stream so DeepSeek JSON-in-content responses execute (`45e7d2ab`). `dsh-doom-loop-guard` sits beside repeat-tool-guard and injects advisory reminders for oscillating call pairs, failing same-path edit spirals, and unchanged failing test runs (`45e7d2ab`, `b256a630`).

### TUI live area and delegation

Process-like live rows share one card language: in-flight `⠋`, success `›`, error `✗`, body lines `⎿` (`10558e6d`). The `/subagents` tree carries child progress (activity, tokens, tool count, elapsed, terminal word) and `/subagents kill` stops a live continuable descendant (`288b4095`). Input: vim double-Esc no longer opens rewind; Ctrl+C states that it exits the process; CSI u Esc interrupts; long input stays responsive (`0049197e`, `3b3e5942`, `b67e8f4f`).

### Upstream rc.7 backports

`node-pty` 1.2.0-beta.15 (`865810e5`); max-tokens replay envelope alignment (`ae694c20`); Safari input-box wrap recovery (`bc4e7a25`); large-history pagination without a spread that overflowed the stack (`041577ae`).

### Other

Meridian's on-disk library is `dsh-meridian.db`, so it no longer collides with a 天枢 schema-2 database in the same cwd (`3e37f191`).

## 2026-08-12 — 222 commits since the 2026-08-09 baseline

The baseline snapshot `snapshots/20260809T140917Z` precedes 222 commits (2026-08-10 to 2026-08-12). The release adds a full terminal UI, a verification gate, code intelligence, and session durability, on top of the SDK's plugin spine.

### Terminal UI (`dsh-tui`)

A complete TUI front end ported from the Tianshu (opencode-tui) render core and adapted to dsh seams (`1b38b2d` seeds a runnable `examples/tui`). Input: slash command registry with a grok-style dropdown menu — fuzzy prefix matching, ↑↓/PageUp-Down selection, Tab accept, Enter submit, MRU ordering, and input-line ghost previews (`3fe76db`, `b45ff36`); `@`-path Tab completion and `@`-mention expansion; vim mode; external editor (Ctrl+O); history search (Ctrl+F); `/model` hot-swap of the live session. Conversation stream: markdown rendering, tool family coloring/timing, parallel tool-group folding, fluency policy, turn-status line, top bar (cwd/branch/model), and a three-row bottom area (input → footer → metrics) per the C4 concept draft (`c4760b9`); subagent runs render as spinner lines that settle into ✓/✗/◌ scrollback entries (`8c3586e`). Commands: `/session /fork /branch /model /theme /clear /compact /steer /status /config /skills /subagents /workflow /tasks /goal /memory /rewind /btw /doctor /mcp /density` plus a `/permission` preset switcher. Interaction: inline approval with unified diff preview, structured questions, plan/auto mode cycling, `/rewind` two-phase rollback, and keymap/command-palette overlays. Architecture: C4 split extracted controllers (approval/question/session), O(1) glance metrics, perf monitor, and a projection bus (5 domains) driving the panels.

**Input surface: clipboard and image paste** (opencode-tui input port, `c1951fb`): `Ctrl+V` reads the system clipboard image with a clipboard-text fallback; right-click / terminal-menu paste detects a clipboard image first (attaching it and swallowing the byte garbage), pasted text that looks like an image path loads as an attachment; vim yank / `Alt+W` selection copy drains to the system clipboard via OSC52; attached images render as a `📎 N images` marker above the input line and, on submit, as inline terminal graphics (kitty / iTerm2) under the user bubble. The user bubble carries a vision hint — image forwarded / bridged via a vision model / not sent when no bridge is configured.

### Verification gate (`dsh-evidence-gate`) and routing (`dsh-agent-router`)

`dsh-evidence-gate` enforces RED-first verification: obligation state machine, edit/verification counters, TDD gate with `enforce` mode, probe suggestions with cooling, and a final L2 gate (`1db1b35`, `604d500`, `4b450f0`, `61bacba`), wired natively into `str_replace_editor` and headless-agent assemblies. `dsh-agent-router` predicts step failure from turn history and routes work — including verifier subagent scheduling and per-profile tool restrictions — with real-turn e2e coverage (`d458e36`, `5f63ea2`, `7651b95`).

### Code intelligence and search

`dsh-semantic-index` (BM25 + salience/RRF/vector fusion, incremental updates) with the `semantic_search` tool (`26fe3c3`, `98613eb`, `3090d3e`); `dsh-meridian` code index — node:sqlite schema, tree-sitter parsers for TS/Python/Go, graph/impact/flow queries, behavior signals, background backfill — exposed as `repo_graph` plus a `<codebase-index>` summary (`2c954b0`–`c5f4253`); `dsh-pheromone` file-level stigmergy with atomic JSON persistence (`68855eb`), surfaced through `file_info` and read-tool `focus` semantics (`9f9bb98`, `e410eab`).

### Session durability

`Session.truncate` rewinds the event log with derived-state reset (`62d1e76`); persistence backends gained `deleteFrom` and a truncate coordinator so rewind survives reload (`e4a057e`); `dsh-fs-snapshot` ports the opencode-tui FileHistory (trackEdit/rewindToBoundary) and snapshots write tools before execution (`277657e`, `c6764f5`).

### Memory

`dsh-memory` (MemoryService + Markdown-file backend, non-git fallback) and `tool-memory` (`memory_save`/`memory_search` with summary injection) provide cross-session recall (`0a09830`, `4ba2d00`).

### Model and engineering

`dsh-llm-deepseek` gained spark reasoning tail truncation (`d17b414`) — wire-level tail-N reasoning passback (flash 300 / pro opt-in), paired with `dsh-spark-anchors` excluded-path anchor compensation (`3bcae85`, `f336a60`) and `/model spark-flash|spark-pro` one-key switching (`360adc3`); `lint-budgets` ratchets type-aware lint debt per file (`3c82af2`); docs were consolidated — doc-typecheck zeroed, i18n pairing enforced, the C5 Claude Code benchmark recorded (`617ffac`), and the AGENTS.md word budgets relocated.

**Image messages and the vision bridge** (`d6be933`, `bda91b1`): an `image` ContentBlock joins the merge-extensible content vocabulary, and `dsh-llm-deepseek` serializes user image blocks to OpenAI-style `image_url` content parts — user-supplied images reach the wire end-to-end (clipboard → input line → session → model request). `dsh-vision-bridge` (new `context/` plugin) covers text-only primaries: at `agent/pre-step` it describes image attachments through a dedicated vision model (`purpose: 'vision-description'`, prompt auto-selected between generic structure and OCR-level transcription on UI/error keywords) and injects the description as a plugin-source user message — model-visible ⟺ logged, with bridge failure degrading to a visible note instead of failing the turn.
