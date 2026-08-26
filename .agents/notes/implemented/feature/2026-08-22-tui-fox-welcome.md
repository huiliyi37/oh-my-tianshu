# Agent Note: Capability-gated fox startup welcome

Status: implemented

English | [中文](2026-08-22-tui-fox-welcome.zh.md)

## Problem

The startup surface needs to establish Oh My Tianshu's identity without making decorative rendering a runtime dependency or weakening terminal history. A live opening also has to yield immediately to user intent, resizing, and startup automation; holding or rewriting committed rows for animation would make the first interaction less reliable than the interface it introduces.

## Decision

The TUI owns one display-only startup welcome. On terminals that can host a fox band, with color and narrow half-block glyph support, `formatWelcomeHero` places the selected rest-band fox to the left of the splash identity. Band sizes, wrap, and the compact-text fallback live in [two-band static fox welcome](./2026-08-23-tui-fox-welcome-clarity.md). Splash copy and the sitting cutout live in [sitting-fox welcome](./2026-08-25-tui-sitting-fox-welcome.md). The details column shows the selected model, its effective reasoning effort, cwd, and distribution version.

`prepareWelcome` supplies at most three numbered restore rows and one already-selected `Tip:` to `formatWelcome`, which owns the final bounded block. There is no live hero preview, so restore choices and the tip appear once in the settled result. Narrow, short, no-color, and full-width block-glyph terminals preserve the same identity and metadata through the compact text form.

The repository-only asset chain deterministically authors `assets/welcome-fox-cutout.png` and the eight-frame 768×72 `assets/welcome-fox-sprite-sheet.png` (eight identical 96×72 rest frames) from `assets/welcome-fox-source.png`. Runtime rendering imports only the generated indexes and fixed palette; it does not read PNG assets, touch the filesystem, or load `sharp`. The sheet is provenance for a later motion pass; the generated module's rest-band contents are owned by [two-band static fox welcome](./2026-08-23-tui-fox-welcome-clarity.md).

`welcomeAnimation` is the only public control. It accepts `auto` or `off`, defaults to `auto`, and fails loud for any other value. Both values commit the same static fox wherever art is supported. [Two-band static fox welcome](./2026-08-23-tui-fox-welcome-clarity.md) owns static attach and unused frame timing. Capability thresholds that fall back to compact text remain product constants rather than deployment tunables.

`WelcomeIntroController` owns one immutable startup snapshot and the one-way active → settled or active → cancelled transition. Session-mount restore history — the recovery banner, replayed transcript, and resume separator — writes ahead of the welcome. After mount finishes and the welcome takes startup ownership, attach settles the canonical final form immediately; first key input, bracketed paste, command-line initial prompt, resize, and a later scrollback commit keep that settled block and the pending-action barrier before the triggering action or entry continues; the barrier does not intercept the mount-time restore commits. Settlement composes against current terminal dimensions and commits the final block once through `CommitEngine`. Disposal cancels without a late final commit. Automatic key setup opens only after non-input settlement, while input cancels the pending overlay.

Resolving the effective effort is decorative metadata: an explicit route value wins, while the model-directory lookup has a one-second cancellable boundary and displays `auto` on absence, failure, or timeout. Disposal aborts the lookup and prevents a late welcome write. The welcome adds no model-visible input, session event, persistence behavior, or agent-loop behavior.

## Alternatives considered

**Keep the rounded whale card** — it preserves the earlier chrome but keeps the mascot and product wordmark subordinate to a generic card frame. The fox split layout gives the identity a clear wide-screen hierarchy while retaining a compact text fallback.

**Decode PNG assets with `sharp` at runtime** — this would put native image decoding, package assets, filesystem access, and runtime failure modes on the startup path. Checked-in indexed TypeScript makes startup independent of the authoring toolchain and lets the generator verify reproducibility offline.

**Always animate or always remain static** — a single always-on opening would delay terminals that cannot host the fox; deleting `welcomeAnimation` would lose the explicit `off` and the fail-loud validation. The field stays `auto|off`; [two-band static fox welcome](./2026-08-23-tui-fox-welcome-clarity.md) owns that both values commit the same static fox.

**Erase and rewrite terminal history for each frame** — committed rows are not a canvas and resize can move them into protected scrollback. Keeping previews in the live region and appending one canonical final block preserves chronological history.

## Consequences

The first screen has one brand hierarchy and one settled representation. Startup gains a checked-in source image, cutout, provenance sheet, generated rest-band module, and generator checks. [Two-band static fox welcome](./2026-08-23-tui-fox-welcome-clarity.md) owns band geometry and static attach. Unsupported terminals lose the fox but retain all startup metadata as text.

The asset authoring dependency remains outside runtime, and the fixed generated module is reviewable and reproducible. The append-only boundary keeps the entire feature outside model, session, persistence, and loop contracts.

## Verification

- Generator coverage rebuilds the cutout, the 768×72 provenance sheet, the two rest bands, the dependency-free generated module, and malformed-asset rejection paths.
- Formatter, controller, runner, and app coverage pins responsive fallback, peer-brand copy, metadata fallback, configuration validation, settlement ordering, cancellation, delayed key setup, and `auto`/`off` buffer equivalence.
- The real [`examples/tui`](../../../../examples/tui/README.md#keyless-snapshot) Loader + PTY snapshot covers source and built launch planes, records only the settled 100×40 mid-band surface, and asserts zero model-network requests.

## Related

- [Two-band static fox welcome](./2026-08-23-tui-fox-welcome-clarity.md)
- [Sitting-fox welcome splash](./2026-08-25-tui-sitting-fox-welcome.md)
- [Oh My Tianshu rebrand](./2026-08-15-oh-my-tianshu-rebrand.md)
- [TUI welcome page polish](./2026-08-13-tui-welcome-page-polish.md)
- [TUI C4 concept draft Wave 1+2](./2026-08-12-tui-c4-concepts-w12.md)
- [TUI C4 concept B layout wave](./2026-08-12-tui-c4-b-layout-bottom-bar.md)
- [Session-resume visibility chain](./2026-08-20-session-resume-visibility.md)
