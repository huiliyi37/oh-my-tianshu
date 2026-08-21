# Agent Note: TUI Provider Key Wizard

Status: implemented

English | [中文](2026-08-21-tui-provider-key-wizard.zh.md)

## Problem

`/key` was welded to DeepSeek: a hardcoded `DEEPSEEK_API_KEY` reference, a DeepSeek-only probe, and DeepSeek-specific copy. With a multi-provider composition shipped (the built-in OpenRouter route, plus ~45 pi-ai catalog providers), a TUI user had no in-terminal way to configure or rotate any non-DeepSeek key — the web Models page or hand-editing `~/.dsh-tianshu/.credentials.yaml` were the only paths, and the first-run auto-prompt checked only the DeepSeek key. The competitor flow (opencode-tui's `/connect`) showed the shape users expect: pick provider → paste masked key → probe → saved hot.

Two service-side gaps blocked a seam-native version. Discovery short-circuited to the installed catalog whenever `provider` named a catalog route, so a draft key never reached the wire and never got authenticated; and 401/403 shared the `DISCOVERY_FAILED` code with network faults, leaving a key-testing surface no machine-checkable way to tell "bad key" from "bad endpoint" (parsing the message is against the error doctrine).

## Decision

The wizard is `/key` itself, not a new command: it opens a provider picker built from `ctx.llm.listConfigurableProviders()` (default provider pinned first with the `current` marker, ` ✓` suffixed to providers whose reference resolves via `credentials.describe`), then chains — after the picker overlay deactivates, via microtask, because the engine switches rather than stacks overlays — into the existing masked-input dialog, now parameterized by a `KeyDialogTarget` (provider, displayName, ref, probe, optional `afterSave`). References resolve profile-first: the resolved settings section's `apiKeyEnv`, else `deriveKeyRef(provider)` (uppercase, non-alphanumeric runs collapse to `_`, `_API_KEY` suffix — the same rule the web Models page applies). A pi-ai route with no profile gets a minimal `{ apiKeyEnv }` written through the settings seam after the key saves, so the route registers live and `/model` offers it immediately; the DeepSeek namespace keeps its schema-default reference and its own endpoint probe. First-run prompting and the welcome/footer readiness flags generalized from "DeepSeek key present" to "the default provider's key present".

On the service side, discovery now treats a draft `apiKey` as an opt-out of the catalog answer — the request resolves the endpoint from the catalog when none was supplied and authenticates on the wire — and 401/403 throw `LlmError(…, 'AUTH')` (the established code for endpoint-rejected credentials), so the wizard maps `AUTH`/`INVALID_CREDENTIAL` → invalid, everything else → unknown (save-anyway escape preserved).

## Alternatives considered

- **A new `/connect` command** (competitor naming). Rejected: `/key`/`/login` are the established surfaces and the flow is the same act; a second name buys nothing and splits discovery.
- **A TUI-side provider→endpoint table for probing.** Rejected: it duplicates the pi-ai catalog's URLs and drifts; the discovery seam already knows every catalog endpoint, and the draft-key semantics make it a real authentication probe.
- **Letting the catalog short-circuit stand and skipping probes for catalog routes.** Rejected: an unverified save defeats the wizard's core promise (the competitor's probe-first design), and a wrong key would surface later as a mid-session failure.
- **Message-parsing to classify 401/403 in the TUI.** Rejected: the error doctrine forbids it; the fix belongs in the seam as a code.
- **Moving `deriveKeyRef` to a shared package.** Rejected for now: one line pinned by tests on both sides, cross-linked in comments; a micro-package for it costs more than the drift risk it removes.

## Consequences

- Any configurable provider's key can be configured, rotated, and verified from the TUI; saving hot-publishes through the credentials seam (no restart) and activates dormant pi-ai routes on save.
- Discovery's catalog short-circuit is now conditional (`apiKey === undefined`), which is a behavior change for any surface that passed both a catalog `provider` and a draft `apiKey` expecting a cached answer — the web Models page passes the draft only from its own key field while editing, where a wire verdict is what it wants.
- `AUTH` from discovery is a new machine-checkable verdict; the web surfaces don't branch on discovery codes today, so their error display is message-only and unchanged.
- The key dialog remains provider-ignorant (targets injected); its constructor-level probe override survives as the test seam above target probes.
- Not done: OAuth login flows in the TUI (the web has them via the authorization seam), `/disconnect`, and wizard draft resumption — deliberate scope cuts.
