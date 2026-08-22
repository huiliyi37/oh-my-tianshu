# Agent Note: Vision-bridge description continuation on token-cap truncation

Status: implemented

English | [中文](2026-08-22-vision-bridge-description-continuation.zh.md)

## Problem

A six-subject fantasy-creature concept sheet sent through the bridge produced a description cut mid-sentence with the `[图片描述被截断]` marker: the GENERAL structured prompt (文字内容/界面元素/可能意图) over a multi-subject image exceeds the default `maxTokens: 1024`, and the cap is hit nondeterministically — the same image fit on a re-roll. The marker fired correctly, but the primary model still received half a description and had no recovery path.

## Decision

Two changes in `@huiliyi37/dsh-vision-bridge`:

- **Default budget raised** from 1024 to 2048 output tokens.
- **One bounded continuation call**: when the first call finishes `max-tokens`, the bridge re-requests with the assistant's truncated text plus a continue instruction ("resume from the cut, repeat nothing"), then stitches the tail. A second consecutive cap hit — or a continuation failure — appends `[图片描述被截断]` while preserving the partial text (fail soft: partial beats empty). Worst case is two calls at `maxTokens` each; there is no unbounded loop.

The stream path was factored into a `callOnce` helper so both calls share error/aborted handling; the fallback-model retry semantics are unchanged and wrap the whole attempt.

## Alternatives considered

**Raise the default only.** Rejected as insufficient: any tail longer than the new budget truncates again, silently repeating today's failure on richer images.

**Unbounded continue-until-stop loop.** Rejected: description cost becomes uncapped exactly when a model rambles; one continuation bounds the spend at `2 × maxTokens`.

**Ask the model to be briefer in the prompt.** Rejected: brevity instructions degrade the per-subject detail that made the description useful.

## Consequences

Multi-subject images survive the output budget; the marker now means "truncated twice or the continuation failed", which is actionable rather than routine. The continuation costs at most one extra auxiliary call per truncated description and stays off the live request path like the rest of the bridge. Coverage: `packages/context/vision-bridge/tests/vision-service.spec.ts` (continue-ok stitch without marker, double-truncation marker with two requests, continuation-failure fail-soft, schema default 2048). The fake adapter now declares `supportsVision` via `resolveModel` because the unified image pipeline strips image blocks from text-only models — without the declaration the request-content assertions cannot observe the original image block.
