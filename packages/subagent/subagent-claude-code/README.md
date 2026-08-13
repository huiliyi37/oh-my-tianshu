# @deepseek-ai/dsh-subagent-claude-code

English | [中文](README.zh.md)

This package registers the fixed `claude-code` subagent provider. Each accepted run invokes the official Claude Agent SDK in the delegating Session's workspace, starts the SDK-distributed Claude Code CLI through the shared subprocess service, submits one self-contained text task, and returns only the final answer through the shared [`dsh-subagent`](../subagent/README.md) result contract.

## Start and ownership

`start(request)` accepts only a non-empty sequence of text blocks and derives the child cwd from the parent Session. It creates one private `AbortController`, calls the official SDK `query()`, and publishes the run only after the SDK's `spawnClaudeCodeProcess` hook has supplied a live CLI handle owned by [`dsh-subprocess`](../../subprocess/subprocess/README.md). A failure or cancellation before publication closes the query, terminates any acquired process tree, waits for it to exit, and rejects `start()`.

The SDK receives the exact concatenated text task. The provider iterates the complete SDK message stream and accepts only a `result` message with `subtype: "success"`, `is_error: false`, and a nonblank `result`, followed by normal iterator completion. Every SDK error subtype, an error-marked success, a missing answer, iterator failure, protocol failure, or process failure maps to `error`; this version produces neither `max-tokens` nor `refusal`.

Local cancellation wins the result race and maps to `aborted`. `dispose()` is idempotent: it aborts the run, asks the SDK query to close, invokes the shared process-tree termination escalation, and waits for whole-tree exit. SDK graceful close expresses protocol intent; the subprocess handle remains the authority for process quiescence. Result failure and independent teardown failure remain separate.

## Native settings and interaction

The provider deliberately omits the SDK `settingSources` option. The official SDK therefore reads the host's normal user, project, and local Claude settings relative to the parent Session cwd, including native account state and product configuration. The provider neither copies nor filters those files and does not create or modify login state.

Each query sets `persistSession: false` and disables `AskUserQuestion`. It supplies no `canUseTool`, elicitation, or dialog callback, so unattended interactions fail through the SDK instead of waiting for a user interface this provider does not own.

## Capabilities and context

The provider advertises no optional start-time capabilities and reports `inheritsParentContext: false`. Claude Code receives the standalone text task and the parent Session cwd, but not the parent conversation, persona, tool filter, depth policy, or structured-output contract. Every run has an independent SDK query, cancellation controller, CLI process, and non-persisted product session.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `env` | `{}` | Explicit SDK/CLI environment layered over the shared credential-scrubbed parent environment. |
| `disposeGraceMs` | `3000` | Positive finite grace in milliseconds, no greater than [`MAX_TIMER_DELAY_MS`](../../util/timeout/README.md), between the shared process-tree owner's termination tiers; disposal then waits for whole-tree exit. |

Production uses the Claude Code CLI supplied by `@anthropic-ai/claude-agent-sdk` and the host's native settings and authentication. The plugin does not install another CLI, select a model, create a product home, log in, or probe an account. Credential-shaped ambient variables are removed before the explicit `env` overlay is applied, so an API key or token intended for the child must be supplied there. Non-credential endpoint variables such as `ANTHROPIC_BASE_URL`, along with ordinary ambient values such as `PATH` and `HOME`, remain inherited unless overridden.

Install this package and add the following rows to your own `cordis.yml`. Shipped CLI configurations do not load this provider or expose `subagent_claude_code` by default.

```yaml
- id: subagent-claude-code
  name: '@deepseek-ai/dsh-subagent-claude-code'
  config:
    env:
      ANTHROPIC_API_KEY: !!js process.env.ANTHROPIC_API_KEY

- id: tool-subagent-claude-code
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: claude-code
    toolName: subagent_claude_code
    enableRunInBackground: false
    maxDepth: provider-managed
```

## Product compatibility and evidence

The runtime dependency is pinned to `@anthropic-ai/claude-agent-sdk@0.3.220`, whose platform optional dependency supplies Claude Code 2.1.220. Required evidence exercises that official distribution through a keyless loopback product path and a credentialed DeepSeek path, while Loader composition proves that both opt-in product packages coexist without starting either product.

The project owner's identity-scoped distribution authorization covers the official SDK and the official CLI/platform payloads declared by each SDK version. [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md) discloses the current optional payload closure without classifying its declared terms as permissive; unrelated non-permissive runtime dependencies continue to fail the notices gate.

## Model Experience

### Child request

#### What the model sees

The Claude Code child receives the standalone text task as one fresh SDK query. Its workspace is the parent Session cwd, while its model, system instructions, tools, permissions, and authentication come from the host's native Claude settings and product installation.

#### Token effect

The child pays for an independent Claude Code context and query. Child tokens do not enter the parent's context.

#### KV Cache effect

Independent of the parent request cache. Reuse depends only on Claude Code's own model, instructions, tools, native settings, and fresh query.

### Parent tool result, indirectly

#### What the model sees

Through `dsh-tool-subagent`, the parent sees only the strict final Claude Code answer or the consumer's exact error for a non-completed result. Claude Code reasoning, tool activity, intermediate messages, stderr, workspace diffs, usage, and product ids are not copied into the parent Session.

#### Token effect

Parent input grows only by the final answer or error retained in the tool result. This provider adds no parent tool schema by itself.

#### KV Cache effect

Append-only: the new tool result follows the reusable parent request prefix.

## Known Limitations and Deferred Work

- **One fresh query and process per run** — there is no continuation, resume, pooling, progress stream, or product-session persistence.
- **Host settings are intentionally authoritative** — project and user settings can change model, tools, and behavior; the provider does not provide a filtered or hermetic production mode.
- **Product installation and account state remain native** — an incompatible SDK payload, configuration error, or authentication failure is surfaced as a startup or run error; the plugin provides no installer or login flow.
- **No human interaction path** — `AskUserQuestion` is disabled and other interactive callbacks are absent, so tasks requiring new approval or input fail instead of suspending.
- **Final text only** — reasoning, intermediate messages, tool traffic, usage, stderr, and workspace diffs remain product-local.
- **No optional shared capabilities** — output schemas, child personas, tool filtering, and harness depth enforcement are rejected by the shared service for this provider.
- **No wall-clock timeout or side-effect rollback** — the caller cancels long work, and files or external systems changed before cancellation are not restored.
