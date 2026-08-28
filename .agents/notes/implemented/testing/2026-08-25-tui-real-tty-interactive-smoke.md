# Agent Note: Real-TTY interactive acceptance smoke for the TUI (P0)

Status: implemented

English | [中文](2026-08-25-tui-real-tty-interactive-smoke.zh.md)

Scope: `examples/tui/tests` (new smoke + fixture + driver + shared PTY harness), `packages/tui/tui` (rewind done-frame fix), `examples/package.json`

## Problem

The shipped TUI had no automated acceptance that a real terminal actually receives the interactive spine: the welcome snapshot pinned the settled welcome card and a clean Ctrl+Q, but the approval flow, `/rewind`, and `/theme` were only exercised by unit specs that drive renderers directly. The v0.4.0 line shipped without that gate, and the agent sandbox denies `posix_openpt`, so PTY-driven coverage had to be designed to run wherever a host PTY exists (CI runners, developer machines) while self-skipping nowhere — it runs in the standard keyless snapshot lane.

## Decision

`examples/tui/tests/interactive-smoke.snapshot.ts` boots `tests/fixtures/interactive-smoke.cordis.yml` through the real Loader inside a 100×40 `node-pty` session and parses the byte stream with headless xterm — markers are matched against the parsed active buffer (normal or alternate), never raw bytes, so ANSI framing cannot fake a pass. The fixture composition is the examples/tui spine plus the confining bash stack (`subprocess` → `sandbox` → `sandbox-policy` → `bash-sandbox`) and the approval seam (`@huiliyi37/dsh-user-approval`, policy `ask`). The model is the loopback `dsh-llm-mock-server`: request one returns `tool_call_success` for `bash` carrying `sandbox_permissions: danger-full-access` + justification, which raises the real approval card (escalation validation only requires strict widening and the pairing — a first-call escalation is wire-legal); request two returns the closing text. `DEEPSEEK_BASE_URL` points at the mock; no key or network is ever contacted.

Scenario one drives the full spine: settled welcome → user message → approval card (`审批 · bash`, `[y] 允许`) → `y` settle → tool output in the transcript → assistant reply → `/rewind` list → granularity (`convo`) → done page → close → `/theme` picker → one step + confirm → `主题已切换:` echo → Ctrl+Q exit 0. Scenario two presses Ctrl+Q while the card is pending — the teardown path that settles the approval as cancelled and aborts the open turn — and also requires exit 0. Both scenarios assert the fake API key never crosses the PTY.

The reusable pieces live in `tests/helpers/pty-harness.ts` (isolated HOME/DSH_HOME/AGENTS_HOME temp roots, allow-listed child env, parser-drain tracking, marker polling with deadline and exit detection, graceful Ctrl+Q → kill cleanup). The smoke reuses the existing `resolveExampleLaunch` src/lib planes; the fixture driver `tests/fixtures/interactive-driver.ts` is the plain boot-and-yield driver — it cannot reuse `welcome-driver.ts`, whose startup-Tip `Math.random` callsite guard assumes no native addon loads before the welcome (the bash sandbox stack loads koffi and trips it).

## Testing

The bug below was found by this lane

Driving `/rewind` exposed a real product defect, not a test artifact: `RewindOverlay.run()` executes asynchronously, but the only repaint trigger was the keypress path (`handleKey` → `overlay.rerender()`), which draws the `executing` frame at best. When the executor settled, nothing repainted, so the `回退完成`/`回退失败` page — including its `任意键关闭` contract — was invisible in real use; the next keypress would instead route through the done-phase handler and immediately deactivate. `RewindOverlay` now takes `{ onSettled }` (fired exactly once when `run()` lands on done, success or failure) and `TuiApp` wires it to `overlay.rerender()`. `rewind-overlay.spec.ts` pins the contract (no fire while executing, exactly one on success and on failure). The smoke is the assembled-transcript proof for the fix, per the keyless-snapshot policy.

## Consequences

- The approval card in this lane is the escalation flow; P1① (persistent always-allow rules extending `ApprovalOutcome`) is future work and would slot in as a third scenario over the same fixture.
- The 4 pre-existing `app.spec.ts` failures observed in the working tree during development are the in-flight fox WIP (verified identical with this change reverted), not this lane.
- Sandbox note: inside the DSH agent sandbox `posix_openpt` is denied; run this lane from a host TTY context (`pnpm test:snapshot` with the file filter). CI runners provide PTYs natively.

## Alternatives considered

**Match markers against raw PTY bytes.** Rejected: ANSI framing could fake a pass; markers are matched against the parsed active buffer (normal or alternate).

**Reuse `welcome-driver.ts` for the fixture.** Rejected: its startup-Tip `Math.random` guard assumes no native addon loads before the welcome; the bash sandbox stack loads koffi and trips it — the fixture driver is the plain boot-and-yield one.

**Self-skip where no host PTY exists.** Rejected: the lane runs in the standard keyless snapshot lane wherever a host PTY exists (CI runners, developer machines); only the DSH agent sandbox (posix_openpt denied) needs a host-TTY invocation.
