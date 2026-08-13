# @deepseek-ai/dsh-tool-git

English | [中文](README.zh.md)

The **model-facing git tool** — one `git` tool with an `operation` discriminator (`status` | `diff` | `log` | `commit`). The four operations share a single tool schema so the prompt footprint stays small (H1: the Claude Code native git tools counterpart, C6 benchmark). This is the consumer layer of the git seam: it owns the tool name, JSON schema, argument validation, prompt section, and result formatting, and executes through the `ctx.git` provider contract ([`@deepseek-ai/dsh-git`](../git)) — the tool never touches git subprocesses directly.

## Config

```yaml
- id: tool-git
  name: '@deepseek-ai/dsh-tool-git'
  config:
    enabled: true   # optional; false registers no tools (default true)
```

## Tool

`git` — one tool, four operations (the `operation` field selects which):

| operation | Relevant arguments | Behavior |
|---|---|---|
| `status` | `workdir?` | Current branch + whether the working tree is dirty. |
| `diff` | `workdir?`, `paths?`, `stat?` | Uncommitted diff (full text, or `--stat` summary; paths-filterable). |
| `log` | `workdir?`, `maxCount?` (default 20, cap 100), `paths?` | Commit history as `hash subject` lines. |
| `commit` | `workdir?`, `message` (required, non-empty) | Stages all changes (`add -A`) and commits. |

Field names are snake_case, matching Claude Code and existing harness tool schemas. `workdir` defaults to the calling agent's session cwd (`exec.agent.session.header.cwd`), then the process cwd. Cancellation (tool `exec.signal`) propagates to the git subprocess.

`commit` is intentionally exclusive (`isConcurrencySafe: false`) and the prompt section tells the model to inspect with `status`/`diff` first; the commit itself is a git-object operation and does not ask for approval (same stance as Claude Code — file mutations still go through the fs approval surface).

## Model Experience

### What the model sees

One structured tool covering repository inspection and committing — working tree, uncommitted diffs, history, and commits — selected by `operation`, plus a prompt section telling it when each applies. Merging the four operations into one tool roughly halves the prompt footprint versus four separate tool definitions.

### Token effect

Tool outputs are the git command text (diff/log lines), bounded by `maxCount` for log; a `--stat` summary option keeps large diffs cheap to preview.

### KV Cache effect

None beyond the normal tool-result append.

## Known Limitations and Deferred Work

- No `show` / `branch` / `revert` operations — extend alongside the seam as needs arise.
- `commit` stages everything (`add -A`); a paths-scoped commit is a future option.
- The tool assumes a git repository at the resolved cwd; `NOT_A_REPOSITORY` surfaces as an error tool result with guidance.
