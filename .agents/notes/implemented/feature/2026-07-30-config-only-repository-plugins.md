# Agent Note: Config-only repository Plugins for standalone dsh

Status: implemented

English | [中文](2026-07-30-config-only-repository-plugins.zh.md)

## Problem

A standalone `dsh` user has no developer-owned SDK project whose `package.json`, lockfile, and `cordis.yml` can carry an external Plugin dependency. Requiring an install command or another state file would make “use this repository” a multi-step workflow, while trusted repository code still needs an exact-source, transactional lifecycle owned by the [repository package format](../architecture/2026-08-08-trusted-repository-package-code.md). Long-running TUI and Web processes also need a failed edit to preserve their usable Plugin generation and tell observers why the candidate was rejected.

## Decision

The shipped TUI and Web/headless `cordis.yml` trees contain an empty `repository-plugins` entry. A user changes only `$DSH_HOME/config.yaml`, replacing that entry's config with a `repositories` list. Each item uses `github:owner/repository#<ref>` plus an optional `&path:/.../.dsh-plugin`; omission selects `/.dsh-plugin`. An explicit ref is mandatory, paths are absolute within the repository and end in `.dsh-plugin`, and duplicate normalized specifiers reject before installation. There is no marketplace, discovery index, HTTPS URL vocabulary, or implicit latest generation.

`@deepseek-ai/dsh-repository-plugin` validates and normalizes each source, then resolves it through the generic vendored [`RepositoryCache`](../architecture/2026-07-30-package-manager-native-repository-cache.md). The default cache is `$DSH_HOME/cache/repository-plugins`; `cacheDir` is the explicit deployment override. Bundled pnpm selects the configured repository subpackage, installs its dependencies, runs its package-authored `prepack`, and atomically publishes the exact specifier. The selected package's direct development dependency on `@deepseek-ai/dsh-repository-plugin` supplies `dsh-plugin-prepare` through package-local `node_modules/.bin`; the lifecycle invokes it after any package-owned build. The DSH host imports the generated `dsh-plugin.mjs` wrapper and mounts it as a child fiber; that wrapper composes static skill and MCP owners plus an explicit trusted Cordis entry when declared.

## Live update and failure

`dsh-app-boot` mounts the root Include through one helper that retains its exact Loader `Entry`. The TUI and Web register `$DSH_HOME/config.yaml` through Cordis HMR; headless reads the same file at startup without retaining a watcher. A watcher update rebuilds the Include patch list as immutable app-owned patches followed by the newly parsed personal patches, so Web-generated port, session-root, trust, and frontend values survive every personal edit unless a later personal patch deliberately replaces that row.

Cordis serializes and coalesces exact-path changes. Include and Loader reconcile a candidate transactionally: success commits the new source list, while fetch, preparation, wrapper import, format, or child-Plugin failure rejects the candidate and retains or restores the last good tree. HMR normalizes the caught value to `Error`, logs it, and broadcasts the parallel `hmr/config-update-failed(filename, error)` event; observer failures cannot break refresh processing. Repository MCP servers use strict startup, so an initial connection, discovery, or tool-registration failure rejects the candidate and becomes a config-update failure; non-strict standalone MCP clients retain their contained successful-Plugin/no-tools behavior.

An identical specifier permanently reuses its cache generation. HMR watches configuration, not cached repository code; the user changes the ref, path, or source list to select another generation.

## Trust boundary

Configuring a repository authorizes package-manager lifecycle code, dependencies, the explicit `dsh.entry`, and spawned MCP servers from that repository to run with the user's filesystem authority. The pnpm child removes ambient environment variables whose names contain `KEY`, `PASSWORD`, `SECRET`, or `TOKEN`, but this is credential-exposure reduction rather than a sandbox. The prepared wrapper validates composition boundaries and lifecycle state; it does not make repository code safe to run when the source is untrusted.

## Alternatives considered

**Require an SDK project dependency.** Rejected for the standalone app path because there is no project manifest to edit. Developer-owned SDK projects keep their native package-manager workflow as a separate capability.

**Add a `dsh plugin install` command and installation database.** Rejected because the personal Loader overlay already owns machine-local composition. A second mutation interface and durable registry would duplicate config identity and rollback.

**Resolve repositories directly in the DSH package.** Rejected because Git transport, GitHub subpackage selection, lifecycle execution, and content storage belong to pnpm and the generic Loader cache, not a DSH-specific adapter.

**Watch cache contents or refresh the same ref automatically.** Rejected because one config value must identify one immutable prepared generation. Background remote resolution would change executable code without a config diff and make rollback depend on mutable remote state.

**Broadcast an `unknown` failure payload.** Rejected at the HMR boundary. JavaScript may throw any value internally, but the public event always receives a normalized `Error`, giving observers one stable contract while retaining the original value as its cause when needed.

## Consequences

- A repository that adds `.dsh-plugin/package.json` can reach standalone users through one personal-config edit without changing its existing skills or `.mcp.json` layout.
- Long-running apps can add, replace, or remove configured generations without restart; rejected candidates retain the last good runtime and produce one generic Cordis event.
- First use may require Git/network access and preparation time. Later starts reuse the exact prepared cache; old generations consume disk until a separate cache-management policy exists.
- Skills and common MCP definitions retain portable static adapters, while an explicit `dsh.entry` can contribute DSH-native Cordis behavior. Format-specific compatibility shims, OAuth-bearing MCP definitions, and marketplaces remain intentionally absent.

## Testing

Repository-package tests pin source normalization, default and nested `.dsh-plugin` paths, cache-root resolution, duplicate rejection, prepared-wrapper loading, and disposal. App-boot tests drive exact-path add, two failure classes, recovery, removal, failure events, and generated-patch preservation through the real HMR/Include/Loader path. A keyless PTY smoke boots the shipped `dsh` composition from personal config alone and invokes a skill from a seeded immutable cache generation.
