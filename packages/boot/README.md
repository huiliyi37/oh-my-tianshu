# boot/ — shared app-bin boot glue

English | [中文](README.zh.md)

The channel-neutral boot library the app bins share: `apps/cli`, the [`scaffold/`](../scaffold/README.md) launcher, and the [`examples/`](../examples/README.md) demo bins all consume it.

| Package | Role | ctx key |
|---|---|---|
| `app-boot/` | Shared boot glue for the app bins: `.env` loading, fail-loud Loader guards, snapshot-aware config resolution, the settle-the-tree boot sequence | (library for the bins) |

The boot sequence and personal-config contract are documented in [`app-boot/README.md`](app-boot/README.md).
