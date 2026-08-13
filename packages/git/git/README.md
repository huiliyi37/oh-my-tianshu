# @huiliyi37/dsh-git

English | [中文](README.zh.md)

The **git capability seam**: the `Git` service definition plus the `GitLocal` CLI provider in one package. `GitLocal` spawns the `git` binary (`execFile`, abort-signal passthrough) and maps failures to typed `GitError` (`NOT_A_REPOSITORY` / `EXEC_FAILED`); the definition+implementation are bundled because the git CLI is a thin, stable wrapper whose provider role does not evolve independently (the fs family splits three packages because its local/sandbox providers do).

## Config

```yaml
- id: git
  name: '@huiliyi37/dsh-git'
  config:
    gitBin: git   # optional; git executable (default `git`; tests inject a stub)
```

`GitLocal` registers `ctx.git` via the Cordis `Service` machinery (plugin it with `ctx.plugin(GitLocal)`).

## API

All methods take an explicit `cwd` (the caller — e.g. `dsh-tool-git` — resolves it from the session header; the service never guesses) and an optional `AbortSignal` for cancellation:

| Method | git command | Returns |
|---|---|---|
| `status(cwd, { untracked? })` | `status --porcelain=v1 --branch` | `{ branch, dirty }` |
| `diff(cwd, { paths?, stat? })` | `diff [--stat] [-- <paths>]` | `{ diff }` |
| `log(cwd, { maxCount?, paths? })` | `log --oneline -n N [-- <paths>]` | `{ commits: [{ hash, subject }] }` |
| `commit(cwd, { message })` | `add -A` + `commit -m` | `{ hash, summary }` |

Errors are typed: `GitError` with `code: 'NOT_A_REPOSITORY' | 'EXEC_FAILED'`. The non-repository detection matches both English and localized git stderr (observed: git 2.50 on a Chinese system reports 「不是 git 仓库」).

## Model Experience

Indirectly, through the `git` tool in `dsh-tool-git`; the seam itself registers no prompt or schema.

#### KV Cache effect

None (the seam is not model-facing; tool-result rendering belongs to `dsh-tool-git`).

## Known Limitations and Deferred Work

- Read-only guarantee is not enforced: `commit` mutates the repository (that is its purpose); `status`/`diff`/`log` never write.
- No `git show` / `git branch` / `git revert` yet — the first batch is status/diff/log/commit; extend the seam as tools need them.
- The error map covers the common not-a-repository failure; other git failures surface as `EXEC_FAILED` with the stderr attached.
