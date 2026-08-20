# Agent Note: Direct DeepSeek vision input

Status: implemented

English | [中文](2026-08-19-direct-deepseek-vision-input.zh.md)

## Problem

DeepSeek vision deployments use the chat-completions image protocol, but the direct `deepseek-official` adapter declared every catalog and pass-through model text-only and rejected every `ImageBlock`. A deployment could not pass user uploads or image-bearing tool results through the direct provider at all.

## Decision

The direct adapter lets a configured catalog entry opt in with `supportsVision: true`; validation rejects a non-boolean flag. Flash, Pro, unlisted pass-through ids, and configured entries that omit the flag remain explicitly text-only. The shipped catalog advertises no vision model, so the model selector cannot offer an unavailable route; a deployment enables its exact vision model itself.

`ImageBlock` carries its image as a data URL inside durable history, so the adapter needs no attachment store: it serializes each retained user and tool-result image block as an ordered OpenAI-compatible `image_url` part, reading the bytes straight from the logged message. Text-only user messages retain string content. Tool results retain string-only `tool` messages; image-only results use `(see attached image)`, and consecutive tool-result images follow in one `user` message beginning `Attached image(s) from tool result:`. System and assistant history images fail with `UNSUPPORTED_CONTENT` before credential or network I/O.

The direct adapter and pi-ai conversion share the deterministic [request-level image payload bound](../bug-fix/2026-08-18-request-image-payload-bound.md). Both default to 20 MiB of accumulated base64 payload and replace the oldest image occurrences with the same fixed placeholder. Direct HTTP 413 responses are `INVALID_REQUEST`.

Canonical messages carry the data URL itself, so no session event, persistence format, API schema, or SDK projection changes. An image block's wire MIME type comes from its `mime` field, falling back to the data-URL header; intake validation (format, size, count) stays with the composing client. External image URLs, the Files API, and image output remain unsupported.

## Alternatives considered

- **Use only the pi-ai DeepSeek provider.** Its generic multimodal path proves the content conversion, but it does not make the direct official route truthful or usable with the official model id.
- **Declare the whole provider image-capable.** This would let Flash, Pro, and unknown pass-through ids accept images that their exact wire model cannot promise to consume. Capability remains exact-model metadata.
- **Send images inside `tool` message content.** The documented compatible form keeps tool content a string. A following user message avoids relying on an undocumented multimodal tool-role form while preserving call-result order.
- **Add external URLs or Files uploads.** Both require new canonical input, authorization, lifetime, cleanup, and replay decisions. Inline data URLs reuse the existing durable message contract without expanding those concerns.

## Verification

Package tests pin model capability gating, configuration validation and live settings updates, user and tool-result wire messages, 413 classification, and exact image-bound behavior; the shared offload conversion is pinned in dsh-llm and exercised again through the pi-ai adapter's suite.

## Consequences

Configured DeepSeek vision routes consume user and tool-result images without changing session durability or response streaming. Repeated history still expands request bodies, but deterministic oldest-first offload bounds the dominant payload and leaves headroom below the official 30 MiB request-body limit. Image token pricing remains provider-owned because the official image token formula is not available.
