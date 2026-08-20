# Agent Note: Per-side image dimension admission limit

Status: implemented

English | [中文](2026-08-17-image-dimension-admission-limit.zh.md)

## Problem

The attachment seam admitted an image on byte count and total decoded pixels alone; no per-side bound existed anywhere in admission. Deployed model routes reject a request with HTTP 400 when it carries many images and any of them has a side above 2000px. An admitted image rides every later request of its session, so one oversized commit poisons durable history: the next model request fails, and so does every retry, permanently killing the session. This fork wires no producer through `ctx.attachments` yet — the TUI sends images as inline data-url blocks — so the gap is closed at the seam before any local consumer can commit an oversized image.

## Decision

`ImageAttachmentLimits` carries `maxImageDimension`, enforced during the admission full decode (`detectImage`) as `IMAGE_DIMENSION_TOO_LARGE`, so every producer that commits through the attachment service refuses an oversized image before anything reaches durable history. `LocalAttachmentStore` exposes it as the `maxImageDimension` config field with default `DEFAULT_MAX_IMAGE_DIMENSION = 2000`, the strictest per-side bound deployed routes enforce; deployments with laxer routes raise it from cordis.yml. Admission failures reach the committing caller as `AttachmentError`s routed on `code`; how each producer surfaces them stays producer-owned.

The same port aligns `DEFAULT_MAX_IMAGE_BYTES` with the provider-safe payload default, 5MB → 3.5MB, so one admitted image stays inside the per-request payload budget the deployed routes accept.

This is a semantic port of upstream deepseek-harness commits `0e39055121`, `d559ba9b2b`, and the attachment-local half of `5849c57c0c`. Upstream's producer-side surfaces have no local counterpart and are deliberately not ported: the `read_image` tool's model-facing error mapping and snapshot scenario (no tool-fs read-image here), the Web composer copy, and the llm-pi-ai image payload handling.

## Alternatives considered

- **Downscale at admission instead of refusing.** Resampling changes the stored bytes away from what the caller supplied, adds a resampling-quality policy, and hides the limit from the caller. Refusal keeps admission a pure gate; the caller can downscale with full knowledge. Worth revisiting only if refusals prove frequent in practice.
- **Enforce at the provider adapter per route.** Too late: by the time a request is assembled the image is already durable history, so every route and every retry re-fails. Admission is the last point where a provider-rejected image can be kept out.
- **Repair already-poisoned sessions** (drop or replace the oversized block on later requests). Out of scope; admission prevents new poisonings, and history rewriting needs its own design against the model-visible ⟺ logged invariant.

## Related

- [Upstream subsystem port parity](../feature/2026-08-16-upstream-subsystem-port-parity.md) — the port that introduced the attachment seam and local backend this limit completes.

## Consequences

- An oversized image can no longer enter durable history through the attachment service; the committing caller gets a stable, caller-correctable `IMAGE_DIMENSION_TOO_LARGE` code.
- Images with a side above 2000px are refused even in compositions whose routes would accept them on small requests; such deployments must raise `maxImageDimension` explicitly.
- Single images above 3.5MB encoded are refused at admission even where a route would accept them; such deployments must raise `maxImageBytes` explicitly.
- Sessions that already carry an oversized image remain broken; this change does not repair existing history.

## Testing

`packages/attachment/attachment-local/tests/image.spec.ts` rejects a side above the limit and accepts a side exactly at it; `tests/store.spec.ts` rejects an oversized side through `saveImageFile` admission; `tests/index.spec.ts` pins every resolved default, including 2000px per side and 3.5MB encoded.
