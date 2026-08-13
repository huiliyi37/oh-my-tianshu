# @deepseek-ai/dsh-host-directory-picker

English | [中文](README.zh.md)

The **workspace-directory picking seam** for the web-GUI host: an abstract `DirectoryPicker` service (`ctx.directoryPicker`) whose single contract method `capability()` returns a discriminated capability describing how an operator selects a directory. Backends differ in interaction shape, not just mechanism, so the seam models the shapes explicitly instead of one method set: `{ kind: 'native', pick(signal) }` opens one native OS chooser on the host display ([`-native`](../directory-picker-native/README.md)); `{ kind: 'browse', list(path?), createDirectory(path, name) }` serves listing/creation primitives an in-app browser drives, which works for remote clients no OS chooser can reach ([`-browse`](../directory-picker-browse/README.md)). Consumers switch on `capability().kind`; the union derives from the merge-extensible `DirectoryPickerCapabilities` map (a new backend declaration-merges its shape there), and the documented default for an unknown kind is to hide the picking affordance rather than fail. The capability object must be stable for the service lifetime. The client side mirrors the seam without a wire advertisement: each backend package is dual-face, its browser half registering the matching picking interaction into ui-workspace's directory-flow slots — so one composition row swaps both the host capability and the client flow together. A composition that should not pin an interaction mounts the [`-auto`](../directory-picker-auto/README.md) chooser instead, which resolves the host's situation once at boot and mounts the matching backend row itself.

Browse primitives fail with the typed `DirectoryPickerError` (`directory-unreadable` / `directory-exists` / `directory-create-failed`, each carrying the subject `path`), which the consuming gateway maps 1:1 onto wire error codes. `DirectoryEntry` rows carry a host-owned `hidden` flag (POSIX dot convention) so display policy stays client-side; `DirectoryListing.crumbs` is the ancestor chain from the filesystem root, every crumb a jump target. Design rationale, the `ctx.fs` separation, and the policy decisions live in [the directory-picker capability seam Agent Note](../../../.agents/notes/implemented/architecture/2026-07-28-directory-picker-capability-seam.md).

## Model Experience

None, as the seam serves the GUI host's directory selection; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No multi-root vocabulary** — the browse contract exposes one ancestry chain per listing; per-deployment root scoping (and Windows drive-root enumeration above a drive) waits for a consumer that needs it, per the seam Agent Note.
