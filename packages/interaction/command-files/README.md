# @huiliyi37/dsh-command-files

English | [中文](README.zh.md)

Load user-defined slash commands from two layers of Markdown command files. A deployment or user drops a `.md` file under `<resolveDshHome()>/commands` (default `~/.dsh-tianshu/commands`) or `<cwd>/.dsh/commands`, and the plugin turns each file into a `/command` without a model turn — the command renders a template and steers the result to the agent.

## Problem

Every other command in the harness is code-owned: `/plan`, `/style`, `/next-workflow` are registered by their own plugin. Users cannot extend the command surface with their own slash commands without editing a plugin and rebuilding. Command files close that gap: the command set becomes ordinary files that a user or a project can add, version, and share.

## Design

Two layers are scanned at load time:

- a **user layer** at `<resolveDshHome()>/commands`, and
- a **project layer** at `<cwd>/.dsh/commands`.

Both are configurable through the `Config` fields `userDir` / `projectDir` (a deployment-varying path is a validated `Config` field, never a hardcoded constant). Only the two layer directories flow through the plugin; the file format and the name grammar below are fixed.

Each `.md` file is one command. The file carries a YAML `---` frontmatter with a required `description` and an optional `images` flag, then a template body. The command name is the lowercase file stem with nested directories flattened by `-` (so `git/log.md` → `git-log`). Every name must match the registry regex `/^[a-z][a-z0-9_-]*$/u`, which requires a **leading letter** — `1foo.md`, `my command.md`, or an uppercase stem all fail loud at load with the offending file path.

The loader performs the cross-layer de-duplication itself, because the command registry throws on a global same-name `register`. It collects the user layer first, then lets the project layer overwrite it, so a project command shadows a homonymous user command and only the winner is registered. A duplicate within one layer (a stem collision or a flattened-name collision) also fails loud at load.

The template body is rendered against the exact raw input:

- `$ARGUMENTS` — the complete `rawInput` verbatim;
- `$1` … `$9` — whitespace-split positional arguments (an absent one leaves the `$n` placeholder in place);
- any other `$`-prefixed sequence (e.g. `$0`, `$10`, `$foo`) passes through unchanged, so a template never silently drops an unknown placeholder.

The rendered text is steered to the agent as a user message; an empty template body settles as an execution-time error instead of steering an empty turn. Image attachments pass through only when the file declares `images: true`.

The command is also mirrored into the TUI slash menu through the optional `tui.commands` seam, delegating execution to the host command registry so `command/run` / `command/done` stay intact.

## Composition

Mount the command registry and this plugin, and point the two layer directories at your command files (or let them default):

```yaml
- id: commands
  name: '@huiliyi37/dsh-commands'
- id: command-files
  name: '@huiliyi37/dsh-command-files'
  config:
    userDir: /home/me/.dsh-tianshu/commands
    projectDir: /work/project/.dsh/commands
```

## Model Experience

### File-backed command steer

#### What the model sees

Each file-backed command, when invoked, renders its template body and steers the result as a `createUserMessage` with `source: { kind: 'user' }` through `agent.steer`. That user message is the model-visible transcript: the model sees exactly the rendered text (plus the declared `images` blocks when the file accepts attachments). No new session event is introduced — the steered user message is already the logged, model-visible input (`model-visible ⟺ logged`), and the registry's `command/run` / `command/done` pair is log-only and never joins the request.

#### Token effect

One user message per invocation, whose token count is the rendered template body (plus any declared image blocks). There is no per-command system-prompt or tool section, so mounting the plugin adds zero model tokens until a command is actually invoked.

#### KV Cache effect

The steered user message is appended as a fresh turn suffix, so it does not invalidate an already-reusable request prefix. Command-file discovery and the command-registry lifecycle pair are log-only and do not reach the request, so the package neither grows nor replaces the prefix; it adds a tail user message per invocation.

## Known Limitations and Deferred Work

- **No filesystem watching** — new or edited command files take effect only on restart; there is no `add`/`change`/`unlink` watcher for either layer.
- **No per-agent scoping** — file-backed commands are deployment-global. A per-agent variant would need an owner for the shadowing rules (the registry supports command-injected child plugins under an agent's `agent.ctx`, but this package registers only globals).
- **No keyless PTY snapshot scenario** — the model-visible surface is a steered user message asserted directly against the session log; the harness's interactive-terminal (PTY) presentation snapshots are not yet wired for this package.
