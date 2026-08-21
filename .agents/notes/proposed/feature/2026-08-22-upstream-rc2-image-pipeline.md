# Agent Note: Upstream v0.1.1-rc.2 unified image pipeline — port plan

Status: proposed

English | [中文](2026-08-22-upstream-rc2-image-pipeline.zh.md)

## Problem

Upstream `dsh-v0.1.1-rc.2` (31 non-merge commits past rc.1) is dominated by one architectural feature — the [unified image request pipeline](https://github.com/deepseek-ai/deepseek-harness) (design note `2026-08-20-unified-image-request-pipeline`): provider-independent normalized attachments, deterministic per-route request versions, a DeepSeek Files API lifecycle, and `read_image` with downscale coordinates. The fork's image surface is homegrown and disjoint: `vision-bridge` (independent model describes images for a text-only primary), `vision-ask` (`ask_image` re-querying), `llm-deepseek`'s `supportsVision` boolean catalog field (not upstream's `inputModalities`), and TUI direct image send with inline base64 + oldest-first offload. Locally, `attachment` is a clean rc.8 port with no normalization concept — `store.ts` digests source bytes verbatim, and there is no request-version seam at all. The user asked for this increment to be pulled and evaluated.

Concrete pain the upstream design solves that the fork shares today: one byte cap serving storage, inline expansion, and model pixels at once; repeated base64 inflating every later request; a provider rejection recurring because the same durable image rides every future request; and no recovery when a stored object goes stale.

## Proposal

Port in dependency order, each group landing green before the next starts. Group B carries the one genuine decision; everything else is adaptation.

### Group A — attachment normalization (upstream end state of six commits)

Bring `attachment-local`'s canonical/normalization/encoding stack (~630 new lines): 8-bit sRGB/sRGBA conversion, EXIF orientation, metadata strip, 2048px long edge, PNG/WebP/JPEG candidate ladder under `normalizedImageMaxBytes` (4MiB default), clean-passthrough with byte-identical dedup, `originalDimensions` on downscale, batch admission preparing every member before publishing any. `saveImage` returns the canonical ref beside source facts. Pre-release stance permits rejecting the old on-disk object format — no migration, called out in the README Known Limitations.

### Group B — request-version seam (needs the vocabulary decision first)

`AttachmentStore.readImageRequest(ref, policy)` with route-owned pixel/byte budgets, `variantId` caching, equal-variant singleflight, and the FIFO transform limiter; `llm` gains `prepareCall` generation binding and `content.ts` the projection helpers (`projectImagesForTextModel`, exact-length offload accounting). **Decision required before work**: whether the fork migrates its catalog vocabulary from `supportsVision` to upstream's `inputModalities`, or keeps the boolean and derives modalities at the seam. This decision touches the user's in-flight OpenRouter/pi-ai vision work (route metadata source), so it is sequenced after that work lands, or jointly with it.

### Group C — DeepSeek Files lifecycle

Four new `llm-deepseek` files (~840 lines: files-api client, file store, upload index scoped by endpoint+key+variantId without storing keys, file-id helpers) plus adapter integration: stale-id directed invalidation with one re-upload retry, quota-error list-and-delete of `dsh-` prefixed files, bounded inline fallback on file-resolution failure, and files/stream timeout decoupling (`d618bfebb4`). The adapter merge must fold in the local `spark` reasoning-truncation feature semantically — `serialize.ts`'s truncation applies to the wire copy only, the session log keeps full reasoning; that divergence is deliberate and survives this port.

### Group D — read_image, post-region-removal form

Upstream's `read_image` (submit a workspace image file as an attachment, model sees pixels; reports downscaled dimensions and coordinate scale factors) is complementary to `vision-ask`'s `ask_image` (re-query an image already in the session) — file→session vs follow-up-on-existing. Adopt only after the division of labor between the two tool descriptions is written down; take the final form with region reads already removed (`724783b024`, `cbc830aded` — the region tool never existed locally, nothing to remove).

### Explicitly not ported

- `reasoning-passback-every-turn` — already in rc.8 and already local (`serialize.ts:157-167`).
- Attachment read quarantine — a proposed note upstream with zero code; register it as a tracked gap locally if Groups A+B land, since the fork's readImage failures are equally fail-loud.
- The blank-permission refresh revert — already handled by withdrawing item 2 of the [rc.1 follow-up plan](2026-08-21-upstream-rc1-followup-ports.md).

## Alternatives considered

**Keep the homegrown inline-only pipeline.** Rejected: the fork already pays the costs upstream itemizes (inline bloat, one-cap-serves-all, recurring rejections), and the normalized-attachment design is provider-independent — it strengthens the existing vision-bridge path too, since described images and direct-sent images share the durable store.

**Migrate the catalog to `inputModalities` wholesale.** One option on the table for Group B, not pre-decided: the fork's `supportsVision` gate flows catalog → resolve → request rejection and the TUI already consumes it; a wholesale rename is churn unless the seam-derivation alternative proves lossy.

**Port Files without Group B.** Rejected: uploaded bytes are exactly the deterministic request versions — Files without the request-version seam re-introduces non-reusable, non-accounted uploads.

## Acceptance criteria

- Group A: admission/normalization/passthrough suites green (including 16-bit PNG conversion, alpha preservation under byte pressure, low-color candidate ladder); a saved image's durable ref addresses normalized bytes; README pairs updated with the on-disk format note.
- Group B: the vocabulary decision is recorded in this note before code moves; `readImageRequest` derives deterministically (same attachment + policy ⇒ same bytes), singleflight shares equal variants without shared-cancellation leaks, text-only routes receive deterministic placeholders, and offload accounting uses derived lengths.
- Group C: upload/reuse/expiry-refresh/stale-invalidation/quota-deletion paths pinned by package tests; the bounded inline fallback engages on file-resolution failure; `spark` truncation behavior unchanged (its suite green).
- Group D: `read_image` reports downscaled dimensions and coordinate scale; `ask_image`'s and `read_image`'s descriptions state their disjoint scopes; no region surface remains.
- Every group: `tsc -b` host+client clean, oxlint zero new diagnostics, keyless snapshot coverage for the model-visible image path, README/pairing re-recorded, implemented note filed.

## Risks

- **Disk-format change** (Group A): existing `~/.dsh-tianshu` attachment objects use pre-normalization digests; the pre-release stance permits rejection, but the failure mode must be loud and named, never silent re-upload — quarantine tracking (above) is the follow-up if it bites.
- **Group B collides with parallel work**: the catalog-vocabulary decision and pi-ai base64-bound adaptation (`48a58b9090`) overlap the user's uncommitted pi-ai vision changes. Sequencing rule: that work lands first, then Group B rebases onto it.
- **Peak RSS**: two concurrent transforms raise memory versus the current serial inline path; the `imageCompressionConcurrency` 1–8 config must stay a validated Config field per the no-hardcoded-tunables rule.
- **Files quota behavior is provider-real**: quota-deletion and stale-id recovery can only be fully exercised against the real API — the keyless suites pin the logic, but the first credentialed run deserves a watched session, not blind trust.
