# Agent Note: Output style presets

Status: proposed

English | [中文](2026-08-23-output-style-presets.zh.md)

## Problem

Tianshu has no way to switch the model's answer style on demand. Claude Code's output styles — `default`, `Explanatory`, `Learning` — are a one-command persona switch that users reach for constantly when alternating between quick answers and tutorial depth. The [system prompt assembly](../../../../packages/core/system-prompt/README.md) already supports ordered sections and the settings seam hot-commits; the product simply ships no style preset over them.

## Proposal

A new package `@huiliyi37/dsh-output-style` under `packages/interaction/output-style/` registers a settings-backed prompt section with three verbatim style presets and a `/style` command to switch them. Mounting is opt-in.

### Section mechanics

The package registers a `systemPrompt.section` named `output-style` at order `10`, between the deployment persona (order `0`) and tool guidance (order `100`–`199`). The three style texts are fixed verbatim blocks, pinned by keyless snapshots. The settings namespace `outputStyle` holds `default`, `explanatory`, or `learning`; `Config.defaultStyle` sets the initial value, and a namespace commit disposes and re-registers the section, so a switch applies from the next assembly with no reload.

Because the section is part of prompt assembly, the request header already covers it: model-visible ⟺ logged holds with no new event vocabulary, and a style switch rewrites the system prefix exactly once, which the README records under the canonical Model Experience format.

### Command surface

`/style` (bare) reports the current style; `/style <default|explanatory|learning>` commits the namespace. The command registers on `ctx.commands` and, when the TUI is composed, injects `tui.commands` and registers a forwarding wrapper that calls `ctx.commands.execute` — the TUI consumes only its own facet, so harness registration alone does not surface in the slash menu (the [`/next-workflow` pattern](../../../../packages/workflow/next-workflow/README.md)).

### Scope

The preset is deployment-global in the first cut. Agent-scoped overrides are deferred: subagents and routers own their profiles, and a per-agent style channel has no identified consumer yet.

## Alternatives considered

### Why not a prompt variable?

`{{outputStyle}}` interpolation would push a long body through the variable path, mixing the variables' small-fact contract with paragraph-sized content, and re-renders on every assembly instead of once per switch.

### Why not shadow the persona section?

The persona at order `0` is the deployment's identity and is owned by `dsh-system-prompt`; styles are orthogonal presets that must stack with whatever persona a deployment chooses.

### Why not reuse the model-roles pins?

Role pins route models per consumer; they carry no prompt content. Styles need text, and the two settings namespaces stay separate so either can change without the other.

## Acceptance criteria

- Keyless snapshots pin all three style texts verbatim.
- An integration test commits each style through the settings namespace and asserts the next assembly's `output-style` section contains the matching text.
- The `/style` bare-report and switch echoes have unit coverage, and a TUI snapshot covers the command surface.
- The HMR-safety test disposes the plugin fiber and observes the section's removal from assembly.
- The package invariant asserts at most one `output-style` section per assembly; the bilingual README pair ships with the package, and this note moves to `implemented/` with the landing commit.

## Risks

- The style texts are model-visible; any wording change re-records the snapshots and the note updates with them.
- A deployment without a settings provider falls back to `Config.defaultStyle`; the README states the fallback so the failure mode is loud in configuration, not silent at runtime.
- The section is always present regardless of the zen-phase tool face, because style is orthogonal to tool exposure; a deployment that wants otherwise composes without the package.

## Implementation deltas (2026-08-23)

Implemented in the working tree as `packages/interaction/output-style`, with these corrections:

- The settings namespace is `output-style`, not `outputStyle` — camelCase fails the kebab-case validation (`settings/src/index.ts:21`).
- Hot switching uses the model-roles realtime-read pattern: one section whose `text` closure reads the live namespace per assembly, replacing dispose+re-register (which was neither the model-roles precedent nor gap-free).
- Order 10 was verified empty in production sources; placement is pinned by probe sections in tests.
- The 'rewrites the system prefix exactly once' semantics are documented in docs/subsystems/session.md and the zen README, not the system-prompt README.
- The three preset bodies are pinned byte-for-byte by unit tests; an app-level keyless snapshot is deferred.
