# Development guide

English | [中文](development.zh.md)

The setup tutorial takes a new contributor from prerequisites to a checked checkout. The contributor reference that follows covers repository layout, daily workflow, and CI shape. Design rationale and implementation details belong to the linked Agent Notes and scripts.

## Setup tutorial

### Prerequisites

- Node.js supports 22.19+ and 24+. CI covers 22.19, 24, and 26; see the [Node engine floor Agent Note](../.agents/notes/implemented/process/2026-07-06-node-engine-floor.md).
- Corepack-enabled pnpm. The repo pins `pnpm@11.7.0` in `package.json`; run `corepack enable` if `pnpm --version` does not resolve through Corepack.
- Git 2.26 or newer; hook setup enables Git's worktree-specific configuration extension.
- Optional: a DeepSeek API key for the Web, headless, and ACP automation demos and real-API e2e tests.

### First-time setup

Install dependencies from the repo root:

```sh
pnpm install
```

The install also configures worktree-local Lefthook hooks and the `dsh-translation-pairing` Git merge driver through `scripts/install-lefthook.mjs`. The [worktree-local hooks Agent Note](../.agents/notes/implemented/process/2026-07-27-worktree-local-lefthook.md) owns the hook-path safety contract; the [automatic pairing merges Agent Note](../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md) owns the merge driver.

If either integration is missing because dependencies were restored from cache or `postinstall` was skipped, install them manually:

```sh
node scripts/install-lefthook.mjs
```

If the wrapper rejects existing Git configuration or reports a stale lock, follow its diagnostic and the linked Agent Note rather than editing worktree metadata speculatively. After moving a checkout, rerun the wrapper to regenerate the owned path.

Run typecheck once after a fresh clone:

```sh
pnpm run typecheck
```

Setup is complete when `pnpm run typecheck` exits successfully.

## Contributor reference

### Repository layout

```
vendor/      Vendored Cordis source — manifest + sync procedure in vendor/README.md
packages/    @huiliyi37/dsh-<pkg> workspaces at packages/<group>/<pkg>/
  core/        product API spine: session, system-prompt, tools, agent, agent-loop
  api/         Remote BFF assembly and TypeRT RPC gateway
  typert/      type graph generator, loader, and runtime registry
  llm/         LLM capability: Service Definition/Consumer + DeepSeek providers
  e2b/         E2B POC: sandbox + FS/subprocess adapters
  bash/        bash capability: Service Definition + local/pwsh providers + shell Consumers
  subprocess/  subprocess capability + local process-tree provider
  pty/         persistent PTY capability
  fs/          filesystem capability + policy
  lsp/         language-server capability
  skill/       skill provider registry + local impl + catalog/loader tool
  web/         web capability: Service Definition + search/fetch providers + tool Consumer
  compact/     compaction capability + basic provider
  context/     request-context plugins
  subagent/    subagent capability: Service Definition + providers + delegation Consumers
  bundle/      installable tianshu --profile patch-layer bundles
  workflow/    workflow capability + worker-thread provider + tool Consumer
  todo/        todo_write tool
  plan/        plan mode as logged state
  guard/       loop-hygiene + tool-timeout plugins
  self-modification/  the agent inspects/mounts its own plugins
  hooks/       Claude Code/Codex hook bridges + wire-protocol library
  session/     durable session data: persistence, projection, titles, telemetry
  settings/    user-settings capability + file provider
  credentials/ credential-reference capability + env/.env provider
  acp/         automation-only Agent Client Protocol server
  interaction/ approval/interaction capabilities, permission, commands, ask-user
  boot/        shared app-bin glue
  scaffold/    project tooling: helper, launcher, initializer, SDK protocol
  examples/    demo bundles (agent-spine + CLI/ACP/JSON-RPC bins)
  support/     dev/test infrastructure
  util/        zero-dependency utilities
python/      Python SDK and bundled runtime (see python/README.md)
native/      @huiliyi37/node-addon-landlock-run source of record (see native/README.md)
examples/    Runnable cordis.yml leaves over packages/examples bundles (see examples/AGENTS.md)
.agents/     Agent workflows and Agent Notes (`notes/`)
docs/        architecture, generated catalogs, postmortems, cookbook (see docs/AGENTS.md)
scripts/     repo gates and generators
website/     VitePress projection of selected bilingual docs/ sources
```

Package groups: packages/README.md.

### TypeScript project layout

