# Agent Note: Sitting-fox welcome splash

Status: implemented

English | [中文](2026-08-25-tui-sitting-fox-welcome.zh.md)

## Problem

The curled cutout, forced into `56×42` / `72×54`, sheared the sitting pixel-art fox and spent palette slots on cream ramps. The old peer line `DeepSeek ◆ Tianshu Harness` sat tight against that box and left no room for the splash lettering approved beside a proportionally scaled original.

## Decision

Welcome art is the sitting transparent PNG. Authoring reads `assets/welcome-fox-source.png`, crops to opaque bounds, and writes the cutout plus an eight-frame 768×72 sheet of identical rest frames. Runtime bands are two nearest-neighbor contain grids snapped to one 15-color plane palette, sized to the approved 196-pixel preview: `28×30` and `36×38` (`28×15` and `36×19` cells need 21 and 25 terminal rows with chrome). `formatFoxFrame` still refuses any other width.

The identity column is `Oh My Tianshu >` on one line and `< Harness >` on the next. The caret and Harness line use a fixed splash mark `#b48cff`. Hero gap is six columns. Title stays beside the fox. Compact text keeps the same two identity lines.

[Two-band static fox welcome](./2026-08-23-tui-fox-welcome-clarity.md) still owns half-block-only rendering, no dither, static attach, and the 80 / 105 column switches.

## Alternatives considered

**Keep the curled fox and 4:3 boxes** — the approved sitting drawing sheared and lost the outline.

**Keep the 56-column band at proportional height** — that is about twice the approved 196-pixel preview on a typical cell size and drowns the splash title.

**Lanczos contain at the 28 / 36 bands** — it averages the sitting outline into cream ramps and spends the plane palette on those intermediates, so the fox reads as blur rather than pixel art.

**Five-row block wordmark or Press Start 2P in the TUI** — terminals cannot host that font; the earlier block wordmark was already rejected. Color, a caret, and a second Harness line carry the splash hierarchy.

**Keep `DeepSeek ◆ Tianshu Harness`** — it fought the splash lettering and repeated Harness.

**Procedural motion frames on the sitting body** — the old tail/eye rectangles were placed on the curled fox and would paint the wrong anatomy.

## Consequences

Bought: the sitting fox keeps its proportions at the approved preview scale; the right-hand column matches the splash; ordinary 24-row terminals can still host the 28-band fox.

Cost: the fox is half the earlier 56-column width, so fine outline detail is coarser and nearest-neighbor cells stay blocky; the sprite sheet is eight copies of rest until a later motion pass is authored for this body.

## Verification

- Generator coverage pins PNG authoring, identical rest frames, `28×30` / `36×38`, and the stale-check against the committed module.
- Formatter coverage pins `Oh My Tianshu >`, `< Harness >`, 80-column wrap, 28 at 21 rows, 36 at 25 rows, and text fallback.
- App coverage pins static attach and the 36 band at 105×25.
- The real [`examples/tui`](../../../../examples/tui/README.md#keyless-snapshot) Loader + PTY snapshot records the settled 100×40 mid-band surface with half-blocks, `Oh My Tianshu >`, `< Harness >`, and no Braille.

## Related

- [Two-band static fox welcome](./2026-08-23-tui-fox-welcome-clarity.md)
- [Capability-gated fox startup welcome](./2026-08-22-tui-fox-welcome.md)
