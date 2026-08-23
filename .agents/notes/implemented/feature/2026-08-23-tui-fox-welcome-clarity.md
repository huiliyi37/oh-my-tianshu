# Agent Note: Two-band static fox welcome

Status: implemented

English | [中文](2026-08-23-tui-fox-welcome-clarity.zh.md)

## Problem

The 40-column squeeze plus Floyd–Steinberg dither and Braille projection made the same cut-out fox unreadable on ordinary 80-column terminals. A 3.24s opening then spent that grain in the live region before the user could type.

## Decision

Runtime welcome art is two Lanczos rest grids snapped to one shared plane palette of at most 16 colors, with no error diffusion: `56×42` and `72×54`. `formatFoxFrame` draws those grids as half-blocks only and refuses any other width. `formatWelcomeHero` selects a band from columns and rows:

- below 80 columns, or when rows cannot host `56×21` cells plus chrome, or without color or narrow blocks: compact text
- `80 ≤ cols < 89`: 56 band, wrap the peer line and later details
- `89 ≤ cols < 105`: 56 band, single-line peer
- `cols ≥ 105` and enough rows for `72×27` cells plus chrome: 72 band

The identity column starts with one theme-colored line of `Oh My Tianshu`. There is no five-row block wordmark. Peer copy stays `DeepSeek ◆ Tianshu Harness`.

Attach commits the selected rest pose immediately. `welcomeAnimation` remains `auto|off` and both values produce that static fox. The eight-frame 96×72 sheet stays in the package as provenance; the generated module exports only the two rest bands. Brand hierarchy, restore-before-welcome order, and the runtime-no-sharp boundary stay in [capability-gated fox startup welcome](./2026-08-22-tui-fox-welcome.md).

## Alternatives considered

**Hand-invented 40-column terminal sprite** — it stopped reading as this fox. The cutout stays the only source.

**72-only or 96-only fox** — ordinary 80-column windows could not host it and would fall back to text.

**Braille or Floyd–Steinberg dither** — both produced the grain this change exists to remove.

**Continuous scaling between 56 and 72** — intermediate sizes reintroduce the soft, averaged look.

**Keep the 3.24s opening on `auto`** — motion would replay an unreadably projected fox; static attach shows the readable rest pose at once. Frame timing stays unused until a later change reintroduces motion.

## Consequences

Bought: the fox is recognizable at 80 columns and sharper at 105; wrap keeps identity readable instead of squeezing art; attach no longer spends 3.24s on an opening.

Cost: `auto` no longer plays a brand opening; only two discrete sizes exist; the 96×72 sheet is provenance rather than a runtime frame.

## Verification

- Generator coverage pins both rest bands, the shared palette, no dither, no third size, and a stale-check against the committed module.
- Formatter coverage pins half-block-only welcome rendering, rejected widths, and 80 wrap / 89 mid / 105 wide / text fallback.
- Controller and app coverage pins immediate complete, `auto` equals `off`, the 72 band at 105×33, and restore-before-welcome / pending-action order.
- The real [`examples/tui`](../../../../examples/tui/README.md#keyless-snapshot) Loader + PTY snapshot records the settled 100×30 mid-band surface with half-blocks, a one-line `Oh My Tianshu`, and no Braille.

## Related

- [Capability-gated fox startup welcome](./2026-08-22-tui-fox-welcome.md)
- [Oh My Tianshu rebrand](./2026-08-15-oh-my-tianshu-rebrand.md)
- [TUI welcome page polish](./2026-08-13-tui-welcome-page-polish.md)
