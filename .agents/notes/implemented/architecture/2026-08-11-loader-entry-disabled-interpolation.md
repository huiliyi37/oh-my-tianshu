# Agent Note: Loader interpolates the entry `disabled` field

Status: implemented

English | [中文](2026-08-11-loader-entry-disabled-interpolation.zh.md)

## Problem

Entry metadata had no conditional mechanism: `!!js` interpolates only under plugin `config`, and [postmortem 0002](../../../../docs/postmortem/0002-js-expression-disabled-filesystem-tools.md) documents that `disabled: !!js ...` stays a truthy expression object, disabling the row everywhere. The persistent pwsh stack ([persistent pwsh over the PTY seam](2026-08-11-pwsh-persistent-pty.md)) needs exactly one persistent shell per host from one preset file — the bash rows on POSIX, the pwsh rows on win32 — which static metadata cannot express.

## Decision

The Loader interpolates the entry `disabled` field (`vendor/loader/src/config/entry.ts`): a `!!js` expression evaluates against the loader context at every mount decision. `disabled` is the only interpolated metadata field; `id`, `name`, `group`, and `inject` stay static. The raw node stays in the options, so write-back keeps the `!!js` form. `verify-cordis-config` now allows expressions in `disabled` only, and rejects ones that do not parse at check time instead of at boot.

The first shipped consumer is the `minimal` preset's persistent shell stack: the bash rows carry `disabled: !!js process.platform === 'win32'` and the pwsh rows the inverted expression. The one-shot shell tools are unaffected by design: the shipped presets (standard, code, cordis) mount `tool-bash` and `tool-pwsh` unconditionally and leave platform absence to the executors. Upstream's wider platform-layer fold (base-bundle rows gating `bash-sandbox`/`pwsh-sandbox`, deletion of the separate Windows patch layer) is not adopted here; it can adopt this mechanism later without further loader changes.

## Alternatives considered

**A declarative `platform` field on the row.** Static and gate-checkable, but a second composition mechanism beside `!!js`, and platform is only today's condition.

**Preset-level platform overlays.** Rejected: the condition belongs on the row it governs.

## Consequences

A row can gate itself on platform or environment; a bad expression fails loud at boot. Every other metadata field remains literal and the gate keeps rejecting expressions there — the postmortem-0002 hazard is closed for `disabled` by evaluation, not prohibition. Boot-level behavior is pinned by the `Loader entry disabled interpolation` suite in `packages/boot/app-boot/tests/user-patches.spec.ts` (evaluation, raw-node retention on write-back, and re-evaluation on `update()`), the gate's own spec, and `apps/cli/tests/windows-shell.spec.ts`, which pins the minimal preset's per-platform roster on any host.
