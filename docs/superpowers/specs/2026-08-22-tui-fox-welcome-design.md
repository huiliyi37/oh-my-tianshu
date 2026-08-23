# TUI Fox Welcome Design

English | [中文](2026-08-22-tui-fox-welcome-design.zh.md)

This document remains the home for brand hierarchy, cutout authorship, settlement reasons, and restore-before-welcome order. Fox size, title layout, palette projection, and static attach are specified in [2026-08-23-tui-fox-welcome-clarity-design.md](2026-08-23-tui-fox-welcome-clarity-design.md).

## Goal

Replace the existing whale welcome card with a transparent animated fox and a reference-style split hero. The welcome identifies the product as `Oh My Tianshu`; `DeepSeek Harness` and `Tianshu Harness` remain peer harnesses, displayed compactly as `DeepSeek ◆ Tianshu Harness` to avoid repeating “Harness.”

The change affects presentation only. It adds no model-visible input, session event, persistence field, or agent-loop behavior.

## Visual contract

The source illustration is cut out from its peach JPEG background and reduced to a transparent indexed sprite. The wide layout places the fox on the left and the brand column on the right:

- A compact five-row pixel wordmark renders `Oh My Tianshu`.
- The next line renders `DeepSeek ◆ Tianshu Harness`; `◆` uses the brand accent and both names have equal visual weight.
- Model and effort, the session working directory, and one stable startup tip follow beneath the peer line.
- The existing top bar remains above the hero.
- The restorable-session list, random tip behavior, input frame, and footer retain their current functions.
- The rounded welcome-card border and the shortcut-list column are removed.

Authored and generated frames are canonical `96 × 72` pixels. Runtime projects/downsamples each frame into a fixed `40 × 30`-pixel / `40 × 15`-cell allocation with half-block glyphs; the allocation does not grow with the terminal. The split hero requires at least 92 columns and 24 rows so the art, three-column-glyph wordmark, peer line, and input chrome cannot wrap or be cropped. Smaller viewports, no-color output, and legacy full-width block-glyph terminals render the text-only welcome instead.

## Opening motion

The fox plays one 3,240ms opening per TUI process attach, then freezes on the canonical curled pose. The motion combines a light tail sway, two breathing beats, one open-eye blink, and star glints. Eight unique indexed frames may be reused by multiple timeline steps; all frames have identical bounds so the neighboring text never shifts.

The existing 120ms TUI ticker drives the animation. Frame selection derives from `performance.now()` and cumulative timeline durations, so delayed ticks skip expired frames instead of extending the opening. The wordmark and environment text remain static while the fox moves.

`welcomeAnimation` is a validated `TuiRunnerConfig` field:

- `auto` is the default and plays only when the output is an interactive color TTY with sufficient width and height and a supported block-glyph width mode.
- `off` skips motion but retains the static fox wherever the art itself is supported.

Animation duration and frame timing are fixed presentation constants rather than deployment tunables.

## Source and generated assets

The editable assets are `welcome-fox-source.jpg` (the supplied illustration), `welcome-fox-cutout.png` (the approved transparent cutout), and `welcome-fox-sprite-sheet.png` (eight `96 × 72` frames in a `768 × 72` horizontal sheet: the canonical frame plus seven motion variants) under `packages/tui/tui/assets/`. The source and cutout remain beside the sheet for future redrawing and provenance; only generated TypeScript enters the published runtime.

A deterministic repository script reads the sheet, applies the approved fixed palette and alpha threshold, and generates `packages/tui/tui/src/format/fox-frames.ts`. Runtime code consumes only the generated palette indexes and timeline; it never opens an asset or invokes `sharp`.

The generated module records the `96 × 72` frame dimensions, palette entries, indexed rows, timeline steps, and the canonical final-frame id. A top-level executed gate regenerates in memory and rejects stale output, invalid palette indexes, unequal frame dimensions, a missing final frame, or an unexpected total duration.

## Rendering components

`src/format/fox.ts` converts one indexed frame into ANSI half-block rows. Each cell represents two vertical pixels: both opaque pixels use foreground plus background on `▀`, one opaque pixel uses `▀` or `▄` on the default background, and two transparent pixels remain unpainted. Every row explicitly restores the default background when leaving a mixed cell and ends with RESET; trailing transparent cells are omitted.

The truecolor and 256-color tracks use the approved fox palette. The 16-color track maps the palette to stable named approximations. Color level zero does not draw a silhouette because it loses the identifying fur, teal tail, and gold-star contrast.

