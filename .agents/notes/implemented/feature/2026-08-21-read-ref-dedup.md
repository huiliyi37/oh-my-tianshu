# Agent Note: read-ref deduplication

Status: implemented

English | [中文](2026-08-21-read-ref-dedup.zh.md)

## Problem

Models re-read unchanged files in the same conversation (verification loops, post-edit confirmation). Every re-read appends another full copy of the content to the message history — the upstream Tianshu measurements attributed most cacheCreate tokens exactly to this in-turn tool-result growth: the suffix is uncached, so identical content is paid for again on every request.

## Decision

`dsh-tool-fs`'s `read` now returns a one-line `[read-ref]` reference instead of the content when ALL hold: same session, same resolved target, same stat version token (the backend's freshness identity — any edit changes it), same window (offset/limit; focus reads never reference), file size ≥ `readRefThresholdBytes` (default 2048, `0` disables). The reference tells the model the content is already in the conversation and to use another window/focus if it needs a different part.

Anti-loop: the reference for one state is served once — a re-read that insists after it gets the real content that time (the model demonstrated it wants the bytes), and the following full read resets the state so a later unchanged read references again. State lives in a `WeakMap` keyed by the live session object, so entries die with the session; `fs/observed` still fires for reference results (a reference is still a read observation for the policy layer). The contract holds both ways: the reference text is the logged, model-visible result, and the full content stays recoverable in the earlier logged read.

## Alternatives considered

- **An mtime+size fingerprint** versus the shipped stat `version` token. The backend already defines the version as its freshness identity (high-resolution stat fields locally, a revision id remotely), so the token tracks change semantics the backend owns instead of re-deriving a weaker local fingerprint that a remote backend might not honor.
- **Deciding in the render layer** (no execute change) versus the shipped execute-time decision. Render may run on replay paths where mutating WeakMap state would be untimely; execute runs exactly once per call, so the ref/degrade state machine has a single owner.
- **Pointing the reference at a spill artifact** (fresh full-content copy) versus the earlier conversation read. The earlier read is already in the session log — recoverable with zero extra IO and storage; spilling would duplicate content the context already carries.

## Consequences

Bought: unchanged re-reads add one line instead of a full content copy, cutting the uncached suffix growth on every subsequent request; edits invalidate immediately through the backend's own freshness token; the state dies with the session (WeakMap), no cleanup path to forget.

Cost: the reference result is not the read envelope, so the read presentation degrades to a generic card for that call (no line-numbered view — the earlier card in scrollback carries it); an insisting re-read pays one full content round-trip before the state resets (alternation is the accepted semantics); no cross-restart memory — a resumed session re-reads once before referencing again.

## Verification

Real-filesystem tests (`tools.spec`, `fsHarness`): first read serves content, second serves the reference, an insisted third read degrades to content, a file mutation invalidates (new version token), a different offset serves content, sub-threshold files never reference, and the threshold-on behavior re-checked for large files.
