# TUI Chrome Closed Loops

English | [中文](2026-08-26-tui-chrome-closed-loops-design.zh.md)

## Goal

After `0.5.0`, pick the next TUI work by closing loops that already exist: one human key produces one card state, one durable record, and one live row budget — not by adding a default-on panel or merging the uncommitted sitting-fox welcome.

This spec is a decision, not an implementation plan. It does not change `agent-loop`, add a model-visible input, or ship the sitting-fox welcome.

## Cognitive alignment

User intent, verbatim: continue researching this project with grok-4.5 subagents, use internal and external references, and prefer closable feature convergence and iteration, including the interaction layer and panel drawing.

Problem levels:

- Primary: L2 wiring — human decisions, live composition, and durable records must agree.
- Related: L5 handoff (`[p]` persist vs settle) and live composition (`renderLive` + `LiveSnapshot`).
- Out of scope this round: L7 large patches, Web `allowed-always`, and the sitting-fox welcome WIP.

## Background

`TuiApp.renderLive` in `packages/tui/tui/src/ui/app.ts` is the live compositor. It builds a `LiveSnapshot` once per frame, then concatenates eight snapshot panel functions from `packages/tui/tui/src/render/live-panels.ts` (`renderGlancePanel`, `renderTodosPanel`, `renderTasksPanel`, `renderStatusPanel`, `renderDelegationPanel`, `renderWorkflowPanel`, `renderSkillsPanel`, `renderLspPanel`), then draws segments that are not on the snapshot: `/btw`, fluency, reasoning, stream tail, pending tool cards, and `formatActivityBand`.

Chrome that must stay on screen (question, approval card, input, footer) starts at `chromeStart`. `CommitEngine` owns settled scrollback. `LiveEngine` redraws the bottom region and can no-op when H2 line text matches. A 120 ms ticker still runs the full JavaScript assemble. An active overlay skips the whole live write; that skip is a contract, not a hole.

Core approval already uses five `ApprovalOutcome` values. `[p]` writes `match: 'exact'`. Web and remote decide stay `allowed-once` | `rejected` on purpose. `[a]` sets an in-memory `alwaysApprove` flag. Rewind truncates stored events; it does not append a rewind decision.

## Research findings

Scouts: GitHub TUI survey, kitchen/trading/alert HUDs, TUI code archaeology, and a fourth scout that attacked the first hypothesis.

| Source | Fact that survives |
| --- | --- |
| Codex / Gemini / Crush | Approval replaces or folds the composer; permission requests are serialized; welcome is a state, not a fake transcript row. |
| Claude Code | Status line is an external process and a second clock; tmux column races and full bottom-zone redraws are known failures. |
| Kitchen / blotter / alert board | Live and settled stay in different columns; confirm is an audit event; confirm lowers attention and does not pretend the condition vanished; incremental update must keep selection and scroll. |
| TUI code | Eight compositor-called panels are pure functions of `LiveSnapshot`; activity band and tool cards are not; Web two-value decide is documented as intentional; overlay pause is comment A6; `canAnimateWelcome()` is false. |
| Fourth scout | `Model-visible ⟺ logged` applies to model requests, not every human-visible row. Theme, tip, and panel visibility are a live control plane. Treating every second authority as a defect fights the shipped `frames` / `events` split. |

Hypothesis after disproof: the closable work is the leak between the two planes, plus the leftover live segments that never entered `LiveSnapshot` — not “log every chrome row” and not “unify Web decide”.

Evidence classes:

- Fact: rewind truncates; Web decide is two-valued; overlay skips live write.
- Status: activity band sits outside the snapshot; 120 ms assemble always runs; `[a]` is memory-only.
- Convention: 120 ms is the animation clock; no idle-assemble budget in CI.
- Assumption: “close the loop” means finish half-wired behavior, not add chrome.

## Round 1 — Variation

Niche: post-`0.5.0` TUI maintainer and operator; hard limits are no `agent-loop` rewrite, no new model-visible input without a session event, and no mixing sitting-fox WIP into this line.

Selection pressure: one key → one card + one durable record + one row budget that a failing test can pin today.

Occupied: standing-grant pentad, new default-on panels, Claude-style status-line subprocess. Empty: treat live vs settled the way a blotter treats Working vs Filled, without adding a panel.

