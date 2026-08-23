# @huiliyi37/dsh-approval-rules

English | [中文](README.zh.md)

Persistent per-tool allow/deny approval rules as a strategy layer over the `ctx.approval` seam. The package registers an `approval/request` waterfall answerer that consults a merged rule list loaded from two YAML layers and, on the first hit, settles the request deterministically — `allow` resolves `allowed-once`, `deny` resolves `rejected` — without consulting any interactive answerer. When no rule matches it delegates via `next()`, so a later interactive answerer still decides. The `/permissions` command (see below) manages the rule files; it is deliberately distinct from `/permission`, the existing preset switcher.

The implementation never changes the `ApprovalOutcome` vocabulary (`allowed-once` / `rejected` / `cancelled` / `unavailable`), never touches sandbox/mode, and the `'never'` approval policy still rejects before any answerer is consulted. Every automatic decision appends a log-only `approval/rule` event to the owning session, so the asked → rule → decided audit stays complete and replayable without entering the model transcript.

## The problem

The approval seam grants exactly one-shot decisions: an answerer returns `allowed-once` for the single action in front of it, or a refusal. There is no way to say "this tool, with these arguments, is always allowed" (or always denied) once and have every future request respect it. This package fills that gap with a **persistent rule layer**: a policy owner writes allow/deny rules to disk, and the seam consults them automatically, reserving the human/agent answerer for everything that does not match a rule.

## Rule syntax

Rules live as a YAML list with three fields per entry. Two layers are merged, **user layer first**, and matching walks the merged list in order returning the first hit.

```yaml
# <resolveDshHome()>/permissions.yaml
- tool: echo
  pattern: '*'
  decision: allow
- tool: bash
  pattern: 'git push*'
  decision: deny
```

- `tool` — the exact tool name this rule governs (matched with strict equality).
- `pattern` — a full-string-anchored glob matched against the tool call's **normalized argument string**. `*` crosses any characters; every other character is literal (this is a glob, not a regex). Anchoring is implicit, so `git push` never matches `safe-git push`. The pattern is matched against the normalized `arguments` string of the `tool/call` event the request references (via its `callId`); a request without a resolvable call matches against `""`.
- `decision` — `allow` (settles `allowed-once`) or `deny` (settles `rejected`).

A malformed YAML file, a non-list top level, an empty `tool` / `pattern`, or a `decision` outside `allow` / `deny` fails loud at load with the offending file path. Unknown tool names are **not** validated at load (a tool surface may be assembled later); such rules simply never match while that tool is absent.

### Layer paths

- User layer: `config.userFile` or `<resolveDshHome()>/permissions.yaml`.
- Project layer: `config.projectFile` or `<cwd>/.dsh/permissions.yaml`.

If a file is absent its layer is empty. `add` and `remove` write the project (or user) file with `mkdir -p` directory creation and `0600` permissions.

## Mount order contract

A Cordis waterfall has no priority mechanism: `approval/request` listeners run in **registration order**, and sibling order is not a policy priority mechanism. The rule answerer therefore only precedes an interactive answerer when **this package is assembled first**. Mount this package before any interactive approval answerer in the target composition; a deployment that mounts it afterward has the interactive answerer win the decision and the rules never apply. The tests pin this ordering with a late interactive answerer stub that would eagerly allow if consulted.

## Command

`/permissions` lists or manages the effective rules (it is distinct from `/permission`, the preset switcher).

- Bare `/permissions` lists the effective rules in priority order as `index  layer  tool  pattern  decision`.
- `/permissions add <tool> <pattern> <allow|deny>` appends to the project-layer file (creating it if absent).
- `/permissions remove <index>` removes the rule at an **effective** index from its owning layer.
- The command is mirrored into the TUI slash menu when the optional `tui.commands` seam is present, delegating execution to the host command registry.

## Config

```ts
export interface Config {
  userFile?: string   // default <resolveDshHome()>/permissions.yaml
  projectFile?: string  // default <cwd>/.dsh/permissions.yaml
}
```

## Model Experience

### Tool approval decision

#### What the model sees

The model sees only the asking consumer's eventual tool outcome — an allowed or rejected call — not the rule that produced it. `approval/asked`, `approval/rule`, and `approval/decided` are all log-only session events and never enter the model transcript; the persistent rule layer is invisible runtime policy, not model-visible context.

#### Token effect

Zero added tokens. An allow leaves the consumer's ordinary result; a deny replaces it with the same small retained error any rejection already produces.

#### KV Cache effect

Append-only. The log-only audit events do not add model-visible content, so nothing invalidates the reusable request prefix.

### Rule management

#### What the model sees

The model sees nothing about the rule store or `/permissions`. Rule management is a human-facing command over files; it is not narrated into the request the model sees.

#### Token effect

Zero added tokens. Rule mutations are not surfaced as context.

#### KV Cache effect

Append-only. No model-visible content changes with rule edits.

## Known Limitations and Deferred Work

- **Unknown tool names are not validated at load** — a rule naming a tool that is not yet assembled is accepted; it simply never matches until that tool appears. A load-time tool manifold could catch typos but is deferred.
- **Rules apply to every agent, including subagents** — there is no per-agent rule scoping in this cut; one merged list governs all requests routed through the seam. Per-agent or per-session rule sets are deferred.
- **`pattern` is a glob, not a regex** — only `*` is a wildcard (any run of characters); there is no character class, alternation, or grouping. A fuller glob dialect is deferred.
- **The rule event carries no approval id** — `approval/rule` is correlated to its asked sibling by tool name and turn position, not by the `approval/asked` id; a keyless snapshot (id-paired rule decisions) is deferred.
- **The command's `pattern` is a single token** — `/permissions add` takes `<pattern>` as one whitespace-free token, so a pattern with spaces must be written by editing the YAML file directly.
