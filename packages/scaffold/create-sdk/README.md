# `@deepseek-ai/create-sdk`

English | [中文](README.zh.md)

Interactive initializer for `npm create @deepseek-ai/sdk [directory]`. Directory/name/description have visible editable defaults. A tree picker selects features and configures finite options with Right/Left navigation; secret text follows only for selected options. Local plugin creation is one none/plugin/tool choice.

The supported package surface is the `create-sdk` bin. The package root exports no symbols, and workflow, bin, source, and package-manifest subpaths are not exported.

The initializer rejects every existing target path, creates one `SdkProject` edit session, validates and commits it, then asks whether to install NPM dependencies and build. Install or build failures keep the generated project and print a retry command.

Public flags are `[directory]`, `--description`, `--provider`, `--base-url`, `--api-key`, `--model`, `--interface`, `--pm`, `--install`/`--no-install`, plus the headless flags `--config <path>` / `--config-json <json>` and `--json`. Interactive flags prefill matching questions; a headless spec (`--config`/`--config-json`) supplies every answer and its feature plan up front, so creation runs without a TTY and drives through a `HeadlessPromptPort` that fails loud on any missing required answer. `--json` emits NDJSON lifecycle events (`done` / `action-required` / `error`) so an agent can fill the named missing input and re-run.

The provider choice is DeepSeek or a custom endpoint backed by `llm-pi-ai`. DeepSeek asks only for an API key and uses the public endpoint plus `deepseek-v4-flash`; custom also asks for a base URL. An empty key requires confirmation and creates a commented empty `.env` variable so provider startup fails clearly until it is filled. Existing plugin defaults are omitted; required SDK presets remain typed against the owning package's Config.

## Model Experience

Indirectly, through the generated project composition and its selected runtime plugins; the headless `--config-json` + `--json` surface additionally lets an agent create a project end to end and react to `action-required` events.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Headless local plugins** — the headless spec supplies project answers and the feature plan; scaffolding a local plugin (the interactive none/plugin/tool choice) is not yet expressible in the spec and defaults to none.
