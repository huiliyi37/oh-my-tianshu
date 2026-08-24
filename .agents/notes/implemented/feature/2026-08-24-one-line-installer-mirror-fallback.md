# Agent Note: One-line installer with mirror-window fallback

Status: implemented

English | [中文](2026-08-24-one-line-installer-mirror-fallback.zh.md)

## Problem

Right after the 0.4.0 release, installs on machines configured for npmmirror failed with `ETARGET: No matching version found for @huiliyi37/dsh-llm@0.4.0`: mirrors sync per-package, and the window where the entry package is present but its dependencies are not makes a plain `npm i -g` unresolvable. Resolution happens before any lifecycle script runs, so no package-side hook can intercept or retry it — the official registry is complete and verified by the release, but the user's configured registry is what npm asks.

## Decision

Ship bootstrap installers (`scripts/install.sh` for POSIX sh, `scripts/install.ps1` for Windows) and make them the README's recommended install. They install with the user's configured registry first; on failure they retry exactly once with `--registry=https://registry.npmjs.org`, which always holds the complete release. They also pass the npm ≥ 11 `--allow-scripts` list only when the installed npm understands the flag, and check for Node/npm presence with actionable messages. The manual `npm i -g` path stays documented beside them.

## Alternatives considered

- **Looser dependency ranges so a lagging mirror resolves the previous version.** Rejected: the workspace is one same-version baseline; mixing 0.3.0 dependencies under a 0.4.0 entry is exactly the state the baseline exists to prevent.
- **Retry from a `preinstall` script.** Rejected: resolution-time `ETARGET` fails before any lifecycle script of ours exists on the machine.
- **Publish the entry package last / flip `latest` late.** Rejected: mirror sync order is not ours to control, and delaying `latest` penalizes every registry equally for one mirror's lag.

## Consequences

Mirror-window installs self-heal at the bootstrap layer instead of producing a support ticket; the trade is that the recommended entry point is now a piped script rather than plain npm, so the manual command stays documented beside it and the scripts carry only retry logic — no version pinning, no environment mutation beyond the one install.

## Testing

Live e2e: `NPM_CONFIG_REGISTRY=https://registry.npmmirror.com` plus a temp prefix reproduced the exact user-reported `ETARGET` on the first attempt, the fallback installed 619 packages from the official registry, and the installed `oh-my-tianshu --version` printed `0.4.0`.
