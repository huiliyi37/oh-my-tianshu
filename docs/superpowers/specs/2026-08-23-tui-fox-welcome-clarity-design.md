# TUI Fox Welcome Clarity Design

English | [中文](2026-08-23-tui-fox-welcome-clarity-design.zh.md)

## Goal

Keep the same cut-out fox and the `Oh My Tianshu` / `DeepSeek ◆ Tianshu Harness` brand hierarchy from [2026-08-22-tui-fox-welcome-design.md](2026-08-22-tui-fox-welcome-design.md), and replace the projection that made the mascot unreadable.

The change is presentation only. It adds no model-visible input, session event, persistence field, or agent-loop behavior.

## Visual contract

The runtime welcome never invents a second fox. Offline generation takes `welcome-fox-cutout.png`, Lanczos-resizes it to one of two even pixel grids, and snaps each opaque pixel to a fixed plane palette with no error-diffusion dither.

Runtime draws those grids with half-block glyphs only. One terminal cell is two vertical pixels. The welcome path does not use Braille, full-block `█` fills, or any size other than the two grids below.

| Band | Terminal columns | Art | Identity column |
| --- | --- | --- | --- |
| Narrow fox | `80 ≤ cols < 105` | `56 × 42` pixels / `56 × 21` cells | Title and peer stay on the right of the fox |
| Wide fox | `cols ≥ 105` | `72 × 54` pixels / `72 × 27` cells | Title and peer stay on the right of the fox |

The left column is the fox. The right column is:

- One line of theme-colored `Oh My Tianshu` (no five-row block wordmark).
- `DeepSeek ◆ Tianshu Harness` with equal weight on both names.
- Model and effort, cwd, optional version.

The top bar, restorable-session list, random tip, input frame, and footer keep their current functions. Resize picks the band from the new size; it never interpolates a third fox size.

A viewport that cannot host the `56 × 21` fox plus chrome, or that lacks color or narrow block glyphs, uses the existing compact text welcome. The title is never stacked above the fox.

## Opening motion

This change does not play an opening. Attach commits the static rest pose for the current band.

`welcomeAnimation` remains a validated `TuiRunnerConfig` field. Both `auto` and `off` produce that static fox wherever art is supported. Frame timing stays unused until a later change reintroduces motion.

## Source and generated assets

Authored assets stay under `packages/tui/tui/assets/`: the JPEG source, the transparent cutout, and the existing eight-frame `96 × 72` sheet. The sheet remains provenance for a later motion pass; this change only requires the rest pose.

The generator writes `packages/tui/tui/src/format/fox-frames.ts` with two rest grids (`56 × 42` and `72 × 54`), the shared palette, and the final-frame id. Runtime imports that module only. It never opens an asset or calls `sharp`.

The stale-output gate rebuilds both grids in memory and rejects a mismatch, a dithered encoding, a missing rest frame, or a size other than the two bands.

## Rendering components

`src/format/fox.ts` renders one selected grid as half-block ANSI rows. Mixed cells use `▀` with explicit foreground and background; a single opaque pixel uses `▀` or `▄` on the default background; transparent runs keep the terminal background and restore it before interior spaces. Every row ends in RESET.

`formatFoxFrame` accepts a band width of `56` or `72` and refuses any other target. Welcome composition calls it with the band already chosen from columns and rows.

`src/format/welcome.ts` owns band selection, the one-line title, wrap-versus-single-line identity, the compact text fallback, restore rows, and the tip. It still receives pre-rendered art lines plus their allocated width.

## Lifecycle ownership

Startup still prepares one immutable welcome snapshot (route, cwd, version, restore rows, tip) and still writes session-mount restore history before the welcome takes startup ownership.

Because there is no intro timeline, `settleWelcome` runs as soon as that snapshot exists. The live region never prepends an animated hero. Input, paste, resize, and later scrollback commits keep the existing settlement and pending-action order from the 2026-08-22 spec so an early key cannot land before the canonical welcome.

Disposal cancels any leftover intro bookkeeping and does not write a second welcome.

## Failure and degradation

Invalid `welcomeAnimation` still fails at plugin load. Stale or illegal generated frames fail the generation gate and tests, not runtime.

Crossing a band on resize recomputes the static welcome at the new size. Rendering stays on `LiveEngine` and `CommitEngine`; the welcome path issues no kitty, iTerm2, or raw screen-erase commands.

## Verification

Generator tests pin Lanczos-plus-plane-palette output for both grids, reject dither, and reject a third size.

Renderer tests pin half-block glyphs, no Braille on the welcome path, explicit background reset, row RESET, and display-width bounds of `56` or `72`.

Welcome tests pin the one-line `Oh My Tianshu` title beside the fox, wrapped identity at 80 columns, the 56-column band, the 72-column wide band, and text fallback below 80 columns or without color.

App and `examples/tui` PTY snapshots record only the settled static surface. The golden contains half-blocks from the fox, not Braille, and contains the one-line title rather than the five-row wordmark.

## Alternatives rejected

A hand-invented 40-column terminal sprite was rejected because it stopped reading as this fox.

A 72-only or 96-only fox was rejected for ordinary 80-column windows.

Braille and Floyd–Steinberg dither were rejected because they produced the grain the current welcome shows.

Continuous scaling between 56 and 72 was rejected because intermediate sizes reintroduce the soft, averaged look.

A 40-column default was rejected after acceptance: the face, ears, and tail stripe disappeared. The title stays on the right of the 56-column fox.
