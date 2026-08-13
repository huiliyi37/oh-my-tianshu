# Agent Note: TUI slash channel fallback to CommandService + plan pending status display (A1)

Status: implemented

English | [中文](2026-08-11-tui-slash-fallback-commandservice.zh.md)

## Problem

Item A1 of the C1 benchmarking pass (`docs/dsh-tui-与claude的对比-c1.md`) names the plan mode's missing entry in the TUI. The plan-mode package (`packages/plan/plan-mode/`) already registers `/plan` with the cordis `CommandService` — its handler calls `ctx.planMode.set()`, and the projection's `pending` is driven by `command/run` events — but the TUI slash channel (`runSlash` in `ui/app.ts`) consults only its own registry of 14 UI commands and echoes 「未知命令」 on a miss, so `/plan` is unreachable from inside the TUI. The statusline compounds it by consuming only the plan projection's `active`, leaving the user without feedback while an in-turn switch is still pending.

## Decision

The TUI is a command input channel, not the commands' owner. For `/` input its registry misses, `runSlash` falls back to `execute(agent, line, signal)` on `ctx.reflect.get('commands', false)`, and CommandService records the `command/run` → `command/done` lifecycle that drives the plan projection's `pending`. The service is read through `reflect.get` rather than property access, because TuiApp's `runtimeCtx` does not inject `commands` and Cordis 4 property access throws "without inject" — the same pattern the compact and goal commands use. When the service is not assembled, there is no session, or the command name is unknown (`execute` returns `undefined`), the channel degrades to the existing 「未知命令」 echo.

The statusline carries a pending state alongside the active one: `formatStatusLine(view, planActive, planPending)`, and `WorkflowStatusLine.setPlanActive(active)` is now `setPlanState({active, pending})`, whose idempotence check compares both fields. A pending switch renders `[plan…]`, which takes priority over `[plan]`.

Three things stay out: a three-state mode (DSH's plan off is the normal state), a shortcut key (Tab belongs to `@`-path completion), and any change to the plan-mode package.

## Verification

- Wave 1, the fallback: `app.spec.ts` carries five cases (success echo, error echo, `undefined` unknown-command, no session, service unavailable), RED with two failing, then GREEN at 5/5; the file is 59/59.
- Wave 2, the pending state: `statusline.spec.ts` carries a pending-rendering case, and the existing `setPlanActive` tests moved to `setPlanState`; statusline is 21/21 and app 59/59.
- Types: a scratch project checking only the four changed files reports zero errors. A full `tsc -b` is blocked by the parallel session and the 60-plus pre-existing errors, per the evidence-gate thread.
- Assembly reachability rests on static evidence only, gathered by a delegate subagent: the TUI profile is base plus tui on the same root ctx, and base assembles dsh-commands and plan-mode (`cordis.patch.yml` L236/L251), so `ctx.reflect.get('commands', false)` resolves. No real-assembly runtime verification was done — there is no environment with execution permission here — and the repository has no precedent at the `commands.execute` level, only the `commands.list` precedent at `apps/web/tests/shipped-composition.e2e.ts` L92. The degraded path is the safety net for that gap.

## Files

- `packages/tui/tui/src/ui/app.ts`: the `runSlash` fallback, the `runCordisCommand` private method, the minimal `CommandServiceFacet` consumption surface, and `planState` consumption (both the attach and `onChanged` paths pass `pending`)
- `packages/tui/tui/src/statusline.ts`: the third `formatStatusLine` parameter `planPending` and `WorkflowStatusLine.setPlanState`
- `packages/tui/tui/tests/app.spec.ts`: the five fallback cases
- `packages/tui/tui/tests/statusline.spec.ts`: the pending-rendering case and the `setPlanState` migration
- `docs/dsh-tui-与claude的对比-c1.md`: A1 marked done

## Alternatives considered

**Register `/plan` in the TUI's own command registry** — rejected. The plan-mode package already owns the command, and its projection's `pending` is driven by the `command/run` lifecycle that only CommandService records; a TUI-side copy would either duplicate the handler or bypass the events the statusline reads. Treating the TUI as an input channel keeps ownership where the capability lives and leaves the plan-mode package untouched.

**Reach the service through property access (`ctx.commands`)** — rejected. TuiApp's `runtimeCtx` does not inject `commands`, so Cordis 4 property access throws "without inject". `ctx.reflect.get('commands', false)` is the pattern already used for the compact and goal commands, and its optional form gives the degraded path its condition.

**A three-state mode indicator** — rejected. DSH's plan-off state is just the normal state, so `active` plus `pending` describes everything the statusline has to show.

**A shortcut key for switching plan mode** — rejected. Tab is taken by `@`-path completion, and no other key was free enough to justify displacing an existing binding.

## Consequences

- Treating the TUI as a channel buys `/plan` plus every other plugin-registered cordis command through one fallback, at the cost of a hint text that still lists only TUI commands: the unknown-command echo's available list does not include cordis commands, so they are discoverable only by knowing their names. Folding `commands.list(agent)` into that list would complete the hint.
- The statusline's plan API changed shape — `setPlanActive` became `setPlanState({active, pending})` — so every caller passes both fields, and an in-turn switch now shows `[plan…]` before `[plan]`.
- Command execution reaches a service the TUI does not inject, so the channel's correctness depends on an assembly assumption backed by configuration evidence rather than a run. The degraded 「未知命令」 echo bounds the failure: an unassembled service looks exactly like an unknown command.
- End-to-end behavior under real assembly is unverified here; `/plan`, `/plan off`, and the `[plan…]` status bar are exercised by users running `dsh web` or `dsh --profile tui`.