`src/format/welcome.ts` owns the static welcome composition and width preservation. Its input carries rendered art lines and their fixed width rather than importing a mascot-specific global constant. The module renders the wide split hero, compact text fallback, final restorable-session section, and startup tip without timers or mutable state.

The obsolete whale renderer, rounded welcome card, and shortcut-column renderer are removed with their tests and imports. Existing random-tip and restorable-session projection behavior remains.

## Lifecycle ownership

A `WelcomeIntroController` owns the process-local intro state: immutable welcome snapshot, monotonic start time, current timeline position, and settled/cancelled status. It owns no timer; the app supplies the current time from the existing ticker.

Startup prepares the environment, session rows, selected tip, route display, cwd, branch, and canonical final output as one snapshot, then commits the top bar immediately. Once input, resize, and ticker handlers are installed, `renderLive()` prepends the current animated hero to the ordinary live-region dynamic segment while keeping the input chrome protected as the reserved tail.

The restore list and final tip remain pending during the short animation. Their data is already available, so a welcome digit pressed during the opening can settle the intro before routing the digit to the existing restore behavior.

`settleWelcome(reason)` is the sole commit point and is idempotent:

1. Mark the controller settled before terminal writes.
2. Clear the temporary live region.
3. Recompute the canonical final welcome from the latest terminal dimensions and current theme.
4. Batch-commit the final hero, restorable-session rows, and tip exactly once.
5. Render the normal live region.

Natural completion and ordinary input use this commit path. Input settlement completes before the original key continues through normal routing, so no keystroke is lost. Resize settles at the new dimensions instead of replaying. Disposal cancels the controller, clears temporary output through normal teardown, and performs no final welcome commit. Initial command-line prompts follow the same input-settlement path.

The intro does not contribute to `dynamicRowsHighWater`; after settlement, ordinary live rendering starts from the existing empty-session budget.

## Failure and degradation

Invalid configuration fails during plugin load. Invalid or stale sprite data fails the generation gate and tests rather than degrading at runtime.

Unsupported color depth, dimensions, or glyph width select a deterministic text fallback before animation starts. A resize that crosses a capability boundary settles directly to the fallback for the new dimensions. Rendering uses `LiveEngine` only; it does not issue independent cursor movement, screen erase, kitty, or iTerm2 image commands.

The final static output is computed from the canonical final frame, never copied from the most recently displayed animation frame. This keeps natural completion, skipped frames, interrupted animation, and animation-disabled startup equivalent.

## Verification

Pure renderer tests cover frame dimensions, palette legality, half-block selection, explicit background reset, row RESET, display-width bounds, fixed art alignment, truecolor/256/16-color output, and text-only capability fallbacks.

Controller tests use a fake monotonic clock to cover every timeline boundary, delayed-tick frame skipping, natural completion, input settlement, resize settlement, repeated settlement, and disposal. They assert one final commit, no late render, and preservation of the triggering input.

Welcome composition tests pin the `Oh My Tianshu` wordmark, `DeepSeek ◆ Tianshu Harness` peer line, wide split layout, compact fallback, final restore list, and random-tip stability.

App and terminal-buffer tests cover the `LiveEngine` transaction. The interpreted terminal state after natural completion must equal animation-disabled static startup; the same equivalence is required after a mid-intro resize. The live-region frame count stays bounded and the input frame remains present.

The runnable `examples/tui` composition gains a keyless Loader-plus-PTY scenario and stable-output snapshot. A real PTY observes the animated preview appear and then settle; the golden records only the settled final surface. Intermediate timing is pinned by the controller tests. Published-path verification builds the TUI bundle before running its built smoke.

## Documentation and decision records

Update both TUI README languages and their translation record with the brand hierarchy, animation configuration, capability fallbacks, and startup interruption behavior.

Add a new Agent Note for the fox intro and cross-link the partially superseded `2026-08-15-oh-my-tianshu-rebrand` decision, whose welcome-card shape and deferred-animation conclusion no longer apply. Keep the older note active because its theme and repository-brand decisions remain current. Update the session-resume visibility note from “welcome card” to “welcome area” without changing its restore semantics.

## Alternatives rejected

Runtime `sharp` decoding was rejected because startup would depend on native image work and asynchronous decoding even though every frame is fixed at release time.

Kitty and iTerm2 graphics animation was rejected because protocol images have separate lifecycle and cleanup semantics, produce inconsistent behavior across terminals and multiplexers, and complicate scrollback settlement.

Hard-coded pre-rendered ANSI strings were rejected in favor of palette-index frames because indexed data can be validated, recolored for terminal color tracks, and rendered with explicit background-reset guarantees.
