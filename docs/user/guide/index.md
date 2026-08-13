# Introduction

English | [中文](index.zh.md)

DeepSeek Harness is a **plugin-based agent development framework** built on the [Cordis](https://github.com/cordiverse/cordis) microkernel. Its central idea is simple: **everything is a plugin**.

## What it is

Harness implements every capability an AI agent needs—including LLM calls, tool execution, session management, and subtask delegation—as a composable plugin. A `cordis.yml` file declares which plugins to load and how to configure them, assembling a complete agent.

```yaml
# Select the LLM backend
- name: '@deepseek-ai/dsh-llm-deepseek'

# Compose one configured agent
- id: agent-spine
  name: '@deepseek-ai/dsh-agent-spine-demo'
  config:
    agents:
      - id: main
        provider: deepseek-official
        model: deepseek-v4-flash
    workspaceContext: false
```

## Who it is for

### Application users

To run an existing agent application, such as a coding assistant or conversational agent:

1. Copy an example template.
2. Add an API key.
3. Run it.

No code is required. See the [quick start](./quickstart.md).

### Plugin developers

To add a custom tool, a new LLM adapter, or another execution backend, write a plugin. Harness provides explicit extension interfaces and a type-safe development experience. See [development](../develop/basic/).

## Core features

- **Configuration only** — `cordis.yml` selects the capability set; changing a model or adding a tool is a configuration edit.
- **Hot replacement (HMR)** — edit plugin code during development without restarting the process.

## Technology

- **Runtime**: Node.js ^22.19 or >= 24
- **Language**: TypeScript (ESM)
- **Framework**: Cordis
- **Package manager**: pnpm workspaces (the repository pins pnpm 11)
