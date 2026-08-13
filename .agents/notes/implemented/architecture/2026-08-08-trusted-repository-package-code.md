# Agent Note: Trusted repository packages load Cordis code

Status: implemented

English | [中文](2026-08-08-trusted-repository-package-code.zh.md)

## Problem

The standalone repository format already installs a selected Git package and runs its dependency and lifecycle code with host authority, but it exposed only copied skills and MCP metadata to DSH. Forbidding a Cordis entry did not create a security boundary: package installation remained trusted executable code while the restriction prevented the package from contributing the Plugin behavior that the Harness architecture is designed to compose.

A repository author also needs to keep an ordinary TypeScript npm package shape. Requiring publication to npm, pre-generated JavaScript in Git, or a DSH-owned TypeScript compiler would make a Git source less capable than the same package installed through a developer-owned SDK project. The first model request must observe any MCP tools that this package starts; background-only initial discovery makes a successful installation nondeterministic at the application boundary.

## Decision

A configured repository package is trusted code. Its `.dsh-plugin/package.json` may declare `dsh.entry` as a relative path to a compiled ESM Cordis Plugin inside that package, alongside or instead of `dsh.skills` and `dsh.mcpServers`. At least one contribution is required. The entry may use namespace exports or a default export and retains ordinary Cordis semantics for `name`, `inject`, `Config`, registrations, startup failure, and effect-scoped teardown.

The package owns its npm dependencies and build toolchain. It declares the published `@deepseek-ai/dsh-repository-plugin` package to obtain the `dsh-plugin-prepare` executable. `scripts.prepack` is a non-empty package-authored command that must invoke that dependency-provided helper, but it may first run `tsc`, `tsdown`, or any other build. DSH neither injects the helper, parses the shell program, nor compiles repository source. The helper validates the metadata after the preceding build, requires the configured entry to resolve to a file within `.dsh-plugin`, validates and copies declared static assets, and writes the prepared `dsh-plugin.mjs` wrapper. The installed package must retain a `prepack` declaration containing that helper command; a missing dependency, wrapper, or build output fails before a cache generation becomes usable.

The generated wrapper first mounts the DSH-owned static runtime for skills and MCP definitions, then dynamically imports and unwraps the explicit entry and mounts it as a child. The wrapper statically declares dependencies implied by the prepared manifest; an entry module's additional `inject` is discovered only when mounted and must already be available in the host composition. Both children must reach Cordis `ACTIVE`; an unsatisfied `inject` or startup exception rejects the repository Loader transaction instead of committing an inert generation. Loader removal, failed replacement, and parent disposal unwind the entry, skill providers, MCP clients, and their effects together.

`dsh-mcp-client` resolves its initial connection and tool synchronization promise as part of Plugin application. Its entry is an `async function`, not an ordinary function returning a Promise: Cordis identifies prototype-bearing ordinary functions as constructors and does not treat a constructor's returned Promise as startup work. A valid server's tools therefore exist before its parent repository wrapper activates and before a one-shot application starts its first model request. Its `failOnStartupError` config preserves optional standalone servers by default while letting repository adapters require their declared servers. Repository-translated MCP clients enable that mode, so initial connection, discovery, or tool-registration failure rejects the candidate generation and rollback still closes the transport.

## Trust boundary

Exact refs, source containment, credential-shaped environment scrubbing, prepared manifests, and immutable cache keys protect identity and composition integrity; they do not sandbox executable package input. Repository lifecycle scripts, transitive npm dependencies, the compiled entry, and spawned MCP servers can exercise the authority available to the DSH process and the Cordis services they receive. Users must therefore trust the selected repository and should pin immutable refs and grant Git only the narrow read credential needed for acquisition.

Model-visible behavior remains governed by the owning DSH seam. A repository entry may register tools, prompt sections, policies, commands, agents, or other effects, but anything reaching a model request still needs the corresponding logged DSH representation and lifecycle cleanup. The repository format grants code loading; it does not weaken those service contracts.

## Alternatives considered

**Keep code forbidden while allowing arbitrary package lifecycles.** Rejected because installation already executes trusted repository code, so the restriction added no isolation and forced Plugin authors to publish or maintain a second integration path.

**Have DSH compile repository TypeScript.** Rejected because compiler choice, module layout, generated chunks, native dependencies, and package metadata belong to the npm package. Running the package's declared build preserves the same boundary as other Git dependencies.

**Import `main`, `exports`, or another discovered entry implicitly.** Rejected because an npm package may contain utilities or an MCP executable that is not a Cordis Plugin. The explicit `dsh.entry` field makes code activation reviewable and lets preparation validate the packed path.

**Add a closed manifest field for every future DSH contribution.** Rejected as the universal extension mechanism. Skills and common MCP files retain useful portable static adapters, while DSH-native behavior composes through the existing Cordis Plugin and service contracts.

## Consequences

- A TypeScript DSH Plugin can live in a GitHub repository, install ordinary npm dependencies, compile during `prepack`, and run without publishing the Plugin package to npm.
- Static-only repository packages remain valid and retain import-free wrappers; adding `dsh.entry` opts that package into runtime code import.
- A package build, dependency install, entry import, unmet service, or Plugin startup failure prevents the candidate generation from replacing the last good configuration.
- Initial MCP synchronization can lengthen application startup by the MCP SDK's per-request timeout, and a repository-declared server that is unavailable or cannot publish its complete tool generation prevents that candidate generation from activating.
- Repository code receives host authority, so source review and immutable pinning are operational security requirements rather than optional hardening.

## Testing

Repository-format tests prepare and mount default-export code entries through the real Loader, observe an entry-owned service, remove the Loader row, and observe cleanup; they also retain skill/MCP preparation, containment, damaged-package, pending-service, and rollback coverage. MCP lifecycle tests require `apply` to settle only after initial tool publication, preserve opt-in contained startup failure, and prove strict connection or tool-registration rejection still closes the client.

The Node 24 consumer acceptance uses the actual built `dsh run` command with a fresh DSH home and an authenticated private GitHub source pinned to the pull request's exact head SHA. The test packs the current repository Plugin build with the same private-field removal and workspace-dependency pinning used for publication, serves its packument and tarball from a job-local npm registry, and directs the Git package's ordinary scoped npm resolution there. That repository package obtains `dsh-plugin-prepare` from the simulated published dependency, installs its other pinned runtime and development dependencies, type-checks and bundles TypeScript during `prepack`, prepares a skill plus a stdio MCP server and `dsh.entry`, exposes the skill and MCP schema in the first real model request, executes the MCP tool, and lets the compiled Cordis entry append a second marker to the result observed in the following request. Registry and cache assertions require npm resolution to reach the simulated publication, source files to be absent from the packed installation, and both built modules, their installed dependency, copied assets, and generated wrapper to be present.
