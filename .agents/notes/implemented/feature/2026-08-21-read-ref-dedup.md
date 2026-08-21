# Agent Note: read-ref deduplication

Status: implemented

English | [中文](2026-08-21-read-ref-dedup.zh.md)

## Problem

Models re-read unchanged files in the same conversation (verification loops, post-edit confirmation). Every re-read appends another full copy of the content to the message history — the upstream Tianshu measurements attributed most cacheCreate tokens exactly to this in-turn tool-result growth: the suffix is uncached, so identical content is paid for again on every request.

## Decision

`dsh-tool-fs`'s `read` now returns a one-line `[read-ref]` reference instead of the content when ALL hold: same session, same resolved target, same stat version token (the backend's freshness identity — any edit changes it), same window (offset/limit; focus reads never reference), file size ≥ `readRefThresholdBytes` (default 2048, `0` disables). The reference tells the model the content is already in the conversation and to use another window/focus if it needs a different part.

Anti-loop: the reference for one state is served once — a re-read that insists after it gets the real content that time (the model demonstrated it wants the bytes), and the following full read resets the state so a later unchanged read references again. State lives in a `WeakMap` keyed by the live session object, so entries die with the session; `fs/observed` still fires for reference results (a reference is still a read observation for the policy layer). The contract holds both ways: the reference text is the logged, model-visible result, and the full content stays recoverable in the earlier logged read.

## Verification

Real-filesystem tests (`tools.spec`, `fsHarness`): first read serves content, second serves the reference, an insisted third read degrades to content, a file mutation invalidates (new version token), a different offset serves content, sub-threshold files never reference, and the threshold-on behavior re-checked for large files.