The repository uses isolated Host and Client aggregates. An ordinary package is registered in exactly one aggregate: Host packages in `tsconfig.host.json` and Client packages in `tsconfig.client.json`.

| File | Role | Forms a program? |
|---|---|---|
| `tsconfig.json` | Solution root: `extends` base, `files: []`, and references to the two aggregates. It is the tsserver discovery entry and the entry for explicitly running the complete Project Reference graph; through the inherited `paths`, it is also the resolution config for tsx running `examples/` and `scripts/`. | No |
| `tsconfig.host.json` | Host aggregate: Host packages, examples, tests, scripts, website, and the exceptional Host project of `api/remotes`. | Yes |
| `tsconfig.client.json` | Client aggregate: `packages/client/*` packages and their tests, `apps/web`, and the exceptional Client project of `api/remotes`. | Yes |
| `tsconfig.base.json` | Shared compilerOptions and the source `paths` map. Also the resolution facade the vitest configs point vite-tsconfig-paths at: it has no `include`, so its `paths` apply to every importer. | No |
| `tsconfig.base.client.json` | Browser compiler shape (`jsx`, DOM libs, `types: []`) extended by the Client aggregate and every `packages/client/*` package. | No |

Host and Client stay two aggregate programs because both sides declaration-merge the cordis `Context` interface under the same keys with different services; one program seeing both merges reports a collision. The collision exists only inside a `ts.Program` — module resolution never triggers it — which is why the solution may reference both aggregates and one paths facade may span both sides. Three disciplines follow:

- `tsconfig.base.json` never gains `include` or `files`: they would leak into every extending package project and narrow the facade's match-all scope.
- A script that builds a repo-wide `ts.Program` seeds `tsconfig.host.json` or `tsconfig.client.json` explicitly — never the root solution, because flattening both aggregates into one program collides the `Context` merges.
- A new package is registered in exactly one aggregate. Having both a Node loader entry and a browser entry is not a reason to split a package; an ordinary Client plugin produces both runtime artifacts during the Client build phase.

`api/remotes` is the repository's only package with split Host and Client tsconfigs. Its Host entry must participate in the Host TypeRT graph, while its Client entry imports `/remote` declarations that Host tsdown must generate first. The package-root `tsconfig.json` is therefore only a solution, and the two aggregates and direct consumers reference `tsconfig.host.json` or `tsconfig.client.json` respectively. The workspace `constraints` gate walks the reachable Project Reference graph and checks each referencing project's own compiler face: a single-config target remains valid from either face, while a split target must name the matching leaf rather than its solution root or opposite leaf. Do not copy this structure to other packages; see the [`api-remotes` README](../packages/api/remotes/README.md) for the complete boundary.

The root build follows the generated dependency order:

```sh
tsc -b tsconfig.host.json
tsdown --env.DSH_BUILD_FACE host
tsc -b tsconfig.client.json
tsdown --env.DSH_BUILD_FACE client
pnpm run build:web
```

Both tsdown passes use the same complete workspace match. They neither scan build artifacts to discover Client packages nor maintain a Host/Client package filter list. Package-local tsdown configs select entries for the current phase through `DSH_BUILD_FACE`: an ordinary Client plugin produces both its Node loader and browser bundle during the Client phase; `api-remotes` uses `hostPhase: true` to produce its Host entry early and only its browser bundle during the Client phase. Tsdown consumes only the JavaScript emitted to `lib/types` by the preceding tsc phase.

TypeRT runs only during Host tsdown, seeded by `tsconfig.host.json`. It analyzes Host types and generates both Host reflection artifacts and the Host-for-Client Remote projection; Client tsdown does not start TypeRT. Consequently, `pnpm run typecheck` runs the complete Host lib phase before Client tsc, while `pnpm run build` continues through Client tsdown and the Web build. The [API Remotes generated-contract build note](../.agents/notes/implemented/process/2026-08-08-api-remotes-generated-contract-build.md) records this ordering decision.

Static analysis and tests resolve workspace imports through the base `paths` map to `src` and must pass on a clean tree; gates that consume built `lib/` output declare that dependency explicitly. Generated Host-for-Client Remote declarations are the deliberate exception: the public `typecheck`, `lint`, and `doc-typecheck` commands generate them first, while internal `*:contracts-ready` scripts assume that an invoking public command or scheduler gate already owns an explicit dependency on the TypeRT contract pass or the complete build. See the [solution-root note](../.agents/notes/implemented/process/2026-07-22-tsconfig-solution-root-two-aggregates.md) for the two-aggregate topology, the [ts-build-config note](../.agents/notes/implemented/process/2026-06-17-ts-build-config.md) for tsc-first emit ownership, and the [TypeRT Remote note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md) for the gate-preparation contract.

