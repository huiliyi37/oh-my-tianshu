# Agent Note: New sessions no longer pose as restored; fork titles come from own history

Status: implemented

English | [中文](2026-08-21-tui-new-session-banner-and-fork-titles.zh.md)

## Problem

Two session-resume surface bugs shared one root: the TUI guessed session provenance from log shape instead of owning it.

1. **Ctrl+N reported "已恢复会话".** `mountSession` guessed `restored = session.events.length > 0`. The intent-bridge alignment session is seeded (`zen/phase` ×2 + `session/end-seed` + `session/title`), so every Ctrl+N on an intent-bridge assembly mounted a brand-new session and still rendered the restored banner, and any future seeded new-session flow would inherit the same false positive.
2. **Restorable rows were indistinguishable.** A fork's durable log embeds the parent's prefix, so `sessionTitleFor` folded the parent's latest `session/title` event or first real message. Two forks of the same parent rendered identical rows — same title, same age, same `fork #parent` suffix — and the user could not tell which session held which work.

## Decision

**Provenance is caller semantics, not a guess.** `mountSession(id, { restored })` takes the flag explicitly: `newSession` passes `false` (both the plain and the intent-bridge alignment branch), `switchSession` passes `true`. The banner, crash-repair notice, and the "上次进行到此处" separator render only for `restored && events.length > 0`.

**Titles become seed-boundary aware.** `sessionTitleFor` treats events after the last `session/end-seed` as the session's own content: an own title event or the own first real message wins; an empty own slice (inactive fork, or a resume whose boundary sits at the log tail) falls back to the whole-log fold, so legacy logs without `end-seed` and plain resumes are unchanged. Inactive forks keep the inherited title and remain distinguishable via the `fork #parent` suffix.

## Alternatives considered

**Infer restored from the end-seed position.** Rejected: the alignment seed already carries content before its `end-seed`, so any log-shape heuristic still misclassifies it. The caller already knows whether it created or resumed the session — an explicit parameter is the narrower, truthful contract.

**Suffix duplicate titles in the picker.** Rejected as a presentation patch: two same-titled forks stay ambiguous about their content. Folding the fork's own first message fixes the cause, not the label.

## Consequences

New sessions — including seeded alignment sessions — never show the restored banner, the crash-repair notice, or the replay separator. Active forks display titles derived from their own post-fork work, so same-parent forks no longer collide in the restorable list. Title folding for pre-`end-seed` logs and for resumed sessions is byte-identical to before.

## Testing

`session-title.spec.ts` pins the four boundary shapes: fork with own title event, fork with only an own first message, inactive fork falling back to the inherited title, and the resume shape (boundary at tail) folding the whole log unchanged. `app.spec.ts` pins a seeded alignment `newSession` emitting neither banner nor separator, negative-verified by dropping the `opts.restored` gate and watching the case go red; the existing restored-mount cases still assert banner, age, cwd, and separator.
