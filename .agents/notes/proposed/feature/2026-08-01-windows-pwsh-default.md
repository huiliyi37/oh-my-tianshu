# Agent Note: Windows defaults to pwsh (roadmap)

Status: proposed

English | [中文](2026-08-01-windows-pwsh-default.zh.md)

## Problem

The harness's shipped execution profile is bash-first on every platform. Windows hosts must install a bash shim (WSL or Git-Bash) or fall back to the POSIX-only `dsh-bash-local` behavior; the model-facing bash tool teaches the bash dialect, and the TUI/Web surfaces render terminal output in bash-shaped expectations. The first Windows-native foundation shipped in the [pwsh executor and tool decision](../../implemented/feature/2026-08-01-pwsh-tool-and-executor.md): a PowerShell implementation of the `ctx.bash` seam and a parity `pwsh` tool — but nothing yet defaults Windows hosts to them.

## Proposal

Two follow-up stages, each independently shippable. The former stage 2 (bash-tool parity twin) shipped with the [pwsh tool bash parity decision](../../implemented/feature/2026-08-02-pwsh-tool-bash-parity.md): `tool-pwsh` now mirrors `tool-bash` for foreground and background work minus the sandbox surface, shares the `DSH_*` environment through `dsh-bash-env`, and carries a keyless application snapshot of its assembled surface.

1. **Windows default composition** — the shipped CLI compositions mount `dsh-pwsh-local` as the `ctx.bash` executor and `dsh-tool-pwsh` as the model-facing shell tool on Windows hosts (bash unmounted there), while POSIX hosts keep the bash stack. This is a composition/roster decision in `base.cordis.yml` and the surface overlays, gated by platform; it makes the shipped Windows experience PowerShell-native end to end.
2. **pwsh GUI rendering** — the Web surface renders pwsh calls with the bash-shaped terminal presentation (terminal card with exit-status pill), the counterpart of the bash terminal cards. Shipped in the [pwsh UI presentation matches bash decision](../../implemented/feature/2026-08-05-pwsh-ui-bash-parity.md) with a keyless web lane; the TUI was removed, so no terminal twin remains. A PowerShell-aware presentation beyond bash parity (native path display, `$env:` facts) remains unclaimed.

The stages are ordered by dependency only where one exists: the rendering stage shipped first with the [pwsh UI presentation matches bash decision](../../implemented/feature/2026-08-05-pwsh-ui-bash-parity.md) because it is platform-independent and its keyless web lane runs on any host, while the Windows default composition remains the only unshipped stage. Nothing in this proposal changes POSIX behavior.

## Alternatives considered

**Default Windows to pwsh inside `dsh-bash-local` (one executor, dialect switch).** Rejected for the same reason the executor decision rejected a mode switch: the executor's identity is the shell it spawns, and platform-gated composition is a deployment choice, not an executor config.

**Ship the Windows default in the same change as the executor/tool.** Rejected: the roster change needs its own evidence (what breaks when the shipped Windows tree stops mounting bash, which tools depend on bash semantics), and it belongs to a composition decision with the approval/PTY surface visible.

**Keep bash on Windows via a shim and skip PowerShell defaults.** Rejected: it perpetuates the install-tax and the dialect mismatch the roadmap exists to remove; the shim is a deployment requirement, not a product behavior.

## Acceptance criteria

- A Windows host running the shipped `dsh` TUI/Web gets `pwsh` as its shell tool and PowerShell as the `ctx.bash` executor without configuration, and `bash` is absent from the model-visible roster there.
- POSIX hosts are byte-for-byte unaffected (same roster, same executor).
- The shipped-composition e2es assert the platform-gated roster on both families.
- Stage 1 lands with the keyless pwsh-tool snapshot already in place from the parity change; stage 2 landed with the web `pwsh-terminal` rendering lane (the TUI's removal left no terminal surface to snapshot).

## Risks

- **Bash-dependent composition rows** — any shipped plugin that assumes `bash` semantics (hook bridges executing shell hooks, workspace tooling) must be audited per stage; the audit may force a staged rollout rather than one switch.
- **Windows CI coverage gap** — unit coverage runs on Linux; Windows-only regressions in the pwsh stack surface through the Windows build/static lane and e2es, which must be extended per stage rather than assumed.
- **Rendering conventions** — the bash-shaped terminal twin shipped with the Web lane; a PowerShell-aware presentation beyond bash parity (native path display, `$env:` facts) remains a UI design decision with snapshot surface, deferred with stage 1.
