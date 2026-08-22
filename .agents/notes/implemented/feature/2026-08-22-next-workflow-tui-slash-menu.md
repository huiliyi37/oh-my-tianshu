# Agent Note: `/next-workflow` joins the TUI slash menu

Status: implemented

English | [中文](2026-08-22-next-workflow-tui-slash-menu.zh.md)

## Problem

The TUI slash menu (`/` suggestions and Tab completion) is fed by the TUI-internal `SlashCommandRegistry`, while `/next-workflow` registers on the host `ctx.commands` plane. The two planes never meet, so the menu offers no hint that the command exists even though typing it works — a discoverability gap for a harness-owned command that `dsh-base` ships in every profile.

## Decision

`dsh-next-workflow` registers a `next-workflow` entry into the optional `tui.commands` service (the registry the TUI exposes for external plugins): a Chinese description plus the `[candidates] <objective>` arg hint. Registration is deferred through `ctx.inject(['tui.commands'], …)` because the shipped bundle order (base rows before the tui leaf rows, `tui.profile.bundles = [dsh-base, dsh-tui]`) applies the plugin before the TUI provides the service; the inject fiber registers once the service is published and stays a harmless pending fiber in non-TUI assemblies, where the typed path is unchanged.

The entry's `run` delegates back to the host `CommandService.execute`, so `command/run` lifecycle records, per-agent command views, and zen/tool-face semantics stay owned by the existing cordis channel.

The TUI now re-projects the registry into the input controller's hint list before every input change; the snapshot was previously taken once at construction, which would hide post-construction registrations such as this one.

## Alternatives considered

**Register at apply via `reflect.get`.** Rejected after verification: the composed tui profile applies `dsh-base` rows (including `next-workflow`) before the bundle layer that mounts `tui-runner`, so the service is not yet provided at apply time and the entry would be silently lost in the shipped profile.

**TUI-side generic bridge over `ctx.commands`.** Rejected: enumeration needs a per-session agent, and host descriptions are English, so the menu would either appear stale or lose the Chinese wording this command needs.

**Hint-only entry without execution.** Rejected: the `SlashCommand` contract requires a `run`, and a run-less entry would silently complicate `runSlash`'s fallback ordering.

**Direct handler invocation from the menu entry.** Rejected: it would bypass the lifecycle recording and per-agent command view of the cordis channel; delegation through `execute` keeps one execution path.

## Consequences

TUI users see `/next-workflow [candidates] <objective>` with a Chinese description in `/` suggestions, Tab completion, and the ghost arg hint; menu selection and manual typing both execute through `CommandService`. The TUI surface stays optional (`reflect.get`, no runtime dependency), and headless CLI behavior is unchanged.

Coverage: the next-workflow spec asserts the registration shape and the delegation call; the TUI app spec asserts a post-construction `tui.commands` registration appears in the rendered menu.
