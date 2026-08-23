# Agent Note: Output style presets

Status: implemented

English | [中文](2026-08-23-output-style-presets.zh.md)

## Problem

Tianshu had no way to switch the model's answer style on demand. Claude Code's output styles — `default`, `Explanatory`, `Learning` — are a one-command persona switch that users reach for constantly when alternating between quick answers and tutorial depth. The [system prompt assembly](../../../../packages/core/system-prompt/README.md) already supports ordered sections and the settings seam hot-commits; the product simply shipped no style preset over them.

## Decision

A new package `@huiliyi37/dsh-output-style` under `packages/interaction/output-style/` registers a settings-backed prompt section with three verbatim style presets and a `/style` command to switch them. Mounting is opt-in; shipped defaults do not include the package.

### Section mechanics

The package registers one `systemPrompt.section` named `output-style` at order `10`, between the deployment persona (order `0`) and tool guidance (order `100`–`199`) — an order verified empty in production sources and pinned by probe sections in tests. The three style texts are fixed verbatim blocks pinned byte-for-byte by tests. The settings namespace is `output-style` (kebab-case; camelCase fails the settings-namespace validation). Hot switching uses the model-roles realtime-read pattern: the section is registered once and its `text` closure reads the live namespace on every assembly, so a commit applies from the next assembly with no dispose/re-register gap. `Config.defaultStyle` sets the initial value and the permanent fallback when no settings provider is assembled.

Because the section is part of prompt assembly, the request header already covers it: model-visible ⟺ logged holds with no new event vocabulary, and a style switch rewrites the system prefix exactly once — recorded under the canonical Model Experience format in the package README.

### Command surface

`/style` (bare) reports the current style; `/style <default|explanatory|learning>` commits the namespace and fails loud on unknown styles or a missing settings provider. The command registers on `ctx.commands` (guaranteed by the top-level inject) and, when the TUI is composed, injects the `tui.commands` facet and registers a forwarding wrapper that calls `ctx.commands.execute` — the [`/next-workflow` pattern](../../../../packages/workflow/next-workflow/README.md), because the TUI slash menu's data source is that facet, not `ctx.commands`.

### Scope

The preset is deployment-global. Agent-scoped overrides are deferred: subagents and routers own their profiles, and a per-agent style channel has no identified consumer.

## Alternatives considered

### Why not a prompt variable?

`{{outputStyle}}` interpolation would push a long body through the variable path, mixing the variables' small-fact contract with paragraph-sized content, and re-renders on every assembly instead of once per switch.

### Why not shadow the persona section?

The persona at order `0` is the deployment's identity and is owned by `dsh-system-prompt`; styles are orthogonal presets that must stack with whatever persona a deployment chooses.

### Why not reuse the model-roles pins?

Role pins route models per consumer; they carry no prompt content. Styles need text, and the two settings namespaces stay separate so either can change without the other.

## Consequences

- The style texts are model-visible; any wording change is a snapshot-visible contract change, and the note updates with them.
- The HMR-safety test disposes the plugin fiber and observes the section's removal from assembly; integration tests commit each style through the settings namespace and assert the next assembly's text, including the no-provider and provider-detach fallbacks.
- The package invariant companion asserts at most one `output-style` section per assembly — on the settled assembly value downstream of the companion's waterfall listener and on the full chain at companion load — with negative tests proving a duplicate assembly fails.
- A deployment without a settings provider renders `Config.defaultStyle` permanently; the README states the fallback so the failure mode is loud in configuration, not silent at runtime.
- The section renders regardless of the zen-phase tool face, because style is orthogonal to tool exposure; a deployment that wants otherwise composes without the package.
- An app-level keyless snapshot is deferred; the verbatim texts are pinned byte-for-byte by package tests through the real assembly pipeline.
