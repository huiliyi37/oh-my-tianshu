# Agent Note: Skill providers are scope-layered, not process-global

Status: implemented

English | [中文](2026-08-24-skill-providers-scope-layered.zh.md)

## Problem

`/preset taiyi` on a session whose roster already ran `standard` failed with `a skill provider named "local" is already registered`: both preset compositions carry `skill-filesystem` (`dsh-skill-local`), and the skills registry enforced provider-name uniqueness on one flat, process-global map. The preset files always documented the other design — "the skill registry is layered per scope: these rows register into THIS preset's layer" — but the implementation never had layers, so any second standing composition collided.

## Decision

Provider storage moves onto `ScopedLayers` (the same primitive the tools registry uses). `registerProvider` derives the calling scope through the traced receiver (`scopeOf(this.ctx)`), files the provider into that scope's layer (global layer for host-plane callers), and enforces name uniqueness per layer: two live presets may each run a same-named provider, a scoped entry shadows a global one for its scope's view, and a duplicate inside one layer still throws as the double-mount bug it always was. Catalog folds (`list`/`snapshot`/`get`) resolve the querying scope the same way — global entries first, scope-chain entries shadowing by name, nearest scope winning. The collect cache keys on a stable per-scope id so one agent's cached catalog cannot serve another preset's view.

## Alternatives considered

- **Throw on cross-scope duplicates and make presets rename their providers.** Rejected: provider names are catalog identity (precedence ranks, `skills/change` attribution); per-preset renames would leak composition details into user-visible names.
- **One standing composition at a time — unmount standard before mounting taiyi.** Rejected: standings exist so joined sessions keep running under their composition; unmounting standard would break every standard session mid-flight.

## Consequences

The registry now matches the scoped registration model the tools registry established; runtime skill registrations (`register`) stay flat and first-wins. `dsh-skill` gains a `dsh-scope` peer dependency.

## Testing

Unit: two scopes registering same-named providers coexist with per-scope views; a scoped provider shadows the global one for its scope only; a same-layer duplicate still fails loud. Composition (`apps/cli/tests/tui-preset-composition.spec.ts`): a taiyi session mounts while a standard session stays mounted — both arm the exact zen face and no tool or provider collides.
