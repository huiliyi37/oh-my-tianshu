# Agent Note: Versioned GUI welcome onboarding

Status: implemented

English | [中文](2026-07-30-versioned-gui-welcome-onboarding.zh.md)

## Problem

The GUI's credential onboarding begins with a DeepSeek-specific readiness check, but the internal-test notice applies to every user and must precede provider setup even when a credential is already configured. Treating both as independent overlays permits simultaneous dialogs, while a process-local dismissal cannot distinguish a completed notice from a window closed before acknowledgement or intentionally present revised copy once.

## Decision

**The Settings shell coordinates ordered steps.** `settings.onboarding` remains a root-scoped list, but `ui-settings` projects its entry ids and order into one coordinator and mounts only the first incomplete step. The active registrant receives `complete()` and `openSection(id)`; no later step mounts until ownership transfers. The product welcome registers at order `-100`, while `ui-models` retains only the conditional DeepSeek readiness and credential-routing step at order `0`.

**Ownerless product onboarding belongs to `ui-settings-general`.** `src/onboarding-copy.ts` is the single editable source for the complete notice, the Continue label, and `WELCOME_NOTICE_VERSION`; both supported GUI locales intentionally render the same Chinese owner copy. Runtime locale dictionaries derive their welcome values from that file, and tests import the same owner instead of repeating paragraph text. The notice is browser UI only: it creates no Session event and contributes no model-visible content. The notice identifies `DSH_TELEMETRY_DISABLED=1` as the telemetry opt-out.

**Loopback acknowledgement is durable per Harness profile.** The Host half registers a `ui-onboarding` section in the user-settings seam, stored under the active `$DSH_HOME/settings.yaml`. The connection plugin publishes whether the current page uses a loopback authority as `ctx.connection.isLoopback`; hostname classification remains internal to the connection package, and other client plugins consume the service state instead of importing its implementation. A loopback browser shows the notice unless `welcomeNoticeVersion` equals the owner constant exactly. Continue applies one path mutation with the current version and calls `complete()` only after the Host commits it; a failed write leaves the notice open, and closing the page or process writes nothing. Bumping the constant intentionally makes every profile acknowledge the revised copy once. A non-loopback browser must not call the loopback-only settings API. It presents the same notice, but explicit Continue completes the step only in the current browser process; reload or a new process presents it again.

**Concurrent loopback views converge without stale replacement.** The acknowledgement write omits `expectedRevision` deliberately: every loopback tab writes the same version to one path, so the operation is idempotent and preserves sibling fields instead of rebuilding the section. `settings/document-updated` becomes `host/settings-changed`; an already mounted loopback tab refetches and advances when another tab or an external editor commits the current version. The API proxy exposes this one product namespace through a closed allowlist beside configurable-provider namespaces, without treating its changes as model-catalog invalidations.

**Onboarding temporarily owns the viewport as one continuous stage.** A solid product surface replaces the complete application view through a body-level portal and marks the underlying app root inert; the exact required mask remains mounted behind that surface with `position:absolute`, zero left/right/bottom offsets, `top:80px`, `rgba(0, 0, 0, 0.24)`, and `backdrop-filter: blur(2px)`. Welcome and conditional credential setup render as successive pages in this stage instead of independent modals. Both pages reuse the Web UI's black `BrandWordmark`. The welcome page preserves the four authored paragraphs verbatim under the `内测声明` title; every paragraph uses one 16/28 body scale, and only the requested action clause inside the final paragraph receives a subtle 500 weight. A short staggered opacity/vertical entrance supplies pacing without blocking interaction and disappears under reduced motion. The title receives initial focus, Continue is the sole button, and no close, Escape, or mask-click path exists.

## Alternatives considered

**Browser local storage** — rejected because acknowledgement would follow one browser profile rather than `$DSH_HOME`; a fresh Harness profile could incorrectly inherit a prior acknowledgement, and external profile edits would have no authoritative update stream. Non-loopback fallback therefore remains process-local rather than browser-profile-local.

**A second independent modal in `ui-settings-general`** — rejected because list registrants would still stack whenever welcome and credential readiness were both true. Ordered ownership belongs to the shell that declares and renders the list.

**Persisting on render or window close** — rejected because observation is not acknowledgement and close delivery is unreliable. Only the explicit Continue commit may suppress the next launch.

**A generic public settings-exposure flag** — rejected because one product namespace does not justify widening every settings registrant's public configuration surface. The gateway keeps an explicit closed allowlist.

## Consequences

A fresh profile always sees the welcome notice before provider-specific onboarding; an already configured credential skips only the later DeepSeek step. On loopback, reloading after Continue stays past the acknowledged version, changing the owner version presents it again, and closing before Continue leaves the next launch unchanged. On non-loopback, Continue advances the live process without a privileged settings request and reload presents the notice again. Focused store and React tests pin both persistence modes, exact-version comparison, write failure, sole-action behavior, no-dismiss paths, coordinator ordering, conditional DeepSeek transfer, and HMR cleanup. The real Chromium scenario boots the shipped Web composition with an isolated harness home, verifies the exact mask geometry and computed styles, reloads before and after acknowledgement, continues into missing-credential setup, confirms an acknowledged-version mismatch returns while the credential is configured, and checks the browser console.
