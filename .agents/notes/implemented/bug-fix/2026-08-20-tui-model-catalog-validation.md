# Agent Note: /model 目录校验——拼写错误不再切换

Status: implemented

English | [中文](2026-08-20-tui-model-catalog-validation.zh.md)

## Problem

`/model <text>` accepted any string and persisted it as the default plus hot-switch target: a typo'd model id (`deepseek-v4-pr`), an unregistered provider, or a malformed route (`a/b/c`) all "succeeded", and the failure only surfaced at the next agent step as a dispatch error. Competitors (Claude Code, Codex, Gemini CLI) validate manual model switches against the known catalog and suggest the closest match.

## Decision

Validate in the TUI command layer (`packages/tui/tui/src/commands/registry.ts`), after alias expansion and before `saveSelection`, against the llm catalog read through a minimal `LlmCatalogFacet` via `ctx.reflect.get('llm', false)`. The llm `listModels` catalog is contractually **advisory** — absence from a catalog must not become request rejection — so the policy is tiered:

- Unknown provider (`listProviders()` has no such route): authoritative, the request would fail at dispatch — hard reject, listing registered providers.
- Known provider with a non-empty catalog, model not listed: the adapter advertises a closed set — hard reject with up to three near suggestions (case-insensitive exact → prefix → substring; never auto-correct).
- Known provider with an empty/failed catalog: cannot disprove — allow.
- llm service unassembled: skip validation (previous behavior).

Malformed shapes (`a/b/c`, empty segments) get a usage line; nothing switches. Rejections name the still-current selection. The spark aliases now fail loud when `deepseek-spark` is not registered, instead of silently saving a dead route.

## Alternatives considered

**Validate inside `dsh-agent-default-model` (service layer).** Rejected: the catalog is advisory by llm contract, so a service-level hard rule would break adapters that legitimately accept unlisted ids (OpenAI-compatible proxies); the TUI convenience layer is where competitor-parity UX belongs.

**Warn but switch anyway.** Rejected: it does not fix the reported pain — the typo still becomes the live selection.

**Edit-distance fuzzy suggestions.** Rejected: prefix/substring matching covers the observed typos (truncated ids, missing suffix) with zero new dependencies.

## Consequences

Bad `/model` input now fails at the command line with an actionable message instead of at the next model request. OpenAI-compatible deployments keep working because empty catalogs stay permissive. The no-arg picker path is unchanged (it only offers catalog entries).

## Testing

- `packages/tui/tui/tests/commands.spec.ts` — six new `/model` cases: unknown provider rejected (registered routes listed), off-catalog model rejected with near suggestion, empty catalog allowed (advisory), bare model name validated against the current provider's catalog, malformed `a/b/c` usage line, spark alias rejected loud when its provider is unregistered. All pre-existing cases run without an llm facet and pass unchanged.

## Related

- [TUI model hot-swap](../../feature/2026-08-11-tui-model-hot-swap.md) — owns the saveSelection + switchLiveModel path this validation guards.
