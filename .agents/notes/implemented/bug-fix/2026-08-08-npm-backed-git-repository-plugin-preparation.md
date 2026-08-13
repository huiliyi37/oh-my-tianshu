# Agent Note: npm-backed preparation makes GitHub repository Plugins self-contained

Status: implemented

English | [中文](2026-08-08-npm-backed-git-repository-plugin-preparation.zh.md)

## Problem

The repository Plugin authoring contract requires `scripts.prepack` to invoke `dsh-plugin-prepare`. Supplying that executable from the running DSH installation made a source package appear valid even when its own manifest could not obtain the helper. It therefore did not prove the behavior users need after `@deepseek-ai/dsh-repository-plugin` is published: an ordinary Git-hosted npm package must be installable and preparable from only its declared dependencies.

A selectable `.dsh-plugin` inside a pnpm workspace has a second isolation requirement. pnpm prepares a Git-hosted package by running the repository's preferred package manager before packing the selected subdirectory. A nested `pnpm install` can join the containing workspace; when the root lockfile does not list `.dsh-plugin` as an importer, pnpm can report success without installing dependencies declared only by that package. Its TypeScript build or prepare command then fails, or a pre-generated artifact hides the missing dependency.

The checked-in headless fixture mounts an already prepared wrapper. It proves runtime composition, not GitHub acquisition, npm resolution, or package-owned preparation.

## Decision

The `.dsh-plugin` package declares `@deepseek-ai/dsh-repository-plugin` as an ordinary development dependency and invokes its published `dsh-plugin-prepare` executable from `scripts.prepack`. The package may declare any other build and runtime dependencies and run arbitrary compilation before the helper. The repository Plugin package marks its Cordis and DSH peers optional so a helper-only development install resolves only the helper's actual `zod` runtime dependency; an application composition still supplies the peers used by the package's Cordis entry.

DSH does not materialize or prepend a prepare executable. `RepositoryCache` supplies only a transaction-owned `pnpm` wrapper: the outer install runs the pinned pnpm entry directly, while pnpm's hard-coded Git-package `pnpm install` reinvokes the same entry with `--ignore-workspace`. The selected package therefore owns dependency resolution even beneath another pnpm lockfile, and normal package-manager lifecycle `PATH` construction exposes `node_modules/.bin/dsh-plugin-prepare`. The temporary pnpm wrapper disappears after the child settles. The repository remains trusted package-manager input: all dependency and lifecycle code executes under the existing trust contract.

The Node 24 consumer lane passes an exact source derived from the pull request head repository and SHA. It uses the existing private DeepSeek Harness repository rather than creating another repository per run. A job-scoped Git configuration gives the read-only job token access to that exact private source and rewrites pnpm's SSH fallback to authenticated HTTPS.

The built-entry acceptance also creates an in-process npm registry. It stages the current built `@deepseek-ai/dsh-repository-plugin` as a publication artifact by removing `private`, replacing workspace protocols with the release version, and packing the declared files. The registry serves the resulting packument and tarball, while a job-local npm config directs only the `@deepseek-ai` scope to it. The real built `dsh run` child then fetches the exact Git source; that package resolves the helper through npm, type-checks and bundles a TypeScript Cordis entry and MCP server, prepares the adjacent skill, and loads all three contributions. A deliberately failing host `PATH` command proves the lifecycle selected the dependency-local executable. The acceptance also requires registry resolution and inspects the immutable prepared cache, so restoring a host-injected helper cannot satisfy it.

## Alternatives considered

**Inject `dsh-plugin-prepare` from the running DSH installation.** Rejected because it lets an incomplete repository manifest pass and tests a host-only path that npm consumers cannot reproduce.

**Publish the source fixture itself to npm.** Rejected because the product contract is specifically that the DSH Plugin remains Git-hosted; only the reusable preparation helper is an npm dependency.

**Create a new private GitHub repository in every CI run.** Rejected because the pull request repository at its exact head SHA is already a real authenticated private Git remote. Per-run repository mutation would add credentials, cleanup, and eventual-consistency failure modes without changing the acquisition path.

**Prepare after `RepositoryCache` installs the selected package.** Rejected because pnpm's packed subdirectory no longer contains sibling source assets referenced by paths such as `../skills`; preparation must happen before packlist.

**Clone GitHub repositories in DSH and bypass pnpm's Git fetcher.** Rejected because it would duplicate ref resolution, subdirectory selection, dependency installation, packlist behavior, and cache integrity already owned by the pinned package manager.

## Consequences

- A repository author can commit a `.dsh-plugin` package, TypeScript source, skills, and MCP definitions to GitHub without publishing that Plugin package to npm. The package must declare the published preparation dependency.
- Private GitHub sources use the host's standard Git authentication. CI proves that path with a temporary read-only configuration rather than persistent runner credentials.
- `prepack`, not `prepare`, is part of the authoring format. It may contain arbitrary package-owned build steps but must invoke the dependency-provided helper; missing dependency or lifecycle metadata fails before a cache generation is usable.
- A selected package in a pnpm repository installs from its own manifest rather than an enclosing workspace. It cannot rely on workspace-only hoisting; ordinary registry and relative `file:` dependencies remain package-owned inputs.
- Exact source strings identify immutable cache generations; a changed ref or source configuration selects another generation.
- Package dependencies, compilation, preparation, and the trusted `dsh.entry` contribution remain owned by the repository package and the [trusted-code decision](../architecture/2026-08-08-trusted-repository-package-code.md).

## Testing

`packages/boot/app-boot/tests/repository-cache.spec.ts` runs a package excluded from its source repository's root pnpm lockfile through a local Git subpath and requires relative `file:` dependencies to provide both its build command and `dsh-plugin-prepare`; it also proves that visible environment survives while credential-shaped variables are scrubbed. `packages/self-modification/repository-plugin/tests/repository-plugin.spec.ts` pins helper-bearing `prepack` metadata and preparation output. `examples/headless-agent/tests/keyless-smoke.e2e.ts` keeps the checked-in prepared fixture on that source contract. `apps/cli/tests/github-repository-plugin.built.e2e.ts` is the product acceptance: simulated published helper package, job-local npm registry, fresh DSH home, exact authenticated private GitHub source, actual built `dsh run`, package-owned TypeScript build, real MCP execution, code-entry transformation, mock LLM request observation, and prepared cache inspection.
