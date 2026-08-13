# Agent Note: MeridianDB codebase-index port (Wave 5: dsh-meridian + dsh-tool-meridian)

Status: implemented

English | [中文](2026-08-12-meridiandb-codebase-index-wave5.zh.md)

## Problem

dsh has no structural codebase awareness: the agent finds symbols and call relationships by blind grep/glob, and files it has read accumulate no structural knowledge. In 天枢 (opencode-tui), MeridianDB stores the tree-sitter-parsed symbol graph in SQLite (files/symbols/edges/module_summaries plus behavior tables), consumed by repo_graph (graph/impact/flow) — "assess blast radius before editing, confirm which tests to run after editing". Port constraints: dsh is a pure-ESM plugin architecture, and the better-sqlite3 native dependency conflicts with the "zero native build chain" convention; the 天枢 ecosystem tables (physarum/immune/mistake/p3/sensorimotor/cli_entries) have no dsh consumers.

## Decision

### S1 Package split (two packages, following the Wave 2 semantic-index convention)
- `packages/search/meridian/` (`@deepseek-ai/dsh-meridian`): core library, zero cordis runtime dependency (peer only). db (node:sqlite) / parser (web-tree-sitter) / framework (regex extraction) / indexer / graph / impact / behavior / backfill.
- `packages/search/tool-meridian/` (`@deepseek-ai/dsh-tool-meridian`): repo_graph tool (graph/impact/flow) + `<codebase-index>` summary injection (dynamic zone order 120).

### S2 SQLite adaptation (better-sqlite3 → node:sqlite DatabaseSync)
- `db.pragma()`/`db.transaction()` are better-sqlite3-specific — pragma reads/writes go through `prepare('PRAGMA user_version').get()`/`exec('PRAGMA ...')`; transactions are wrapped locally in `withTransaction` (BEGIN/COMMIT/ROLLBACK + rollback on exception).
- `SCHEMA_VERSION = 1` (user_version validation: 0 + no objects → initialize; 0 + objects present / non-current → reject — same precedent as dsh sessions).
- The 天枢 `native-resolver.js` null-db fallback is removed — engines ^22.19||>=24 guarantees node:sqlite availability, and it fails loud.

### S3 Schema trimming (12 tables → 6 tables)
Keep files/symbols/edges/module_summaries/access_log/co_edits (the latter two are the co-edit/access heat dependencies of MeridianBehavior). Trim physarum×2/immune_memory/mistake_entries/p3_state/sensorimotor_log/cli_entries — 天枢 agent-ecosystem coupling with no dsh consumers; `<codebase-index>` therefore outputs only statistics + the Modules table (no CLI section).

### S4 Behavior-signal wiring (dsh-pheromone)
MeridianBehavior's StigmergyStore parameter plugs directly into `@deepseek-ai/dsh-pheromone` (query() shape matches `{path, currentStrength}[]`, zero adapter layer). **Pheromone wiring deferred**: StigmergyStore is a pure library (instantiated by tool-file-info itself), and tool-meridian's first batch does not instantiate it (co-edit/access heat still work; pheromone boost is 0).

### S5 Injection discipline (dynamic zone, not frozen zone)
The `<codebase-index>` summary (≤2000 characters) is injected via `ctx.systemPrompt.context({ order: 120 })` — the same mechanism as tool-semantic-search's semantic:index; unchanged content diffs are not re-injected, keeping the prefix-cache bytes stable (Wave 4 discipline). The original plan's "frozen zone" was corrected by research (天枢 actually uses the volatile dynamic zone).

### S6 Backfill gating parameterized
天枢 env gating (RIVET_MERIDIAN_BACKFILL*) → Config fields (backfillOnDemand/backfillMaxFiles/backfillOnStart) — "deployment changes are Config" discipline; the core library's backfill accepts only options.allowed/maxFiles.

### S7 Lint adaptation (ported code × dsh discipline)
13 non-null assertions (no-non-null-assertion) and duplicated branches (sonarjs no-all-duplicated-branches) in the 天枢 code need rewriting: regex capture groups `m[1]!` → `m[1] ?? ''`; `matches[0]!` → guarded local variable; the Python import_from if/else identical branches → a single statement. Behavior-equivalent rewrites.

## Files

- `packages/search/meridian/`: package.json/tsconfig.json + src/{types,db,parser,framework,indexer,graph,impact,behavior,backfill,invariant,index}.ts + tests/{db,parser,framework,graph,indexer,backfill}.spec.ts (44 cases)
- `packages/search/tool-meridian/`: package.json/tsconfig.json + src/{index,summary,invariant}.ts + tests/tool.spec.ts (6 cases)
- `tsconfig.base.json`: 4 explicit search-group paths (wildcard does not include search/)
- `tsconfig.host.json`: registers meridian + tool-meridian references

## Verification

- Package tests: meridian 44/44 + tool-meridian 6/6 (db.spec table creation/needsParse/GLOB escaping, parser three languages, indexer incremental/revival/boundaries, graph/impact ordering and reverse BFS, backfill enumeration/gating/idempotence)
- typecheck: `tsc -b packages/search/meridian packages/search/tool-meridian` exit 0; lint (oxlint staged 48 rules) 0 errors
- Smoke (real repository): test-huiliyi37 itself backfilled 200 files in 17.4s, indexing 454 files/15638 symbols; repo_graph graph query returns relevant file rankings, impact identifies direct 12/transitive 229/should-run tests (including meridian's own spec)
- Commits: 2c954b0 (skeleton+DB) / d744dfd (parser+framework) / f03d623 (indexer family) / c5f4253 (tool package)

## Alternatives considered

**better-sqlite3 native adaptation (same as 天枢)** — rejected: dsh convention is zero native build chain; node:sqlite DatabaseSync's synchronous API shape is compatible (prepare/get/run/all), and the adaptation cost is only pragma/transaction wrapping.

**repo_map tool port** — rejected (research disproved it): 天枢's repo_map is a pure readdir/stat file tree (`src/tools/repo-map.ts`) with no MeridianDB dependency, outside this Wave's scope.

**read_file lazy-build hook** — deferred: touching tool-fs/read.ts is a cross-package change; on-demand backfill (triggered by the first repo_graph call) covers the first-query experience. If the smoke test shows the experience is unacceptable, add the hook in a second batch.

**tree-sitter language expansion** — ts/py/go in the first batch; `tree-sitter-wasms@0.1.13` actually ships 36 wasm files (including rust etc.; the 天枢 comment "only 3" is outdated), the "add when available" expansion gate is already satisfied, and later languages register in parser.ts LANG_WASM/EXT_TO_LANG.

## Consequences

- Incremental semantics: if file content is unchanged, cross-file edges are not recomputed (needsParse false skips) — after a new same-name symbol is added, old edges stay inferred until the file is re-parsed (same behavior as 天枢).
- With an empty index, graph mode returns the seed file with score 1.0 (stats 0) instead of an error — same behavior as 天枢, and the agent sees the "index: 0 files" signal.
- pheromone boost not wired (see S4); the stale marker (git head sha comparison) deferred; module_summaries has no producer yet (the codebase-index Modules part awaits a later backfill enhancement or explicit backfill).
