# Agent Note: tool-JSON-in-content repair plugin

Status: implemented

English | [中文](2026-08-19-tool-json-repair.zh.md)

## Problem

DeepSeek intermittently serializes tool calls as JSON text inside `content` instead of the `tool_calls` wire field (the failure shape opencode-tui repairs with its `RepairPipeline`). omts's `dsh-llm-deepseek` translates only well-formed wire `tool_calls`, so a JSON-in-content response lands as a plain text message: the loop executes nothing and the model burns turns re-emitting the call. The `dsh-tui` gap analysis ([opencode-tui vs omts](../../../../docs/opencode-tui-vs-omts-能力差距与吸收路线.md)) classes this as the highest-value absorbable item from the 天枢 source.

## Decision

[`packages/llm/tool-json-repair`](../../../../packages/llm/tool-json-repair/README.md) is a standalone plugin that wraps the `llm/stream` waterfall. A text block that is EXACTLY one JSON object with a clean non-empty string `name` re-emits as a `tool-call` block-start/delta/end with the source block's index; everything else passes through byte-identically. The conversion is fail-closed: prose, truncated JSON, arrays, multi-object blocks, padded names, and blocks after a proper tool-call block stay text. The call id is deterministic (`repair-<index>-<hash12>` of name + arguments) so replay and snapshots are stable. The invalid-JSON-escape repair inside the parse is ported from opencode-tui `src/api/json-escape-repair.ts` (Apache-2.0, provenance comment in [`detect.ts`](../../../../packages/llm/tool-json-repair/src/detect.ts)) — it recovers Windows-path backslashes before parsing.

The plugin needs no loop change: the loop already logs whatever the `llm/stream` waterfall delivers as `assistant/chunk` and assembles `assistant/message` from it, so the repaired stream is the durable one (model-visible ⟺ logged holds with no new event type), and the existing `agent/pre-tool-commit` validation re-checks the repaired arguments against the tool's parameter schema. The `dsh-llm` invariant validates the transformed stream's protocol wherever the invariant companion is mounted. Config: `enabled` (default true), `maxBlockChars` (default 65536, fails loud below 1), `allowFenced` (default true). The plugin is wired into `dsh-base` (`packages/bundle/base/cordis.patch.yml`), so every product profile gets the repair.

## Alternatives considered

**Port opencode-tui's `RepairPipeline` with pluggable passes.** Rejected: the pipeline repairs already-parsed calls (null-to-omit, array coercion, auto-link cleanup) and lives inside opencode-tui's CVM; omts's failure surface is the JSON-in-content extraction itself, which this plugin covers with one conservative rule. Additional argument-repair passes remain additive plugin work if a live provider proves the need.

**Repair inside `dsh-llm-deepseek`'s translate step.** Rejected: bakes a repair policy into one adapter's wire contract, with no way to disable it per deployment without adapter config creep, and no coverage for any other provider that exhibits the same shape.

**Convert at `agent/pre-tool-commit`.** Rejected: that waterfall may only rewrite `arguments` of already-present calls (call set and identities must match), so it cannot materialize a call from text.

**Do nothing and rely on the model to recover.** Rejected: the failure burns turns and tokens; opencode-tui treats the repair as always-on, and the fail-closed detector has no false-positive surface on ordinary prose.

## Consequences

- A JSON-in-content response now executes the intended call; the wire text of the original response is not retained (the repaired stream is the log), so forensic diffing against the raw provider payload is unavailable.
- Conversion is skipped once any proper tool-call block has opened in the stream — a mixed response keeps its text and runs only its wire-level calls.
- `enabled: false` registers nothing, so a deployment that distrusts the repair pays exactly the plugin load.
- The 天枢 probe prerequisite was satisfied keylessly: the failure shape is exercised by the deterministic snapshot backend and the assembled-loop mock adapter instead of a live API probe (no `DEEPSEEK_API_KEY` in this environment; the real-API tier is left to CI with keys).

## Testing

- `packages/llm/tool-json-repair/tests/tool-json-repair.spec.ts` — detection matrix (fence, escape repair, prose/truncated/multi-object/padded-name rejection, char cap), stream transformation through the real `llm/stream` waterfall with the `dsh-llm` invariant live, deterministic id stability, and two assembled agent-loop turns (repair executes the call and logs the repaired stream; `enabled: false` leaves text).
- `examples/headless-agent/tests/headless.snapshot.ts` — the `tool-json-repair` scenario boots the assembled one-shot app against a deterministic adapter streaming the bug shape; asserts the persisted log's `tool/call`/`tool/result` and snapshots the normalized stream-json transcript.

## Related

- [opencode-tui vs omts — capability gap and absorption roadmap](../../../../docs/opencode-tui-vs-omts-能力差距与吸收路线.md) — the analysis this implements.
- [dsh-tui fusion evolution record](../../../../docs/dsh-融合演进-迭代记录.md) — earlier 天枢 absorptions (render core, meridian, pheromone, fs-snapshot).
