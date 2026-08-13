# `@deepseek-ai/dsh-scripts`

English | [中文](README.zh.md)

The `dsh-sdk` launcher owns SDK project startup and configuration.

| Command | Behavior |
|---|---|
| `dsh-sdk start [target] [-- args…]` | Import a module target and invoke `main(bootContext)`, or boot `cordis.yml` when omitted; arguments after `--` are forwarded |
| `dsh-sdk dev [target] [-- args…]` | Register TypeScript and local-workspace source resolution, then use the start path |
| `dsh-sdk build [args…]` | Invoke the project's installed tsdown with the project arguments |
| `dsh-sdk config` | Open one interactive edit session, review accumulated changes, commit once, and install once when NPM dependencies changed |
| `dsh-sdk create <source>` | Add an external Cordis plugin from a native package-manager source (`pkg@version` or `github:owner/repo#ref`): confirm, `<pm> add <source>`, then mount the resolved dependency in `cordis.yml`. No giget/pacote; the package manager resolves and pins the source (github deps build via their own `prepare` under the manager's policy) |

`ProjectBuild(tsdownConfig)` and `PluginBuild(tsdownConfig)` are exported only from `@deepseek-ai/dsh-scripts/dev/tsdown-config`. Development and production read the same `cordis.yml`.

Generated project scripts invoke `dsh-sdk` for dev, build, start, and config; typecheck runs `tsc -b` directly. HMR remains an explicit `cordis.yml` feature loaded by both dev and start.

The runtime library exports `startSDK(source)` to load `.env` and `cordis.yml` and return the live context, and `runSDK(target)` to import a project module and invoke its `main(bootContext)` (`runSDK()` without a target delegates to `startSDK('./cordis.yml')`). `SdkBootContext` carries the raw forwarded `argv`, generic `args`, the absolute launcher `cwd`, and the `start`/`dev` mode. The launcher declares no project options: Node `parseArgs()` runs with zero schema, so valued flags use `--key=value`, bare flags become booleans, `--no-cache` becomes `args.cache = false`, and option names retain Node's spelling (`--max-depth=3` → `args['max-depth']`).

`start` never builds. `dev` registers the project-installed tsx transform plus an exact package-name map from `plugins/*/package.json` to each `src/index.ts`, then follows the same start path. `build` invokes the project-installed tsdown and forwards its arguments; an absent tsdown config is a successful no-op.

`config` requires a TTY. One feature tree selects the desired enabled set; changed rows are highlighted, Right changes finite feature options, required rows cannot be deselected, inconsistent rows show diagnostics, and custom/manual Cordis config entries support enable/disable. The workflow reconciles that target into one edit session. Review & Apply commits once, then NPM dependency changes trigger one package-manager install. A failed install does not undo committed files.

The root library exports `startSDK`, `runSDK`, and the `SdkBootArgs`/`SdkBootContext` types; command composition remains private to the bin. No `src/*`, bin, or package-manifest subpath is exported.

## Model Experience

Indirectly, through the project `cordis.yml` tree loaded by `start` or `dev`.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Launcher arguments are schema-free** — `start` and `dev` preserve Node `parseArgs()` output rather than validating project-specific flags.
