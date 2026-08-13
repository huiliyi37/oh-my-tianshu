# tui/ — interactive terminal UI

English | [中文](README.zh.md)

The terminal UI layer for `dsh --profile`: the bundle patch inserts `tui-runner` on top of dsh-base, and the render core is a port of the Tianshu terminal engine (file-by-file provenance: [tui/SOURCE-MAP.md](tui/SOURCE-MAP.md)).

| Package | Role | ctx key |
|---|---|---|
| [`tui/`](tui/README.md) | TUI runner + render-engine port | — (consumes sessions/agents/the projection bus; registers the `userInteraction` provider) |
