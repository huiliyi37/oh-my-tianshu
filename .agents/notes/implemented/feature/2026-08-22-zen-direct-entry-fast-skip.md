# Agent Note: Zen Direct Entry — /fast User Skip, Shipped Intent-Bridge Default Restored

Status: implemented

> **2026-08-23 update:** the shipped default was restored to the mounted bridge (user request) — the `intent-bridge` row in `packages/tui/tui/cordis.patch.yml` is uncommented again and `bundle-patch.spec.ts` asserts its routes. Everything else in this note stands: `/fast` remains the explicit user skip, the `enabled` fallback remains, and direct zen entry is one commented block away.

English | [中文](2026-08-22-zen-direct-entry-fast-skip.zh.md)

## Problem

The shipped TUI patch routed every new session through the intent bridge, and the bridge's multi-line task card structurally defeated zen's first-message triage (single-line, ≤80 chars), so even trivial prompts paid the full anchoring phase plus an extra alignment-model round trip. The user had no way to decline zen for a task they already knew needed no anchoring. Separately, mounting the bridge with `enabled: false` crashed `newSession`: the TUI treated service presence as routing consent while `createAlignedSession` throws when disabled.

## Decision

- **Comment-mounted, not deleted** — the `intent-bridge` row in `packages/tui/tui/cordis.patch.yml` is the shipped default again (restored 2026-08-23): new sessions run the alignment first, and triage's short-message skip is structurally preempted by the task card. Deployments that prefer direct zen entry comment the row out — either way the switch is one block, and `bundle-patch.spec.ts` asserts the row and its routes.
- **`/fast [message]` as the explicit user skip** — zen adds `'user'` to `ZenTransitionReason` and registers the command behind an optional `commands` inject (the `/plan` pattern; the TUI reaches it through its CommandService fallback). Before the first message the promotion lands before the first assembly, so the model never sees the zen face (triage-equivalent); mid-zen the unlock is visible from the next assembly with no narration. The optional message steers the turn; an already-promoted session settles as a benign idempotent success; under `faceSelection` the command refuses because the face is frozen. The zen invariant accepts the fourth promotion reason.
- **Disabled bridge falls back instead of throwing** — `IntentBridgeService` exposes an `enabled` getter and `newSession` checks it before calling `createAlignedSession`, so a mounted-but-disabled bridge yields a plain direct-to-zen session.

## Consequences

- The zen phase itself is unchanged. On the bridged default every new session pays one alignment round trip and anchors through the task card; direct-entry deployments (row commented out) keep the short-message triage skip, and `/fast` stays the explicit user skip either way.
- The promotion-reason vocabulary is now `arm | anchor | timeout | triage | user`; the persistence, config, and cordis catalogs plus the zen/intent-bridge READMEs were re-recorded bilingually.
- Deployments that want direct entry comment the patch row out; bridged sessions keep seeding zen-completed logs, so both entry modes coexist.

## Alternatives considered

- **A sidecar classifier that widens triage** — rejected: an extra model hop per session is exactly the cost removing the bridge reverses, and zen entry is already deterministic in message shape (length/newlines), so the user controls it without inference.
- **Shipping the row with `enabled: false` instead of unmounting** — rejected as the default: it still fails loud on missing routes at load and needed the same fallback fix; it remains a supported deployment state for staged rollouts.
- **Registering /fast in the TUI slash table instead of zen** — rejected: the phase owner registers its own exit (mirroring `/plan` in plan-mode), and the TUI's CommandService fallback already dispatches it without UI coupling.
