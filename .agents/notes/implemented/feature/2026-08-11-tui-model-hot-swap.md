# Agent Note: /model current-session hot swap (C2 item 4)

Status: implemented

English | [中文](2026-08-11-tui-model-hot-swap.zh.md)

## Problem

`/model <provider/model>` only writes the default model (`saveSelection`), which affects new sessions; the currently running session is untouched, so after switching models the user has to wait for a new session or edit cordis.yml.

## Decision

The hot swap lives purely in the assembly layer, and agent-loop is untouched.

1. **The mutable ref**: `installModelSelection` (packages/core/agent/src/model-selection.ts L39) accepts a **mutable `ModelSelectionRef { current, assembled }`** — every prompt assembly snapshots `selection.current` into assembled, and request routing consumes assembled. Changing `ref.current` takes effect automatically on the next agent step, without interrupting the current step. Verified against the implementation, L46-58 (the assembly snapshot) + L60-78 (request routing).
2. **TuiApp holds the ref**: `private modelRef: ModelSelectionRef | null`; the newSession/switchSession (resume branch) setup passes `this.modelRef` instead of a literal, so the ref survives the session; in the registry fallback branch, where the agent is held by another assembler, the ref goes to null.
3. **`switchLiveModel(selection): boolean`**: changes `modelRef.current` and returns whether the hot swap succeeded (false = a registry-fallback session cannot hot-swap).
4. **The /model command**: saveSelection (the default still updates) + `deps.switchLiveModel(next)`; the echo distinguishes 「当前会话与默认均生效」 (both the current session and the default take effect) from 「默认生效；当前会话不可热切」 (the default takes effect; the current session cannot hot-swap).

## Verification facts

- commands.spec.ts: 2 /model hot-swap cases (switchLiveModel invoked + the both-effective echo; false → the cannot-hot-swap echo), RED→GREEN.
- app.spec.ts: 4 switchLiveModel lifecycle cases (true after newSession, false with no session, false on registry fallback, true after resume), RED→GREEN; 4/4.
- Related specs 179/181 (the 2 failures are pre-existing at HEAD from parallel-session commit 59f655b: statusline wiring, tool-card rendering — git is clean, not uncommitted WIP, zero overlap with this change).
- Types: a scratch check of the 4 files reports zero type errors for this change's 48-line diff; all tsc errors sit in app.spec.ts's parallel-session test region (resize mock types, pre-existing at HEAD).

## Files

- `packages/tui/tui/src/ui/app.ts`: the modelRef field + newSession/switchSession wiring + switchLiveModel + createBuiltinCommands injection
- `packages/tui/tui/src/commands/registry.ts`: BuiltinCommandDeps.switchLiveModel + /model command hot swap and echo
- `packages/tui/tui/tests/app.spec.ts`: 4 switchLiveModel cases
- `packages/tui/tui/tests/commands.spec.ts`: 2 /model hot-swap cases + the deps helper
- `docs/dsh-tui-与grok的功能对比-c2.md`: item 4 marked ✅

## Alternatives considered

**grok's ACP hot swap — `SetSessionModelRequest` to the running agent** — unavailable. DSH has no ACP, so there is no session-model request to send; mutating the `ModelSelectionRef` that prompt assembly already reads reaches the same effect through the assembly layer alone.

**Applying the switch immediately by interrupting the current step** — rejected. The ref is read at the next prompt assembly, so the swap lands on the next agent step and the streaming reply in flight is left alone; an immediate switch would mean touching agent-loop, which this change deliberately does not do.

**grok's effort argument and agent-type mismatch modal** — rejected as out of scope by the C2 document. `/model` hot-swaps the model only: there is no effort hot swap, and DSH does not distinguish agent types, so there is no mismatch modal to open.

## Consequences

- The running session follows `/model` while the default keeps updating, and the price is a one-step delay: the swap lands on the next agent step, so a reply already streaming finishes on the old model — a semantics difference carried only by the command echo, not by docs or help.
- A registry-fallback session, whose agent another assembler holds, cannot hot-swap; switchLiveModel returns false and the echo says the default alone took effect, so the limit reaches the user instead of failing silently.
- The whole mechanism is one held ref plus one TuiApp field and one command dependency — a 48-line diff that leaves agent-loop and the model-selection implementation as they are.
- Evidence stops at the package tests: in the assembled `dsh --profile tui`, whether the next user message's request lands on the new model (the model name visible in the transcript/glance line) is unverified.
