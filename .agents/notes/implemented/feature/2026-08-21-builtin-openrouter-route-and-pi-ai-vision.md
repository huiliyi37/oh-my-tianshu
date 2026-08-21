# Agent Note: Built-in OpenRouter Route and pi-ai Image-Input Declarations

Status: implemented

English | [中文](2026-08-21-builtin-openrouter-route-and-pi-ai-vision.zh.md)

## Problem

Out of the box the product served exactly one provider: `llm-deepseek` registers `deepseek-official`, while `llm-pi-ai` mounts dormant by design — "which adapters exist is composition; which providers run is the user's settings document" ([[2026-07-14-provider-routed-llm-adapters]]). Making OpenRouter's `stealth/ox-alpha` (a free 1M-context reasoning model) usable without a per-user settings write meant breaking that dormancy with a shipped provider profile.

On the capability side, the multimodal image chain ([[2026-08-13-tui-image-paste-and-vision-bridge]]) never reached a pi-ai route. `PiAiModelProfile` had no input-modality field, so a hand-declared model materialized `input: ['text']` and pi-ai silently downgraded its images to "(image omitted…)" placeholders; and the adapter never reported `supportsVision` even for catalog models that take images (the `gpt-4.1` class), so the composer's direct-send gating, the vision bridge's auto-pick, and `ask_image` treated every pi-ai model as text-only. A TUI drift compounded it: `app.ts`'s local `llm` facet read a nonexistent `inputModalities` field, so the post-switch vision refresh always evaluated false.

## Decision

The base bundle's `llm-pi-ai` row carries one shipped profile: route `openrouter`, `apiKeyEnv: OPENROUTER_API_KEY`, model `stealth/ox-alpha` with `contextWindow: 1048576`, `maxTokens: 131072`, `supportsVision: true`, and `reasoningEfforts: {low, high, max}` — capacities and the effort vocabulary are OpenRouter's own published model facts; `compat` is deliberately unstated because pi-ai's provider-id detection already speaks the OpenRouter dialect (nested `reasoning.effort` parameter, no developer role), exactly as it does for its own 276-model OpenRouter catalog. The composition/settings split keeps its rule with one shipped exception; a user `llm-pi-ai:` section still merges over the route per provider, `models` arrays replace wholesale, and the route itself cannot be removed from settings (the pre-existing layered-merge limitation, now with a live instance). Without a key the route registers and lists, failing `MISSING_CREDENTIAL` only when used — the same keyless posture `llm-deepseek` ships in.

`PiAiModelProfile` (and `modelOverrides`, which shares its fields) gains `supportsVision`: absent inherits the installed entry's input modalities (a hand-declared model is text-only), `true` forces `['text', 'image']` onto a model the catalog ships text-only, `false` strips image input from one the catalog ships multimodal. It materializes as pi-ai's `Model.input`. The adapter reports `supportsVision: input.includes('image')` from both `listModels` and `resolveModelInfo` — a stated boolean, because pi-ai's `input` is authoritative — which makes catalog vision models usable as vision bridges with no per-model config. `stream()` refuses images bound for a text-only model with `UNSUPPORTED_CONTENT` before credential resolution or network I/O, mirroring `llm-deepseek`'s gate ([[2026-08-19-direct-deepseek-vision-input]]): pi-ai itself would only downgrade them to placeholders, which would look like the model having seen them.

The TUI facet now reads `supportsVision`; the declaration's three-state semantics parallel `reasoningEfforts` ([[2026-08-08-pi-ai-per-model-reasoning-declarations]]).

## Alternatives considered

- **Settings-only provider add** (the documented dormancy path, zero product change). Keeps the posture pure but ships nothing: every user re-derives the same profile. Chosen as the rule, with the shipped route as the deliberate exception, because the model is meant to be product-visible on day one.
- **A dedicated `llm-openrouter` adapter package** (the `llm-deepseek` pattern). Duplicates a provider pi-ai's catalog already serves, and collides with it: the moment a user configures route `openrouter` through `llm-pi-ai`, `DUPLICATE_ADAPTER` refuses the whole registration.
- **A free-form modalities array** (pi-ai's `Model.input` shape) as the profile field. The harness seam's vocabulary is the single boolean `supportsVision` on `LlmModelInfo`; an array exports pi-ai vocabulary — including a video notion pi-ai 0.82.1 cannot dispatch — to every configuration surface for no consumer.
- **Surfacing capability through `resolveModelInfo` only.** Pickers and the vision bridge's auto-pick enumerate `listModels`; half-surfacing leaves every pi-ai vision model unpickable as a bridge.
- **Letting pi-ai's placeholder downgrade stand** (no adapter gate). Contradicts fail-loud, and the deepseek adapter already refuses; asymmetric silence between adapters would be the worse drift.

## Consequences

- Every profile (tui/web/headless) serves `openrouter`/`stealth/ox-alpha` out of the box; `shipped-composition` e2e pins the route, capacities, vision flag, and effort offer against the real bundle.
- The shipped model's base-declared `reasoningEfforts` is merge-locked: a user layer can re-spell a level but not remove one, so editing that model is better done by restating its `models` list (README and providers guide document this).
- Web goldens changed with the shipped row: the Models page now always shows an OpenRouter card, and `default-model.e2e`'s reset finale no longer ends on an empty registry — the composition route survives `replace` by design.
- pi-ai catalog vision models become bridge candidates everywhere `supportsVision` is read, with zero configuration.
- The image-chain coverage gap noted in [[2026-08-13-tui-image-paste-and-vision-bridge]] (upstream keyless image snapshots unported) stands; this change's wire path is pinned by mock-server specs instead.

## Testing

`catalog.spec` covers `supportsVision` materialization both directions beside inheritance; `adapter.spec` covers the capability surfacing, the gate's ordering (refusal before credential resolution, zero HTTP), and the image data-URL round-trip on the wire; TUI `app.spec` covers the post-switch vision refresh against the real facet shape; `shipped-composition.e2e` pins the shipped route end to end; the `models-settings` and `onboarding` goldens carry the assembled-page transcript.
