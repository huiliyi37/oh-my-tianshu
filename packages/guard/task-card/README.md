# @huiliyi37/dsh-task-card

English | [中文](README.zh.md)

The task card rewrites a session's FIRST user message into a structured task card before it reaches the model: a `# title`, `## 目标` (goal), optional `## 约束` (constraints) and `## 验收` (acceptance), and the verbatim original under `—— 原始请求 ——`. Clearer semantics for the model, clearer task framing for the user — and because a card is multi-line and long, a rewritten first message is never mistaken for a trivial prompt by the zen phase's triage (the rewrite itself is decided after triage, so the two compose orthogonally).

Generation ladder (never blocks the first step): **LLM** (one bounded call, explicit route, short deadline, zero retries) → **semantic template** (pure function, always succeeds) → **untouched** (messages that fail the trigger conditions pass through as-is). The verbatim original is kept under the marker in every mode: the session log holds only the rewritten message, and the original section is what keeps the user's exact input reconstructable.

Decision record: [the task-card Agent Note](../../../.agents/notes/implemented/architecture/2026-08-18-task-card-first-message.md).

## Config

```yaml
- id: task-card
  name: '@huiliyi37/dsh-task-card'
  config:
    enabled: true                # default; false mounts the service with no behavior
    mode: llm                    # default; llm = one model call with template fallback, template = zero-cost template only
    provider: deepseek           # REQUIRED when mode: llm (the first message has no assistant message to derive a route from)
    model: deepseek-chat
    timeoutMs: 5000              # default; card-generation deadline before the template fallback
    maxInputChars: 4000          # default; longer first messages are left untouched
    maxOutputTokens: 300         # default; card-generation output budget
```

`resolveConfig` fails loud at plugin load on unknown keys, a bad `mode`, non-positive budgets, or a `mode: 'llm'` without a provider/model pair. The rewrite is installed at `agent/pre-step` — the one waterfall whose return value is honored — so the rewritten message is what the model sees AND what lands in the session log (`model-visible ⟺ logged` closes for free).

## Trigger conditions (all must hold)

- The first message of `decision.messages` is a user message (`source.kind === 'user'`).
- The session is a top-level one (`header.parentSession` unset) — subagent dispatch prompts are already anchored.
- The message text is non-empty, has no card marker yet (idempotence), and is not longer than `maxInputChars`.
- The session log holds no `user/message` yet — the rewrite is first-message-only, so resume/fork sessions are never re-rewritten.

## The card shape

```markdown
# {one-line title}

## 目标
{1-2 sentences restating the goal}

## 约束
- {constraint}      (omitted when none)

## 验收
- {verifiable criterion}   (omitted when none)

—— 原始请求 ——
{the user's verbatim original}
```

The LLM contract (fixed `system` prompt in `src/llm.ts`) forbids inventing constraints or acceptance criteria the message does not support — omit the section instead. The parser (`parseLlmCard`) validates the shape at the model boundary: a missing title or goal falls back to the template, never ships a broken card.

## Invariants

`@huiliyi37/dsh-task-card/invariant` validates the owned relationship from the authoritative session log: a carded message keeps a non-empty verbatim original, keeps `source.kind === 'user'`, and is the first user message of its session (which also makes a second carded message impossible).

## Model Experience

### Card-generation call (LLM mode)

#### What the model sees

One bounded auxiliary model call carrying the fixed card-generation contract as its system prompt and the user's first message (up to `maxInputChars`) as input; zero retries under a `timeoutMs` deadline.

#### Token effect

One call per session with output capped at `maxOutputTokens` (default 300); template mode makes no call at all.

#### KV Cache effect

A separate short-lived request; nothing from it enters the session prefix.

### Rewritten first message

#### What the model sees

The session's first user message becomes the card: `# title`, `## 目标`, optional `## 约束` and `## 验收`, and the verbatim original under `—— 原始请求 ——`.

#### Token effect

The card replaces the raw first message in place; growth is the card scaffolding (headings and list markers) on top of the preserved original.

#### KV Cache effect

The rewrite lands at `agent/pre-step` before the session's first request, so the card is part of the prefix from request one — no mid-conversation churn.

## Known Limitations and Deferred Work

- **No re-entry** — only the first message is rewritten; mid-session "new task" reframing is out of scope.
- **Template mode does not add semantics** — it structures the message (title + goal) but does not infer constraints or acceptance; that is the LLM mode's job.
- **No UI card surface** — the TUI transcript shows the rewritten message as a plain user message; a dedicated card render is deferred.
- **Subagents never rewrite** — their dispatch prompt is already the anchor.
