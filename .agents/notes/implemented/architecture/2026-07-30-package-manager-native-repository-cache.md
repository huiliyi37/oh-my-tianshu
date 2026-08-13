# Agent Note: Package-manager-native repository cache

Status: implemented

English | [中文](2026-07-30-package-manager-native-repository-cache.zh.md)

## Problem

A standalone Harness app cannot rely on a developer-owned SDK project to declare and install repository dependencies. Loading a configured GitHub repository therefore needs a persistent fetch, preparation, and cache boundary, but implementing Git transport, hosted-source syntax, package preparation, and a content store inside DSH would duplicate a package manager. Requiring a separately installed package manager would make a config-only feature depend on host setup.

The cache also needs an update identity. A mutable branch name cannot both remain permanently cached and reflect later commits without an independent refresh protocol.

## Decision

Vendored `@cordisjs/plugin-loader/repository` exports `RepositoryCache`, a generic Node-only package helper with no DSH plugin-format knowledge. Keeping it on a subpath prevents browser consumers of the Loader's main entry from traversing Node filesystem and child-process imports. The caller supplies a package-manager-native source specifier and a cache root. DSH-specific callers own accepted source syntax, path selection, and the cache-root location; the [SDK project dependency workflow](../../proposed/feature/2026-07-17-sdk-follow-up-capabilities.md#external-cordis-plugin-installation) remains a separate path owned by the developer project's selected package manager.

The Loader carries an exact runtime dependency on `pnpm@11.7.0` and invokes that package's JavaScript entry with the current Node executable. It never discovers a global executable or delegates through Corepack. Each cache miss creates an isolated project with one dependency named `repository`; pnpm owns Git/GitHub resolution, fetching, its content-addressed store, dependency installation, and lifecycle scripts in the repository's dependency graph.

The isolated workspace sets `dangerouslyAllowAllBuilds: true`. A configured repository and its dependency graph are trusted executable code: lifecycle scripts may run before DSH reads any declared assets. The child receives ordinary host process state needed by Git and pnpm, but ambient credential-shaped (`KEY`, `PASSWORD`, `SECRET`, `TOKEN`) variables are removed. No OAuth, token forwarding, or private-repository authentication contract is added.

The SHA-256 of the exact specifier names the cache entry. Concurrent same-process requests share one task. Installation occurs in a sibling temporary directory; only a successful install with a package directory and marker is atomically renamed into the final key. Failed staging is removed, and a competing process's already-published valid entry wins. A later process validates the marker and package directory before returning the stable `node_modules/repository` path.

An identical specifier permanently reuses its published entry. The caller changes the ref or another part of the specifier to request a new generation; the cache does not poll remotes, reinterpret mutable refs, expire entries, or garbage-collect old generations.

## Alternatives considered

**Implement GitHub download, archive extraction, preparation, and caching directly.** Rejected under the [dependency policy](../process/2026-07-26-dependencies-over-hand-rolling.md): pnpm already owns hosted Git syntax, Git execution, lifecycle policy, and a shared content store. A second resolver would add more code while still needing package semantics.

**Require `pnpm` on `PATH` or invoke Corepack.** Rejected because changing one app config must be sufficient on every supported installation. Pinning and shipping the CLI also makes the preparation policy reviewable and independent of the host's package-manager version.

**Resolve a branch or tag again on every startup.** Rejected because it turns startup into a network refresh, changes code without a config diff, and makes rollback depend on remote state. Explicit ref changes preserve auditability even when a user deliberately chooses a mutable ref.

**Disable repository lifecycle scripts.** Rejected because common plugin repositories need a declarative `prepare` step to validate and package their plugin subdirectory. The trust boundary is explicit configuration of executable source, not an incomplete illusion that only static files can run.

**Introduce a Cordis repository service.** Rejected because cache lookup has no runtime contribution registry or provider variation. A small helper lets the later host own Cordis lifecycle and HMR without adding a service contract prematurely.

## Consequences

- Standalone apps carry pnpm's approximately 18.6 MB unpacked runtime instead of requiring a global tool or owning a Git/package implementation.
- A repository author may use ordinary package preparation, and a malicious configured repository or dependency can execute code with the scrubbed child environment and the user's filesystem authority.
- Exact specifiers make startup deterministic after the first successful install; changing cached code requires a config/ref change.
- Failed installs leave no published cache entry and may be retried. Published corruption fails loud instead of silently reinstalling under the same identity.
- Cache generations consume disk until a future explicit cache-management policy removes them.

## Testing

`packages/boot/app-boot/tests/repository-cache.spec.ts` covers same-process single-flight, cross-instance cache reuse, exact-specifier separation, failed-stage cleanup and retry, and boundary validation. Its real local-Git case invokes the bundled pnpm, runs the fixture repository's `prepare` script, and reads the prepared file from the installed cache entry without network access.
