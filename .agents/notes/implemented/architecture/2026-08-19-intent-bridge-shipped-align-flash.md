# Agent Note: Shipped TUI align route is DeepSeek flash

Status: implemented

English | [中文](2026-08-19-intent-bridge-shipped-align-flash.zh.md)

## Problem

The TUI bundle mounted intent-bridge with `alignProvider: minimax` / `alignModel: MiniMax-M3`. `llm-pi-ai` mounts dormant: the `minimax` route does not register until a `llm-pi-ai:` settings profile exists, and that profile needs its own key. A first-run user has only `DEEPSEEK_API_KEY`. Alignment still opens a tab, the first request fails (`MISSING_CREDENTIAL` or no adapter), and the error path hands the raw message to the main session — the task is not blocked, but first-run alignment does not run.

## Decision

The shipped TUI `cordis.patch.yml` sets both intent-bridge routes to `deepseek-official` / `deepseek-v4-flash` — the same out-of-box adapter and key as `agent-default-model`. A MiniMax (or any other) alignment route remains a deployment overlay on the same row, after the chosen adapter is live. Alignment does not follow `/model`: the exec override still does, so switching the execution model to pro leaves clarification on flash.

The two-session split is unchanged: the alignment session is seeded zen-complete and sees only `finalize_alignment`; the fresh main session receives the task card and arms zen. See [the intent-bridge Agent Note](2026-08-18-intent-bridge.md).

## Alternatives considered

- **Require a MiniMax key on first run (TUI `/config` write path).** Rejected: a second paid key before the first prompt. Web Settings → Models already adds catalog providers; that surface stays the way to opt into MiniMax.
- **Align follows the current `/model` selection.** Rejected this change: a user who switches execution to pro would also clarify on pro. Overlay covers the case where alignment should track a non-default route.
- **Keep MiniMax as the shipped default and rely on the error fallback.** Rejected: the first tab is titled 意图对齐 and the first turn errors; fallback is recovery, not onboarding.
- **A user-facing align-route setting next to `/model`.** Deferred: profile `cordis.patch.yml` is the existing deploy override; a settings field is a later product surface, not required to unblock first run.

## Consequences

- First-run TUI alignment uses the same DeepSeek key as `/model`; no `llm-pi-ai` profile is required to open a new session.
- The cheap MiniMax split is opt-in: overlay the align pair and add the pi-ai profile plus key (Web Models page or `settings.yaml`).
- A user whose `/model` is `deepseek-spark` still aligns on `deepseek-official` flash (same key, different route).
- Headless snapshot fixtures may still name `minimax` as a dual-adapter test route; that is not the shipped TUI default.

## Testing

- `packages/tui/tui/tests/bundle-patch.spec.ts` pins `alignProvider` / `alignModel` / `execProvider` / `execModel` to `deepseek-official` / `deepseek-v4-flash`.

## Related

- [Intent bridge](2026-08-18-intent-bridge.md) — session split, handoff, and zen seed.
- [Configure models](../../../../docs/user/guide/providers.md) — how a deployment adds a pi-ai catalog route and key.
