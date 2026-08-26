# Agent Note: Two-band static fox welcome

Status: implemented

English | [中文](2026-08-23-tui-fox-welcome-clarity.zh.md)

## Problem

The 40-column squeeze plus Floyd–Steinberg dither and Braille projection made the same cut-out fox unreadable on ordinary 80-column terminals. A 3.24s opening then spent that grain in the live region before the user could type.

## Decision

Runtime welcome art is two contain rest grids snapped to one shared plane palette of at most 16 colors, with no error diffusion. Band heights, the sitting cutout, the nearest-neighbor kernel, and splash copy live in [sitting-fox welcome](./2026-08-25-tui-sitting-fox-welcome.md). `formatFoxFrame` draws those grids as half-blocks only and refuses any other width. `formatWelcomeHero` selects a band from columns and rows:

- below 80 columns, or when rows cannot host the narrow-band cells plus chrome, or without color or narrow blocks: compact text
- `80 ≤ cols < 105`: narrow band, title stays on the right of the fox
- `cols ≥ 105` and enough rows for the wide-band cells plus chrome: wide band

The identity column stays beside the fox. There is no five-row block wordmark and no title stacked above the art.

Attach commits the selected rest pose immediately. `welcomeAnimation` remains `auto|off` and both values produce that static fox. The eight-frame 96×72 sheet stays in the package as provenance; the generated module exports only the two rest bands. Brand hierarchy, restore-before-welcome order, and the runtime-no-sharp boundary stay in [capability-gated fox startup welcome](./2026-08-22-tui-fox-welcome.md).

## Alternatives considered

**Hand-invented 40-column terminal sprite** — it stopped reading as this fox. The cutout stays the only source.

**Wide-only or sheet-only fox** — ordinary 80-column windows could not host it and would fall back to text.

**Braille or Floyd–Steinberg dither** — both produced the grain this change exists to remove.

**A 40-column runtime band** — after acceptance it lost the face, ears, and tail stripe. The cutout already fills its canvas; cropping cannot buy more pixels.

**Continuous scaling between the two bands** — intermediate sizes reintroduce the soft, averaged look.

**Keep the 3.24s opening on `auto`** — motion would replay an unreadably projected fox; static attach shows the readable rest pose at once. Frame timing stays unused until a later change reintroduces motion.

## Consequences

Bought: the narrow-band fox stays recognizable and keeps the title on the right; the wide band is sharper at 105; attach no longer spends 3.24s on an opening.

Cost: `auto` no longer plays a brand opening; only two discrete sizes exist; the 96×72 sheet is provenance rather than a runtime frame.

## Verification

- Generator coverage pins both rest bands, the shared palette, no dither, no third size, and a stale-check against the committed module.
- Formatter coverage pins half-block-only welcome rendering, rejected widths, and narrow-beside-title at 80 / 105 wide / text fallback.
- Controller and app coverage pins immediate complete, `auto` equals `off`, the wide band at 105×25, and restore-before-welcome / pending-action order.
- The real [`examples/tui`](../../../../examples/tui/README.md#keyless-snapshot) Loader + PTY snapshot records the settled 100×40 mid-band surface with half-blocks and no Braille.

## Related

- [Sitting-fox welcome splash](./2026-08-25-tui-sitting-fox-welcome.md)
- [Capability-gated fox startup welcome](./2026-08-22-tui-fox-welcome.md)
- [Oh My Tianshu rebrand](./2026-08-15-oh-my-tianshu-rebrand.md)
- [TUI welcome page polish](./2026-08-13-tui-welcome-page-polish.md)
