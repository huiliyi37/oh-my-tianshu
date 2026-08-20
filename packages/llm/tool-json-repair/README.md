# @huiliyi37/dsh-tool-json-repair

English | [中文](README.zh.md)

A repair plugin, not a model-facing tool and not an adapter: it never appears in the tool list and never touches the request. It wraps the `llm/stream` waterfall and converts one failure shape — a DeepSeek response that serializes its tool calls as JSON text inside `content` instead of the `tool_calls` wire field — into a real tool-call block, so the agent loop executes the call the model meant instead of swallowing it as prose. Detection is fail-closed: only a text block that is EXACTLY one JSON object with a clean non-empty string `name` converts; prose, truncated JSON, arrays, and multi-object blocks stay text. The ported invalid-escape repair from opencode-tui (`src/api/json-escape-repair.ts`, Apache-2.0) additionally recovers Windows-path backslashes inside the arguments object before parsing.

## Config

```yaml
- id: tool-json-repair
  name: '@huiliyi37/dsh-tool-json-repair'
  config:
    enabled: true        # default; false registers nothing
    maxBlockChars: 65536 # default; text blocks longer than this never convert
    allowFenced: true    # default; accept one ```json … ``` fence around the object
```

`maxBlockChars` fails loud at plugin load: anything but an integer >= 1 throws, never a silent fall-back.

## Conversion semantics

- **Whole-block, single-object only.** The trimmed block text (after one optional ```json fence) must parse as one plain object whose `name` is a non-empty string with no surrounding whitespace. The `arguments` field is optional and becomes `{}`; any other shape leaves the block untouched.
- **Escape repair before parse.** An invalid JSON escape inside a string literal is doubled (`F:\智慧项目` → `F:\\智慧项目`) so the arguments survive a model that wrote Windows paths unescaped; legitimate escapes pass through.
- **Skipped once a real tool call exists.** The stream wrapper stops converting once any proper `tool-call` block has opened, so a response that already carries wire-level tool calls keeps its text intact.
- **The repaired stream is the logged stream.** The loop records the transformed `assistant/chunk` events and the repaired `assistant/message` — model-visible ⟺ logged holds with no new event type. The converted block reuses the source block's index; its call id is deterministic (`repair-<index>-<hash12>` of name + arguments), so replaying the same stream yields the same durable log.
- **Schema validation still applies.** The repaired call runs through the loop's existing `agent/pre-tool-commit` validation: arguments that fail the tool's parameter schema are dropped with a warning, exactly like a model-issued call.

## Model Experience

### Repaired tool call

#### What the model sees

Nothing new in the system prompt or tool schemas. When a text block converts, the step proceeds exactly as if the model had emitted a wire-level tool call: the same tool execution, the same `tool/result` content, the same follow-up request.

#### Token effect

Zero when no block converts. A converted block shifts the same text out of message history (replaced by the executed call and its result), so the net context effect is the tool round-trip the model intended.

#### KV Cache effect

The prefix is untouched: the conversion happens inside stream processing, after the request is sent, so the cached prompt prefix for the following turn is unaffected.

## Known Limitations and Deferred Work

- **Exact-shape detection only** — a block holding prose plus JSON, two objects, an array, a `tool`/`input`-keyed object, or an unfinished object stays text; extending the shape vocabulary is pending evidence of a live provider emitting those variants.
- **Conversion is skipped after a real tool-call block** — a mixed response (wire tool calls plus JSON-in-content) keeps its text; the rare both-shapes case is left to the loop's normal handling.
- **The original wire text is not retained** — the repaired stream replaces the text block before logging, so a forensic diff against the raw provider payload is unavailable; the durable log always shows the executed reality.
- **Reasoning blocks are never converted** — only `text` blocks are candidates, matching the documented failure shape.
