# dsh-scope

English | [中文](README.zh.md)

Scoped registration primitive. `createScope(ctx, key)` creates a tagged Cordis context whose backing fiber owns every registration made through it. `scopeOf(ctx)` reads the tag, and `scopeTarget(base, key)` routes scoped events to listeners with the same key while leaving unscoped listeners global. The agent loop creates one scope per live agent, but the mechanism is key-agnostic so lower-level packages can use it without depending on agents.

## Public API

- `createScope(ctx: Context, key: ScopeKey): Scope` Mint a scope under `ctx`'s fiber. Usable synchronously (effect collection is uid-gated; service resolution falls through to the minting plugin's dependency surface). The typed, same-process key is trusted; an inactive minting context still fails through Cordis (`INACTIVE_EFFECT`).
- `Scope.ctx` The tagged context: registrations through it are scope-visible AND scope-lifetime. Derived contexts (an `extend`, a fiber mounted under it) inherit the tag; nested scopes shadow (nearest tag wins).
- `Scope.rawDispose` The EXACT Cordis disposer for the backing fiber — a composite (generator) effect yields THIS function to nest the scope's teardown at that yield position (Cordis dedupes nested effects by function identity; yielding a wrapper leaves the scope disposing as a concurrent sibling).
- `Scope.dispose(): Promise<void>` Idempotent, shared quiescence boundary for every registration made through the scope. Racing/repeat calls await the same teardown, including when `rawDispose` invoked the underlying single-shot Cordis disposer first.
- `scopeOf(ctx: Context): ScopeKey | undefined` The tag a context (or any context derived from it) carries; `undefined` = context-global.
- `scopeTarget(base: T, key: ScopeKey | undefined): Scoped<T>` Build the opaque dispatch `thisArg` for a scope-filtered event. It composes `base`'s existing `Context.filter` with the scope predicate (untagged listener ⇒ admitted; tagged ⇒ admitted iff tag === key; `key === undefined` ⇒ untagged only). The carrier contains routing state only; the real subject is carried by the event arguments. `{ global: true }` listeners bypass filtering (Cordis semantics).
- `Scoped<T>` The compile-time opaque carrier brand: scope-filtered events demand it as their `this` type, so dispatching with a bare subject is a compile error. The type parameter records the subject type but does not expose its properties.
- `isScopeCarrier(value)` / `carrierKeyOf(value)` Runtime carrier marks, used by the dev invariants to assert every scope-filtered dispatch carries a carrier keyed to the subject its arguments name.
- `ScopeLayer` Aggregate contract for one registry's complete global or exact-scope contribution; `isEmpty()` controls scoped-layer reclamation.
- `ScopedLayers<L>` Own one eager global layer and lazy exact-scope layers. `peek()` never creates, `merge()` materializes insertion-ordered named shadows, and `effect()` derives visibility and ownership from the same context while returning the exact Cordis disposer.
- `NamedEntries<V>` Insertion-ordered named storage with caller-owned duplicate diagnostics, lookup, and live iteration within one nonempty table generation; draining the table detaches existing iterators from later insertions, and `insert()` returns an idempotent exact-entry undo.
- `AnonymousEntries<V>` Insertion-ordered anonymous storage whose unique internal keys keep equal values as independent registrations; it uses the same drained-generation iterator boundary, and `append()` returns an idempotent exact-entry undo.

The optional `@deepseek-ai/dsh-scope/invariant` companion owns that runtime assertion. It uses the generated `scoped-events.generated.ts` resolver map to require a carrier for every declared scoped event and, when the payload exposes its routing subject, require identity with the carrier key. The Program-backed generator derives the map from event declarations and real `scopeTarget(base, key)` calls.

## Design contract

The registration context determines both visibility and ownership, preventing a registration from being visible in one scope but disposed with another. Scopes route trusted same-process plugins; they are not sandboxes or authority boundaries. See the [agent-scope Agent Note](../../../.agents/notes/implemented/architecture/2026-07-08-agent-scope-contexts.md#security-and-authority-are-non-goals) for rationale and security non-goals.

Scope-aware services define a concrete `ScopeLayer` that aggregates their heterogeneous tables and domain helpers. `ScopedLayers.effect()` accepts one synchronous action returning one synchronous undo, installs that undo before optional notification, and reclaims an exact-scope layer only when the complete aggregate is empty. `notify` defaults to `true`; the supplied callback owns whether observer failures throw or are contained. `EntryValues` remains internal, the storage classes are imported from the package root rather than a `/store` subpath, and the shared storage does not define registry-specific filtering or iteration policy. See the [shared scoped-layer storage Agent Note](../../../.agents/notes/implemented/architecture/2026-07-12-scoped-layers-store.md).

Handing out a scoped context hands out the minting plugin's service-resolution surface (resolution walks the minting fiber's dependency chain, not the holder's) — mint it from the plugin whose dependencies the scoped registrations need to resolve.

## Known Limitations and Deferred Work

- **Only scope-aware surfaces isolate state** — registries must file by `scopeOf()` and events must dispatch through `scopeTarget()`; an arbitrary Cordis service remains context-global merely because it is called through a scoped context.
- **A context carries one nearest scope key** — nested scopes shadow their parent's tag rather than forming hierarchical or multi-membership policy sets.
- **Service reachability comes from the scope minter** — handing out `Scope.ctx` also hands out the minting plugin's injected service surface, so a broader minter cannot later be narrowed by the holder.
