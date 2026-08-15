# Agent Note: Oh My Tianshu rebrand — omp-aligned welcome card, amber default theme, repository rename

Status: implemented

English | [中文](2026-08-15-oh-my-tianshu-rebrand.zh.md)

## Problem

The TUI's visual identity predates the product's public positioning: the welcome hero carried the internal `DSH` brand, the default `graphite` theme read as generic-neutral, and the repository name `dsh-tianshu-build` described the build line rather than the product. With oh-my-pi (omp) and oh-my-dsh as the interaction references, the product is positioned as **Oh My Tianshu** — the interface should carry the recognizable omp-style identity, and the repository name should match.

## Decision

Wave one of the omp alignment (identity layer only), plus the repository rename:

- **Brand**: `formatBrandWelcome` defaults become `Oh My Tianshu` / `Tianshu Harness` (`packages/tui/tui/src/format/welcome.ts`). Package names (`@huiliyi37/dsh-*`) and the CLI name (`tianshu`) stay unchanged — the rename is repo + product-brand only.
- **`omp` theme, the new default**: a new amber-accent palette (`packages/tui/tui/src/theme-palettes.ts`: primary `#febc38`, slate grays, warm user rail) registered first in `THEME_PALETTES`; `autoThemeFor` maps dark backgrounds to `omp` (light keeps `paper`), and the `theme.ts` initial value follows. `graphite` and every other palette remain selectable via `/theme`.
- **Welcome card**: `formatWelcomeCard` wraps the existing responsive hero in a rounded box with the brand embedded in the left of the top border (`╭─ Oh My Tianshu ───╮`); the whale gains an opt-in diagonal body gradient (`bodyGradient`, truecolor track only — belly/eye/blush keep their brand colors, the 16-color track is unchanged); a random italic dim `Tip:` line (`WELCOME_TIPS` / `pickWelcomeTip`) lands below the card. The hero itself is untouched, so existing hero specs keep their meaning.
- **Rename**: GitHub repo `huiliyi37/dsh-tianshu-build` → `huiliyi37/oh-my-tianshu`; every tracked hardcoded URL swept (`git grep dsh-tianshu-build` = 0), including `repository.url` fields, doc links, and the doc-site/verification scripts that assert the canonical identity.

Deferred to wave two (recorded, not built): the powerline-thin status bar embedded in the composer top border, mode-reactive composer border colors, omp-style message-surface treatment (full-width user bubble tint, status-tinted tool blocks), and the 3-second gradient-sweep logo intro.

## Alternatives considered

- **Full rename (packages + CLI)**: `@huiliyi37/dsh-*` and the `tianshu` binary touch hundreds of references, the publish chain, and installed profiles — a separate engineering track. Rejected for this wave; the user-facing brand and repo name carry the identity.
- **Recoloring `graphite` in place**: would silently change every existing install's look and steal the name users may have pinned. A new registered palette keeps `/theme graphite` intact.
- **Gradient as the whale default**: the flat brand blue is asserted by the baseline spec and remains the right rendering for 256/16-color tracks, so the gradient is an explicit `bodyGradient` option used by the welcome path only.
- **Renaming the local checkout directory**: cosmetic and session-disruptive; the directory keeps its name while the remote identity changes.

## Consequences

The first screen now reads as Oh My Tianshu at a glance (amber accent, bordered welcome card, gradient whale, random tip), while all sixteen prior themes remain selectable. The GitHub rename leaves the old URL as a redirect, and the sweep keeps local/CI/doc references on the new identity. `app.ts`'s source budget rose to 3069 (PR #1's chrome-pin wiring plus this wave's welcome wiring). The whale gradient keeps the flat brand blue off the truecolor welcome, so any printed/flat-color brand usage must pick the track deliberately.

## Testing

- `pnpm exec tsc -b packages/tui/tui`: 0 errors.
- `pnpm vitest run packages/tui/tui/tests`: 1633 passed (90 files), including new `formatWelcomeCard` / `pickWelcomeTip` / whale-gradient specs and the updated brand/default-theme assertions.
- `verify-source-budgets`, `verify-doc-refs`, `verify-public-repository-links`, `verify-package-paths`, `verify-md-links`, `verify-md-wrap`, `check-workspace-constraints`: all pass after the rename sweep.

## Related

- [TUI audit-driven hardening batch and the visionBridge probe service](./2026-08-15-tui-audit-hardening-batch.md)
- [TUI image paste / clipboard and the vision bridge (opencode-tui port)](./2026-08-13-tui-image-paste-and-vision-bridge.md)
