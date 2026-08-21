# @huiliyi37/dsh-attachment-local

English | [中文](README.zh.md)

The private local implementation of [`@huiliyi37/dsh-attachment`](../attachment). Objects land at `<DSH_HOME>/attachments/v1/objects/<sha256-prefix>/<sha256>` and are addressed by an opaque `sha256:` id. Each process proves a home durable once by syncing every ancestor entry to the filesystem root, so a directory another process created but has not yet synced is never mistaken for a safe boundary. Writes then use a private staging directory, owner-only files, a synced temporary file, an atomic exclusive hard-link publish, and directory syncs on the publication path (POSIX; Windows relies on filesystem metadata journaling) so the reported reference survives a crash. Write admission and reads fully decode the raster before accepting its format and dimensions; reads also re-check the digest and logged metadata. Byte, total-pixel, and per-side dimension limits are write-time admission policy, so a later policy reduction does not make already-admitted history unreadable. The per-side default (2000px) stays below the strictest dimension bound deployed model routes enforce on requests carrying many images: an admitted image rides every later request of its session, so admission is the last point where a provider-rejected image can be kept out of durable history.

Admission accepts at most 20 images and 100MiB of encoded source bytes per message; each source may use up to 3.5MiB, 40,000,000 pixels, and 2000px per side. It then prepares a provider-independent normalized attachment. EXIF orientation is applied, metadata and color profiles are removed, pixels become 8-bit sRGB/sRGBA, and the long edge is reduced proportionally to `normalizedImageMaxDimension` (2048px by default). The normalized attachment has its own `normalizedImageMaxBytes` safety cap (4MiB by default). Transparent pixels are retained; Sharp/libvips may omit an alpha plane whose samples are all opaque. A nearest-neighbour bounded sample classifies color complexity without averaging high-frequency pixels. Confirmed low-color images try PNG, using a palette only when the input has no alpha channel, then WebP at qualities 85, 80, and 75. Other alpha images try WebP at those qualities; other opaque images try JPEG. Each candidate runs only after the preceding candidate exceeds the cap. Dimensions shrink only after every candidate at one size exceeds the cap. A clean, single-frame 8-bit sRGB/sRGBA PNG, JPEG, or WebP already within both normalization limits passes through byte-identically; 16-bit PNG, GIF, animated input, metadata, orientation, and incompatible color spaces force conversion. The source and converted attachment are each fully decoded once. `saveImages` prepares and verifies every normalized attachment once before publishing the batch, so validation failure leaves no partial references and commit does not repeat full image encoding. Normalization runs through the service instance's FIFO limiter: `imageCompressionConcurrency` bounds simultaneous native transforms, ranges from 1 through 8, and defaults to 2; file publication remains ordered after preparation.

`DSH_HOME` resolves through the shared path policy: explicit config, `$DSH_HOME`, then `~/.dsh-tianshu`. Session logs contain only the reference and verified metadata, never this host path. `readImage` forwards optional cancellation into the filesystem read, observes it around verification, and preserves it instead of wrapping it as `ATTACHMENT_READ_FAILED`.

## Model Experience

Indirectly, through durable replay of historical user images and structured model image output after restart and fork.

#### KV Cache effect

Normalization is deterministic: unchanged source bytes and policy re-derive the identical stored attachment, so replayed history keeps later provider requests byte-stable.

## Known Limitations and Deferred Work

- Objects are retained indefinitely; reference-aware garbage collection is deferred.
- The local backend assumes the host and provider adapter share this filesystem service.
- Animated GIF sources keep only their first frame; animation is outside the version-one image contract.
- Object ids address the stored normalized bytes, not the submitted source bytes. Objects written by a pre-normalization release keep their source-byte ids: they remain readable under their old references and are never migrated or silently re-stored.
- The normalization encoder is pinned by the installed sharp/libvips build; an encoder upgrade re-addresses future normalized attachments while existing objects stay valid.
