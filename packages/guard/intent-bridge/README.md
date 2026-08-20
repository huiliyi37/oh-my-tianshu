# @huiliyi37/dsh-intent-bridge

English | [中文](README.zh.md)

The intent bridge splits a fresh session's first message into two roles. A low-cost ALIGNMENT model (configurable route) runs a multi-round clarification conversation with the user in a dedicated alignment session — ordinary turns, no hang machinery; when the intent is clear it calls `finalize_alignment`, and the bridge hands the structured task card to a FRESH main session. The main session never inherits the alignment context: it receives only the card, which is multi-line and long, so task-card stays idempotent (no rewrite) and zen's triage does not skip it — the main session naturally arms the zen phase and anchors before unlocking the full face.

The alignment session is seeded with a completed `zen/phase` pair so zen never arms it; its tool face is restricted to `finalize_alignment` alone (agent-scoped registration bypasses the restrict allow list); a deterministic `session/title` names the tab; the `intent:policy` system-prompt section renders the alignment contract only while an alignment session is live.

Decision record: [the intent-bridge Agent Note](../../../.agents/notes/implemented/architecture/2026-08-18-intent-bridge.md).

## Config

```yaml
- id: intent-bridge
  name: '@huiliyi37/dsh-intent-bridge'
  config:
    enabled: true                    # default; false mounts the service with no behavior (routes still required)
    alignProvider: deepseek-official # REQUIRED alignment-agent route
    alignModel: deepseek-v4-flash
    execProvider: deepseek-official  # REQUIRED main-session route
    execModel: deepseek-v4-flash
    alignMaxRounds: 5                # default; steps before a template card is force-finalized
    # section: custom alignment contract text (optional; default = the built-in contract)
```

`resolveConfig` fails loud at plugin load on unknown keys, a missing provider/model pair, or a non-positive `alignMaxRounds`. The shipped TUI bundle mounts the plugin with the routes above (the out-of-box DeepSeek adapter, same `DEEPSEEK_API_KEY` as `/model`); deployments override them from `cordis.patch.yml`. A MiniMax alignment route is an overlay after the `llm-pi-ai` profile and its key are live — not a second required key on first run.

Decision record for that default: [shipped TUI align route](../../../.agents/notes/implemented/architecture/2026-08-19-intent-bridge-shipped-align-flash.md).

## createAlignedSession

`ctx.intentBridge.createAlignedSession(options)` creates the alignment session and returns its id plus the owned `AgentHandle`. Both options are caller-owned: `cwd` lands the alignment session AND the main session it hands off to in a real project directory (omitted → both persist under `_no-cwd/` and vanish from the Web session list); `exec` overrides the main-session route for this alignment's handoff (omitted → the config exec route) and may carry `reasoningEffort` — the TUI passes its current `/model` selection and `/effort` so the main session follows both. An omitted `reasoningEffort` leaves the adapter default; the alignment session does not inherit it.

## Handoff

`finalize_alignment` validates its arguments at the tool boundary (non-empty `title`/`goal`, at most 4 constraints and acceptance entries; malformed calls are rejected back to the model), renders the card with the verbatim original under the marker, creates the fresh main session, feeds it the card as its first user message, records a log-only `intent-bridge/handoff` event on the main session's log, and emits the `intent-bridge/handoff` dispatch event — UIs observe the dispatch and switch sessions.

## Failure paths

Neither path blocks the task. When the alignment rounds are exhausted, the bridge force-finalizes a template card and rejects the step so the alignment model never runs past the budget. When the alignment agent errors, the verbatim original flows straight to the main session and task-card's single-shot rewrite is the fallback.

## Invariants

`@huiliyi37/dsh-intent-bridge/invariant` validates the handoff from the authoritative session log: at most one `intent-bridge/handoff` record per session carrying a non-empty `alignSessionId` and a known reason (`anchor` | `rounds-exhausted` | `alignment-error`), and a carded first user message after a handoff keeps a non-empty verbatim original under the marker.

## Model Experience

### Alignment-session first request

#### What the model sees

The alignment agent's requests carry the fixed `intent:policy` contract section and exactly one tool, `finalize_alignment`; the restrict allow list is emptied, so no global tool is visible. The contract tells it to restate, classify, clarify (1-3 questions per round), and finalize — never to perform the task.

#### Token effect

The fixed contract section (about a thousand characters) rides every alignment request; clarification turns are ordinary short exchanges, bounded in steps by `alignMaxRounds` (default 5).

#### KV Cache effect

The section bytes are identical across every alignment round, so the alignment session's prefix stays cache-stable; the section stops rendering once the alignment session is gone.

### finalize_alignment call and result

#### What the model sees

One tool whose arguments are `title`, `goal`, and optional `constraints`/`acceptance` lists (at most 4 entries each); a malformed call is rejected back to the model with a contract-shaped error. Acceptance renders `Alignment accepted — the task card was handed to the main session.`

#### Token effect

One small call/result pair per alignment; a rejected malformed call adds one error turn.

#### KV Cache effect

Append-only.

### Main-session first request

#### What the model sees

The main session's first user message is the rendered task card with the verbatim original under the marker; its prompt carries no alignment content — zen arms and the anchored face applies as on any fresh top-level session.

#### Token effect

The card replaces the user's raw first message (title, goal, optional lists, preserved original) — typically a few hundred tokens.

#### KV Cache effect

The card is in place before the main session's first request, so the prefix never churns mid-session.

## Known Limitations and Deferred Work

- **The round meter counts agent steps, not user turns** — with a single-tool face the two coincide in practice; a multi-step alignment turn would consume budget faster.
- **A bridged main session cannot hot-switch its model** — the exec route is a snapshot taken when the alignment session is created; the registry-owned agent does not take the TUI's model ref.
- **A failed handoff closes the alignment session to retries** — `finalize` marks the session finalized before creating the main session, so a failed create leaves no retry path (recovery: a new session).
- **The alignment tab survives the handoff** — it stays in the tab list as a plain chat; automatic disposal is deferred.
