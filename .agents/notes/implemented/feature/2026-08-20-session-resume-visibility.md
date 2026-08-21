# Agent Note: Session-resume visibility chain

Status: implemented

English | [中文](2026-08-20-session-resume-visibility.zh.md)

## Problem

Session resume had no user-facing signals: cold start silently created a session, resume replay was silent, crash repair synthesized closers into the model context with no notice, and there was no CLI way to address a session by id. Every step of the discovery → select → resume → result chain was invisible.

## Decision

The TUI and CLI now surface the whole chain (roadmap docs/dsh-session-resume-roadmap.zh.md, phases 1–3):

- Cold start renders a numbered restorable-session list (title · age · cwd) in the welcome card; digits 1–9 resume the numbered session while the welcome phase is active. The phase starts after the list renders and ends on the first typed character, a session switch, or a submit, so digit routing never steals typing afterwards. The cold-start default (new vs auto-resume) stays new — the roadmap's decision point is deferred; the list only adds visibility.
- Resuming mounts a banner (title · last activity · cwd) and a `上次进行到此处` separator after the replayed history. Fresh sessions render neither.
- The crash-repair notice keys off the durable `turn/end { reason: { kind: 'interrupted' } }` marker: repair.ts is its only producer, the loop never emits it, and the closers always append at the log tail, so only the **last** turn/end is consulted — once the user completes later turns (a non-interrupted tail) the notice no longer shows, and the permanently logged marker never misreports later resumes as interrupted. No new session event, no persistence/loop write-path change.
- `dsh tui --session <id>` and `dsh run --session <id> "task"` resume a named session (TUI via cmdlineArgs forwarding, headless via the resume factory). Unknown ids fail loud with recovery guidance; headless never silently falls back to create.
- `/resume [id]` shares the listSessions source with Ctrl+S and the welcome list. The session picker rows use the restorable-session summary line instead of raw UUIDs. The chrome session-tab row (short-id tabs fed by every persisted session, made always-visible by 2.3) was removed after product review: it crowded the interface with meaningless hex, and title-bearing switch surfaces (/resume, Ctrl+S, welcome list) cover it; Ctrl+X and Alt+digit tab jumping went with it, while mounted side conversations still surface in the live-region session line (renderSessionTabs, ≥2 mounted sessions).
- Corrupt JSONL artifacts (empty or unparseable header line) stay listed as `version: -1` placeholder headers with the id recovered from the directory name; list/picker/welcome mark them 不可恢复 and loadHistory propagates load failures instead of returning an empty log. Zstd header-frame corruption stays loud (unchanged). A placeholder always defers to a valid same-id artifact regardless of iteration order (placeholders are collected separately and never poison duplicate detection). Selecting a corrupt row fails a pre-check **before any switch state is committed** with a "会话工件损坏" echo — the app never half-switches, and every key path (digits/Ctrl+S/Alt+digit/Ctrl+X/picker) shares one failure echo; auto-selecting paths (Ctrl+S, /resume without arguments, the tab row) skip corrupt rows while list/picker/welcome keep them visible.
- Version-mismatch errors carry actionable guidance (upgrade or a separate session root).
- The random welcome tip pool includes the resume tip only when restorable sessions exist and the first-screen list is hidden; the Ctrl+S tip row drops its age summary while the list is visible.
- Interrupted assistant messages render a `⚠ 输出被中断` badge; orphan `TOOL_NOT_STARTED` tool results (repair closers without a recorded tool/call) render a `未开始执行` card instead of being dropped.
- The config-driven restore path logs an info line when a fixed sessionId has no artifact and degrades to a fresh session, distinguishing 已新建 from 已恢复 (which surfaces via agent/session-start source=resume).

Copy decisions: the roadmap asked new recovery copy to be bilingual; the repo's i18n pairing contract governs documentation, while the TUI's established convention is a single Chinese UI language (only USAGE_TEXT is inline bilingual). New copy follows the TUI convention; every doc updated by this work is a verified bilingual pair.

## Alternatives considered

- **A new session event for the crash-repair signal** versus the shipped durable `turn/end { kind: 'interrupted' }` marker. A new event adds vocabulary, emission machinery in the persistence load path, and an architecture-doc sync surface for a fact the log already carries; repair.ts is the marker's only producer and the type doc pins that, so the trailing marker is the same signal with zero write-path change.
- **A public session-id or title segment in the top bar** versus the shipped chrome session-tab row (later removed). The tab row listed every persisted session as short ids — noise the top-bar segment would only shrink, not fix; switching surfaces with titles (/resume, Ctrl+S, welcome list) answer the same question, so the row was removed outright (product review) rather than relocated.
- **Making the cold-start default resume-the-newest** versus the shipped keep-new default. The roadmap deferred that product decision; the numbered list adds visibility without changing default behavior, keeping the change reversible when the decision lands.

## Consequences

Bought: every step of the discovery → select → resume → result chain has a visible signal (numbered cold-start list, resume banner, history-end separator, crash notice, corrupt-row annotations, version-error guidance); failures never leave a half-switched app; the trailing-marker semantics keep later resumes free of stale crash notices.

Cost: TUI copy stays single-language Chinese by the repo's TUI convention (only USAGE_TEXT is inline bilingual), so the new surfaces are not localized with the doc corpus; corrupt artifacts stay listed as unrecoverable rows rather than being cleaned (visibility over hygiene, by design); the cold-start default remains new-session — users with history must act to resume.

## Verification

- Pure projections: formatRestorablePickerList, corrupt-row formatting, wasCrashRepaired (trailing-marker semantics), interrupted transcript rows, orphan tool rows (restore-session / transcript / render specs).
- App-level: welcome list + digit routing + phase exit, banner/divider/crash notice on resume, --session attach (known/unknown/corrupt id), picker summary rows, tab-row removal regression (no short-id tabs, Ctrl+X/Alt+digit back to the input line), tips dynamics, switch-failure safety (corrupt row and rejected resume commit no half-switched state; Ctrl+S skips corrupt rows) (app.spec).
- Backend: JSONL list keeps corrupt artifacts as version -1 with decoded ids (including order-independent deferral to same-id valid artifacts and placeholder dedup); coordinator version error carries guidance (jsonl.spec / coordinator-contract).
- CLI: run/tui --session parsing and forwarding (args.spec), headless resume factory + unknown-id guidance (headless.spec).
- agent-loop: config-driven degradation logs the signal (config-session-id.spec).
