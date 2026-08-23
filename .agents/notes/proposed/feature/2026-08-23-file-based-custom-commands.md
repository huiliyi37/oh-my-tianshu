# Agent Note: File-based user custom commands

Status: proposed

English | [中文](2026-08-23-file-based-custom-commands.zh.md)

## Problem

Every human command in Tianshu is registered from code through the [command registry](../../../../packages/interaction/commands/README.md), so a user cannot extend the product surface without writing a plugin. Claude Code's `.claude/commands/*.md` convention is its strongest interaction lever: users and projects drop Markdown files that become first-class slash commands whose bodies are prompt templates. The [`/next-workflow` precedent](../../../../packages/workflow/next-workflow/README.md) shows a shipped command registering on `ctx.commands` and surfacing in the TUI slash menu, but nothing loads user-authored files into that registry.

## Proposal

A new package `@huiliyi37/dsh-command-files` under `packages/interaction/command-files/` loads user- and project-authored command files and registers each as a human command, following the [plugin command registration contract](../../implemented/feature/2026-07-19-plugin-command-registration.md). Mounting is opt-in; shipped defaults do not include the package.

### File layout and naming

The loader scans `$DSH_HOME/commands/**/*.md` (user layer) and `.dsh/commands/**/*.md` (project layer), merging user files first and project files after. A command name is the lowercase file stem, and nested directory levels flatten with `-` (`git/log.md` becomes `git-log`) because `parseCommand` admits only a lowercase letter first, then letters, digits, `_`, and `-`. A stem that starts with a digit fails loud at load. Duplicate names within one layer fail loud at load; a project file deterministically shadows a user file with the same name.

### File format

Each file opens with a YAML frontmatter block, then the template body:

- `description` (required) — the one-line description the command panel shows.
- `images` (boolean, default `false`) — whether the invocation may carry composer image attachments, matching the registry's `input.images` declaration.

The body is a prompt template. `$ARGUMENTS` expands to the complete raw input after the command name; `$1` through `$9` expand to whitespace-split positional arguments. Undefined `$x` sequences pass through verbatim, and an empty template is an execution-time error.

### Dispatch

Each file registers one command whose handler renders the template and steers the receiving agent with a `createUserMessage` containing the rendered text, the same steer pattern [`/plan` uses](../../../../packages/plan/plan-mode/README.md). Without arguments the template is sent verbatim; with arguments the expansion applies. The handler returns a success echo, and `recordInput` keeps its default `true`, so `command/run` audits the raw input while the expanded message becomes model-visible content owned by this package. The registry's image enforcement already rejects attachments to non-declaring commands, and a declaring command receives the frozen blocks and owns their use.

### Registration lifecycle

The loader scans at plugin load and registers every discovered command on `ctx.commands`; `commands/change` observers refresh live adapters. The TUI consumes only its own `tui.commands` facet, never `ctx.commands`, so the loader also injects that facet when composed and registers a forwarding wrapper per command that calls `ctx.commands.execute` — the exact [`/next-workflow` pattern](../../../../packages/workflow/next-workflow/README.md). File watching and rescan are deferred (see Risks below).

### Scoping

Command files register globally. Agent-scoped command files are deferred: subagents and routers own their profiles, and per-agent shadowing from files would add a second source of truth without an identified consumer.

## Alternatives considered

### Why not TUI-only command files?

Loading files inside `packages/tui` would reach only the terminal surface, while the registry already makes one registration serve every command adapter, including the Web client. A harness-level loader costs nothing extra and loses no surface.

### Why not executable JS/TS command files?

Claude Code command files are inert templates. Executing user-authored code at load grants arbitrary process access and drags in module loading, hot-reload, and trust decisions; templates keep the capability inert and auditable.

### Why not reuse the skill loader?

Skills are model-side progressive disclosure of instructions, while commands are a human dispatch surface with the `command/run`/`command/done` lifecycle. The surfaces differ enough that sharing a loader would bend both contracts.

## Acceptance criteria

- A real-composition e2e boots a test-only `cordis.yml` fixture that mounts the package plus one command file, drives the command, and asserts the `command/run`/`command/done` pair, the audit payload, and the model-visible `user/message` the handler steers.
- A keyless snapshot pins template rendering, including `$ARGUMENTS`, `$1` through `$9`, and verbatim passthrough of undefined `$x`.
- Failure cases are proven loud: duplicate stems within one layer, a missing description, and an empty template each fail in their test.
- The HMR-safety test disposes the plugin fiber and observes command removal.
- The bilingual README pair and the package invariant (registered command names equal the discovered file set) ship with the package; this note moves to `implemented/` with the landing commit.

## Risks

- No file watching in the first cut: users restart to load new command files, and the command panel listing mitigates discovery friction.
- Template output becomes a user message; that matches the trust of typing the message directly, and the frontmatter keeps attachment admission explicit.
- Flat `-` naming can collide (`a-b.md` versus `a/b.md`); the duplicate check fails loud instead of silently shadowing.

## Implementation deltas (2026-08-23)

Implemented in the working tree as `packages/interaction/command-files`, with these corrections from code verification:

- The registry cannot shadow within one layer — same-name registrations throw (`scope/src/store.ts`). The loader dedupes itself: user entries collected first, project entries override, only winners register.
- The `/next-workflow` precedent is a dual registration: the TUI slash menu's data source is the `tui.commands` facet, not `ctx.commands`. The loader mirrors every discovered command into `tui.commands`.
- Registry names must start with a letter (`/^[a-z][a-z0-9_-]*$/u`), so numeric/underscore-leading stems fail loud at load.
- `$DSH_HOME` resolves to `~/.dsh-tianshu` by default; both command directories are new conventions under it and `.dsh/`.
- Keyless PTY snapshot deferred; template rendering is pinned verbatim by unit tests.