| Id | Niche | One-liner |
| --- | --- | --- |
| V1 | Mainstream | Give Web and remote the same `allowed-always` answerer the TTY already has, so every channel writes the same standing grant. |
| V2 | Neighbor | Rebuild live chrome as a Codex-style bottom pane: one budgeted compositor owns panels, activity band, approval, and input. |
| V3 | Empty | Keep the two planes. Pin leaks (`[p]` disk vs card, `[a]` vs status line) and move activity band onto `LiveSnapshot` so Working rows and Filled scrollback cannot fight. |
| V4 | Mutant | Delete default chrome (intent-bridge handler, extra panels, 120 ms ticker) until three live regions remain: glance, stream tail, input. |

Founder assumptions: “closed loop” means finish existing wiring; interaction and panel drawing are the right layer; sitting fox is a different line.

Fitness: hard = one-key honesty + no new default-on panel; plus = a test that fails on today’s tree; minus = Web always-allow, new subprocess chrome, merging sitting fox.

## Round 2 — Selection

Re-injected request: find closable convergence, including interaction and panel drawing.

| Test | V1 | V2 | V3 | V4 |
| --- | --- | --- | --- | --- |
| Causal | Breaks: Web two-value decide is a channel role, not a missing answerer. | Holds if “one compositor” means snapshot + budget, not a rewrite. | Holds: leak → disagreeing card/disk/status. | Breaks: deleting `/todos` does not close `[p]`. |
| Cost | High and documented as a non-goal. | High if it rewrites `renderLive`; low if it only extends the snapshot. | Low: tests and snapshot field first. | High product cost for little honesty gain. |
| Co-evolve | Static: more wire, same TTY bugs. | Dynamic only when the snapshot is the live contract. | Dynamic: interaction tests force the compositor to tell the truth. | Static deletion. |
| Landable first step | Widen `approvalResponsePayloadSchema`. | Put activity-band inputs on `LiveSnapshot`. | Write the persist-vs-settle test, then the snapshot field. | Unsubscribe `intent-bridge/handoff` when disabled. |

Local-optimum trap: V1 looks like “finish the pentad” but expands a surface the standing-grant note deferred. V4 looks like convergence but skips the interaction leaks the user named.

| Fate | Id | Why |
| --- | --- | --- |
| Extinct | V1 | Intentional channel split; not closable work on this tree. |
| Extinct as a rewrite | V2 | Full bottom-pane rewrite is a new compositor. Keep the snapshot+budget trait. |
| Extinct as a product | V4 | Deleting operator panels does not close a key. Keep the dead-handler trait. |
| Survives | V3 | Hits both named layers; first steps are failing tests on today’s code. |

Salvaged traits: V2’s “activity band belongs on the snapshot”; V4’s “disabled intent-bridge must not subscribe”.

Strongest: V3 plus those two traits.

New finding: `renderSessionTabs` in live-panels is already unused by the compositor — that deletion already happened. Do not redo it.

## Round 3 — Adaptation

Cleared tropes: “unify every channel”, “log every human-visible row”, “status-line subprocess”, “overlay pause is a bug”.

Exaptation: `LiveSnapshot` already exists so a later compositor rewrite is unnecessary. Put activity-band inputs on it and let H2 keep skipping stdout. Kitchen recall maps to rewind as a destructive truncate with an explicit overlay, not as a new append event.

Who / where / act / result:

- Operator at an approval card on a TTY: `y` / `n` / `a` / `p` / Esc → card, disk rule, and status line agree, or the echo names which of the three failed.
- Operator on a running turn: the ticker or a resize → Working rows (activity band + pending tools) stay inside a cap; settled text stays in `CommitEngine`; optional panels stay behind their slash flags.
- Maintainer on this branch: write the failing tests first; do not open the sitting-fox welcome in the same change.

Convergence: V2, V3, and the kitchen/blotter split agree that live and settled must not share one unbounded list.

## Final plan

Ship V3 as two-plane honesty plus a chrome budget.

### Loop A — approval honesty

On the TTY, these three must be jointly true after every approval key:

1. `approval.peek()` is either this request or `null`.
2. A persisted allow rule exists if and only if `[p]` finished writing for this request.
3. Status-line “always” is on if and only if `alwaysApprove` is true in this process and this session.

