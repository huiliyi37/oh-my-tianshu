# Agent Note: 对齐会话把非 finalize 调用转成 face 声明，契约声明唯一可用工具

Status: implemented

English | [中文](2026-08-20-intent-alignment-face-guidance.zh.md)

## Problem

A real session transcript on the default TUI composition (`dsh-base` + `dsh-tianshu-tui`, `standard` preset) shows the intent-bridge alignment model flailing: it calls `zen_anchor`, `bash`, and `glob` and reads back a chain of dead ends — `zen_anchor` "only available during the zen phase", `unknown tool "bash"`, `unknown tool "glob"` — before the user's task ever reaches the main session. The alignment agent's visible face is exactly two tools (`finalize_alignment` plus the leaked agent-scoped `zen_anchor`), but it inherits the `standard` preset's "coding agent" persona, and the `intent:policy` contract never states its tool inventory. A flighty model (the TUI aligns with `deepseek-v4-flash`) reaches for familiar coding-agent tools from its priors; `unknown tool` gives it no recovery path.

## Decision

- The `intent:policy` contract (`ALIGN_SECTION`) now opens with the face statement: only `finalize_alignment` exists in this session, and there is no shell, filesystem, or search tool — do not call any other tool name.
- A registry guard (mirroring zen's locked-tool guard) denies every non-`finalize_alignment` execution while the calling session is a live alignment session, returning the same face statement. This covers the leaked `zen_anchor` too, so the alignment model never sees the misleading post-phase anchor success either.

## Alternatives considered

**Remove `zen_anchor` from the alignment face entirely.** Rejected: the anchor is registered by zen's `agent/created` resume branch (the alignment seed reads as a promoted session), and there is no unregister-by-name tool API; blocking it through the guard achieves the same model-visible outcome with one small rule.

**Rely on the tool list alone (no guard).** Rejected: the transcript shows the alignment model calling tools that are not in its list; the guard turns that into the actionable statement instead of a bare `unknown tool`.

## Consequences

The alignment model gets prompt-level and runtime-level statements of its single tool; non-finalize calls resolve as a clear denial instead of `unknown tool`. The `intent:policy` section grows by two lines. `zen_anchor` stays registered on the alignment face (stable catalog) but its execution is denied with the face statement. Main-session behavior is unchanged.

## Testing

- `packages/guard/intent-bridge/tests/intent-bridge.spec.ts` — new: a scripted alignment model calling `bash`, `glob`, and `zen_anchor` gets three denials all containing the face statement and none containing `unknown tool`; the first request's system prompt carries the inventory line.
- `packages/guard/intent-bridge/tests/align.spec.ts` — the contract asserts the single-tool declaration.

## Related

- [intent-bridge architecture](../../architecture/2026-08-18-intent-bridge.md) — owns the alignment session design this guard enforces.
- [zen_anchor no-op and callable face](../../bug-fix/2026-08-20-zen-anchor-noop-and-callable-face.md) — the paired fix for the main session's anchored face.
