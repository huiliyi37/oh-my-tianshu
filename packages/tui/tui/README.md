# dsh-tui

English | [中文](README.zh.md)

Interactive terminal UI: the TUI layer for `oh-my-tianshu --profile`, riding on top of dsh-base through a bundle patch (stable plugin id `tui-runner`). The render core is ported from the Tianshu terminal engine (Apache-2.0, file-by-file provenance in [SOURCE-MAP.md](SOURCE-MAP.md)), and agent state always arrives through session events and the projection bus — the engine is a pure presentation layer with no agent logic.

## Assembly

```yaml
# cordis.yml（examples/tui 是可运行样例；bundle patch 自动插入同一行）
- id: tui-runner
  name: '@huiliyi37/dsh-tui'
```

The shipped bundle patch (cordis.patch.yml) mounts, besides `tui-runner`: spark-anchors, the vision bridge, and the tianshu-side capability roster — fs-snapshot (`/rewind` file restore), the memory service plus memory tools (including `memory_deep_recall`), the cross-session query tools, evidence-gate, zen (the anchored first-face phase; the top status bar shows a `禅` badge while armed; `memory_deep_recall` is not on the zen `face`), agent-router, and agent-presets (`default: standard`; the shipped read-only root is injected by `composeProfile`).

`TuiRunnerConfig` (all optional):

| Field | Semantics |
|---|---|
| `stdin` / `stdout` | Stream injection (test doubles); defaults to the process global streams |
| `initialSessionId` | The session to enter at startup; defaults to creating a new one |
| `editorKey` | External-editor trigger key (Phase 6.4); defaults to `ctrl_o` |
| `vimEnabled` | Vim keybindings (Phase 6.5); defaults to `false` |
| `vision` | Primary-model vision capability and bridge state for the image-attachment bubble hints (`supportsVision` / `bridgeEnabled` / `bridgeSource`); derived by the assembler from the vision-bridge plugin config — when absent, `bridgeEnabled` is auto-probed from the `visionBridge` service the plugin provides at apply time |
| `workflowHistoryLimit` | Settled workflow-run cache cap for the `/workflow` panel, drop-oldest beyond it; positive integer, defaults to `50` |
| `lsp` | LSP diagnostic bridge: `enabled` (default `true`) / `timeoutMs` (default `2000`). Lazy per-extension language servers pull diagnostics when the agent touches a file; shown on tool-card badges and the `/lsp` panel. Display-only — no session events, no model-facing surface |

**Input-box clipboard and image paste** (ported from the opencode-tui input surface): `Ctrl+V` reads the system clipboard image (falling back to clipboard text); right-click / terminal-menu paste detects a clipboard image and attaches it instead of inserting the byte garbage, and pasted text that looks like an image path is loaded as an attachment; attached images render as a `📎 N images` marker above the input line and, on submit, as inline terminal graphics (kitty / iTerm2) under the user bubble. Vim yank / `Alt+W` selection copy drains to the system clipboard via OSC52. The user bubble carries a vision hint — image forwarded / bridged via a vision model / not sent (no vision bridge configured).

