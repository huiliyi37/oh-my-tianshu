# Agent Note: TUI key dialog and `/model` role pins

Status: implemented

English | [中文](2026-08-21-tui-key-dialog-and-role-pins.zh.md)

## Problem

The TUI could detect a missing DeepSeek credential (welcome line, footer badge, `/config` panel) but offered no way to set one — the only write path into the credentials seam was the web Models page, so a terminal-only user had to hand-edit `.env` or learn the file layout before the first request could succeed. The `model-roles` seam (see [Per-role model pins](2026-08-21-model-role-pins.md)) likewise landed without a TUI front door, reachable only by editing `settings.yaml`.

## Decision

`packages/tui/tui/src/ui/key-dialog.ts` is a masked-input overlay that writes through the existing `ctx.credentials` seam rather than inventing storage: the key is probed against `GET {baseURL}/models` first (`DEEPSEEK_BASE_URL`, defaulting to the official endpoint), where 401/403 refuses the write, and a network error or timeout — which cannot disprove the key — warns and allows an explicit save-anyway confirm. A `describe()` reporting `writable: false` (the process environment shadows the reference) short-circuits to an explanation state instead of a write that could never take effect, and a missing credentials service degrades to guidance for setting the environment variable. The dialog opens from `/key` (alias `/login`) and once per launch after the welcome screen when no key resolves; a successful save re-runs the readiness check so the welcome line and footer flip without a restart, which the per-request credential resolution in `llm-deepseek` already guarantees. The dialog consumes a minimal structural credential face (`KeyDialogCredentials`) instead of importing `dsh-credentials`, keeping the package boundary at the assembler.

`/model` gains the role subcommands `vision` / `secondary` / `subagent` (picker or direct `provider/model` argument) that call `ctx.modelRoles.pin`/`unpin`; the picker's first row clears the pin back to "follow the default". The three role words are now reserved in `/model`'s first argument, taking over the old bare-word meaning (a model literally named `vision` must now be addressed as `provider/vision`). The `/config` panel shows each role's pin state — pinned route or "follow the default" — and deliberately does not replicate the consumers' fallback chains, which span plugins the panel cannot see. Role logic lives in `src/model-roles.ts` and the dialog in `key-dialog.ts`, so `app.ts` carries wiring only.

## Alternatives considered

- **Editing `$DSH_HOME/.env` from the TUI** — the `.env` layers resolve below the credentials store and are shadowed by the process environment anyway; the credentials seam already owns the writable, hot-published store, so a second write path would fork the precedence contract.
- **Validating the key only on the first request** — a first-run flow whose failure surfaces one turn late is exactly the guidance gap being closed; grok-build probes the key at initialize with the same refuse-on-401/403, allow-on-network-error taxonomy.
- **Full effective-resolution display in `/config`** — an honest per-role "effective route" would need each consumer's fallback chain (composition config, auto-bridge, session inheritance), none of which is queryable cross-plugin; the panel shows pin state plus a pointer to `/model <role>` instead.

## Consequences

The probe endpoint and dialog copy are DeepSeek-specific while the dialog's structure (describe-gated write, probe taxonomy, masked input) is provider-neutral — onboarding another provider means a new ref and probe URL, not a new dialog. The first-run auto-open is once per launch, not a persisted dismissal. The reserved-word takeover of `/model vision` is a behavior change for any user with a bare model id matching a role name. `app.ts`'s source budget rose 4061 → 4435 across this feature and the key-dialog wiring; both features landed their logic in separate modules, and the manifest edit keeps the growth review-visible.

## Testing

TUI specs cover the dialog state machine (masking past eight characters, the env-shadowed blocked state, invalid-probe return to input, unknown-probe save-anyway, the `onSaved` refresh) and the role commands (picker opening and current-pin marker, direct pin, catalog rejection with suggestions, vision warning for non-`supportsVision` models, the follow-default unpin row, degradation when the seam is absent), plus the `/config` section's two render states.
