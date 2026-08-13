# DeepSeek Harness Python SDK

English | [中文](README.zh.md)

Python subprocess SDK for driving DeepSeek Harness over JSON-RPC stdio. The
runtime inherits normal DeepSeek Harness environment variables such as
`DEEPSEEK_BASE_URL` and `DEEPSEEK_API_KEY`, so callers can use real model
endpoints directly or point those variables at a local proxy during
benchmark runs.

Installing `deepseek-harness` installs the exact same-version `deepseek-harness-runtime-bin` platform wheel. The normal entry point therefore needs no executable argument:

```py
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness() as harness:
    result = harness.run("Say hi.")
```

`DeepSeekHarness` keeps its lazily started runtime subprocess for reuse across calls. Use it as a context manager, as above, or call `close()` explicitly when finished.

By default, the SDK launches the bundled single-file `dsh-jsonrpc-agent` executable from the `deepseek-harness-runtime-bin` package and injects that package's default configuration (the stdio JSON-RPC server, agent core, preloaded DeepSeek adapter, JSONL session persistence with an explicitly composed semantic checkpoint policy, local bash) via `DSH_CORDIS_CONFIG`. To run a plugin composition of your own, keep the `@deepseek-ai/dsh-jsonrpc` entry in the config and pass the Cordis config path.

```py
from deepseek_harness import DeepSeekHarness

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cordis="examples/jsonrpc-agent/cordis.yml",
) as harness:
    result = harness.run("Make the requested code change.")
```

`provider` selects a provider route registered by the chosen Cordis composition; `model` is the model id resolved by that adapter. `max_tokens` is an optional positive per-request output-token cap for the root agent and its in-process descendants; omission leaves the provider default in control. Compaction summaries keep the separate limit configured by their compaction plugin. The bundled default composition registers `deepseek-official`. A custom composition can mount `llm-pi-ai`, configure provider-specific credentials/endpoints there, and select any provider/model present in pi-ai's installed catalog.

`Session.run()` owns an activity interval from its prompt's durable inbox receipt through the next whole-agent idle and returns `RunResult(session_id, final_response, events, notifications, session_root)`. The result has no prompt-level status or turn reason: `final_response` is the last committed root-session assistant text in the interval, not an output causally assigned to the prompt. Steering, injected context, and other queued work may contribute before idle.

`HarnessClient` retains discovered subagent ancestry for the lifetime of the runtime process. During each `Session.run()`, `RunResult.notifications` and `on_notification` receive the root session and all known descendant notifications in wire order, including nested subagent lifecycle and session events. `RunResult.events` contains root-session events only, so descendant messages cannot replace the root response. The low-level `session_prompt()` returns the queued `MessageId` immediately; callers that bypass `Session.run()` own any later activity boundary themselves.

The same behavior can be selected for the runtime subprocess with `DSH_CORDIS_CONFIG`. The injection lives in `HarnessClient.start()`, so the low-level client's default launch gets it too: when the launch resolves to the bundled runtime and neither `cordis` nor a non-empty `DSH_CORDIS_CONFIG` is set (the runtime treats an empty value as absent, and so does the injection check), the bundled default configuration is used; an explicit `runtime_bin`, `bridge_bin`, or `launch_args_override` disables the injection entirely. See the [sdk-runtime README](../sdk-runtime/README.md) for the runtime carriers (production exe vs dev-only node closure) and how to obtain them.

`cwd` and `runtime_cwd` are resolved to absolute paths before subprocess launch, environment injection, and the wire handshake. The public API exposes only applied options: deployment persona and persistence belong in `cordis.yml`, while `session_root` remains the high-level convenience that sets `DSH_SESSION_ROOT`.
