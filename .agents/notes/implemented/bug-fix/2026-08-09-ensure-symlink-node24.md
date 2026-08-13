# Agent Note: ensureSymlink fails to replace symlinks-to-directories on Node >= 24

Status: implemented

English | [中文](2026-08-09-ensure-symlink-node24.zh.md)

## Problem

Every `dsh` command failed during `healProfilesModuleFallback` when `~/.dsh/profiles/node_modules/@deepseek-ai/<pkg>` links pointed at an older staging checkout — a boot-blocking failure of the app-boot profile fallback on engines >= 24 whenever the profile link farm points at a stale checkout:

```
Error: Path is a directory: /Users/<user>/.dsh/profiles/node_modules/@deepseek-ai/dsh
    at rmSync (node:fs:1229:18)
    at ensureSymlink (packages/boot/app-boot/src/profile.ts:187:5)
```

`ensureSymlink` lstat'd the link, confirmed it was a symlink, compared `readlinkSync` against the target, and called `rmSync(link)` to replace a wrong-target link. On Node >= 24 `fs.rmSync` refuses a symlink whose target resolves to a directory with `ERR_FS_EISDIR`; Node 22 had unlinked it.

`rmSync` is documented for files and directory trees, not for replacing symlinks. The link is a symlink by construction here (non-symlinks throw earlier in the same function), so the replacement intent is to remove the link itself — which is exactly `unlinkSync`'s contract, stable across the supported engine range (`^22.19 || >=24`).

## Decision

`ensureSymlink` in `packages/boot/app-boot/src/profile.ts` removes a wrong-target link with `unlinkSync`, which the module imports from `node:fs`:

```ts
import { readlinkSync, unlinkSync } from 'node:fs'
declare const link: string
declare const target: string
function guard(): void {
  if (readlinkSync(link) === target) return
  unlinkSync(link)  // rmSync throws EISDIR on symlinks-to-dirs (engines >= 24)
}
```

## Verification

- Reproduced: with a stale staging checkout's link farm, `dsh run` failed at `rmSync` with `ERR_FS_EISDIR` on Node 24.1.0.
- After the fix: link farm healed to the active checkout and `dsh run "<prompt>"` completed with a real model response.
- `packages/boot/app-boot/tests/profile.spec.ts` — 14/14 pass.

## Alternatives considered

**Keeping `rmSync` for the replacement.** Rejected: it is documented for files and directory trees, not for replacing symlinks, and on engines >= 24 it refuses a symlink whose target resolves to a directory with `ERR_FS_EISDIR` — precisely the stale-link case the fallback exists to heal. It appeared to work only because Node 22 unlinked such a link instead.

**Branching the replacement on the engine major version.** Rejected: `unlinkSync` removes the link itself across the whole supported range (`^22.19 || >=24`), so one call already states the replacement intent, and a version-conditional path would have to stay correct on both engines for no additional behavior.

## Consequences

The healing path no longer depends on engine-specific `rmSync` behavior for symlinks, and it covers `^22.19 || >=24` with a single call. It also removes strictly less: `unlinkSync` deletes the link and never reaches the directory the link resolves to. What the narrower call gives up is any handling of a non-symlink at that path — that case keeps throwing the earlier "exists and is not a symlink" error and stays the operator's problem, which is what the function already required.
