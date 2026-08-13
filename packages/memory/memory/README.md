# @deepseek-ai/dsh-memory

English | [中文](README.zh.md)

Project memory service: cross-session recall (BM25 hybrid over structured claims and knowledge notes) and claim persistence with a quality gate. Provides the recall/remember seam used by agents and tools.

## Model Experience

### Indirect — library/service surface

#### What the model sees

Memory is model-visible only when a consumer (tool or plugin) renders recalled claims into context; no prompt text originates here. The service exposes `recall` and `remember` operations (`recall_feedback` for outcome tracking).

#### Token effect

None directly; consumers render recall results at their own cost.

#### KV Cache effect

No prompt structure contributed directly.

## Known Limitations and Deferred Work

- **Recall quality depends on stored claims** — sparse stores answer poorly.
- **Project-scope claims are gated** at session end (pending quality gate); a crashed session may drop them.
- **No per-user isolation** — the store is workspace-scoped.
