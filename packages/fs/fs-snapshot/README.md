# dsh-fs-snapshot

English | [中文](README.zh.md)

File snapshot/rewind: injects a pre-write snapshot hook into the `tools/execute` waterfall (ported from opencode-tui's `FileHistory`, Apache-2.0, see the header notice in `src/file-history.ts`). **Before** a write tool (`str_replace_editor` write commands / `write` / `edit`) executes, the hook takes a full-content snapshot of the target file for `/rewind`'s file rewind (code/both granularity).

Distinction from checkpoint-policy: a checkpoint persists the event log (so a crash cannot lose a turn), while this plugin snapshots file contents (for rewind's file rewind) — the two are orthogonal.

## Assembly

```yaml
# cordis.yml（examples/tui 是可运行样例）
- id: fs-snapshot
  name: '@huiliyi37/dsh-fs-snapshot'
```

Configuration (`Config`, schemastery-validated):

| Field | Semantics |
|---|---|
| `backupDir` | Snapshot root; defaults to `<os.tmpdir()>/dsh-fs-snapshot`, with backups landing at `<backupDir>/<sessionId>/<sha256(path)[:16]>@v<N>` |

Depends on the `tools` service (`inject: ['tools']`): without a tool registry, assembly fails loud instead of degrading silently.

## Consumer surface

- `HISTORIES_KEY` (`'fsSnapshot.histories'`) — the per-session `FileHistory` map, retrieved via `ctx.get`
- `getFileHistory(ctx, sessionId)` — fetches one session's snapshot index (returns `undefined` when no record exists)
- `FileHistory.rewindToBoundary(boundaryId)` — restores each file's earliest snapshot before the boundary (`backupFileName === null` means the file did not exist then → unlink)

Snapshots cap at 100 entries (`MAX_SNAPSHOTS`); overflow evicts the oldest and deletes its on-disk backup.

## Verification

```sh
pnpm vitest run packages/fs/fs-snapshot/tests/
```

## Model Experience

None, as the pre-write snapshot hook copies files aside and delegates to next() unchanged; it registers no model surface.

#### KV Cache effect

None; the hook adds no request content and touches no logged message.

## Known Limitations and Deferred Work

- **The write-tool allowlist is a closed set** — only `str_replace_editor` (write commands) / `write` / `edit` trigger snapshots; files written directly through bash get no backup, so rewind's file rewind cannot see such changes (the same blind spot as the dsh-evidence-gate edit gate).
- **The backup directory defaults to tmpdir** — OS tmp cleanup invalidates historical snapshots; rewind across restarts needs an explicitly configured persistent `backupDir`.
- **The snapshot index is in-memory** — the `HISTORIES_KEY` map vanishes with the process; after a restart the on-disk backups remain but the index is not rebuilt (a persisted index is deferred work).
