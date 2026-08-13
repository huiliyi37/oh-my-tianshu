# `dsh` CLI behavior reference

English | [中文](README.zh.md)

This reference defines the profile, one-shot run, web-alias, plugin-management, and config-dump command modes. Argv is parsed once through [`src/args.ts`](../src/args.ts), and [`src/bin.ts`](../src/bin.ts) dynamically imports only the selected runner.

## Profile boot

`dsh --profile <name>` boots the profile at `$DSH_HOME/profiles/<name>`. The effective tree is composed over an empty root by applying, in order: each bundle patch named in the profile manifest's `dsh.profile.bundles` list, the profile's own `cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml` (machine-local preferences shared by every profile, so it outranks the per-profile layer), each `--patch <path>` overlay in argv order, and launcher flag patches. Later layers win per row; a patch replaces the targeted row's complete `config` value rather than deep-merging keys, and may insert new rows. A parse, schema, resolution, or plugin boot failure is reported and exits nonzero. SIGINT and SIGTERM dispose the mounted root before exit.

Bundle names resolve from the dsh installation first, then from the profile directory. In-box bundles (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-headless`) therefore always come from the same installation as the running `dsh`; out-of-tree bundles come from the profile's pnpm-managed `node_modules`. A bare plugin `name` in any patch row resolves through the profile directory's Node parent-walk, which reaches the maintained installation fallback `$DSH_HOME/profiles/node_modules` (one symlink per package the installation's app and bundles depend on, healed on every launch).

The `web` and `headless` profiles auto-initialize from shipped templates on first use (`web`: base + web-app; `headless`: base + headless). On load, the exact installation-owned headless tuple (base + web-app + headless) normalizes to the shipped template; extra, missing, or reordered bundle lists are user-owned and remain untouched. Any other missing profile fails loud with a hint to run `dsh plugin --profile <name> add <package>`.

Profile boot accepts no positional task. A profile that mounts the one-shot runner row (`headless-runner`) therefore fails loud with the canonical `dsh run --profile <name> "<task>"` command instead of reaching the row's raw required-field error.

Inspect the composed tree without booting it:

```sh
dsh --profile web --dump-default-config
dsh --profile web --patch ./extra.yml --dump-config
```

`--dump-default-config` prints only the bundle layers; `--dump-config` adds the profile's `cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml`, and `--patch` overlays. Both print comments naming the file that supplied each row and every overlay that changed it; `!!js` expressions remain unevaluated, and unmatched patch targets are reported on stderr.

## One-shot run

`dsh run [--profile <name>] [--patch <path>...] <task...>` joins the task arguments with spaces, rejects a missing or blank task, and defaults `--profile` to `headless`. Repeatable `--patch` overlays occupy the same layer position as profile-boot overlays. A custom selected profile must mount `headless-runner`; otherwise launch fails before boot with a diagnostic naming that missing row.

The launcher patches the task text into the runner row. After Loader settlement, the runner reads the shared `ctx.agentDefaultModel` default, creates one fresh persisted Agent through `ctx.agents`, submits the task, waits for quiescence, and flushes the Session before deriving the last non-empty assistant text and final `turn/end` reason from its durable interval. It prints the text on stdout and exits 0 for `completed`, else 1. The shipped headless profile mounts no ApiProxy, Host, HTTP server, Web runtime, or browser client; a successful run writes nothing to stderr and opens no listening port.

## Plugin management

`dsh plugin --profile <name> <args...>` initializes the profile when missing (shipped template, or `@deepseek-ai/dsh-base` alone for other names), then forwards `<args...>` to `pnpm` with the profile directory as working directory — `add`, `remove`, `why`, `update`, and every other pnpm verb work unchanged; pnpm must be on PATH. Relative path specs (`.`, `../plugin`, and their `file:`/`link:` forms) are anchored to the invoking directory first, so `add .` from a plugin checkout installs that checkout, not the profile. After every successful run, `dsh.profile.bundles` is reconciled against the installed state: each dependency resolving to a package whose manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` joins the layer stack (so an `update` that gains the declaration activates it), a bundle-less dependency stays plain with a one-time warning, and a removed dependency leaves the stack.

```sh
dsh plugin --profile tui add github:deepseek-harness/turtle-ui
dsh plugin --profile tui remove turtle-ui
dsh --profile tui
```

Git-hosted plugins that ship sources build during install through their `prepare` script, which pnpm ≥10 blocks until the consumer allows it: the first `add` fails with pnpm's `allowBuilds` hint (and a dsh pointer at the profile's `pnpm-workspace.yaml`); copy the printed key there and re-run. Installing a built tarball or a local checkout needs no allowance.

