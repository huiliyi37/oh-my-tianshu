# @huiliyi37/dsh-pheromone

English | [中文](README.zh.md)

File-level stigmergy store: session-scoped spatial memory via exponential-decay signals (fragile/entry-point/etc.), atomic JSON persistence with debounced writes and exponential retry backoff. Signal sources are wired by consuming plugins (see `dsh-tool-file-info`).

## Model Experience

### Indirect — library surface

#### What the model sees

No model-visible surface; pheromones are consumed through `file_info` tool results (decayed strengths) or by other plugins.

#### Token effect

None directly.

#### KV Cache effect

No prompt structure contributed; storage is out-of-band.

## Known Limitations and Deferred Work

- **Decay and capacity are fixed** (7-day half-life default, 200-entry LRU) — tunables are store options, not config fields.
- **Sync flush is best-effort** (non-atomic) — process-exit path may lose the last debounce window.
- **No cross-session persistence contract** — format is internal; upgrades may reject old files.
