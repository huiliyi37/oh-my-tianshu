# Agent Note: Android/Termux install and startup compatibility fixes

Status: implemented

English | [中文](2026-08-16-mobile-install-compat-fixes.zh.md)

## Problem

A field report from an Android phone (Termux + proot-distro, aarch64) documented four breakages when installing and starting `@huiliyi37/dsh-tianshu@0.2.1`:

1. `koffi` (FFI dependency) has no Android prebuilt, falls back to source compilation, and its CMake configure reads `$PREFIX/include/android/api-level.h`; a proot-distro root does not export `PREFIX`, so the path degenerates to `/include/android/api-level.h` and configure dies.
2. npm 11 blocks lifecycle scripts until allowlisted (`allowScripts`); the blocked list included `koffi`, `node-pty`, `@huiliyi37/dsh-subprocess-local`, `@google/genai`, and `protobufjs`, risking silently skipped native builds.
3. `oh-my-tianshu tui` crashed with `--expose-internals is required for HMR service`: the HMR service needs the internal ESM loader, and npm bin links launch a bare `node <script>` without the flag.
4. `oh-my-tianshu web` crashed with `cannot get property "webStartup" without inject`: the official `@deepseek-ai/dsh` shares the default `$DSH_HOME` (`~/.dsh`) and its leftover flat-fallback module links let the `web` profile resolve the other installation's rc.6 bundles, which do not satisfy this installation's boot contract.

## Decision

Four fixes, each at the owning boundary:

- **bin re-exec (`apps/cli/src/bin.ts`).** When `process.execArgv` lacks `--expose-internals`, re-exec once with the flag before argument parsing, preserving `process.execArgv` so the source launcher's `--import tsx/esm` hook survives; the `process.execArgv` guard makes the re-exec idempotent.
- **Profile bundle ownership check (`packages/boot/app-boot/src/profile.ts`).** `loadProfile` fails loud when a `dsh.profile.bundles` entry is neither provided by this installation nor declared in the profile's own dependencies, yet still resolves from the profile directory — the other installation's leftover links. The error names the fix: remove the profile directory, or isolate this installation with `DSH_HOME=$HOME/.dsh-tianshu`.
- **Termux install guard (`apps/cli/scripts/check-android-prefix.mjs`).** A `preinstall` script fails loud with the `export PREFIX=/data/data/com.termux/files/usr` one-liner when `process.platform === 'android'`, `PREFIX` is unset, and the Termux prefix directory exists — before the dependency's confusing CMake error.
- **README install guidance.** The Install section documents the npm ≥ 11 `--allow-scripts` allowlist and the Termux `PREFIX` requirement.

## Alternatives considered

**Publish `@koromix/koffi-android-arm64` prebuilts.** Rejected for now: that requires upstream cooperation and a cross-compile pipeline; the guard plus documentation unblocks the phone today.

**Disable the HMR row outside `--dev` profiles.** Rejected: it silently downgrades the documented hot-reload contract on every long-lived surface to avoid a launch problem better solved at the entry point.

**Auto-isolate `$DSH_HOME` on first run.** Rejected: silently moving user data is worse than the loud ownership error; `$DSH_HOME` already exists as the documented escape hatch.

## Consequences

A bare npm bin invocation works for every mode, a foreign-initialized profile fails with a fixable diagnostic instead of an unreadable injection error, and Termux installs get the `PREFIX` guidance before `koffi` compiles. The re-exec costs one extra process spawn per bare launch (~50 ms) — negligible against boot; `--expose-internals` is the same surface the official `dsh` already requires on this platform. The ownership check rejects only bundles this installation cannot provide and the profile did not declare, so out-of-tree plugins installed through `oh-my-tianshu plugin --profile <name> install` keep working.
