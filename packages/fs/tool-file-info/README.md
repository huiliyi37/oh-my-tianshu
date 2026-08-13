# @deepseek-ai/dsh-tool-file-info

English | [中文](README.zh.md)

`file_info` tool: size/lines/structural skeleton + pheromone recall for a single file, plus two session-event signal sources — `read_file` calls deposit entry-point signals, failing verification commands deposit fragile signals on named test files. All file access goes through the `ctx.fs` service seam.

## Model Experience

### file_info tool

#### What the model sees

The `file_info` tool schema (path) and its result (sizes, skeleton lines, pheromone strengths). No prompt text is contributed.

#### Token effect

Fixed tool-schema cost on every request in that tool view; result text is bounded (skeleton ≤5 lines).

#### KV Cache effect

Prefix-stable while the tool view is unchanged; pheromone decay changes result content only.

## Known Limitations and Deferred Work

- **Signal heuristics are conservative** — fragile deposition keys off failure markers in command output; mis-calls are possible.
- **Correlation by turn:step** is bounded by session turns; long-lived sessions accumulate map entries until GC.
- **No mtime surfaced** — the fs service version token is opaque (by design).
