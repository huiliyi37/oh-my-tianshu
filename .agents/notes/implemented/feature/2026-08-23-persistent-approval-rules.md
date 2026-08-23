# Agent Note: Persistent tool-pattern approval rules

Status: implemented

English | [中文](2026-08-23-persistent-approval-rules.zh.md)

## Problem

The [approval seam](../../../../packages/interaction/user-approval/README.md) grants one-shot decisions only: its documented limitation is that no remembered rule, `allow-always`, or grant store exists, and the [permission presets](../../../../packages/interaction/permission/README.md) bundle whole-session policy, not per-tool patterns. Users re-answered recurring approvals, or flipped `/yolo` and gave up granularity. Claude Code solves this with persisted tool-pattern rules such as `deny Bash(git push:*)` and a management surface.

## Decision

A new package `@huiliyi37/dsh-approval-rules` under `packages/interaction/approval-rules/` persists per-tool allow/deny pattern rules, answers approval requests through the seam, and ships a `/permissions` management command. Mounting is opt-in.

### Rule storage

Rules live in YAML files the host reads and writes directly; neither file nor content ever reaches a model request. The user layer is `<resolveDshHome()>/permissions.yaml` and the project layer is `.dsh/permissions.yaml` (extending the existing `.dsh/` convention), both `Config`-overridable; the effective list merges user entries first, and matching walks the merged list returning the first hit. A malformed file fails loud at plugin load. Disk is the authoritative store: `add`/`remove` commit to the layer file first and mirror the in-memory snapshot only after the write succeeds, `remove` resolves its listed index against a fresh disk read, and there is no filesystem watching — external edits surface after restart.

A rule names a tool, a glob `pattern`, and a `decision`:

```yaml
- tool: bash
  pattern: '*git push*'
  decision: deny
```

The pattern anchors full-string against the tool call's normalized argument string — the raw `arguments` value of the referenced `tool/call` event, whitespace-collapsed. Most tools receive JSON-encoded arguments from the model (a bash-style call normalizes to `{"command":"git push",…}`), so patterns anchor on the stable inner substring with `*` on both sides; the README documents this shape because a plain `git push*` never matches a JSON-encoded call and a silently-dead deny rule fails open.

### Answerer semantics and mount order

A Cordis waterfall has no priority mechanism: `approval/request` listeners run in registration order, and the seam explicitly warns that sibling order is not a policy priority mechanism. The shipped design therefore owns an explicit **mount order contract**: the rule answerer precedes an interactive answerer only when this package is assembled first; the README and JSDoc state it, and a test pins it with a late interactive answerer stub that would eagerly allow if consulted. On a rule miss the answerer delegates via `next()`. The package never changes the `ApprovalOutcome` vocabulary, never touches sandbox/mode, and the `'never'` policy still rejects before any answerer is consulted — proven by a test under `policy: 'never'` with a matching allow rule present.

### Provenance event

Every automatic decision appends a log-only `approval/rule` event to the owning session (the waterfall request carries the agent, so no session lookup is needed) between the matching `approval/asked` and `approval/decided`, carrying the matched rule's tool, pattern, decision, effective index, and owning layer. The package invariant companion validates the event pre-commit (`internal/dispatch` — a throw vetoes the append), applies its fold post-commit, and re-validates a replayed session at companion load.

### Command surface

`/permissions` (bare) lists the effective rules; `add <tool> <pattern> <allow|deny>` appends to the project file; `remove <index>` removes the effective-index rule from its owning layer. The command registers on `ctx.commands` (optional inject, so a headless rules-only composition mounts) and mirrors into the TUI slash menu the [`/next-workflow` way](../../../../packages/workflow/next-workflow/README.md); its copy explicitly disambiguates from the existing singular `/permission` preset switcher.

## Alternatives considered

### Why not the composed single terminal answerer?

The original proposal had this package own the deployment's single terminal answerer as a composition — rules first, then an injected interactive answerer called directly on a miss — which would have made precedence by construction instead of by registration order. It lost because it requires a new `tui.approvalAnswerer` host seam exposing each adapter's interactive answerer: a cross-adapter contract change with one consumer, inverting the seam's composition ownership. The mount order contract reaches the same guarantee for correct compositions while the seam stays untouched; a mis-ordered composition fails visibly (the interactive answerer answers everything) instead of silently.

### Why not extend the seam's outcome vocabulary?

Adding `allow-always` and a remembered-grant store to `ctx.approval` changes a seam contract every consumer must honor, and session-local grants still die with the session. Rules are a separable policy layer over the existing one-shot vocabulary.

### Why not a sandbox command-policy DSL?

Codex's execpolicy-style prefix DSL governs command execution, a broader mechanism than approval answering, and sits closer to the sandbox seam. The [codex candidates catalog](../../proposed/feature/2026-08-22-codex-harness-enhancement-candidates.md) already names it as a separately evaluated item; approval rules and exec policies stay separate until evidence says otherwise.

### Why not settings-based rules?

The settings seam hot-commits deployment configuration; approval rules are per-project user intent whose authoritative home is the project directory, and settings files are not project-local.

## Consequences

- Composition tests run approval requests under each case: `deny` settles `rejected` and `allow` settles `allowed-once` without invoking a later interactive stub, an unmatched request delegates through `next()`, and the loader-composition spec proves the same through a real Loader boot plus load-time failure on a malformed file. Pattern tests cover full-string anchoring, `*` runs, multibyte arguments, and first-match-wins ordering across the two layers; mutation tests pin disk-authoritative commit (a failed add never reaches the effective snapshot) and external-edit coherence (remove resolves against a fresh disk read).
- The invariant companion carries its own spec: accepted pairing, unpaired and double-rule rejection, payload vocabulary rejection, and replay rejection at companion load.
- Unknown tool names are not validated at load (the tool face may mount later); they simply never match at request time.
- The first grammar is a simple anchored glob, not regexes: patterns can under- or over-match, and the `/permissions` listing keeps current grants visible as the counterweight.
- An `allow` rule is a standing grant; files are written `0600`, and the README documents file-permission hygiene.
- Rules answer for every agent in the deployment, including subagents; per-agent rule scoping is deferred until a consumer asks for it.
- The `approval/rule` event carries no approval id; it correlates to its asked sibling by tool name, and the invariant's pairing fold enforces that discipline (an id-pairing keyless snapshot is deferred).
- The ACP automation bridge keeps its own one-shot machine decisions and does not consult rules in this cut.
