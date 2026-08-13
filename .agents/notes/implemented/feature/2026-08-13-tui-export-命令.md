# Agent Note: T3 /export session-export command

Status: implemented

English | [中文](2026-08-13-tui-export-命令.zh.md)

- **Date**: 2026-08-13
- **Scope**: TUI command layer (`packages/tui/tui`) + docs

## Problem

C6 gap-matrix batch three, T3: Claude Code has `/export`, grok has `export_cmd.rs` (a three-field `ExportArgs`), DSH had no session-export surface — users could not export the current session transcript as Markdown for sharing/archiving/review/feeding another model. Low cost, high visibility (the renderer is a pure function and the event source already exists).

## Decision

**Add only the TUI command layer — no session/agent-layer changes, no invented event types**: the export reads `session.events` (the authoritative event stream) and renders forward — **not reusing `scrollback-transcript.ts`** (that is reverse parsing: rendered lines → message units for search; only forward rendering exports complete content with no fold truncation and full tool results).

- `format/export.ts` (new, pure function, Cordis-free): `renderSessionExport(events, meta)` → Markdown. Three message-event kinds — user/assistant/tool-result; assistant splits into text + reasoning (`> reasoning` quote) + tool-call lines; over-long tool results truncate at 5000 characters with a trailing `…+N chars`; an empty session renders `(no messages)`. Deterministic: identical input always yields identical output (snapshot-testable).
- `registry.ts`: `BuiltinCommandDeps.exportTranscript(path?)` (returns the export path) + the `/export [path]` command + `BUILTIN_COMMAND_NAMES` registration.
- `ui/app.ts` `exportTranscript`: `ctx.sessions.get(activeSessionId)` fetches the current session; the default path = `join(header.cwd ?? process.cwd(), 'dsh-export-<id>.md')`; no session / missing session / write failure all throw (fails loud; the command layer echoes the failure).
- Non-goals: `/copy` (clipboard export; depends on a clipboard ingestion surface, queued as follow-up); remote sharing/upload.

## Consequences

**Commit**: this batch (`registry.ts` + `app.ts` + `format/export.ts` + three specs + bilingual README + the C6 matrix).

**Verification**: `export.spec` 7/7 (including truncation/determinism/empty session), `commands.spec` 111/111 (/export bare, with path, name table), `app.spec` wiring case exercises the full chain over the real filesystem (command → deps → renderSessionExport → writeFile → echo, `vi.waitFor` polling the write); TUI tsc exit 0. Full app.spec 180/182 — the 2 failures come from parallel-session external changes (`str_replace approval diff` assertion mismatching the new permission-diff `renderFileDiff` format; a long-idle `stale` timeout), zero intersection with this batch's diff, non-blocking.

**Pitfalls recorded**:
- The `tool/result` event data carries `message: ToolResultMessage` (`core/session/types.ts` is the authoritative shape) whose content is a `[ToolResultBlock]` tuple — fixtures must construct via `createToolResultMessage` (`createMessage` flattening text blocks goes falsely green: the renderer extracts no text)
- The `user/message` data is the UserMessage directly (not a `{message}` wrapper) — asymmetric with assistant/message, easy to get wrong
- exactOptionalPropertyTypes: `{ cwd: string | undefined }` is incompatible with `cwd?: string` — conditional spread `...(cwd !== undefined ? { cwd } : {})` is the correct shape
- The app.spec wiring test cannot rely on a single `setImmediate` round for real IO — `vi.waitFor` polls the file write and the on-screen echo

**Follow-ups**: `/copy` clipboard export (depends on a clipboard ingestion surface); T5 full-screen viewer.

## Alternatives considered

- **Reuse `scrollback-transcript.ts` for export** — rejected: that module reverse-parses rendered lines into message units for search; folds truncate content. Only forward rendering from `session.events` exports complete text and full tool results.
- **Invent a dedicated export event type or a session-layer export API** — rejected: reading the authoritative `session.events` stream suffices; no new vocabulary needed.
- **`/copy` clipboard export in the same batch** — deferred: it depends on a clipboard ingestion surface that does not exist yet; queued as a follow-up.
