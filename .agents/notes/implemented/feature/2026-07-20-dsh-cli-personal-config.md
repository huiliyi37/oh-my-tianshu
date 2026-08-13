# Agent Note: The dsh CLI and personal config overlays from the Harness home

Status: implemented

English | [中文](2026-07-20-dsh-cli-personal-config.zh.md)

## Problem

A developer's own preferences — which provider and model the TUI uses, personal credentials, a private adapter route — had nowhere to live except edits to committed files. Pointing the TUI demo at a personal Anthropic-proxy Opus route meant patching `examples/tui-agent/cordis.yml` and `.env` in the working tree, which risks committing secrets and repeats per checkout. There was also no installable command: running the agent in an arbitrary project directory required invoking the repo's demo script from the repo root. Loader metadata is static, so "conditional composition uses overlays" (AGENTS.md) — but overlays only existed as committed sibling files, not as a machine-level layer.

## Decision

The entry modes and the personal file's name and location below are superseded by the [profile plugin bundles decision](../architecture/2026-08-05-profile-plugin-bundles.md): `dsh` boots profiles, and the personal layer became the per-profile and home-level `cordis.patch.yml`. What survives unchanged is this note's substance — the Harness home as the machine-level layer's root, patch semantics over a shipped composition, and fail-loud parsing.

Two coupled pieces, aligned with the `apps/` assembly tier proposed by the `dsh web` PR (#443):

**The `dsh` CLI (`apps/cli`, npm name `@deepseek-ai/dsh`).** `apps/*` is the product-assembly tier over `packages/*` libraries. One bin dispatches the default interactive TUI, `-p`/`--prompt` headless turns, and the `web` surface. The TUI boots `examples/tui-agent/cordis.yml` (or `--config`) with the invoking directory as the workspace. The committed `bin/dsh` launcher resolves the checkout through its own real path and runs the app with tsx's ESM hook; the [source-launch decision](../architecture/2026-07-29-dsh-source-launch-tsx-esm.md) owns that contract. `pnpm run demo:tui` runs the same entry.

**Personal config (`dsh-app-boot`).** The personal overlay lives in the Harness home — `$DSH_HOME`, else `~/.dsh` — resolved by the shared [`resolveDshHome`](../architecture/2026-07-24-single-harness-home-resolver.md) (`@deepseek-ai/dsh-paths`), the same single root skills and AGENTS.md resolve against. The dsh TUI, Web, and headless surfaces consume its two optional files; the demo bins boot their committed trees verbatim:

- `.env` — loaded after the invoking directory's `.env`; `process.loadEnvFile` never overrides, so precedence is ambient > project `.env` > personal `.env`.
- `config.yaml` — a top-level YAML array of `@cordisjs/plugin-include` `PatchOptions`, parsed with the include's own `!!js` dialect (`loadPersonalPatches`) and passed to `boot()`, which forwards it as the root include's `patches`. Patch semantics match the shipped surface overlays: an id-targeted patch replaces the named entry's whole `config`, `insert` appends entries, and an unmatched id is a silent no-op. The [repository Plugin integration](2026-07-30-config-only-repository-plugins.md) uses one shipped row to make an exact GitHub source list a config-only choice.
- A missing file means no overlay; a present-but-unreadable, unparsable, or non-array file throws at boot (misconfiguration fails loud, never a silent skip).

The PTY smoke's launcher isolates `$DSH_HOME` to a per-test directory, exactly as it already isolates `DSH_AGENTS_HOME`, so a developer's real personal overlay cannot leak into fixtures; only the dsh CLI reads personal config, so no other test launcher needed changes.

The TUI and Web register the exact personal path through Cordis HMR after boot. Every add, change, or removal transactionally recomposes the full patch list through the launcher's own composition closure, so the fresh personal patches land in the same layer position they booted in. Invalid YAML or a rejected Loader candidate leaves the last good tree active and broadcasts `hmr/config-update-failed(filename, Error)`; the headless surface reads the file once at startup. The Include also re-applies its patches on committed config-file refreshes (the [config hot-reload resilience Agent Note](../bug-fix/2026-07-20-config-hot-reload-resilience.md)).

## Alternatives considered

**A separate `bin/dsh` wrapper owning the `dsh` name.** Rejected because `apps/cli` is the single product CLI for default TUI, headless, and Web dispatch. Two competing entrypoints would collide in `$PATH` and product identity.

**A pi-style typed settings file (`defaultProvider`/`defaultModel`/`providers`).** Rejected by the user in favor of patch semantics: the personal file is a cordis overlay over the shipped default config, not a second config vocabulary to own and translate.

**A personal full `cordis.yml` that includes the requested config.** Rejected: the personal file would have to name the leaf config's path, which varies per checkout; patches invert the dependency so the bin keeps choosing the tree and the personal layer only amends it.

**Deep-merging personal patches into entry configs.** Rejected: it would fork the patch semantics from the committed overlays and the vendored include; whole-config replacement is already the documented contract.

**Opt-in via env flag instead of presence.** Rejected: personal config that is off by default never gets used; presence plus explicit per-test isolation gives live runs the overlay and tests hermeticity.

## Consequences

- `dsh` from any directory (and `pnpm run demo:tui`) can apply personal providers, models, repository Plugins, and other Loader entries with no checkout edit; verified end-to-end against a personal Anthropic proxy with Opus 4.8, including a bash tool round trip.
- Because an id-targeted patch replaces the whole `config`, a personal override restates the base fields it keeps and can drift when the base entry changes shape; the loader's entry-not-found/name-mismatch warnings and [`dsh --dump-config`](../../../../apps/cli/README.md#profiles) (which prints the composed tree those patches produce) are the diagnostics.
- Personal patches resolve ids against the booted file's own tree, so nested-include overlays (Code Mode) are not personalized; live-run parity for those leaves is deferred.
- `dsh-app-boot` depends on `js-yaml` and imports the include's `!!js` YAML dialect (`entryListSchema`) directly, and, like `apps/cli`, depends on `@deepseek-ai/dsh-paths` for `resolveDshHome`.
- Live watching belongs only to long-running TUI and Web processes. Headless automation gets deterministic startup configuration and exits without retaining a watcher.

## Testing

`packages/boot/app-boot/tests/user-patches.spec.ts` pins parsing, startup application, exact-path add/failure/recovery/removal, last-good rollback, failure broadcast, and preservation of app-owned patches. `apps/cli/tests/built-bin.e2e.ts` boots the real dsh bin over a profile and exercises the live patch layer end to end. Test launchers isolate `$DSH_HOME`, so a developer's real overlay cannot leak into fixtures.
