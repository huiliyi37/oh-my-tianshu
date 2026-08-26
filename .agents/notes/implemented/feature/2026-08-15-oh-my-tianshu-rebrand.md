# Agent Note: Oh My Tianshu rebrand — product identity, amber default theme, repository rename

Status: implemented

English | [中文](2026-08-15-oh-my-tianshu-rebrand.zh.md)

## Problem

The TUI's visual identity predates the product's public positioning: the welcome hero carried the internal `DSH` brand, the default `graphite` theme read as generic-neutral, and the repository name `dsh-tianshu-build` described the build line rather than the product. With oh-my-pi (omp) and oh-my-dsh as the interaction references, the product is positioned as **Oh My Tianshu** — the interface should carry the recognizable omp-style identity, and the repository name should match.

## Decision

The rebrand decision establishes the product identity, default palette, and repository name:

- **Brand**: the product identity is `Oh My Tianshu` / `Tianshu Harness`. Package names (`@huiliyi37/dsh-*`) and the CLI name (`oh-my-tianshu`) stay unchanged — the rename is repo + product-brand only.
- **`omp` theme, the new default**: a new amber-accent palette (`packages/tui/tui/src/theme-palettes.ts`: primary `#febc38`, slate grays, warm user rail) registered first in `THEME_PALETTES`; `autoThemeFor` maps dark backgrounds to `omp` (light keeps `paper`), and the `theme.ts` initial value follows. `graphite` and every other palette remain selectable via `/theme`.
- **Startup identity, partially superseded**: the [capability-gated fox welcome](./2026-08-22-tui-fox-welcome.md) replaces this note's rounded whale card and its decision to defer a live intro. It owns the current fox assets, responsive wordmark, animation, settlement, and compact fallback; this note continues to own the product identity, default theme, repository rename, and message/chrome surfaces.
- **Rename**: GitHub repo `huiliyi37/dsh-tianshu-build` → `huiliyi37/oh-my-tianshu`; every tracked hardcoded URL swept (`git grep dsh-tianshu-build` = 0), including `repository.url` fields, doc links, and the doc-site/verification scripts that assert the canonical identity.

The segmented status bar lives in the composer's top border (`format/top-status-bar.ts` — left identity segments in primary, right metrics in muted, secondary dash fill, drop-from-right on narrow widths, ascii fallback); `formatInputFrame` accepts a pre-rendered `topLine` and shares `promptBorderColor` with it, so the whole top edge carries the mode-reactive border color (plan warning / always-approve error / normal fog blue); the footer keeps mode badge + key hints only.

The theme system exposes an optional truecolor `SurfaceSet` — `userMsgBg` plus `toolPendingBg`/`toolSuccessBg`/`toolErrorBg` — for the `omp` and `graphite` palettes and inherited custom themes; the 16-color fallback track omits it and keeps rail/no-tint styles. `format/bg-block.ts` (`withBgFill`/`withBgFillLines`) pads lines to full width under a surface color; user messages render as full-width warm bubbles when `userMsgBg` exists, tool-card bodies tint by status, diff cards keep their own colors, and `width` threads through `renderTranscript` options into the card renderers. `chromeBg` paints the composer top-border status bar as a full-width chrome band.

## Alternatives considered

- **Full rename (packages + CLI)**: `@huiliyi37/dsh-*` and the `oh-my-tianshu` binary touch hundreds of references, the publish chain, and installed profiles — a separate engineering track. Rejected for this wave; the user-facing brand and repo name carry the identity.
- **Recoloring `graphite` in place**: would silently change every existing install's look and steal the name users may have pinned. A new registered palette keeps `/theme graphite` intact.
- **Gradient as the whale default**: rejected for the superseded card because flat brand blue was the established 256/16-color rendering. That choice no longer constrains the current fox, whose indexed palette and text fallback belong to the [fox welcome decision](./2026-08-22-tui-fox-welcome.md).
- **Renaming the local checkout directory**: cosmetic and session-disruptive; the directory keeps its name while the remote identity changes.

## Consequences

The first screen reads as Oh My Tianshu through the sitting-fox splash and `Oh My Tianshu >` / `< Harness >` lines, while every registered theme remains selectable. The GitHub rename leaves the old URL as a redirect, and the sweep keeps local, CI, and documentation references on the new identity. The `omp` palette, top-border status bar, and message/chrome surface tones remain this note's current contract; startup rendering and history ownership belong to the [fox welcome decision](./2026-08-22-tui-fox-welcome.md).

## Testing

- Theme, top-status-bar, background-fill, and message-surface specs pin the surviving palette and chrome contracts.
- Current first-screen rendering, tip selection, responsive fallback, and animation are verified by the [fox welcome layers](./2026-08-22-tui-fox-welcome.md#verification), not the removed card or whale specs.
- Repository identity remains covered by the public-repository-link, package-path, documentation-link, and workspace-constraint checks.

## Related

- [Capability-gated fox startup welcome](./2026-08-22-tui-fox-welcome.md)
- [TUI audit-driven hardening batch and the visionBridge probe service](./2026-08-15-tui-audit-hardening-batch.md)
- [TUI image paste / clipboard and the vision bridge (opencode-tui port)](./2026-08-13-tui-image-paste-and-vision-bridge.md)
