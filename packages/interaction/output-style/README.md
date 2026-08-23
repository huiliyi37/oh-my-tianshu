# @huiliyi37/dsh-output-style

Switchable output-style presets for the assembled system prompt. The package mounts one ordered `system-prompt` section — `output-style` at order `10`, between the deployment persona (`0`) and the tool-guidance band (`100`–`199`) — carrying three verbatim presets: `default`, `explanatory`, and `learning`. The active style lives in the `output-style` settings namespace; the `/style` command reports and commits it. Mounting is opt-in; shipped defaults do not include the package.

## Public API

- `apply(ctx, config)` — function plugin (`name: 'output-style'`, injects `systemPrompt` and `commands`). Registers the section once, wires the settings namespace through `installSettingsSection`, registers `/style` on `ctx.commands`, and mirrors it into the TUI slash menu when `tui.commands` is composed.
- `Config.defaultStyle` — style active until a settings commit switches it, and the permanent fallback when no settings provider is assembled (default `'default'`).
- `OUTPUT_STYLES` / `OUTPUT_STYLE_TEXTS` — the closed vocabulary and its verbatim bodies; `OUTPUT_STYLE_SETTINGS_NAMESPACE` / `OUTPUT_STYLE_SETTINGS_SCHEMA` — the `output-style` namespace contract.

### Live events

None. A `/style` switch writes only through the settings seam's own commit path; no session events are added. The package invariant companion (`@huiliyi37/dsh-output-style/invariant`) asserts at most one `output-style` section per assembly on every `system-prompt/change`.

## System prompt

#### What the model sees

One extra ordered section whose body is the active preset verbatim:

```markdown
Answer directly and concisely. Lead with the result or decision, then only the supporting detail needed to act on it. …
```

The three bodies are fixed product copy pinned byte-for-byte by tests (`OUTPUT_STYLE_TEXTS`). The section renders unconditionally regardless of the zen-phase tool face — style is orthogonal to tool exposure; a deployment that wants otherwise composes without the package.

#### Token effect

One preset body (~50–70 tokens) per request while mounted, independent of tool count or persona length.

#### KV Cache effect

Prefix-stable while the active style stays unchanged. A `/style` commit changes the rendered section text once, invalidating prefix reuse from the first changed system-prompt token of the next request; subsequent requests are prefix-stable again at the new text.

## Switching semantics

The section is registered once and its `text` closure reads the live resolved namespace on every assembly (the realtime-read pattern shared with model role pins) — a committed switch applies from the next assembly with no dispose/re-register gap. `/style <style>` validates against the closed vocabulary and fails loud on unknown styles or a missing settings provider; bare `/style` reports the current value. Without a settings provider the composition's `Config.defaultStyle` renders permanently.

## Known Limitations and Deferred Work

- Styles are deployment-global: subagents and routers render the same preset as their parent. Agent-scoped overrides are deferred — no consumer has asked for per-agent style channels, and adding one would need an owner for the shadowing rules.
- No file/CLI editing surface beyond `/style`: the namespace can also be edited through any settings writer (e.g. `/config`), but no dedicated UI ships with this package.
