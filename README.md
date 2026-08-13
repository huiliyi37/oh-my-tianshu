# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source coding agent built on the DeepSeek Harness SDK.

It uses an architecture where **everything is a plugin**.

## Internal testing notice

DeepSeek Harness is under internal testing. Features and interfaces may change.

The internal build uploads all Session Logs by default to help diagnose reported problems. Set `DSH_TELEMETRY_DISABLED=1` to disable telemetry. Send feedback through the internal WeChat group.

## Install

Clone the repository, then run the installer:

```sh
git clone <repo-url>
cd deepseek-harness
scripts/install.sh
```

The installer requires `git` and Node `^22.19 || >=24`, offers to install `pnpm` when it is missing, prompts for a DeepSeek API key, builds the required repository artifacts, and launches the Web UI.

The default active checkout is `~/.dsh/source/current`, and the launcher is linked into `~/.local/bin`. Re-run the installer to update. [`scripts/install.sh`](scripts/install.sh) owns alternate locations, update mechanics, and recovery options.

## Use DeepSeek Harness

### Web UI

For the recommended local interface, choose Web UI when the installer finishes. To start it later, or after updating the active checkout, build the repository and run:

```sh
(cd ~/.dsh/source/current && pnpm run build)
dsh web
```

The path above is the installer's default. If you set `DSH_SOURCE` or `DSH_CURRENT`, or reused an existing checkout, replace `~/.dsh/source/current` with that checkout path; see [`scripts/install.sh`](scripts/install.sh) for details. The Web UI is served at `http://127.0.0.1:3080` by default.

### Profiles

`dsh` boots profiles — ordered stacks of plugin-bundle patch layers under your own overrides in `$DSH_HOME/profiles/<name>`:

```sh
dsh --profile web                       # the browser UI (same as: dsh web)
dsh plugin --profile tui add <package>  # install a plugin into a custom profile
dsh --profile tui                       # boot it
```

