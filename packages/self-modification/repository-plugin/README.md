# @deepseek-ai/dsh-repository-plugin

English | [中文](README.zh.md)

Trusted repository package format for DeepSeek Harness. A `.dsh-plugin` npm package may contribute a compiled Cordis/DSH Plugin entry, skill roots, and a common `.mcp.json`; its ordinary `prepack` lifecycle owns dependency installation and source compilation before the DSH prepare helper validates the outputs and emits the Loader wrapper. Static contributions compose [`dsh-skill-local`](../../skill/skill-local/README.md) and [`dsh-mcp-client`](../../mcp/mcp-client/README.md). Design rationale: [trusted repository package code](../../../.agents/notes/implemented/architecture/2026-08-08-trusted-repository-package-code.md) and the [static contribution subformat](../../../.agents/notes/implemented/architecture/2026-07-30-static-repository-plugin-format.md).

## Authoring format

Place an ordinary package in the repository's `.dsh-plugin` directory:

```json
{
  "name": "humanize-dsh-plugin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "prepack": "npm run build && dsh-plugin-prepare"
  },
  "dsh": {
    "entry": "./lib/plugin.js",
    "skills": ["../skills"],
    "mcpServers": "../.mcp.json"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.29.0"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-repository-plugin": "^0.0.1",
    "typescript": "6.0.3"
  }
}
```

`scripts.prepack` must be non-empty and invoke `dsh-plugin-prepare`; it may run arbitrary package-owned build steps first. The package declares `@deepseek-ai/dsh-repository-plugin` as an ordinary development dependency so its published executable is available to that lifecycle. DSH does not inject the helper: the repository package declares and runs its own compiler, runtime dependencies, preparation helper, and other npm lifecycle code. The selected package is installed from its own manifest instead of inheriting an enclosing pnpm workspace, so declare every dependency it needs and do not depend on workspace-only hoisting. DSH does not transpile TypeScript or infer a package entry.

`dsh.entry` is an optional relative path to a compiled ESM Cordis Plugin inside `.dsh-plugin`. The module may use either namespace exports or a default export and owns its ordinary `name`, `inject`, `Config`, registrations, and effects. `dsh.skills` is an optional array of local skill roots, and `dsh.mcpServers` is an optional path to one `.mcp.json`; at least one of the three fields is required. Skill and MCP paths may reach adjacent repository assets but must remain beneath the directory containing `.dsh-plugin`; the compiled entry must remain inside the package selected and packed by the package manager. A repository containing several Plugins gives each one its own `.dsh-plugin` package under a different selectable subdirectory.

The repository package and every dependency or lifecycle script it runs are trusted code, just like an npm package selected directly by the user. This format is not a sandbox: install only repositories whose code may access the host process, filesystem, network, and services declared through Cordis. Exact refs and the immutable cache provide identity and reproducibility, not isolation.

## Standalone app configuration

The shipped `dsh-base` bundle every profile starts from contains an empty `repository-plugins` row. A user enables exact GitHub generations by replacing that row's config in a user patch layer — `$DSH_HOME/profiles/<name>/cordis.patch.yml`, or the home-level `$DSH_HOME/cordis.patch.yml` shared by every profile; a `--patch` overlay patches the same row for one run:

```yaml
- id: repository-plugins
  name: '@deepseek-ai/dsh-repository-plugin'
  config:
    repositories:
      - 'github:PolyArch/humanize#<commit>'
      - 'github:owner/repository#<ref>&path:/plugins/one/.dsh-plugin'
```

Each source must use `github:owner/repository#<ref>`. Omitting `&path:` selects `/.dsh-plugin`; an explicit path is absolute within the repository and must end in `.dsh-plugin`. A commit ref gives the clearest immutable identity, while tags and branches remain accepted exact config values. `cacheDir` may override the default `$DSH_HOME/cache/repository-plugins` cache root.

Git transport uses the host's ordinary Git authentication. Public repositories need no credentials; private sources require a read-only credential or SSH agent that can read the selected repository. DSH removes credential-shaped environment variables before package lifecycles, so configure Git itself, such as through a credential helper or job-scoped Git config, instead of expecting an exported token variable to cross that boundary. Repository lifecycle code is trusted and can invoke Git, so use the narrowest repository-scoped credential available.

Long-lived surfaces watch both `cordis.patch.yml` layers through Cordis HMR. A valid source-list change installs and swaps the complete repository Plugin generation; a failed fetch, prepare, import, or Plugin application keeps the last good tree and broadcasts `hmr/config-update-failed(filename, error)`. One-shot runs read the layers only at startup, and a `--patch` overlay is never watched. An identical source string permanently reuses its prepared cache entry, so selecting changed code requires a ref, path, or other source-config change. App integration rationale: [config-only repository Plugins Agent Note](../../../.agents/notes/implemented/feature/2026-07-30-config-only-repository-plugins.md).

## Preparation

