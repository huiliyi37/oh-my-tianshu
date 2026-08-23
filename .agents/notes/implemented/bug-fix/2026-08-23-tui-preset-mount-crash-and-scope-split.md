# Agent Note: The shipped TUI could not mount the standard preset

Status: implemented

English | [中文](2026-08-23-tui-preset-mount-crash-and-scope-split.zh.md)

## Problem

`a56b89bc54` made every shipped agent factory mount the default preset in `setup`. Booting the TUI then failed at the first session with `PresetMountError: preset "standard" failed to mount` — four loader entries rejected at once, and behind the visible crash sat four independent defects that the shipped composition had never exercised, because no factory had ever mounted a preset in it.

Two of the four were losses from the public-baseline migration (private `90d10bba` → `35c60d0b70`). The private repo's `e27d38efd6` had registered `cordis:group` as a loader builtin beside `cordis:include`, and its web overlay disabled base's 32 agent-plane rows once presets owned the agent plane; both facts vanished in the migration, so every `cordis:group` row in a preset resolved to `undefined` (`plugin[Symbol(cordis.group)]` on undefined) and `dsh-skill-local` collided with base's own global registration ("a skill provider named 'local' is already registered"). Third, `apps/cli`'s preset dependency closure (from `649d733af9`) missed `@huiliyi37/dsh-tool-pwsh`, the one standard-preset row base does not also carry, so the profile's flat module fallback could not resolve it. Fourth — visible only after the first three were fixed — mounting succeeded but the agent's face stayed `['str_replace_editor', 'zen_anchor']`: two `dsh-scope` defects and a zen defect split the preset layer away from the agent view.

## Decision

The scope split had two layers. `dsh-scope` keyed its context tag with `Symbol('dsh.scope')` and its carrier/parent relations in module-level WeakMaps, but loader-mounted rows run against a second copy of the module in mixed source/built worlds (the tsx source launch, vitest transformers): the tag on the standing context was literally a different symbol instance than the one `scopeOf` read, and `bindScopeParent` wrote a parent into a WeakMap the registry's view walk never consulted. Sharing the marker (`Symbol.for`) and hosting the two stores on `globalThis` under registered symbols makes one process hold one routing table regardless of module copies.

The remaining gap was zen's face arming. `armRestrict`/`completeArm` read "which tools exist" through the GLOBAL view (`tools.schemas()` with no scope). In the preset world `bash`/`todo_write`/`subagent` live only in the standing scope's layer, so the zen face armed as `['str_replace_editor']`, and `completeArm` would have failed loud at the first message for names that were visible all along — a global read cannot arm a scoped face. Reading the agent's own post-restriction view instead is self-defeating (the armed restriction hides the names it still owes), so the registry gained `restrictableNames(scope)`: the chain-aware, pre-restriction name set `restrict()` itself validates against.

- `packages/boot/app-boot`: register `ctx.loader.builtins.group = Group` beside `include` (restores `e27d38efd6`).
- `packages/tui/tui/cordis.patch.yml` and `packages/bundle/web-app/cordis.patch.yml`: disable the 21 base rows the standard preset re-provides at the agent plane. Host-plane rows (registries, subagent backends, executors) and preset-absent faces (`tool-git`, `tool-str-replace-editor`, …) stay global — preset sessions still see them through the scope chain.
- `apps/cli/package.json`: add `@huiliyi37/dsh-tool-pwsh` to the preset dependency closure.
- `packages/core/scope`: `Symbol.for` marker + `globalThis`-hosted carrier/parent stores (one process, one table).
- `packages/core/tools`: public `restrictableNames(scope)`; `dsh-zen` arms and completes against it.
- Paid alongside: ACP `newSession` now mounts the default preset like every other factory ([companion note](../architecture/2026-08-23-preset-default-inheritance-and-agent-mount.md)); `runner.spec`'s welcomeAnimation passthrough tests retired with the field `51824216f3` deleted; `SOURCE-MAP.md` gained the `cache-telemetry.ts` row `78703fd9c8` omitted.

## Consequences

Every shipped profile that mounts a roster now runs the division of labor the preset files always documented: host-plane rows global, the agent plane composed per preset, base-unique faces still visible through the scope chain. `restrictableNames(scope)` is a new public registry read for face-arming; scope routing survives duplicate module copies instead of silently splitting per copy. Committed test debt from `51824216f3` (welcomeAnimation passthrough) and `78703fd9c8` (SOURCE-MAP row) is retired alongside, and the ACP bridge mounts like every other factory.

## Alternatives considered

- **Strip the agent plane out of dsh-base instead of disabling per overlay.** Rejected: base-only deployments (a profile with a rosterless composition) would lose every tool the moment no preset mounts; overlay disables keep base self-sufficient and put the choice where the roster is.
- **Read the agent's post-restriction view in zen's completion check.** Rejected: the armed restriction hides exactly the names the check still owes, so the debt could never settle; the pre-restriction set `restrict()` itself validates against is the correct read.
- **Eliminate the mixed source/built world instead of sharing scope state.** Rejected: the source-launch contract (tsx ESM) and test transformers both load rows against built lib by design; one process-wide routing table is the smaller, honest fix.

## Testing

`apps/cli/tests/tui-preset-composition.spec.ts` boots the real tui profile through `prepareProfile` (temp `$DSH_HOME`, real bundle patch layers, shipped preset root, only the renderer and HMR rows disabled) and pins three facts: the roster boots with `standard` default; the global layer carries no preset-owned tool while base-unique faces stay visible; a factory-mounted session arms the exact zen face `['bash','str_replace_editor','subagent','todo_write','zen_anchor']` — three of those five arrive only through the standing layer, so the list is false before the fix. The real TUI boots clean (`node --import tsx/esm apps/cli/src/bin.ts tui`). Affected suites green: zen, scope, agent-presets, tool-skill, tool-subagent, tools, app-boot, tui.
