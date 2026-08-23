# Agent Note: File-based user custom commands

Status: implemented

English | [中文](2026-08-23-file-based-custom-commands.zh.md)

## Problem

Every human command in Tianshu is registered from code through the [command registry](../../../../packages/interaction/commands/README.md), so a user could not extend the product surface without writing a plugin. Claude Code's `.claude/commands/*.md` convention is its strongest interaction lever: users and projects drop Markdown files that become first-class slash commands whose bodies are prompt templates. The [`/next-workflow` precedent](../../../../packages/workflow/next-workflow/README.md) shows a shipped command registering on `ctx.commands` and surfacing in the TUI slash menu, but nothing loaded user-authored files into that registry.

## Decision

A new package `@huiliyi37/dsh-command-files` under `packages/interaction/command-files/` loads user- and project-authored command files and registers each as a human command, following the [plugin command registration contract](../../implemented/feature/2026-07-19-plugin-command-registration.md). Mounting is opt-in; shipped defaults do not include the package.

### File layout and naming

The loader scans `<resolveDshHome()>/commands/**/*.md` (user layer, default `~/.dsh-tianshu/commands`) and `.dsh/commands/**/*.md` (project layer), both `Config`-overridable, merging user files first and project files after. A command name is the lowercase file stem with nested directory levels flattened by `-` (`git/log.md` becomes `git-log`) and must satisfy the registry grammar `/^[a-z][a-z0-9_-]*$/u` — a stem that starts with a digit or underscore fails loud at load. Duplicate names within one layer fail loud at load. The registry itself cannot shadow within one layer (same-name registrations throw), so the loader de-duplicates cross-layer collisions itself: user entries are collected first, project entries override, and only the winners register — a project file deterministically shadows a user file with the same name.

### File format

Each file opens with a YAML frontmatter block, then the template body:

- `description` (required) — the one-line description the command panel shows.
- `images` (boolean, default `false`) — whether the invocation may carry composer image attachments, matching the registry's `input.images` declaration.

The body is a prompt template. `$ARGUMENTS` expands to the complete raw input after the command name (never trimmed); `$1` through `$9` expand to whitespace-split positional arguments, with an absent positional left verbatim. Any other `$x` sequence passes through unchanged, and an empty template settles as an execution-time error without steering.

### Dispatch

Each file registers one command whose handler renders the template and steers the receiving agent with a `createUserMessage` containing the rendered text. The registry's own `command/run`/`command/done` lifecycle audits the invocation, and the steered message is the model-visible content — model-visible ⟺ logged holds through the steer path. The registry's image enforcement rejects attachments to non-declaring commands before the handler runs, and a declaring command receives the frozen blocks and owns their use.

### Registration lifecycle

The loader scans at plugin load and registers every discovered command on `ctx.commands` (self-disposing registry effect, proven by the HMR test). The TUI slash menu's data source is the `tui.commands` facet, not `ctx.commands`, so the loader also injects that facet when composed and registers a forwarding wrapper per command that calls `ctx.commands.execute` — the exact [`/next-workflow` pattern](../../../../packages/workflow/next-workflow/README.md). No filesystem watching: new or edited command files take effect on restart (see the README's Known Limitations).

### Scoping

Command files register globally. Agent-scoped command files are deferred: subagents and routers own their profiles, and per-agent shadowing from files would add a second source of truth without an identified consumer.

## Alternatives considered

### Why not TUI-only command files?

Loading files inside `packages/tui` would reach only the terminal surface, while the registry already makes one registration serve every command adapter, including the Web client. A harness-level loader costs nothing extra and loses no surface.

### Why not executable JS/TS command files?

Claude Code command files are inert templates. Executing user-authored code at load grants arbitrary process access and drags in module loading, hot-reload, and trust decisions; templates keep the capability inert and auditable.

### Why not reuse the skill loader?

Skills are model-side progressive disclosure of instructions, while commands are a human dispatch surface with the `command/run`/`command/done` lifecycle. The surfaces differ enough that sharing a loader would bend both contracts.

## Consequences

- Real-Loader composition tests boot a test-only `cordis.yml` and pin the full path: discovery, project-shadows-user, execution through `ctx.commands.execute`, the `command/run`/`command/done` pair, the steered user message, and TUI-facet mirroring. Failure cases are proven loud: an invalid derived name, a missing description, an empty template, and a same-layer duplicate each fail in their test.
- A keyless PTY snapshot is deferred; template rendering is pinned verbatim by unit tests through the real registry path.
- No file watching in the first cut: users restart to load new command files, and the command panel listing mitigates discovery friction.
- Template output becomes a user message; that matches the trust of typing the message directly, and the frontmatter keeps attachment admission explicit.
- Flat `-` naming can collide (`a-b.md` versus `a/b.md`); the same-layer duplicate check fails loud instead of silently shadowing.