## Web alias

`dsh web` is a hardcoded alias for `--profile web` that additionally accepts the Web flag family. `--host`, `--port`, `--workspace-root`, and repeatable `--trusted-host` values become patches over the composed rows; their owning plugin schemas validate them at boot. `--dev` switches the web-runtime row to development mode and inserts the client-plugin HMR receiver; it expects a separate `pnpm run dev:web` watcher for no-refresh client bundle updates.

```sh
dsh web
dsh web --patch ./extra.cordis.yml
dsh web --dump-config
```

The production Web runner needs built package and frontend artifacts (`pnpm run build`). It serves `http://127.0.0.1:3080` by default. Binding all interfaces also trusts the machine's discovered LAN IP literals; `--trusted-host` adds named authorities accepted by the `/api` browser-trust fence.

Process shutdown gives the plugin tree up to five seconds to dispose. The first `SIGINT`/`SIGTERM` starts that graceful drain; a second signal forces immediate exit. If one-shot normal completion is already stuck in disposal, the first `Ctrl+C` is the escalation and exits immediately instead of being swallowed.

All modes treat the invoking directory as the default workspace root, load applicable `AGENTS.md` or `CLAUDE.md` instructions with a 65,536-byte render budget, and use an in-memory SQLite session content index. Long-lived surfaces watch valid edits of both `cordis.patch.yml` layers (profile and home) and reapply them transactionally; one-shot runs read the files once at startup.

New sessions default to the `workspace-write` permission preset. Bash and filesystem mutations are restricted to the session workspace and platform temporary roots; reads, network access, and process visibility are not confined. `DSH_PERMISSION_MODE` changes the process fallback. Stored General-settings permissions affect later Web sessions, not an already-open one.

`DSH_TOOLS_MODE` selects `native`, `code`, or `both` for the process; another value fails at boot. [`config/core-web.cordis.yml`](../config/core-web.cordis.yml) is an optional RL-compatible `--patch` overlay that pins native mode, renders only `DSH_SYSTEM_PROMPT` or `You are a helpful software engineer assistant.` as the system prompt, disables Workspace instructions and every Web runtime prompt contribution, and exposes only persistent `bash` and `str_replace_editor` while retaining the shipped host, browser, workspace, persistence, and permission composition.

`DSH_SYSTEM_PROMPT` is passed as the system-prompt [`persona`](../../../packages/core/system-prompt/README.md#config): complete `{{…}}` groups use that contract's strict variable interpolation and have no literal-brace escape; any set value, including an empty string, is authoritative and an empty value therefore removes the system prompt, while only an unset variable selects the fallback.

## Shared deployment behavior

The base bundle mounts the native DeepSeek adapter, settings and credential providers, stable `web_search`, repository Plugin support, and session telemetry. Provider credentials resolve from the inherited environment, `$DSH_HOME/.credentials.yaml`, the invoking directory's `.env`, then `$DSH_HOME/.env`; the managed document is never materialized into `process.env`, while both `.env` files are ordinary launch environment layers. Search uses `DEEPSEEK_API_KEY` and accepts `DEEPSEEK_SEARCH_BASE_URL`; `web_fetch` is disabled unless a patch layer inserts a provider and enables it.

Session events stream as OTLP/HTTP logs by default. `DSH_TELEMETRY_OTLP_URL` selects another collector. Any non-empty `DSH_TELEMETRY_DISABLED` disables the telemetry row before boot. The shipped base has no telemetry redaction rule, so exported records can contain message text, tool arguments and results, and workspace paths; the [telemetry Agent Note](../../../.agents/notes/implemented/feature/2026-07-31-web-telemetry-default-mount.md) owns that deployment decision.

The empty `repository-plugins` row lets profile patch layers mount prepared immutable repository Plugin generations. See the [repository Plugin contract](../../../packages/self-modification/repository-plugin/README.md#standalone-app-configuration). The CLI also ships `@deepseek-ai/dsh-mcp-client` as a dependency for patch layers, but no MCP server is enabled by default because each server command is trusted executable code outside the agent sandbox.

## Source launcher

Link the source-running launcher onto PATH:

```sh
ln -sf "$(pwd)/bin/dsh" ~/.local/bin/dsh
```

It resolves the checkout through its real path and launches `apps/cli/src/bin.ts` with `node --import tsx/esm`. `TSX_TSCONFIG_PATH` is pinned to the checkout root, so workspace package resolution is independent of the invoking directory. `pnpm run dsh` uses the same entry and forwards arguments. The built form is `apps/cli/lib/bin.js` after `pnpm run build`.
