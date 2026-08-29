# Agent Note: Selectable welcome mascot — whale default, fox retained

Status: implemented

English | [中文](2026-08-30-tui-welcome-whale-mascot.zh.md)

## Problem

The distribution gained a pixel-art whale mascot (whale raising a star) that matches the Oh My Tianshu identity better than the sitting fox, and the startup welcome should present it. The fox is already shipped, documented, and covered by golden snapshots, so replacing it outright would break asset continuity for existing installs; the choice is a user preference and a deployment default, neither of which belongs in the agent loop or the composition layer.

## Decision

The welcome hero renders one selectable mascot. The whale is the default; the fox is retained, and both share the `28×30` / `36×38` / `44×46` rest-band geometry (80/105/140 columns respectively), so `resolveWelcomeArtWidth` and `formatWelcomeHero` stay mascot-independent.

The whale reuses the fox's asset chain shape: the archived `assets/welcome-whale-source.png` is authored repository-side by `scripts/author-welcome-whale-assets.ts` — the source's `DeepSeek </>` / `< Harness >` caption band is cropped away, the uniform dark background is flood-filled to transparency from the borders (interior dark pixels such as the eye and outlines are unreachable and survive), and the result is trimmed to opaque bounds. `scripts/generate-welcome-whale.ts` projects the cutout into the deterministic generated `src/format/whale-frames.ts` (median-cut 15-color palette, nearest snap, no error diffusion). Because the whale cutout is a high-resolution rendering of a pixel-art original, projection first recovers its native pixel grid (116×88, each art pixel ≈ 8 source pixels) and samples the bands from that grid — one-shot nearest sampling at 25–33× reduction sub-samples and destroys small shapes like the star. The fox, authored near its native resolution, keeps the one-step projection and byte-identical bands. Palette derivation, band snapping, validation, and module rendering live in `scripts/welcome-art-shared.ts`, shared with the fox generator, whose 28/36 bands stay byte-identical across the extraction (`verify-welcome-fox` is the regression proof). Runtime rendering does no asset I/O; `src/format/fox.ts` owns the shared indexed half-block renderer plus the generic frame binding, and `src/format/whale.ts` is the symmetric whale entry.

When the hero's details column fits (61 columns), the brand renders as oversized pixel block letters — a small `Oh My` text row above `TIANSHU >` and `< HARNESS >` in the hand-authored 5×5 block font (`src/format/block-text.ts`) — matching the reference wordmark hierarchy; narrower columns keep the one-line `Oh My Tianshu >` / `< Harness >` text. The block stack is exactly as tall as the 28-column band, so the hero's row budget is unchanged.

Selection is resolved where the welcome commits: `prefs.welcomeMascot` (the user's `/welcome fox|whale` choice, persisted to `~/.dsh-tui/prefs.json`) overrides the runner's `welcomeMascot` config (deployment default, fail-loud validation at plugin load), which defaults to `whale`. `settleWelcome` reads the preference at commit time, so a switch made before settlement applies immediately; a settled welcome block is never rewritten, so a later switch takes effect on the next startup. The zero-import leaf `src/format/welcome-mascots.ts` owns the closed mascot id set shared by the render dispatch, the `/welcome` command, the prefs parser, and config validation.

## Alternatives considered

**Replace the fox with the whale outright** — deletes a shipped, snapshot-covered asset and forces a mascot change on every install with no way back. Retaining both costs one extra generated module and one config key.

**Rewrite the settled welcome in place on switch** — scrollback is append-only; rewriting committed rows was rejected for the animation pass for the same reason (terminal history is not a canvas). The switch deliberately lands on next startup, with the pre-settlement window picking it up live.

**Persist the choice through the settings service instead of prefs.json** — the TUI's user-level toggles (`/bell`, `/info`) already persist to `~/.dsh-tui/prefs.json`, a file deliberately shared with the official host plugin so one preference survives both distributions; `/welcome` follows that seam rather than opening a settings namespace for a presentational toggle.

**Author a whale sprite sheet like the fox's** — the eight-frame fox sheet is provenance for a deferred motion pass; the whale ships a single static pose, and inventing frames would fabricate art the product never commissioned.

**Theme-attached mascot** — the mascot is product identity, not palette; themes remain orthogonal to the welcome art.

**One-shot nearest downscale for the whale** — sampling 36 of 929 columns sub-samples the art's native pixels and the star collapses into an unreadable blob; recovering the 116×88 native grid first keeps every shape addressable at band scale.

**Weight the star region in palette derivation** — the median-cut already isolates the cream star (an outlier color earns its own box), and weighting instead steals slots from the belly, painting a cream artifact onto it. The palette stays unweighted.

**Reuse an existing big-text/figlet dependency** — no such dependency is vendored, and the wordmark needs eleven glyphs; a hand-authored 5×5 font is smaller than any new dependency and matches the mascot's pixel grid exactly.

## Consequences

Fresh installs greet with the whale-and-star hero under the oversized block-letter wordmark; the fox is one persistent `/welcome fox` away. Adding `welcome` to the builtin command names makes the `/w` prefix ambiguous with `/workflow` (prefix resolution rejects it; `/we` disambiguates). The welcome golden snapshot under `examples/tui` now records the two-step whale surface and the block-letter brand, and the static gates gain `verify-welcome-whale` beside `verify-welcome-fox`. The background-keyed cutout keeps the star's dark aura, which reads as a glow rim on dark themes and a faint dark halo on light ones — accepted at band scale. The command body and the art selection live in `welcome-mascot-command.ts` and `welcome-mascot-art.ts`; the app assembly carries only the registration call, one option/field pair, and the settle-time lookup, a residual +6 lines that raise the `app.ts` source-budget ceiling to 6191 — further thinning belongs to the C4 split track, not this feature. Welcome-surface test anchors standardize on the hero-unique `Oh My` text row (present in both brand modes); `█`-based negative anchors are unusable because the live region's input cursor is a full block.

## Verification

- Generator coverage re-authors the whale cutout byte-identically from the archived source, checks the transparent border, projects all three rest bands through the recovered native grid into a dependency-free module, and rejects malformed cutouts before producing data; the fox generator spec stays green across the shared-helper extraction and the added 44-column band.
- Renderer coverage pins whale and fox band geometry for all three widths, glyph hygiene, and width validation; hero coverage pins the block-letter brand at 61+ detail columns, the one-line text fallback below, and the unchanged hero row budget; app coverage pins the whale default against the explicit fox option, and `/welcome` echo, rejection, and prefs persistence; runner coverage pins fail-loud `welcomeMascot` validation.
- The real [`examples/tui`](../../../../examples/tui/README.md#keyless-snapshot) Loader + PTY snapshot is re-recorded for the two-step whale surface and the block-letter brand, and still asserts zero model-network requests.

## Related

- [Capability-gated fox startup welcome](./2026-08-22-tui-fox-welcome.md)
- [Two-band static fox welcome](./2026-08-23-tui-fox-welcome-clarity.md)
- [Sitting-fox welcome splash](./2026-08-25-tui-sitting-fox-welcome.md)