Business services declare callable methods on the Host with `@Remote` or `@RemoteScope`; the Host build generates Host-for-Client types and runtime contributions, and the Client's `api-remotes` composition loads those contributions under `ctx.remote` and scoped `agentCtx.remote` namespaces. See [API Gateway](api-gateway.md) for the generated artifacts on both sides, their assembly relationships, the SRC development fallback, and the Web build order.

If a relevant local check consumes built package output, build once first:

```sh
pnpm run build
```

`pnpm run hygiene` includes `publint`, which validates package entrypoints against the built `lib/*.js` files, and `verify-node-next-types`, which validates built declarations against a temporary NodeNext consumer. A fresh worktree has no bundled JS or declarations until `pnpm run build` runs; ordinary commits and pushes do not require that build unless their selected checks consume it.

### Environment variables

The real DeepSeek adapter and key-backed agent demos read credentials from the environment or from a gitignored `.env` at the repo root:

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://... # optional
```

`DEEPSEEK_BASE_URL` is optional and defaults to the public API. Never commit real credentials. The real-API e2e suites self-skip when `DEEPSEEK_API_KEY` is not set.

### Git integrations

The pairing merge driver derives a conflicted `.i18n.yaml` record from the confirmed ancestor, current, and other owner blobs when both language files use Git's default text strategy and merge cleanly. It fails closed on owner conflicts, non-text merge configuration, or invalid records; after an already-stopped merge, run `pnpm run resolve-translation-pairing-conflicts`, which stages every safe pairing record and exits unsuccessfully if other pairing conflicts still need manual work. See the [bilingual documentation contract](i18n/README.md#the-pairing-contract) for the exact boundary.

The installer probes the exact Node/tsx driver entrypoint before publishing its worktree configuration. If that runtime later becomes unavailable, the Node-independent launcher writes Git's ordinary text result, leaves the sidecar unresolved, and prints the recovery path; restore dependencies and run `pnpm run resolve-translation-pairing-conflicts`, or run `git merge --abort`. If `pre-merge-commit` rejects an otherwise clean merge, Git leaves the complete result staged without a commit; repair the failure and run `git commit`, or abort. The [automatic pairing merges Agent Note](../.agents/notes/implemented/process/2026-08-08-automatic-translation-pairing-merges.md#failure-contract) owns the exact index and `MERGE_HEAD` states.

lefthook is configured in `lefthook.yml` as a fast local checkpoint:

- `pre-commit` verifies staged pairing records against the staged owner blobs, validates staged files with the project-free `.oxlintrc.staged.json` profile and applies Oxlint fixes with one bounded retry, regenerates `THIRD_PARTY_NOTICES.md` when a staged file is one of its inputs, checks the staged diff for whitespace errors, and runs the vendor manifest guard.
- `pre-merge-commit` performs the same index-backed pairing check before Git creates an automatic merge commit.
- `pre-push` runs `pnpm run typecheck`, which completes the Host lib phase, including generated TypeRT contracts, before the Client TypeScript check.

The vendor manifest guard checks that changes under `vendor/*/src` are staged with the matching `vendor/README.md` manifest update. See `vendor/README.md` before editing vendored code.

Apart from the scoped staged-record verification, the hooks intentionally do not run tests, snapshots, documentation checks, builds, or hygiene. Contributors run the [checks relevant to the changed behavior](../AGENTS.md#run-relevant-checks-locally) once; CI owns exhaustive coverage, built-artifact smokes, and the Node 22.19, 24, and 26 compatibility matrix.

Contributors can opt into the comprehensive local gate set with `pnpm run check:all`. The command is independent of the Git hooks and is not an agent instruction.

### CI gates

The keyless [CI workflow](../.github/workflows/ci.yml) groups independent gates into broad lanes and runs a smaller compatibility signal across supported Node versions. Artifact consumers wait for one build within their lane. The separate real-API workflow runs `pnpm run test:e2e` with its configured worker bound. See [scripts/run-gates.ts](../scripts/run-gates.ts) and the workflow files for the current gate and job inventory.

### Daily commands

The root `pnpm` scripts below are the daily surface; [`package.json`](../package.json) and scripts/run-gates.ts own the current script and gate inventories. Select the smallest checks that cover the changed surface. Documentation changes use `pnpm run doc-sync`; package-public behavior changes also update the owning README or JSDoc, and built-artifact checks require `pnpm run build` first.

```sh
pnpm install            # pnpm workspaces, node ^22.19 || >=24
pnpm run clean           # remove build outputs and safe residue from deleted packages
pnpm run ci:local        # local CI loop (typecheck → test → build → hygiene → lint); the pre-push rigor gate
pnpm run test           # vitest unit tests
pnpm run test:coverage  # CI coverage gate: per-file 100% on packages/*/*/src
pnpm run test:e2e       # real-API tests; self-skip without DEEPSEEK_API_KEY
pnpm run test:snapshot  # keyless ACP/headless replay vs expected outputs; filter: -t <name>
pnpm run test:snapshot:record  # re-record expected outputs (needs key)
pnpm run typecheck
pnpm run lint
pnpm run duplication    # cross-file TypeScript clone detection
pnpm run build          # tsc emits lib/types, tsdown bundles runtime
pnpm run check:windows-wine  # ONLY when diagnosing a known Windows failure (needs wine); CI owns this signal
pnpm run hygiene        # knip + publint + workspace constraints + NodeNext consumer check
pnpm run doc-sync       # all documentation gates; leaf list in scripts/run-gates.ts
pnpm run website:build  # VitePress build (doubles as dead-link check)
pnpm run demo:headless "task" # one-shot agent (needs DEEPSEEK_API_KEY)
pnpm run demo:cordis    # the agent modifies its own runtime (needs key)
pnpm run demo:acp       # ACP automation server (needs DEEPSEEK_API_KEY)
```

### Demos

The one-shot Headless coding agent needs `DEEPSEEK_API_KEY` in the environment or repo-root `.env`:

```sh
pnpm run demo:headless "summarize this workspace"
```

The self-referential cordis demo can inspect and modify its live plugin runtime and needs the same credentials (`web` by default, or `acp`):

```sh
pnpm run demo:cordis
```

The ACP automation server exposes fresh agent sessions over JSON-RPC stdio and also needs `DEEPSEEK_API_KEY`:

```sh
pnpm run demo:acp
```

### TODO markers

Use one of three comment tags to flag known issues in the code, ordered by urgency:

- `FIXME` — an issue that should block a new release. A release should not ship with an open `FIXME` unless reviewers explicitly agree the change can be merged anyway.
- `TODO` — an issue that should be fixed soon, once we have the resources.
- `XXX` — an issue that we may fix someday; lowest priority, no commitment.

Pick the tag that matches the urgency so anyone scanning the code can tell a release blocker from a someday-maybe.

### Documenting types verbatim (`ts type-equiv`)

The [subsystems](subsystems/README.md) pages paste source-equivalent declarations together with their original JSDoc so a reader sees the exact shape and source contract. To keep a paste from drifting when source changes, fence it as ` ```ts type-equiv ` (instead of ` ```ts `) and register it in `scripts/type-equiv.manifest.json` with the source file and symbol it mirrors:

```json
{ "doc": "docs/subsystems/session.md", "symbol": "SessionEvent", "source": "packages/core/session/src/types.ts" }
```

`pnpm run verify-type-equiv` (part of `doc-sync`) then extracts that symbol's declaration and attached JSDoc from source via the TypeScript parser and asserts the block matches both. For a class whose implementation bodies do not belong in the catalog, use ` ```ts public-api ` and set `"projection": "public-api"`; the checked projection retains the public fields, constructor, accessors, methods, and original class/member JSDoc while omitting bodies and private or protected members. Comparison ignores whitespace and non-JSDoc comments but requires every original JSDoc comment, including member documentation, so readers see the source contract beside the exact shape. The gate enforces a 1:1 correspondence by document, symbol, and projection between primary blocks and manifest entries; a paired `.zh.md` block reuses its unsuffixed sibling's entry only when the whole tracked fence sequence is byte-identical and ordered identically. `doc-typecheck` applies the same derivative rule to compilable fences, while skipping both source-equivalence fence kinds from compilation and its opt-out ratio. When you change a documented declaration or its JSDoc, the gate fails until you update the paste; when you add or remove a primary block, update the manifest in the same change.
