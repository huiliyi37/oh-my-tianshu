# tui

English | [中文](README.zh.md)

An interactive terminal UI composition over the same agent spine the [headless-agent](../headless-agent/) example uses: the real DeepSeek adapter, one pre-created `main` agent, and the `@huiliyi37/dsh-tui` bundle's `tui-runner` plugin. The TUI renders the session log through the read-only `adapter/transcript` projection; the session log stays the authoritative fact source.

## Run it

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
pnpm exec tsx ../headless-agent/tests/fixtures/headless-driver.ts ./cordis.yml "say hello"
```

The `tui-runner` plugin mounts when this composition boots. The headless driver above streams one task through the real model, feeding every canonical `session/event` into the transcript projection — the same read path the TUI uses — and prints the derived view plus the final assistant text before exit. For an interactive terminal session, boot the composition from a TTY; the render core takes over stdin/stdout.

## Composition

- `settings` — user-settings document
- `credentials` — resolves `DEEPSEEK_API_KEY` from the process environment
- `llm-deepseek` — the DeepSeek adapter (full thinking at max effort)
- `agent-spine` — pre-creates one `main` agent
- `fs-snapshot` — pre-write file snapshots backing `/rewind` file rollback
- `spark-anchors` — excluded-path anchor re-injection paired with the `deepseek-spark` wire truncation
- `tui-runner` — the `@huiliyi37/dsh-tui` bundle's interactive render core

## Keyless snapshot

The composition itself carries no key. The existing transcript smoke folds canonical session events through `emptyTranscript` / `applyTranscriptEvent` and records the resulting TUI-facing conversation view under `.rivet/scratch/` (see [`tests/transcript-smoke.e2e.ts`](tests/transcript-smoke.e2e.ts)).

The settled-welcome snapshot in [`tests/welcome.snapshot.ts`](tests/welcome.snapshot.ts) boots this example's real `cordis.yml` through the Loader with [`tests/fixtures/welcome-driver.ts`](tests/fixtures/welcome-driver.ts), drives the TUI through `node-pty` at 100×30, parses the terminal with xterm, and compares only the settled welcome area with [`tests/snapshots/welcome/terminal.expected.txt`](tests/snapshots/welcome/terminal.expected.txt). The harness isolates `HOME`, Harness roots, and child environment variables; its loopback request sentinel verifies zero model-network requests before capture, exit, and cleanup.

`resolveExampleLaunch` keeps both launch planes covered: source mode runs the TypeScript driver through `tsx` with workspace path mappings, while `DSH_EXAMPLE_MODE=lib` runs under plain Node so bare package imports resolve through built `lib/` exports. Only the settled append-only mid-band surface enters the golden.