The [CLI contract](apps/cli/README.md#profiles) describes profile layout, layer semantics, and config dump commands.

### Terminal UI (`dsh-tui`)

Start the full-screen terminal interface:

```sh
dsh tui          # or: dsh --profile tui
```

The TUI is a port of the Tianshu (opencode-tui) render core adapted to dsh seams. Type `/` to open the command menu — ↑↓ to select, Tab to accept, Enter to submit, Esc to close. Press `Ctrl+.` any time for the shortcut map.

**Slash commands**

| Command | Effect |
|---|---|
| `/session` | session management (list / switch) |
| `/fork [directive]` | fork the current session (history copied) and switch; optional first message |
| `/branch` | alias of `/fork` |
| `/model [provider/model]` | view or switch the model (hot-swaps the live session; `spark-flash` / `spark-pro` aliases switch to DeepSeek Spark) |
| `/theme [name]` | switch themes |
| `/clear` | clear the current conversation's scrollback |
| `/compact` | compact the current session's context |
| `/steer <text>` | mid-turn steering (redirect without interrupting) |
| `/status` | status panel (5-domain projection snapshot) |
| `/config` | settings panel (settings / permission / credentials) |
| `/skills` | skill browser panel |
| `/subagents` | delegation-tree panel |
| `/workflow` | running-workflow panel |
| `/tasks` | task panel (background tasks) |
| `/goal` | goal management (create / pause / resume / complete / block) |
| `/memory` | memory browser (list / filter / delete / preview) |
| `/remember <text>` | save a memory |
| `/rewind` | two-phase rollback (message list → granularity) |
| `/btw <question>` | side-question to the background agent |
| `/doctor` | terminal diagnostics with fix guidance |
| `/mcp` | list connected MCP servers and tools |
| `/export [path]` | export the current session's transcript to a Markdown file |
| `/density` | toggle compact tool-card rendering |
| `/permission` | switch the permission preset (workspace-write / danger-full-access) |

**Keyboard shortcuts**

| Key | Effect |
|---|---|
| `Ctrl+N` | new session |
| `Ctrl+S` | resume the most recent session |
| `Ctrl+Q` | quit |
| `Ctrl+P` | command palette |
| `Ctrl+.` | shortcut map overlay |
| `Ctrl+F` | history search (n/N jump) |
| `Ctrl+O` | open the input line in `$EDITOR` |
| `Ctrl+T` | mid-turn steer |
| `Ctrl+V` | paste the system-clipboard image (clipboard-text fallback when the clipboard holds no image) |
| `Alt+W` | copy the selection to the system clipboard (OSC52) |
| `Shift+Tab` | cycle mode: normal → plan → always-approve |
| `Tab` | `@`-path completion; accept a slash-menu selection |
| `↑/↓` | input history (menu selection while the slash menu is open) |
| `PageUp/PageDown` | page the slash menu |
| `Esc` | close the slash menu or overlays |

**Interaction**

Tool approvals prompt inline as `⚠ 允许执行 …？[y/N]` with a unified diff preview above the prompt. Subagent runs appear as spinner lines in the live region and settle into ✓/✗/◌ scrollback entries on completion. The bottom three rows are the input line (with a bottom-edge line colored by mode), the footer (mode badges + shortcut hints), and the metrics row (model / token usage / cache hit rate).

**Image paste and terminal preview**

`Ctrl+V` (or right-click / terminal-menu paste) reads the system clipboard image — macOS `osascript`, Linux `wl-paste`/`xclip`, Windows PowerShell — and attaches it; pasting text that looks like an image path loads the file as an attachment instead. Attached images render as a `📎 N images` marker above the input line and, on submit, as inline terminal graphics (kitty / iTerm2 protocols) under the user bubble. The bubble carries a vision hint: an image-capable primary sees the image directly; a text-only primary with a vision bridge configured gets the image described by the vision model first; with neither, the TUI warns that the image was not sent (and does not submit it).

**Vision bridge (optional)**

`dsh-vision-bridge` lets a text-only primary still read user images: at `agent/pre-step` it describes image attachments through a dedicated vision model and injects the description as a plugin-source user message (model-visible ⟺ logged; bridge failure degrades to a visible note, never a failed turn). Enable by adding the plugin with a vision-capable provider/model:

```yaml
# cordis.yml
- id: vision-bridge
  name: '@deepseek-ai/dsh-vision-bridge'
  config:
    provider: deepseek-official   # any registered llm route that can see images
    model: <vision-capable model>
```

and set the TUI's `vision` state (in the `tui-runner` bundle config) so the bubble hint reflects the bridge: `supportsVision: false`, `bridgeEnabled: true`.

**DeepSeek Spark mode (internal)**

The `deepseek-spark` provider route truncates assistant reasoning to the tail N tokens on the wire (flash 300 / pro opt-in), keeping the model's context lean; `dsh-spark-anchors` pairs with it, re-injecting the excluded paths so the model does not re-derive ruled-out options. Enable once — settings hot-reload, no restart:

```yaml
# settings.yaml
llm-deepseek:
  spark:
    enabled: true
```

then switch with `/model spark-flash` or `/model spark-pro` (aliases for `deepseek-spark/deepseek-v4-flash` / `deepseek-spark/deepseek-v4-pro`). Spark shares the DeepSeek API key — no extra configuration.

### Headless

Run one task, print the final answer, and exit:

```sh
dsh run "summarize this workspace"
```

### Automation and SDKs

From a source checkout with `DEEPSEEK_API_KEY` in the environment or its root `.env`, start the ACP automation server:

```sh
pnpm run demo:acp
```

The [Python SDK](python/README.md) drives a bundled JSON-RPC runtime. The [examples](examples/README.md) cover the runnable headless, ACP, JSON-RPC, Code Mode, and self-referential compositions.

## Why DeepSeek Harness

Built-in capabilities cover file reading, editing, and search; shell and persistent PTY execution; reusable skills; task tracking, goals, plans, todos, and background tasks; subagents and workflows; sandboxing and approvals; settings and credentials; persistent, resumable, forkable, and queryable sessions; LSP and web access; context compaction; loop-hygiene guards (RED-first verification, failure routing, repeat-call reminders, and per-call timeouts); and telemetry. Each composition selects the subset appropriate to its surface. The Web UI includes Plan Mode.

- **Everything is a plugin.** Models, tools, policies, storage, context management, and interfaces are composable [Cordis plugins](docs/user/develop/basic/index.md), so deployments can extend or replace behavior without forking the agent loop. See the [architecture](docs/architecture.md) for the underlying design.
- **Runs are reconstructable.** Anything visible to the model is logged in the authoritative session stream; persistence, resume/fork/query, replay, telemetry, and UIs derive from the same events. See the [session-log architecture](docs/architecture.md#session-log).
- **Code Mode (opt-in).** It exposes a `run_code` tool and a generated TypeScript SDK; only program output re-enters model context. See [Code Mode](packages/core/tools/README.md#code-mode).
- **Self-referential Cordis tools are opt-in.** They let the agent inspect its live runtime and mount or unmount plugins while it runs. See the [Cordis tools](packages/self-modification/tool-cordis/README.md).

## Community

Follow <a href="https://x.com/Deepseekharness">DeepSeek Harness on Twitter</a> for project updates.

## Development

Start with the [development guide](docs/development.md) and read the [architecture](docs/architecture.md) before changing packages.

For agents, follow [AGENTS.md](AGENTS.md).

DeepSeek Harness is currently in internal testing.

## License

BSD 3-Clause (the `LICENSE` file is not included in this private snapshot)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
