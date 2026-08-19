# tests/ — test-runner capability family

English | [中文](README.zh.md)

This family gives the model a dedicated test-runner surface: `run_tests` executes the workspace's detected test framework through the `ctx.bash` seam and returns machine-readable pass/fail counts, and `related_tests` lists test files near one source path by filename convention. Both tools emit only the ordinary `tool/call`/`tool/result` session events, so evidence-gate accounts `run_tests` runs as verification evidence with no new channel.

| Package | Role | ctx key |
|---|---|---|
| [`tool-run-tests/`](tool-run-tests/README.md) | Model-facing `run_tests` + `related_tests` tools | registers on `ctx.tools` |

The child README owns framework detection, summary parsing, discovery conventions, and the evidence-gate interplay.
