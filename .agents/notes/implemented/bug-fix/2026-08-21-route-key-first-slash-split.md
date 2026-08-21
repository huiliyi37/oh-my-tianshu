# Agent Note: Route Keys Split on the First Slash

Status: implemented

English | [中文](2026-08-21-route-key-first-slash-split.zh.md)

## Problem

The TUI composes picker rows and accepts `/model` arguments as `provider/model` strings, and every consumer parsed them with `value.split('/')` destructuring — which silently truncates a model id that itself contains `/`. OpenRouter-style ids (`stealth/ox-alpha`, `anthropic/claude-sonnet-4.5`) made the picker confirm `{provider: 'openrouter', model: 'stealth'}` and the argument grammar reject three-segment input as malformed, so selecting the shipped OpenRouter model failed its first request with `UNKNOWN_MODEL`-shaped errors naming the truncated id.

## Decision

`provider/model` keys split on the **first** slash only: provider route keys never contain `/` (catalog ids and settings dict keys), while model ids verifiably can. `parseRouteKey` in the TUI's shared `model-roles.ts` pure layer is the single parser; the main and role picker callbacks and both `/model` argument paths use it. A slash-free input keeps the existing bare-model semantics (current provider, new model); a slash-containing input is always read as provider-then-model, so `stealth/ox-alpha` under a non-matching current provider is a catalog-check failure naming the bogus provider rather than a guess.

## Alternatives considered

- **Provider-aware parsing** (treat the first segment as a provider only when it matches a known route). Rejected: the parse would depend on live catalog state, so the same input could mean different things as routes come and go, and the pure-function layer would need the llm seam injected.
- **Rejecting slash-containing model ids** at the profile layer. Rejected: the ids are provider-native (OpenRouter, and any vendor-prefixed gateway); forcing renames would desynchronize the harness catalog from the wire.

## Consequences

- OpenRouter catalog routes are fully usable from the TUI pickers and `/model` arguments, including role pins (`/model vision openrouter/stealth/ox-alpha`).
- Inputs like `a/` or `/b` (empty side) no longer reach the usage-error branch but fall to the bare-model path and die in the catalog check with the same loud message as any unknown model.
- The web composer is unaffected: it composes structured provider/model values and never string-parses.
