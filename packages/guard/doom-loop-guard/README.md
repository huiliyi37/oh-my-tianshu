# @huiliyi37/dsh-doom-loop-guard

English | [中文](README.zh.md)

An advisory loop-breaker, not a model-facing tool: it never appears in the tool list, never vetoes or rewrites a call, and adds exactly one behavior — it watches each agent's stream of tool calls and injects an escalating advisory reminder when the stream shows a loop pattern that [repeat-tool-guard](../repeat-tool-guard/README.md)'s identical-call chain does not cover: an alternating call pair, consecutive failed edits on the same file, or an unchanged failing test run. The decision stays entirely with the model; a legitimate call sequence is delayed by nothing and blocked by nothing. It never duplicates the identical-repeat reminder — that chain belongs to repeat-tool-guard.

## Config

```yaml
- id: doom-loop-guard
  name: '@huiliyi37/dsh-doom-loop-guard'
  config:
    oscillationPairs: 2       # default; A,B,A,B trips the oscillation detector
    editRetryThreshold: 3     # default; consecutive failed same-file edits
    testChurnThreshold: 3     # default; consecutive identical failing test runs
    exclude: []               # extra tool-name patterns transparent to every detector
    argumentsPreviewChars: 200 # default; cap on the churn reminder's command preview
    reminderBudget: 3         # default; reminders per agent per user-turn
```

Every numeric field fails loud at plugin load (integers >= 2, except `argumentsPreviewChars`/`reminderBudget` >= 1) — never a silent fall-back. `exclude` entries support `*` wildcards and are predicates over whatever tools exist at call time, not references to registry entries. The built-in exclude list covers read-only discovery tools (`read`, `glob`, `grep`, `file_info`, `related_tests`, `task_output`, `task_list`, session/memory/web search, `skill`), so legitimate search-then-act rhythms stay quiet.

## Detectors

- **Oscillation.** The last `2 × oscillationPairs` calls form exactly two tools alternating (A,B,A,B, …) with identical per-tool canonical identity, and at least one call failed or reported a failure. A pure successful alternation may be a legitimate search-then-act rhythm and never trips.
- **Edit spiral.** Consecutive failed (`isError`) calls of an edit-family tool (`str_replace_editor`, `edit`) on the same path. A successful edit on that path clears the marker, so the next genuine spiral can fire.
- **Test churn.** Consecutive runs of the same test command (`run_tests`, or a `bash` command containing `test`) whose normalized output hash is unchanged and whose output reports a failure. The hash normalization strips elapsed-time markers (`in 1.2s`), so identical failing runs hash identically.

Each detector dedupes per pattern until the pattern breaks, and the per-turn `reminderBudget` caps reminder volume; observation continues past the budget. Calls without an agent are ignored; chains are per-agent and reset on a user message.

## Reminder delivery

Reminders ride the post-execute decision's `additionalContexts` (source `{kind: 'plugin', plugin: 'doom-loop-guard'}`), never a `content` replacement: the `tool/result` event stays the tool's own output for audit. The loop buffers the context and appends it as an injected `user/message` after the step's tool results, which the session renders as a plain synthetic user message — model-visible, source-attributed, and reconstructable from the session log with no new session event. The guard always delegates via `next()` and prepends its reminder to the downstream decision's context array (both variants — a blocked call still gets the nudge).

## Model Experience

### What the model sees

No tool schema or normal-call text is added. On detection, that agent receives one advisory reminder naming the pattern, the tools or path involved, and the recommended change of approach.

### Token effect

Zero tokens before a detector trips. Each reminder is bounded: the churn reminder previews the canonical command identity capped at `argumentsPreviewChars`; the oscillation and edit reminders are fixed-length.

### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Exact patterns only** — the three detectors cover oscillation, failed-edit spirals, and unchanged failing test output; slower drifts (near-identical variants, long-period cycles) evade them.
- **Compaction does not reset state** — a window spanning a compaction checkpoint keeps counting.
- **Advisory only** — escalating to `block` at a high threshold is not implemented, though `PostToolDecision` already supports blocking.
- **Test-churn hashing is text-level** — normalization strips only elapsed-time markers; other volatile output (timestamps, durations) makes two identical failing runs hash differently.
- **Legitimate repeated polling still draws nudges** past the thresholds — the pressure valves are the thresholds, `exclude`, and `reminderBudget` config.
