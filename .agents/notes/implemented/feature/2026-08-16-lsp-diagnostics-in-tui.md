# Agent Note: LSP diagnostics surfaced in the TUI tool cards and /lsp panel

Status: implemented

English | [中文](2026-08-16-lsp-diagnostics-in-tui.zh.md)

## Problem

The TUI is a pure presentation layer: it renders logged session events and registers no model-facing surface. The sibling repository `dsh-tui` (fetched as `dshtui/*` refs) had grown an LSP diagnostic stack — tool-card badges (`⚠ N错 M警`) plus a `/lsp` panel — that this repository lacked. The two repositories share no git ancestor and diverge in structure (`src/lsp/` here is `packages/tui/tui/src/lsp/`), so the feature had to be ported by semantics, not cherry-picked.

## Decision

`packages/tui/tui` (`@huiliyi37/dsh-tui`) now carries the LSP bridge as a display-only capability, ported from `dsh-tui` at `326adb7`:

- `src/lsp/` — `rpc.ts` (JSON-RPC over stdio), `manager.ts` (single-server client, pull-priority with `publishDiagnostics` cache), `multi-manager.ts` (per-extension lazy routing), `server-registry.ts` (typescript via `npx -y`; pyright/gopls/rust-analyzer/clangd/jdtls probed on PATH), `lsp-bridge.ts` (lazy lifecycle, per-file in-flight merge + 5s freshness cooldown, one-time unsupported marking, dispose invalidation). All five files depend only on `node:` builtins.
- `src/format/lsp-diagnostics.ts` — pure display functions (badge text, severity colors, file grouping, panel rows).
- `TuiApp` wiring — lazily creates the bridge on first file touch or `/lsp` open; `tool/call` argument paths (nested `tool_uses` recursive) trigger pulls; live tool-card title appends the badge; `/lsp` toggles the panel; dispose kills all servers.
- Data-source probing mirrors the vision-bridge pattern: a `provide('lsp')` service with a `getDiagnostics` shape is consumed directly; the official `ctx.lsp` seam (`@huiliyi37/dsh-lsp`) is adapted through its `query(getDiagnostics)` operation. The official seam currently exposes no `getDiagnostics` operation (its four operations are goToDefinition/findReferences/goToImplementation/hover), so an assembled official seam is detected but yields empty diagnostics until the operation lands upstream. The TUI bundle patch does not assemble any `lsp` service, so the built-in bridge (self-spawned servers) is the operative path today.
- Diagnostics never enter session events or any model-facing surface; the TUI remains a pure presentation layer.

Tests: `lsp-rpc.spec.ts` (frame codec/dispatch), `lsp-panel.spec.ts` (pure panel functions), `lsp-bridge.spec.ts` (fake-server integration, 16 cases), and black-box `app.spec.ts` cases (badge on card, panel empty state, unknown extension never spawns, companion-service path) — all injectable, never spawning real servers.

## Alternatives considered

**Cherry-pick the upstream commits.** Rejected: no shared merge base, and the upstream files carry `@deepseek-ai` imports and a laxer lint baseline (this repository's `strict` tsconfig and oxlint config required adaptation: `exactOptionalPropertyTypes` in the RPC notify path, `noUncheckedIndexedAccess` in the frame parser, `no-non-null-assertion`, `no-misused-promises` on the async mock, and `no-misused-spread` on class instances).

**Probe the official seam at runtime before selecting it.** Rejected: confirming `getDiagnostics` support would require issuing a query, which lazily spawns a server — violating the bridge's lazy-start contract. The upstream design (detect the seam, adapt, yield empty until the operation lands) is kept, and the empty-diagnostics consequence is documented in the README's Known Limitations.

**Port the companion `lsp/` package (dsh-tui-lsp) as well.** Rejected: it was extracted into its own repository upstream (`omdsh-dev/dsh-lsp`), and this repository already ships the official seam packages (`dsh-lsp` / `lsp-local` / `tool-lsp`); the TUI consumes either shape structurally without a package dependency.

## Consequences

The TUI gains a diagnostics view with no session-event or model-surface footprint: tool cards show a `⚠ N错 M警` badge once diagnostics are cached, and `/lsp` groups them by file with severity coloring. Language servers are spawned only for touched file extensions and killed on dispose; an uninstalled server is marked unsupported once and rendered as a panel empty state rather than repeated spawn attempts. Assembling the official `ctx.lsp` seam in the TUI profile today yields empty diagnostics (documented), and the seam's future `getDiagnostics` operation activates automatically. Porting also surfaced pre-existing lint findings (`term-caps.ts`, the `app.ts` `tailLines` line) that remain untouched.
