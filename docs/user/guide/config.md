# Configuration

English | [中文](config.zh.md)

Harness uses `cordis.yml` to describe which plugins an agent loads and the configuration passed to each one. The file composes capabilities; the generated configuration catalog records the fields and defaults each package actually supports, avoiding a second hand-maintained reference.

## Start from a real configuration

The repository examples are runnable configurations and the most reliable starting points for a new project:

- [the `dsh-base` bundle patch](../../../packages/bundle/base/cordis.patch.yml) provides the common model, tools, persistence, policy, and telemetry rows every profile starts from.
- [the `dsh-web-app` bundle patch](../../../packages/bundle/web-app/cordis.patch.yml) adds the browser host, Workspace management, browser interaction, and client plugins.
- [headless-agent](../../../examples/headless-agent/cordis.yml) exposes the coding composition as a one-shot task.
- [acp-agent](../../../examples/acp-agent/cordis.yml) exposes fresh sessions to programmatic ACP clients.

A minimal configuration is a list of plugin entries:

```yaml
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'

- id: bash
  name: '@deepseek-ai/dsh-bash-local'

- id: agent-loop
  name: '@deepseek-ai/dsh-agent-loop'
  config:
    agents:
      - id: main
        provider: deepseek-official
        model: deepseek-v4-flash
```

## Plugin entries

`name` identifies an npm package or a local module relative to `cordis.yml`; `id` gives the plugin instance a stable identity; and `config` supplies plugin-specific configuration. Set `disabled: true` to skip an entry temporarily.

```yaml
- id: local-tool
  name: './src/my-tool.ts'
  disabled: false
  config:
    toolName: my_tool
```

Cordis starts sibling entries concurrently. A plugin declares required services through `inject`; Cordis waits for those services before applying the plugin, so file order does not establish dependency readiness. Missing models, tools, and plugins fail as early as possible instead of being silently ignored.

## CLI patch layers

`dsh --profile <name>` composes the profile's bundle patch layers (its manifest's `dsh.profile.bundles` list, in order) over an empty root, then the profile's own `~/.dsh/profiles/<name>/cordis.patch.yml`, then each `--patch <path>` overlay, then CLI-flag patches. Later layers win per row.

A patch replaces a row's entire `config` value; it does not deep-merge keys. For example, patching `llm-deepseek` with only `config: { thinking: disabled }` also removes that row's configured `apiKeyEnv` and `baseURL`, so restate every key the row must retain.

## JavaScript values and environment variables

The Cordis loader evaluates runtime expressions tagged with `!!js` for non-secret runtime values. Bundled LLM adapters carry credential references such as `apiKeyEnv`; the value belongs in an environment layer or `$DSH_HOME/.credentials.yaml`, not Cordis configuration.

```yaml
config:
  cwd: !!js process.cwd()
```

The tag is `!!js`, not `!js`.

## Exact configuration reference

The generated [plugin configuration catalog](../../config-catalog.md) lists every current field, type, and default. For composition concepts, continue to the [architecture](../../architecture.md) and [capability seams](../../capability-seams.md). To create a configuration, copy the closest entry from the [examples overview](../../../examples/README.md) and adapt it.
