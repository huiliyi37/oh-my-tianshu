# @huiliyi37/dsh-tool-memory

English | [中文](README.zh.md)

`memory` tool: exposes recall and remember over the `dsh-memory` service, with a summary cache bound to the apply closure (per-instance isolation).

## Model Experience

### memory tool

#### What the model sees

The `memory` tool schema (`action`/`query`/`text`/…) and its recall results as tool output, rendered with the `recall`/`remember` verbs.

#### Token effect

Fixed tool-schema cost; recall results are bounded by the consumer limit.

#### KV Cache effect

Prefix-stable while the tool view is unchanged; recall results change content only.

## Known Limitations and Deferred Work

- **Recall latency** depends on store size (BM25 scan over claims).
- **Project-scope writes** may be deferred to session end (quality gate).