`[a]` stays process-local. Restart must ask again. Do not persist `[a]` into YAML in this line.

If `[p]` finishes after the request is already `cancelled`, the card must stay settled as `cancelled`. The next matching ask may use the new exact rule. A test must pin that triple; today’s tree does not.

Do not widen Web or `apiproxy` decide to `allowed-always`.

Fix `mode-cycle` assertions so `[a]` / Shift+Tab cannot still expect `allowed-once` when the controller settles `allowed-always`.

### Loop B — live composition

`LiveSnapshot` becomes the only input to default-on live rows that are not chrome:

- Keep the eight gated panels as pure functions of the snapshot.
- Add activity-band inputs to the snapshot and stop calling `foldActivity` from `renderLive` beside it.
- Leave question, approval, input, and footer as chrome after `chromeStart`.
- Default-on Working rows: glance, stream tail, pending tool cards, activity band.
- Optional rows stay behind `/todos`, `/tasks`, `/status`, `/subagents`, `/workflow`, `/skills`, `/lsp`, `/btw`.

Row budget: chrome is never clipped from the top. Working rows have a max height. Settled text is `CommitEngine` only.

Idle frame: if the snapshot key and chrome key are unchanged, skip assemble. The 120 ms ticker may still advance shimmer `tick` when a spinner is visible. Overlay stay-paused remains the A6 contract.

### Loop C — dead entries

When intent-bridge is `disabled: true`, `attach` must not subscribe `intent-bridge/handoff`.

Sitting-fox welcome (`28` / `36` bands, sitting assets) stays a separate dirty-tree line. It must not land in the same change as Loops A–C. Published welcome bands stay `56` / `72` until that line has its own spec.

## Implementation path

### Phase 1 — pin the leaks

Actions: add the persist-vs-settle test; add the restart-still-asks test for `[a]`; align `mode-cycle` with `allowed-always`; add activity-band fields to `LiveSnapshot` and route `formatActivityBand` through them; unsubscribe disabled intent-bridge.

Output: tests fail on the pre-change tree and pass after the pin. No welcome asset change. No Web schema change.

Success: the three Loop A facts hold in TUI tests; `renderLive` no longer folds activity beside the snapshot; disabled intent-bridge installs no handoff listener.

Exit: if a test cannot name the disk/card/outcome triple, stop and do not start Phase 2.

### Phase 2 — row budget

Actions: give Working rows a documented max; skip idle assemble when keys match; keep overlay pause.

Output: a 24-row window keeps input and the approval card; activity band cannot push chrome off screen.

Success: a snapshot or unit test pins chrome survival at 24 rows with a full activity band.

Exit: if idle skip drops a required shimmer frame, keep the ticker for spinner rows only.

### Phase 3 — separate visual line

Actions: only after A and B, open the sitting-fox welcome as its own spec, or drop it.

Output: welcome bands change only in that spec.

Success: `WELCOME_FOX_BAND_WIDTHS` and `formatFoxFrame` stay one set.

Exit: if the sitting fox cannot meet the published cut-out identity, keep `56` / `72`.

## Risks

| Weak point | Response |
| --- | --- |
| Calling every local flag a second authority | Keep theme, tip, and panel visibility on the live control plane. Only decision leaks are in scope. |
| `[p]` then `cancelled` looks like data loss | The test must state the rule: this card stays cancelled; the next ask may be auto-allowed by the new exact rule. |
| Idle skip hides a spinner | Skip only when no spinner field is in the snapshot key. |
| Sitting-fox WIP collides with `56` / `72` | Leave it uncommitted; do not edit those constants here. |
| Web operators want Always | Point at the standing-grant note; this spec does not open that channel. |

## Next step

Write one TUI test that persists an allow rule, cancels the same request while the write is in flight, and asserts the disk / card / outcome triple. Do not start the sitting-fox welcome in that change.

## Alternatives rejected

- Widen Web decide to five outcomes in this line.
- Treat `Model-visible ⟺ logged` as “every live row needs a session event”.
- Rebuild `renderLive` as a new bottom-pane framework.
- Add a Claude-style status-line subprocess.
- Treat overlay pause as a defect.
- Merge sitting-fox welcome into Loops A–C.
- Delete `/todos` and `/tasks` to look converged.
