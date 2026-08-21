# Agent Note: TUI Image Preview via Half-Block Rendering

Status: implemented

English | [中文](2026-08-22-tui-image-preview-halfblock.zh.md)

## Problem

Image attachments were invisible until it was too late to act on it: while composing, the only feedback was a `📎 N images` count line, and after submit the image rendered only through the kitty/iTerm2 graphics protocols — users of every other terminal (Apple Terminal, VS Code's xterm.js, tmux/screen) saw nothing pixel-like at all, ever. The competitor (opencode-tui) has no composer thumbnail either, so this was a genuine gap on both sides of the comparison, not a port.

## Decision

Render previews as truecolor half-block ANSI text: each `▀` character carries the upper pixel in its foreground color and the lower pixel in its background color, so a `cols × rows` grid of characters displays a `cols × 2·rows` pixel image in any terminal that can print text. Two surfaces consume one renderer (`engine/image-preview.ts`):

- **Composer thumbnail** — the last attached image renders above the `📎` line in the live region while editing (≤30 cols × 10 rows), recomputed on every attach/remove via `onImagesChange`, with an epoch counter dropping stale async results.
- **Bubble fallback** — when `imageProtocol()` is `'none'`, submit writes the same half-block render into scrollback under the user bubble (≤ terminal width × 16 rows), with the identical clear-live/write-raw/re-render choreography the graphics-protocol path uses.

Pixel decoding goes through `sharp` (lazy-imported; the TUI package gains the dependency, the same version the attachment pipeline already ships in the bundle). Any failure — missing native module, corrupt payload, decode error — returns `null` and the surface degrades to the previous text-only behavior; preview is decorative and never gates sending. Design details that matter: nearest-neighbor resampling keeps screenshot hard edges crisp instead of blurring text into mid-tones; same-color runs merge into one SGR pair per run (a flat screenshot collapses from per-pixel escapes to a handful of sequences); the grid is aspect-fit with the row cap reflecting back on width so extreme portraits show a narrow full-height strip rather than a cover-cropped band; and `▀` is East Asian Width Ambiguous, so under `ambiguousWide` the column budget halves to keep both the rendered width and the live engine's `displayWidth` row accounting correct. Transparent pixels flatten onto the theme's `userMsgBg` when the theme provides one (truecolor track), else a neutral dark constant.

## Alternatives considered

- **Composer preview via kitty/iTerm2 protocols when available.** Rejected: the live region is erased and rewritten as plain text every frame, while protocol graphics persist independently of text redraws — previews there need image-id bookkeeping and explicit deletes for every frame. Half-block is text, so redraw-correctness is free, and one code path serves all terminals.
- **Always half-block in the transcript too.** Rejected: protocol terminals get full-resolution images post-submit today; half-block stays the `'none'` fallback, keeping the best available fidelity per terminal.
- **Decoding via the sips/magick CLI chain** (`image-tool.ts`). Rejected: stock macOS has sips but not magick, and sips cannot emit raw pixels — the fallback would be macOS-broken. `sharp` is already a proven native dependency of the attachment pipeline in the same process.
- **Pure-JS PNG/JPEG decoders.** Rejected: hand-rolling decoders for six container formats against the repo's maintained-dependencies policy.

## Consequences

- Every terminal sees a pixel-level preview of the image it is about to send, and non-protocol terminals additionally see it in the transcript after submit.
- `@huiliyi37/dsh-tui` now depends on `sharp` (native, `^0.35.3`); the bundle's install footprint is unchanged (same version already shipped via attachment-local), standalone TUI consumers pull it once. The lazy import plus null-degrade keeps the render path alive if the native module ever fails to load.
- Preview lines carry heavy truecolor SGR content through the live engine; this is within the `LiveRegionLine.text` contract (ANSI-formatted text) and `displayWidth` strips escapes, verified by a width assertion in the spec.
- Not done: animated GIF frame selection (first frame only), a config toggle for the fallback's scrollback cost, and sixel support (no terminal in the detection set needs it).
