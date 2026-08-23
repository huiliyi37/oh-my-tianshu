# Agent Note: Persistent tool-pattern approval rules

Status: proposed

English | [中文](2026-08-23-persistent-approval-rules.zh.md)

## Problem

The [approval seam](../../../../packages/interaction/user-approval/README.md) grants one-shot decisions only: its documented limitation is that no remembered rule, `allow-always`, or grant store exists, and the [permission presets](../../../../packages/interaction/permission/README.md) bundle whole-session policy, not per-tool patterns. Users therefore re-answer recurring approvals, or flip `/yolo` and give up granularity. Claude Code solves this with persisted tool-pattern rules such as `deny Bash(git push:*)` and a management surface.

## Proposal

A new package `@huiliyi37/dsh-approval-rules` under `packages/interaction/approval-rules/` persists per-tool allow/deny pattern rules, answers approval requests through the seam, and ships a `/permissions` management command. Mounting is opt-in.

### Rule storage

Rules live in YAML files the host reads and writes directly; neither file nor content ever reaches a model request. The user layer is `$DSH_HOME/permissions.yaml` and the project layer is `.dsh/permissions.yaml`; the effective list merges user entries first and project entries after, so a later project rule wins ties deterministically. A malformed file fails loud at plugin load.

A rule names a registered tool, a glob pattern over the complete normalized argument string (`*` matches any run, the match anchors at both ends), and an `allow` or `deny` decision:

```yaml
- tool: Bash
  pattern: 'git push:*'
  decision: deny
```

### Answerer semantics

The seam contract composes one terminal answerer per deployment and does not treat sibling listener order as a policy mechanism, so the package owns precedence by construction instead of by registration order. It registers the deployment's single terminal answerer as a composition: the rules first, then the injected interactive answerer as the fallback — the host adapter exposes its answerer through a small service seam (`tui.approvalAnswerer` for the TUI, which today registers its listener internally), and the composed handler calls the fallback directly on a rule miss. Without an injected answerer the chain still terminates: a miss settles `unavailable` and fails closed. The first matching rule answers — `allow` returns `allowed-once`, `deny` returns `rejected`. Rules answer approval requests only: they never touch `sandbox/mode`, never change `approval/policy`, and the `never` policy still rejects before answerers run, so rules cannot override it. A rule decision appends the log-only `approval/rule` event between `approval/asked` and `approval/decided`, carrying the matched rule reference and decision, so the log reconstructs the provenance of every auto-answered request.

### Command surface

`/permissions` (bare) lists the effective rules; `/permissions add <tool> <pattern> <allow|deny>` appends to the project file; `/permissions remove <index>` removes a listed rule. The command registers on `ctx.commands` and surfaces in the TUI slash menu the way [`/next-workflow` does](../../../../packages/workflow/next-workflow/README.md).

## Alternatives considered

### Why not extend the seam's outcome vocabulary?

Adding `allow-always` and a remembered-grant store to `ctx.approval` changes a seam contract every consumer must honor, and session-local grants still die with the session. Rules are a separable policy layer over the existing one-shot vocabulary.

### Why not a sandbox command-policy DSL?

Codex's execpolicy-style prefix DSL governs command execution, a broader mechanism than approval answering, and sits closer to the sandbox seam. The [codex candidates catalog](2026-08-22-codex-harness-enhancement-candidates.md) already names it as a separately evaluated item; approval rules and exec policies stay separate until evidence says otherwise.

### Why not settings-based rules?

The settings seam hot-commits deployment configuration; approval rules are per-project user intent whose authoritative home is the project directory, and settings files are not project-local.

## Acceptance criteria

- A real-composition e2e runs approval requests under each case: a `deny` rule settles `rejected` and an `allow` rule settles `allowed-once` without invoking the injected interactive answerer, while an unmatched request reaches the fallback — proven through the composed single terminal answerer, with no sibling listener ordering involved.
- The e2e asserts the `approval/asked` → `approval/rule` → `approval/decided` sequence and that the model sees only the consumer's tool outcome.
- Pattern tests cover full-string anchoring, `*` runs, multibyte arguments, and first-match-wins ordering across the two layers.
- Load-time failure is proven: a malformed rules file, an unknown tool name, and a reserved decision each fail loud.
- The HMR-safety test disposes the plugin fiber and observes the answerer withdrawal; the TUI wiring test proves the host exposes `tui.approvalAnswerer` and stops self-registering its internal listener when rules are composed.
- The `/permissions` add/list/remove surface has unit coverage plus a TUI snapshot of the listing; the package invariant pins rules-file/loaded-rules consistency and the provenance event shape. The bilingual README pair and this note's promotion ship with the landing commit.

## Risks

- The first grammar is a simple anchored glob, not regexes: patterns can under- or over-match, and the `/permissions` listing keeps current grants visible as the counterweight.
- An `allow` rule is a standing grant; the file is host-writable only, and the README documents file-permission hygiene.
- Rules answer for every agent in the deployment, including subagents; per-agent rule scoping is deferred until a consumer asks for it.
- The answerer seam addition touches the TUI; the ACP automation bridge keeps its own one-shot machine decisions and does not consult rules in the first cut.

## Implementation deltas (2026-08-23)

Implemented in the working tree as `packages/interaction/approval-rules`, with these corrections:

- Waterfall offers no priority mechanism (order = registration order; the seam warns sibling order is not policy priority). The 'runs before the interactive answerer' property is now an explicit mounting-order contract — documented in JSDoc/README and pinned by a test that registers a late interactive answerer stub and asserts rules decide first with sequence asked → rule → decided.
- Unknown tool names are not validated at load (the tool face may mount later); they simply never match at request time.
- The provenance event rides on `req.agent.session` — the waterfall request carries the agent, so no session lookup is needed.
- `/permissions` copy explicitly disambiguates from the existing singular `/permission` preset switcher and the `permissions` projection key.
- `.dsh/` project-layer convention already exists (`.dsh/skills|agents|memory`), so `.dsh/permissions.yaml` extends it rather than inventing one.
