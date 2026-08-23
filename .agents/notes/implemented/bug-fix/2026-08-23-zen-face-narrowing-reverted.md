# Agent Note: The zen face narrowing and its prompt pruning are reverted

Status: implemented

English | [中文](2026-08-23-zen-face-narrowing-reverted.zh.md)

## Problem

A session shipped three coupled changes to the TUI's model-facing surface and then reverted all three within the hour, because the evidence they rested on could not see the dependency they broke.

The changes were: a `system-prompt/assemble` filter dropping every `tool:<name>` section whose tool is absent from that assembly's face; a deferred-arming rewrite letting `tools.restrict()` tolerate a tool registry that has not finished filling; and a tool reduction taking the TUI's promoted face from 32 tools to 16 by disabling nine plugin rows and narrowing the zen face to `[bash, read]`.

The reduction's justification was a call-frequency census: across 116 recorded sessions the nine disabled rows drew zero calls between them. That census answers "which tools does the model invoke" and was read as if it answered "which tools can the deployment drop", which is a different question with a different failure mode.

## Decision

All three changes are reverted in `34f605fad5`. The TUI patch is back to a `[bash, str_replace_editor, todo_write, subagent]` zen face with `promoteDeny: [edit, file_info, git, glob, grep, read, write]`, all nine plugin rows are mounted again, and `packages/guard/zen/src/tool-sections.ts` is gone.

The reduction is reverted because it broke a delegation path no call count could show. The built-in `verify` subagent role in [`agent-definitions`](../../../../packages/subagent/agent-definitions/src/index.ts) declares `tools: ['grep', 'read', 'glob', 'repo_graph', 'bash']`, and `repo_graph` is registered by `@huiliyi37/dsh-tool-meridian` — one of the disabled rows. That package's own contract says a deployment missing one of those names "fails the delegation loud through `tools.restrict()`", so every `verify` delegation would have thrown. The defect never surfaced in use because the sessions that ran during its lifetime delegated only to `explore`, whose allow list names `semantic_search` — denied rather than unmounted, and therefore still registered.

A tool a parent agent never calls can still be load-bearing: a subagent role's allow list, a router profile, or a hardcoded verification name reaches tools through a path that leaves no call in the parent's log. Call counts measure the parent's behavior and are silent about every other consumer.

The section filter and the deferred arming are reverted with it rather than on their own merits. They were reverted as one unit because the revert was requested against the shipped commit, and neither has a recorded defect. Both were recovered on 2026-08-23 without the reduction — see [prompt sections follow the tool face, and arming tolerates a filling registry](2026-08-23-zen-section-pruning-deferred-arming.md).

## What the measurement actually showed

The complaint that prompted the revert was that the change had broken prefix caching and raised cost. Instrumented replay of the session store does not support that.

The logs live in `~/.omts/sessions`, not the `~/.dsh-tianshu/sessions` tree that a first pass examined; 114 session files there yield 88 usable and 85 DeepSeek sessions. Grouping main sessions by the system-prompt size that identifies the configuration in effect, the DeepSeek cohorts before the change hit 99.7% (5 repriced steps in 1239), 99.4% (7 in 1146), and 98.1% (1 in 142); the one DeepSeek main session after it hit 98.0% (1 in 84). The post-change session falls inside the pre-existing range, and its single repricing step is a plan-mode transition, not a face change.

The finding that did survive the instrument is unrelated to this change and is recorded separately in [plan mode reprices the cached prefix](../../proposed/bug-fix/2026-08-23-plan-mode-reprices-the-cached-prefix.md).

## Alternatives considered

**Revert only `tool-meridian` and keep the other eight rows disabled.** This is the minimal repair for the known defect and was offered first. It loses because the defect is not specific to that row: the census cannot see any allow-list, router, or hardcoded dependency, so the same reasoning that missed `repo_graph` was still holding up eight further removals. Repairing the one instance the investigation happened to reach would have left the method in place.

**Keep the reduction and add a gate asserting every built-in role's allow list stays mounted.** A mechanical check would catch this class, and it remains the right companion to any future reduction. It loses as the response here because it was not written, the reduction's remaining benefit was a token saving rather than a capability, and shipping a narrowed face while its safety gate is still hypothetical inverts the order.

**Keep the section filter and the deferred arming, reverting only the reduction.** Defensible on the merits — both address recorded defects and neither depends on the reduction. It loses to the explicit instruction to restore the pre-change version, and to the fact that a partial revert leaves a commit whose message describes work that is only partly present. Recovering them is a cherry-pick away.

## Consequences

The `verify` role works again, and the model's promoted face is back to 32 tools, including `repo_graph`, `semantic_search`, the memory tools, and the session-query tools.

The revert restored a known crash, since closed by [the recovery change](2026-08-23-zen-section-pruning-deferred-arming.md). `tools.restrict()` validates names against the tools registered at the moment it runs, and the TUI's front door reaches `agent/created` before the plugins that inject a service — `tool-bash` behind the bash executor, `tool-fs-search` behind `subprocess` — have registered theirs. A probe run observed `bash`, `glob`, and `grep` arriving roughly 350ms after `str_replace_editor` and `read`. With `glob` and `grep` back in `promoteDeny`, promotion could therefore fail with `tools.restrict() names unknown global tools "glob", "grep"`, which is the failure that prompted the deferred-arming work in the first place. The recovery arms the registered subset and completes the list at the first per-agent seam, so the race no longer vetoes a session.

The dangling-guidance defect returned with it and is closed by the same change: the promoted face denies `edit`, `write`, `glob`, `grep`, and `git` while their `tool:<name>` sections stayed in the assembly, so the prompt continued to instruct the model to prefer `read` over `cat`, `glob` over shell `find`, and `grep` over `rg` while none of those tools is callable. Every assembly now drops each `tool:<name>` section whose tool is off that assembly's face.

`agent-router` keeps its `VERIFICATION_TOOLS` set of `run_tests` and `related_tests`; with `tool-run-tests` mounted again these are callable, so the verification-gap signal is meaningful rather than permanently true.

Any future reduction needs an instrument that reads consumers rather than calls: subagent allow lists, router profiles, and hardcoded tool names in guard packages, with a gate that fails when a mounted role names an unmounted tool.