**Composer keys.** Esc and Ctrl+C abort a busy turn (`⏹ 已取消`); a second Ctrl+C inside the 2s window exits the process even if the turn is still marked busy. Idle Esc does not quit; double-Esc opens rewind (user checkpoints only; Esc or Ctrl+C closes the list; Esc on the granularity step returns to the list) unless vim is enabled (then `/rewind`). An idle first Ctrl+C arms the 2s window (a non-empty line clears the draft first; Ctrl+Z restores it); the second press exits the process. The hint above the input says the next Ctrl+C leaves the process. Kitty keyboard protocol flag 1 encodes Ctrl+letter as CSI u (`CSI 99;5u` for Ctrl+C), which the input decoder maps onto the same `ctrl_*` names as the legacy C0 bytes. `Ctrl+J`, Alt+Enter, and a trailing `\`+Enter insert a newline. Shift+Enter toggles sticky newline mode when the terminal emits Kitty/xterm enhanced keys (attach enables protocol flag 1); while on, Enter inserts a newline and Shift+Enter leaves the mode. Bracketed paste inserts the whole segment; a paste of 100+ lines or 10,000+ characters collapses to `[paste #N +M lines]` and expands on submit (below that, pasted text stays fully editable in the draft). The input viewport shows at most about one third of the terminal height (3–16 rows), with `… 上 N 行` / `… 下 N 行` overflow hints; Up/Down move by wrapped visual rows, and PageUp/PageDown page the draft. Session tab labels strip the `session-` prefix.

**Session rendering surface** (Claude Code benchmark): settled tool cards commit into scrollback in real time at `tool/result`, consuming the harness presenter intent (`presentCall`/`presentResult`) through a soft-degrading bridge (`adapter/tool-view.ts`) — `diff` results render structured red/green file diffs (shared with the approval preview via `renderFileDiff`), `terminal` results render command title + cwd + exit/signal badge, everything else falls back to text-folding cards. The think/reasoning channel streams as a shimmer header (`✻ 思考中…`, tick-driven band sweep, static on 16-color terminals) plus a dim tail in the live area, and settles as a folded header in scrollback at segment end (`✻ 思考 (3.2s) · 12 行`) — the full text is hidden by default (competitor-aligned) and revealed on demand with `Ctrl+O` in the live area (scrollback is append-only; aborted turns discard the buffer; compact mode keeps the header line only). Resume/attach replays through the same bridge with messages and tool cards interleaved by event seq, so live and restored transcripts render identically.

**LSP diagnostics** (ported from the Tianshu LSP stack): when the agent touches a file, the bridge lazily launches a language server for its extension (TypeScript via `npx -y` by default; pyright/gopls/rust-analyzer/clangd/jdtls probed on PATH) and fetches diagnostics — shown as a `⚠ N错 M警` badge on the live tool card and grouped by file in the `/lsp` panel. Diagnostics live only in the TUI's local display cache: no session events are written, no model-facing surface is registered, and all servers are killed on dispose. An external `getDiagnostics`-shaped service (`provide('lsp')`, e.g. the dsh-lsp companion plugin) is consumed when present, sharing one server set with the model tool surface; the official `ctx.lsp` seam is adapted via its `query(getDiagnostics)` operation and yields empty diagnostics until the operation lands upstream.

Service dependencies: `sessions`/`agents`/`agentDefaultModel` are required; `goals`/`subagents`/`agentPresets` are optional — when unassembled, the `/goal` command, the delegation-tree panel, and the `/preset` command degrade (fails loud reporting unavailability, never swallowing silently). `/session list` titles fold the official `session/title` events assembled in `dsh-base`. The TUI also registers the `userInteraction` provider (in-terminal question answering) and subscribes to `approval/request` (pending approval cards).

## Layering

- `src/engine/` — the terminal render engine (live region / scrollback commit / input line / images / performance monitor), the ported layer
- `src/ui/app.ts` — TuiApp assembly and session mounting (pending approvals/questions, panel visibility, slash dispatch, rewind overlay)
- `src/adapter/` — adapts dsh session/agent services to `TuiPort` (the engine only knows the port, never ctx)
- Panel projections (`projectXxxPanel`) are pure functions; the pending-state state machines are extracted into controllers (`src/controllers/`, see docs/tui-controllers.md), and the [C4 split plan](../../../docs/dsh-tui-拆分方案-c4.md) keeps thinning app.ts

## Verification

```sh
NO_COLOR=1 pnpm vitest run packages/tui/tui/tests/
```

## Model Experience

None, as the TUI renders logged session events and forwards ordinary user input; it registers no prompt, tool, or context surface.

#### KV Cache effect

None directly; user input submitted through the TUI becomes ordinary logged messages whose request effects belong to the session and loop packages.

## Known Limitations and Deferred Work

- **LSP needs local language servers** — diagnostics require a language server installed per extension (TypeScript via `npx -y` is assumed available; pyright/gopls/rust-analyzer/clangd/jdtls need PATH entries). The official `ctx.lsp` seam (`dsh-lsp`) currently exposes no `getDiagnostics` operation, so an assembled official seam is detected but yields empty diagnostics until the operation lands upstream; without any `lsp` service, the built-in bridge spawns servers itself.
- **Image re-interrogation is opt-in** — the ask_image tool and session image registry are ported as the standalone `dsh-vision-ask` plugin, which requires an explicit vision model (`model`/`baseUrl`/`apiKeyEnv`) and therefore ships commented-out in compositions; the vision bridge (`dsh-vision-bridge`) covers the one-shot submit-time description path, and repeated same-angle descriptions still re-call the vision model (no description cache).
- **app.ts monolith (~2.2k lines)** — the pending-state state machines are controller-ized (question/approval), while render composition and key arbitration remain in app.ts; the C4 split plan (pure-function panel segments) keeps advancing. dispose already releases the interaction/taskDone/taskSurface/subagent/workflow disposers, and switching sessions settles pending approvals/questions (fail-closed).
- **Engine I/O file coverage exemptions** — terminal-boundary files such as input-line/live-engine sit on the coverage exemption list in vitest.config.ts (`TODO(tui)` comments), to be digested gradually as the real composition-test line matures.
- **Orphan controllers converged** — `engine/stream-render-controller.ts` and `engine/tool-group-controller.ts` proved semantically unequal to the app.ts inline logic after case-by-case comparison (StreamRender lacks the fluency handling for tool/call·tool/result·turn/end; ToolGroup lacks the compact parameter), so the extractions were deleted per the C4 Wave 3 criterion (the app.ts inline logic stays). The underlying primitives (StreamRenderer/BlockStreamWriter/formatToolCard/format-tool-group) remain and keep their own tests.
- **User-level TTY acceptance is blocked** — the agent sandbox cannot drive a real terminal for manual acceptance; behavioral evidence rests on unit tests and real composition tests.
- **Projection models partially wired** — turn-summary and summary-state are driven by the App body (turn-end summary line; `/compact` reads summary-state directly), while activity-status/activity-store landed as pure folds with specs but nothing drives them (only the fluency chain consumes the `ActivityPhase` type); the designed cache-telemetry/cache-panel-source/history-replay/adapter-projections are unimplemented. Current state is recorded in [docs/projection-layer.md](docs/projection-layer.md).
