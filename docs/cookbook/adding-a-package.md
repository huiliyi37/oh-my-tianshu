# Cookbook: adding a workspace package

English | [中文](adding-a-package.zh.md)

The file-by-file checklist for a new `@deepseek-ai/dsh-<name>` package. This checklist is validated against the bash and adapter packages as templates; if it drifts from them, fix it here.

## 1. Create the package

```
packages/<group>/<pkg>/
  package.json     # copy from packages/core/tools, adjust name/description/deps
  tsconfig.json    # extends ../../../tsconfig.base.json, rootDir src,
                   # outDir lib/types, references: ../../../vendor/cosmokit,
                   # ../../../vendor/cordis (+ ../../../vendor/schemastery if
                   # you use Config, + ../../<group>/<dep> for each dsh dep)
  src/index.ts     # service default export or plugin (name/inject/apply/Config)
  README.md        # service API, events, extension points, design notes,
                   # + gated Model Experience context blocks or short form
                   # + the gated "Known Limitations and Deferred Work" section
                   # (or a whitelist entry in scripts/verify-package-readme-limitations.ts)
```

Choose an existing group when one matches the package's role (`core`, `llm`, `bash`, `compact`, `subagent`, `todo`, `session-persistence`, `ui`, `util`, or `support`). A new group is allowed, but it is a pure container: no `package.json`, no source files, and packages still sit exactly one level below it.

package.json invariants (enforced by `pnpm run constraints` / `scripts/check-workspace-constraints.ts`): `private: true`, a `version` matching the root `package.json`, `type: module`, `main: "lib/index.js"`, `types: "lib/types/index.d.ts"`, `exports["."].types: "./lib/types/index.d.ts"`, `exports["."].default: "./lib/index.js"`, `cordis` in BOTH peerDependencies and devDependencies (same range). Mirror every dsh peer dependency in devDependencies. `schemastery` goes in `dependencies` (it is a runtime validator), matching agent-loop. The `files` list contains exactly `lib/index.js`, `lib/invariant.js`, `lib/types/**/*.d.ts`, and package-specific runtime artifacts recognized by the gate; a package whose runtime export points into the emitted tree also includes `lib/types/**/*.js`. Do not publish `src`, declaration maps, JS maps, or stale root declaration files. CLI app packages with a package `bin` include `lib/bin.js` immediately after `lib/index.js` in `files`.

In-package relative imports use explicit `.ts` specifiers in source (for example, `export * from './types.ts'`). The compiler rewrites those to `.js` in emitted JS and leaves explicit `.ts` specifiers in declarations, which standard NodeNext/Node16 TypeScript consumers resolve to the sibling `.d.ts` files.

## 2. Register it in the root configs

| File | Change |
|---|---|
| `tsconfig.base.json` | no edit for an existing group; for a new group, add a `./packages/<group>/*/src` candidate to the `@deepseek-ai/dsh-*` wildcard |
| `tsconfig.host.json` (Host package) or `tsconfig.client.json` (Client package) | add `{ "path": "./packages/<group>/<pkg>" }` to `references` — an ordinary package belongs to exactly one aggregate, never both. `api/remotes` uses a repository-specific split because the Host generates a contract that the Client consumes in a later phase; new packages must not copy it ([layout](../development.md#typescript-project-layout)) |
| `knip.json` | only if the package has entrypoints that repository discovery does not already cover |

A `packages/client/*` package additionally extends `tsconfig.base.client.json` instead of `tsconfig.base.json`, and a client plugin package declares `dshClient` in package.json, exports `./client`, and calls the shared tsdown preset (`packages/client/tsdown.client.ts`) — see [packages/client/AGENTS.md](../../packages/client/AGENTS.md) for the client-side contract.

Covered automatically by globs or package-manifest discovery — no edits needed: root `package.json` workspaces, `scripts/publint-all.ts`, `tsdown.config.ts`, `.oxlintrc.json`, `scripts/check-workspace-constraints.ts`.

## 3. Decide the package topology

For a swappable capability, separate Service Definition / Service provider / Consumer roles into packages when they evolve independently (see docs/architecture.md § "Capability seams" — the bash trio is the template). A single-purpose plugin stays one package.

## 4. Write the package README

Keep package-specific service API, config, events, extension points, and design notes first. The limitations section records durable consumer gaps and non-obvious maintainer constraints owned by this package; ordinary cleanup stays in its source TODO or Agent Note. An indirect Model Experience sentence may name the consumer that surfaces this package's contribution, but it does not restate that consumer's implementation. End a package README with this canonical sequence:

````markdown
## Model Experience

### Request surface and condition

#### What the model sees

An exact data-dependent shape, an anchored generated-catalog link, or an introduction to the verbatim literal below.

##### Verbatim text for this field, when needed

```markdown
Stable system-prompt prose of any length, or another long non-generated literal, copied exactly from source.
```

#### Token effect

Fixed, conditional, retained, replaced, capped, or zero-direct token effect.

#### KV Cache effect

Append-only, prefix-stable, replacing, or independent behavior, including the exact conditions that may invalidate reuse.

## Known Limitations and Deferred Work

- **Consumer-visible gap** — exact boundary, consequence, or maintainer constraint.
````

Fill Model Experience from the implementation. Use one H3 per direct, conditional, capped, lifetime, or auxiliary-model surface, with the three ordered H4 fields shown above and one prose paragraph under each. Quote stable text owned by the package: system-prompt prose goes in a titled H5 plus `markdown` fence under the field that introduces it—normally `What the model sees`—other short literals stay inline with named placeholders, and other long literals use the same nested form. Summarize only data-dependent or provider-owned text. A tool-schema surface links its anchored section in the generated [tool catalog](../tool-catalog.md) and states only deltas absent there. Keep prompt and schema surfaces separate when scoping can hide one without the other. In `KV Cache effect`, distinguish append-only growth, a stable repeated prefix, replacement of earlier request tokens, and an independent model request, then name the package-owned changes that can invalidate reuse. “Does not invalidate” means the package preserves an already-reusable prefix; provider cache availability and eviction remain outside the package contract. The [prose standard](../../.agents/skills/dsh-prose-standard/SKILL.md) governs completeness and ownership; the verifier enforces the mechanical shape.

A package with no context effect or one consumer-owned path uses the audited `None, as ` or `Indirectly, through ` sentence in [`SENTENCE_MODEL_EXPERIENCE`](../../scripts/verify-package-readme-model-experience.ts), followed by a `KV Cache effect` H4 and one non-empty paragraph; a model-agnostic generic package may instead join `NO_MODEL_EXPERIENCE_SECTION`. Do not expand either case into a description of another package's work. The limitations [allowlist](../../scripts/verify-package-readme-limitations.ts) is independent. The [Model Experience Agent Note](../../.agents/notes/implemented/process/2026-07-12-package-model-experience-contract.md) records the rationale.

## 5. Verify

```sh
pnpm install        # registers the workspace
pnpm run doc-sync
pnpm run constraints && pnpm run typecheck && pnpm run lint
pnpm run build && pnpm run hygiene
```

Follow the [repository testing policy](../testing.md) for the behavior-specific checks and coverage required by the new package.
