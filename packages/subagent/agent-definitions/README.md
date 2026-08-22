# @huiliyi37/dsh-agent-definitions

English | [中文](README.zh.md)

Agent role definitions (`ctx.agentDefinitions`): named compositions of subagent start-request inputs — persona body, tool allow list, model route, sandbox narrowing — discovered from flat markdown files, plus a runtime registration seam that hosts the built-in read-only `explore` and `verify` roles. A role is not a provider: provider selection stays with the delegation tool's deployment configuration, and the model-facing Consumer ([`dsh-tool-subagent`](../tool-subagent/README.md)) merges a chosen role into one delegation request.

## Role files

A role file is a flat `<name>.md` document — no directory bundles — with YAML frontmatter and a markdown body that becomes the child persona:

```markdown
---
name: reviewer
description: Read-only code review citing file:line evidence.
tools:
  - grep
  - read
  - glob
model: fast-model
---

You are a code-review subagent. ...
```

`name` (kebab-case) and `description` are required — the description drives delegation routing, so it must say when to choose the role. `tools` is an allow list applied as the child's global-tool restriction (unknown names fail the delegation loud through `tools.restrict()`); `model` overrides the child's `agentOptions.model`. Invalid files are skipped with a warning and never fail discovery.

Discovery scans ranked roots, and a lower rank wins a duplicate name: project `.dsh/agents` (100) and `.agents/agents` (200), `customAgentDirs` (300), user `~/.dsh-tianshu/agents` (400) and `~/.agents/agents` (500), and the configured `bundledAgentDir` (600). Runtime registrations sit at rank 250. Reads go through the `ctx.fs` service when one is mounted (the bundled root reads the host directly), and chokidar-backed watching plus first-party `fs/observed` mutation notices invalidate the per-cwd catalog cache.

## Runtime registration and the built-in roles

`ctx.agentDefinitions.register()` installs a role from code — the seam deployments and tests use for roles that ship with the product. `explore` supplies a read-only codebase-survey persona and `grep`/`read`/`glob`/`semantic_search`/`bash`; `verify` supplies an independent evidence-checking persona and `grep`/`read`/`glob`/`repo_graph`/`bash`. Both carry a `read-only` sandbox narrowing appended as a durable `sandbox/mode` delegation override on the child log. The narrowing needs the delegation provider's `sandboxMode` capability and survives cold resume because it lives on the child log, not in the descriptor. `builtinExplore: false` and `builtinVerify: false` omit their respective registrations.

## Config

| Key | Meaning |
|---|---|
| `includeDefaultRoots` | Include project and user roots around custom roots, default `true`. |
| `dshHome` | Harness config root; defaults to `$DSH_HOME` or `~/.dsh-tianshu`. |
| `agentsHome` | Shared agent config root; defaults to `$DSH_AGENTS_HOME` or `~/.agents`. |
| `customAgentDirs` | Extra roots scanned after project roots and before user roots. |
| `bundledAgentDir` | Installer-supplied role root at the lowest precedence; trusted-host reads. |
| `builtinExplore` | Register the built-in read-only `explore` role, default `true`. |
| `builtinVerify` | Register the built-in read-only `verify` role, default `true`. |
| `collectCacheMaxEntries` | Maximum completed per-cwd catalogs kept in memory, default `128`. |
| `watch` | Watch host-local roots for catalog changes, default `true`. |
| `watchUsePolling` | Use Chokidar polling instead of native filesystem events, default `false`. |
| `watchStabilityThresholdMs` | Milliseconds a changed role file must remain stable before observation, default `200`. |
| `watchPollIntervalMs` | Milliseconds between Chokidar stability or polling probes, default `100`. |
| `watchMaxProjects` | Maximum distinct project roots whose agent directories stay watched, default `128`. |
| `watchFollowSymlinks` | Follow watched symbolic links to their target files, default `true`. |

## Model Experience

Indirectly, through `dsh-tool-subagent`, which renders this catalog into the durable `<available_agents>` message and merges a chosen role's body into the child persona.

#### KV Cache effect

No direct prompt effect. The named consumer owns catalog publication; a role edit invalidates this service's discovery cache, and the consumer's digest decides whether the session message is republished.

## Known Limitations and Deferred Work

- **A role cannot remove scoped child tools** — the `tools` allow list rides `tools.restrict()`, which shapes only global registrations, so scoped contributions such as the `report` tool survive every role; trimming them needs a role-aware continuable-setup contribution.
- **No `.claude/agents` compatibility source** — external role directories mount through `customAgentDirs`; a dedicated compatibility reader is deliberately deferred.
- **Markdown roles cannot request the sandbox narrowing** — `sandbox: 'read-only'` is reachable only through runtime registration; the frontmatter carries no field for it.
- **Role bodies interpolate as personas** — the body becomes a `deployment:persona` section under strict `{{var}}` interpolation, so literal `{{…}}` text in a role file fails the child's first request with a prompt-variable error.
