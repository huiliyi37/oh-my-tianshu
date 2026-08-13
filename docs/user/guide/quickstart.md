# Quick start

English | [中文](quickstart.zh.md)

This guide gets an agent running in five minutes.

## Prerequisites

- [Node.js](https://nodejs.org/) ^22.19 or >= 24
- [pnpm](https://pnpm.io/) 11 through Corepack
- A [DeepSeek Platform](https://platform.deepseek.com/) API key

```sh
node -v
corepack enable
pnpm -v
```

## Step 1: install and configure the API key

```sh
git clone https://github.com/deepseek-ai/deepseek-harness-sdk.git
cd deepseek-harness
pnpm install
pnpm run build
```

Create the gitignored repository-root `.env`:

```sh
DEEPSEEK_API_KEY=sk-your-key-here
```

## Step 2: run one Headless task

Run a non-interactive task and print its final answer:

```sh
pnpm run dsh run "summarize the architecture of this workspace"
```

`dsh run` creates and persists a fresh session, prints the final assistant answer, and exits. It starts no Web server or listening port, and a successful run leaves stderr empty.

## Step 3: use the Web UI

Start the browser interface:

```sh
pnpm run dsh web
```

Open `http://127.0.0.1:3080`. The agent can read and write files, run commands, delegate subtasks, and track a plan. Try: `Create hello.js in the current directory, print "Hello from Harness!", and run it`.

## What happened

`dsh run` boots the `headless` profile: [`dsh-base`](../../../packages/bundle/base/cordis.patch.yml) and [`dsh-headless`](../../../packages/bundle/headless/cordis.patch.yml) compose over an empty root, then the runner drives the core Agent and Session services directly. `dsh web` instead composes `dsh-base` with [`dsh-web-app`](../../../packages/bundle/web-app/cordis.patch.yml), which owns the Host, HTTP, and browser layers. Both read the same default DeepSeek model route from `dsh-base`.

## Next steps

- [Configure models](./providers.md) — reach providers beyond DeepSeek, and custom gateways
- [Configuration](./config.md) — understand the `cordis.yml` format
- [Develop a plugin](../develop/basic/) — build your own tool or backend