During exact Git installation, DSH's bundled pnpm installs the selected package from its own manifest. A transaction-owned `pnpm` wrapper reinvokes the same pinned pnpm with `--ignore-workspace`, so an enclosing workspace lockfile cannot suppress dependencies declared only by the selected `.dsh-plugin` package. The required `prepack` lifecycle runs after that dependency installation and before the selected subdirectory is packed; its ordinary `node_modules/.bin` lookup obtains `dsh-plugin-prepare` from the declared direct development dependency on `@deepseek-ai/dsh-repository-plugin`. That package marks its Cordis/DSH runtime peers optional so using the executable alone does not install the runtime graph. Package-owned commands may build TypeScript or other source before invoking the helper. The helper validates `package.json#dsh`, verifies that the compiled entry is an in-package file, validates skill and MCP sources, copies static assets under `dsh-plugin-assets`, and writes `dsh-plugin.mjs`. Before importing that wrapper, DSH revalidates that the installed package retained both the direct development dependency and a `prepack` declaration containing the helper command. Failure to resolve the published helper, install dependencies, build, or prepare fails before a cache generation is published. Rationale: [npm-backed Git source preparation Agent Note](../../../.agents/notes/implemented/bug-fix/2026-08-08-npm-backed-git-repository-plugin-preparation.md).

## Runtime composition

Loading this package registers one effect-scoped Loader builtin. Each generated wrapper delegates its prepared static manifest to that builtin, then imports and mounts `dsh.entry` when declared. The wrapper can statically gate only the `loader`, `skills`, and `tools` services implied by the prepared manifest; the entry's own `inject` is discovered when that child is mounted. The entry must reach `ACTIVE`, so a missing entry-only service or startup failure rejects the repository generation instead of committing an inert child, and all effects disappear on Loader removal or rollback. The runtime likewise validates every declared skill root as an existing in-package directory before mounting — a package whose generated outputs were dropped by `files`/`.npmignore` or damaged in cache fails instead of silently losing contributions. Repository skill roots mount as uniquely named `dsh-skill-local` providers with default project/user roots excluded and watching disabled; cached package generations are immutable.

## Common MCP format

The `.mcp.json` root is `{ "mcpServers": { ... } }`. A stdio entry accepts only `type: "stdio"` (optional), `command`, `args`, and `env`; an HTTP entry accepts only `type: "http"`, `url`, and `headers`. String values support exact `${NAME}` process-environment expansion at Plugin load, and a missing name fails that load. HTTP URLs become the existing MCP client's `streamable-http` transport; stdio entries use the prepared package directory as `cwd`.

Unknown fields reject, including OAuth and `auth` objects. There is no `CLAUDE_PLUGIN_ROOT` expansion or compatibility layer. After translation, the existing `dsh-mcp-client` exclusively owns transport creation, connection diagnostics, tool synchronization, calls, and disconnect lifecycle. Repository-declared servers enable its strict startup mode: Plugin activation waits for the initial connection and tool synchronization, so the first model request observes a fully registered initial tool generation, while a network, child-process, discovery, or registration failure rejects the candidate repository generation instead of silently activating without its declared tools.

## Export shape

Namespace Plugin: named exports `name` / `inject` / `apply`, preparation constants, and `prepareDshPlugin`; no default export. The package also exposes the `dsh-plugin-prepare` executable and an invariant companion.

## Model Experience

### Repository skills

#### What the model sees

Indirectly through `dsh-tool-skill`: prepared, model-invocable skills join its logged catalog and selected instruction-body surface under their declared names and descriptions. The exact consumer schema is in the generated [`skill` tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-skill).

#### Token effect

Conditional and data-dependent: each visible repository skill adds one capped catalog row; loading one adds its full current instruction body and resource-base guidance to retained tool history.

#### KV Cache effect

A stable prepared Plugin set is prefix-stable. Adding, removing, or replacing a repository Plugin can append the consumer's replacement catalog and affect later request prefixes.

### Repository MCP tools

#### What the model sees

Indirectly through `dsh-mcp-client`: every connected server contributes its server-qualified tool schemas, and calls retain that client's canonical MCP results and rendering.

#### Token effect

Conditional on successful connection and the remote tool list; schemas recur on requests in the active tool view, while calls and results remain in history until compaction.

#### KV Cache effect

Stable connected tool lists are prefix-stable. Plugin lifecycle or MCP tool-list changes can change later tool-schema prefixes from the first affected definition.

### Repository code

#### What the model sees

Data-dependent. The trusted Cordis entry may contribute any DSH behavior available through its declared services and events, including tools, prompt sections, policies, commands, and transformations. Every model-visible contribution remains subject to its owning DSH seam's logging and lifecycle contract.

#### Token effect

Defined by the services and registrations the entry contributes; the repository format itself adds no model content.

#### KV Cache effect

Stable registrations preserve the owning surface's normal prefix behavior. Loading, removing, or replacing the exact repository generation can change any prefixes affected by that Plugin.

## Known Limitations and Deferred Work

- **No code sandbox** — `dsh.entry`, npm dependencies, and package lifecycle scripts execute with the DSH host's authority; repository trust is mandatory.
- **Entry-only service dependencies are not pre-gated** — the generated wrapper cannot declare an entry module's `inject` before importing it. Any service beyond those implied by Skills or MCP must already exist when the wrapper mounts the entry, or that repository generation rejects.
- **No MCP authentication protocol** — static headers may use environment expansion, but OAuth-bearing definitions reject and private-server login flows are not implemented here.
- **Generated assets are immutable runtime input** — repository cache generations are not watched; source, ref, path, or configuration must select another prepared generation.
