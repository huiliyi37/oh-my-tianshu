# Agent Note: dsh meridian index uses dsh-meridian.db, not 天枢 meridian.db

Status: implemented

English | [中文](2026-08-17-meridian-dsh-db-filename.zh.md)

## Problem

`tool-meridian` injects a `<codebase-index>` dynamic context block that opens the indexer SQLite on every prompt render. `MeridianIndexer` stored that database as `<cwd>/.rivet/meridian.db`. Workspaces that also run 天枢 already have that file at schema 2 with the untrimmed ecosystem tables (`physarum_*`, `immune_memory`, `cli_entries`, …). This port keeps a six-table schema 1, so opening the shared file throws `meridian database has schema version 2, incompatible with this build (1)` and the thrown context contribution renders as a `✗` tool failure in the TUI. Deleting the file would repair dsh and break 天枢 on the next run.

## Decision

The dsh file is `dsh-meridian.db` in the same state directory (`MERIDIAN_DB_FILENAME`). Schema 1 and the six-table trim are unchanged. A same-directory 天枢 `meridian.db` is not opened. Version mismatch on `dsh-meridian.db` still fails loud on `repo_graph`. The `meridian:index` context callback swallows open failures and injects nothing for that turn, so an unusable derived index cannot fail the prompt.

## Alternatives considered

**Bump this build to schema 2 and open 天枢's file.** Rejected: schema 2 is the untrimmed 天枢 layout; this port dropped those tables and must not write them.

**Delete or rebuild `meridian.db` in place on mismatch.** Rejected: that destroys the 天枢 index in a shared workspace, after which 天枢 fails with schema 1 vs 2.

**Keep the shared filename and tell the operator to delete the file.** Rejected: the collision returns on the next 天枢 write, and the context contribution still fails every turn until then.

## Consequences

omts in a workspace that already has 天枢 `.rivet/meridian.db` creates `.rivet/dsh-meridian.db` and the `理解` turn no longer shows the schema `✗`. Tests pin coexistence with a schema-2 `meridian.db`, and the context callback not throwing in that layout.
