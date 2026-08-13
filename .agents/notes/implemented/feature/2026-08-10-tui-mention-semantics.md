# Agent Note: TUI @mention expansion semantics (Phase 9a)

Status: implemented

English | [中文](2026-08-10-tui-mention-semantics.zh.md)

## Problem

The TUI roadmap (Phase 9a) describes `@filename` as "expand the file into a content summary in the user message". The Tianshu port source `.rivet/tui-source/tui/mention-parser.ts` (51 lines) instead implements **agent context injection**: `@file` → `MentionReference` → `renderMentionContext` renders a `<mentions>` XML block ("Resolve these @mentions before proceeding") that is injected into agent context for the agent to resolve itself. The two semantics differ, so the implementation direction was unresolved and a decision was required before coding.

## Decision

Adopt the roadmap's original user-side semantics: `@filename` expands into a truncated content summary displayed in the user message, **not** agent context injection.

## Alternatives considered

**Tianshu mentions injection (agent context)** — rejected. It crosses the TUI plugin boundary into agent context assembly (system-prompt/assemble wiring), and anything model-visible must be logged as a session event (AGENTS.md: Model-visible ⟺ logged), which is out of scope for Phase 9a.

**User-side summary expansion** — adopted. Stays inside the TUI plugin (dsh-tui-next-phase.md architecture constraint), never touches model input, and carries no session-log obligation.

## Consequences

- Parsing is a pure function over `@`-prefixed relative/absolute path tokens (no IO).
- Reads are bounded to workspace (`cwd`) files; directories / missing / out-of-scope paths degrade to plain reference-name display.
- Summaries truncate (first 20 lines / 4 KB) with a collapse marker to avoid polluting the input box.
- File reads validate existence and size at the file boundary (AGENTS.md boundary validation discipline).
- Future agent-context mention injection, if ever wanted, becomes its own item with the required session events.
