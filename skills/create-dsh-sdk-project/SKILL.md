---
name: create-dsh-sdk-project
description: Create a DeepSeek Harness SDK project non-interactively (headless), driven by an agent instead of the interactive wizard. Use when asked to scaffold a new DSH SDK project without a terminal.
---

# Create a DeepSeek Harness SDK project headlessly

The `create-sdk` initializer normally runs an interactive wizard. To create a project
**without a terminal**, pass a structured spec and ask for machine-readable events:

```sh
npm create @deepseek-ai/sdk -- --config-json '<spec-json>' --json
```

- `--config-json '<json>'` supplies the whole spec inline (no prompts). Alternatively
  `--config <path.json>` reads the same spec from a file.
- `--json` makes the command emit one NDJSON lifecycle event per line to stdout.

## Spec shape

All fields are optional except those a chosen feature requires. Unsupplied answers that
have a sensible default are taken from it; a *required* answer with no default (a secret,
a custom provider base URL, a required feature option) makes the run fail loud rather than
block.

```json
{
  "directory": "my-agent",
  "description": "A DeepSeek Harness agent",
  "provider": "deepseek-official",
  "apiKey": "<key>",
  "model": "deepseek-v4-flash",
  "interface": "acp",
  "pm": "npm",
  "install": false,
  "features": [
    { "id": "persistence", "options": ["sqlite"] },
    { "id": "web", "options": ["exa"], "secrets": { "apiKey": "<exa-key>" } }
  ]
}
```

`features` is the complete set of optional features to enable, each with its chosen
options and any secrets/values it needs. The interactive feature tree and its
recommended-feature prompts are skipped in headless mode.

## Reacting to events

Each line of stdout is one JSON object:

- `{"type":"done"}` — the project was created (and installed, if `install` was true).
- `{"type":"action-required","prompt":"<message>"}` — a required answer was missing.
  Add the corresponding field to the spec (e.g. an `apiKey`, a feature secret, a custom
  `baseURL`) and re-run.
- `{"type":"error","message":"<message>"}` — the run failed for another reason.

Iterate: read `action-required`, fill the named input into the spec, re-run until `done`.
