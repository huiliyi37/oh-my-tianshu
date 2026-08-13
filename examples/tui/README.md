# tui

English | [中文](README.zh.md)

An interactive terminal UI composition over the same agent spine the
[headless-agent](../headless-agent/) example uses: the real DeepSeek adapter,
one pre-created `main` agent, and the `@huiliyi37/dsh-tui` bundle's
`tui-runner` plugin. The TUI renders the session log through the read-only
`adapter/transcript` projection; the session log stays the authoritative fact
source.

## Run it

```sh
# repo root .env (gitignored) or exported env:
#   DEEPSEEK_API_KEY=sk-…
#   DEEPSEEK_BASE_URL=https://…   # optional; defaults to the public API
pnpm exec tsx ../headless-agent/tests/fixtures/headless-driver.ts ./cordis.yml "say hello"
```

The `tui-runner` plugin mounts when this composition boots. The headless
driver above streams one task through the real model, feeding every canonical
`session/event` into the transcript projection — the same read path the TUI
uses — and prints the derived view plus the final assistant text before exit.
For an interactive terminal session, boot the composition from a TTY; the
render core takes over stdin/stdout.

## Composition

- `settings` — user-settings document
- `credentials` — resolves `DEEPSEEK_API_KEY` from the process environment
- `llm-deepseek` — the DeepSeek adapter (full thinking at max effort)
- `agent-spine` — pre-creates one `main` agent
- `tui-runner` — the `@huiliyi37/dsh-tui` bundle's interactive render core

## Keyless snapshot

The composition itself carries no key. The transcript projection derives a
TUI-facing conversation view by folding canonical session events
(`emptyTranscript` / `applyTranscriptEvent`); a keyless snapshot of that view
is recorded under `.rivet/scratch/` by the real-model smoke (see
[`tests/transcript-smoke.e2e.ts`](tests/transcript-smoke.e2e.ts)).
