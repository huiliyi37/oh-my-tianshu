# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the product launcher for profiles: ordered stacks of plugin-bundle patch layers under the user's own overrides. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh run [--profile <name>] [--patch <path>...] "task"` | Run one fresh persisted session directly over core, print the final answer, and exit; the profile defaults to `headless` and mounts no Web server. |
| `dsh web` | Alias of `--profile web` with the Web flag family (`--host`, `--port`, `--dev`, ...). |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |

The invoking directory is the default workspace root. `dsh run` requires non-blank task text and the selected profile must mount the `headless-runner` row; `--profile` preserves custom one-shot profiles. The `web` and `headless` profiles auto-initialize on first use from shipped templates; any other profile must be created through `dsh plugin`.

## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list) and a `cordis.patch.yml` (the user's own patch layer, hot-reloaded on long-lived surfaces). The tree composes over an empty root: each bundle's patch in `dsh.profile.bundles` order, then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`, then `--patch` overlays, then flag patches. Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins. Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and the source launcher.

## Development

Production runs require built package and frontend artifacts. From a checkout, `pnpm run dsh` runs the TypeScript entry and forwards arguments; the [source-launcher reference](reference/README.md#source-launcher) describes the PATH symlink and module-resolution contract.
