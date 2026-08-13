# Agent Note: Feed the streaming-commit pipeline from session events

Status: implemented

English | [中文](2026-08-10-tui-streaming-commit-feed.zh.md)

## Problem

Assistant replies never reached the scrollback. The ported design routes `text-delta → BlockStreamWriter` (throttle) `→ StreamRenderer` (stable markdown block boundaries) `→ commit`, but nothing ever called `BlockStreamWriter.push` — the pipeline was constructed unwired. Streaming text showed only in the live-region tail, projected from the transcript's `streaming` fold, and disappeared the moment the turn closed: the UI displayed wrap-up above an absent reply.

## Decision

`mountSession` subscribes a stream feed for the active session: `assistant/chunk` text deltas push into the block writer, and `assistant/message` plus non-aborted `turn/end` flush the writer and finalize the renderer, committing any remaining pending text. The live-region tail reads `StreamRenderer.getLiveTailLines` (pending plus the writer's buffer) instead of the transcript's whole-stream text, so a block already committed to the scrollback never renders twice. `handleAbort` and session detach discard the writer buffer and reset the renderer, and an aborted `turn/end` skips finalization, keeping cancelled fragments out of the scrollback. The newly unused `renderStreamingTail` helper is removed.

## Alternatives considered

**Commit the assembled message row on `assistant/message` instead of wiring the stream.** Rejected: it strands the ported incremental-markdown machinery (stable-boundary commits, fence-flicker protection, render cache) and lands long replies as one late block instead of progressively scrolling stable paragraphs.

**Feed reasoning deltas through the same pipeline.** Rejected: the transcript's message fold keeps only text blocks, so committing reasoning would paint scrollback content that the session log's own projection never reproduces.

## Consequences

Replies persist after the turn, and the live tail shows only uncommitted text (single-render ownership between scrollback and live region). Reasoning deltas no longer appear in the live tail — they were part of the old transcript-sourced tail and are outside the committed design; restoring a reasoning surface is a separate display decision.
