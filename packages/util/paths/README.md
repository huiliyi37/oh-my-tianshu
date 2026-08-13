# dsh-paths

English | [中文](README.zh.md)

Shared filesystem path helpers for DeepSeek Harness user data.

## DSH home

`resolveDshHome()` resolves the single-root DeepSeek Harness home. Precedence, highest first: an explicit configured path, `$DSH_HOME`, then `~/.dsh`. The harness keeps all user data under one root.

`dshHomePath(...segments)` joins child segments onto that resolved home with Node's platform path rules. With no segments it returns the home itself.

`dshHomeDisplay()` names an active root symbolically for user-facing paths: `~/.dsh` for the default home, `$DSH_HOME` for any configured home. It never leaks an absolute machine path.

`DSH_HOME_DIR_NAME` owns the default user-data directory name: `.dsh`.

`defaultDshHome()` returns the default DeepSeek Harness home by joining the operating-system home directory with `.dsh`, using Node's platform path rules.

`expandHomePath()` expands `~`, `~/...`, and Windows-style `~\...` prefixes against the operating-system home directory. It leaves non-tilde paths and `~user/...` untouched.

This package is intentionally small and harness-dep-free so product packages can share user-data path conventions without depending on one another.

## Known Limitations and Deferred Work

- **Expansion is deliberately narrow** — only bare `~`, `~/...`, and `~\...` use the current operating-system home; named-user forms such as `~alice/...`, environment variables, and shell expressions remain unchanged.
- **Helpers do not touch the filesystem** — callers still own directory creation, existence checks, permissions, and trust policy for the resulting path.
