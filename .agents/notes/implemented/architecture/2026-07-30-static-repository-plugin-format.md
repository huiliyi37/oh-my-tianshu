# Agent Note: Static repository Plugin format

Status: implemented

English | [中文](2026-07-30-static-repository-plugin-format.zh.md)

## Problem

A repository that already contains reusable skills or an MCP server declaration should be usable by standalone Harness applications without becoming a Harness SDK project or rewriting its existing layout. Popular repositories must be able to add one `.dsh-plugin` directory while keeping their current skills and `.mcp.json` elsewhere in the tree. These portable static contributions still need to reuse the existing skill and MCP lifecycle owners when the same trusted package also carries native Cordis code.

The [package-manager-native repository cache](2026-07-30-package-manager-native-repository-cache.md) prepares an exact package source but intentionally knows nothing about DSH formats. This layer therefore needs a package-manager-compatible authoring format, a deterministic prepared artifact, and a Cordis composition that stays transactional under Loader disposal and replacement.

## Decision

`@deepseek-ai/dsh-repository-plugin` owns the static contribution subformat inside a `.dsh-plugin` package: skill roots and one common `.mcp.json`. Its package metadata uses `package.json#dsh.skills` for relative skill-root paths and `package.json#dsh.mcpServers` for the relative MCP document path. Each path may leave `.dsh-plugin` to reuse repository content but must remain beneath the directory containing that `.dsh-plugin`; a nested selectable Plugin therefore owns the adjacent subtree above its package without gaining access to unrelated host paths. The package may additionally declare the explicit code entry owned by the [trusted repository package decision](2026-08-08-trusted-repository-package-code.md), and at least one code or static contribution is required.

The `.dsh-plugin` package declares the published `@deepseek-ai/dsh-repository-plugin` package as a development dependency and a non-empty `scripts.prepack` that invokes its `dsh-plugin-prepare` executable. During Git installation, pnpm installs that dependency from the selected package's own manifest; `prepack` runs after dependency installation and before pnpm packs a selected subdirectory, including a Plugin nested inside another package-manager workspace. The package may build its code first. The helper validates metadata and source types, strictly parses `.mcp.json`, copies static assets into `dsh-plugin-assets`, and writes `dsh-plugin.mjs`; the source loader revalidates the installed package's helper-bearing lifecycle metadata before importing that wrapper. A static-only package still receives an import-free wrapper containing its normalized manifest, service-derived `inject` list, and delegation to the `dsh-repository-plugin` Loader builtin. The dependency and workspace-isolation rationale is in the [Git source preparation repair](../bug-fix/2026-08-08-npm-backed-git-repository-plugin-preparation.md).

Loading the DSH package registers that builtin as an effect. A generated wrapper mounts the builtin as its child with `import.meta.url`, so all contributions belong to the wrapper fiber and disappear on Loader removal or rollback. The builtin revalidates the prepared manifest and path containment before reading assets. It composes the existing implementations rather than registering skills or MCP tools itself.

Each prepared skill set mounts `dsh-skill-local` with a unique `repository:<package-name>` provider name, only the copied custom roots, and watching disabled. `dsh-skill-local` therefore gains two general configuration fields: `providerName` and `includeDefaultRoots`. Their defaults preserve its existing single local provider; repository instances set a distinct name and exclude project/user roots so multiple instances neither collide nor duplicate host-local discovery.

Each `.mcp.json` server becomes one existing `dsh-mcp-client` child. The adapter accepts the common root `{ "mcpServers": ... }`; stdio definitions allow only optional `type: "stdio"`, `command`, `args`, and `env`, while HTTP definitions allow only `type: "http"`, `url`, and `headers`. Exact `${NAME}` process-environment references expand at runtime, after cache preparation; missing names fail Plugin load. HTTP maps to the client's Streamable HTTP transport, and stdio uses the prepared package directory as `cwd`. The existing client alone owns connection attempts, failure logging, remote tool synchronization, tool calls, and disconnects. Repository instances enable strict startup, so an initial connection, discovery, or tool-registration failure rejects the repository Loader generation; non-strict standalone clients retain the logged successful-plugin/no-tools behavior.

Unknown MCP fields reject. This intentionally excludes OAuth, `auth` objects, `CLAUDE_PLUGIN_ROOT`, and a broader Claude compatibility contract. Commands, hooks, agents, rules, and other foreign manifest conventions are not inferred from static repository layout; DSH-native behavior uses the explicit trusted Cordis entry. Repository subdirectory selection and GitHub source configuration belong to the [standalone app integration](../feature/2026-07-30-config-only-repository-plugins.md), not this static adapter.

## Alternatives considered

**Discover an entry from `main`, `exports`, or repository layout.** Rejected because static assets do not imply that a package's ordinary entry is a Cordis Plugin. Trusted code loading is explicit through `dsh.entry` and remains outside this static adapter's ownership.

**Teach generated wrappers to implement skills and MCP directly.** Rejected because copied runtime code would drift from `dsh-skill-local` and `dsh-mcp-client`, especially their provider invalidation, tool synchronization, failure, and teardown contracts.

**Import Harness packages from each generated wrapper.** Rejected because repository packages should not resolve or version the application's internal dependency graph. A Loader builtin supplies one app-owned implementation and keeps generated wrappers import-free.

**Watch prepared repository assets.** Rejected because an exact repository cache generation is immutable. Ref, subdirectory, or configuration changes select a new generation; a second watcher would create an unowned refresh identity.

**Make every MCP connect failure a Loader update failure.** Rejected because optional standalone MCP clients deliberately contain startup failures and expose no tools. The MCP client instead owns an explicit strict-startup option, which repository adapters enable for their declared servers.

## Consequences

- Existing skill/MCP repositories can add a small `.dsh-plugin/package.json` without relocating their assets or adopting an SDK project.
- Prepared static output is deterministic glue, while an optional `dsh.entry` and the configured repository lifecycle remain trusted executable package-manager input rather than a sandbox.
- Multiple repository Plugins coexist through provider names and ordinary MCP server-name uniqueness; duplicate names fail through their existing registries and participate in Loader rollback.
- Cached source edits do not appear live. Another exact source/ref/path/config selection is required.
- Adding another portable static contribution kind requires an explicit format and DSH-owned runtime consumer; DSH-native behavior uses the separate explicit code entry.

## Testing

Focused tests prepare skills and MCP metadata, prove a static-only wrapper contains no imports, reject Work IQ-style OAuth fields, map Expo-style HTTP and DataJunction-style stdio plus environment values, and exercise missing variables. A real Loader test mounts a generated wrapper through the registered builtin, reads its skill through `ctx.skills`, removes the Loader entry, and observes provider cleanup. The CI built-entry acceptance invokes `dsh run` with a GitHub source pinned to the pull request head and observes the copied skill alongside the trusted code and MCP proofs owned by the superseding decision.
