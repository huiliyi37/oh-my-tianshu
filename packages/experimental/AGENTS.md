# AGENTS.md — Experimental and internal packages

These rules supplement the [package rules](../AGENTS.md). The [experimental and internal package group decision](../../.agents/notes/implemented/architecture/2026-07-28-experimental-plugin-package-group.md) owns the rationale.

- All Cordis plugin packages whose whole public contract is experimental or internal-only belong here. An experimental option inside an otherwise stable package stays in that package's product-role group.
- Use this directory to share engineering and product-manager prototypes across the team so others can discover, run, review, and extend them against the real plugin graph.
- Official releases exclude this directory. A package enters a release only after moving to its product-role group; do not add packages here to release manifests or bundles.
- Experimental packages carry no stability, compatibility, migration, or support promise. Internal-only packages may define narrower internal contracts but make no public release promise.
- Experimental or internal-only status never relaxes repository engineering, security, documentation, lifecycle, testing, or snapshot requirements.
- Release packages must not take runtime dependencies on packages here. Examples may; every other runtime dependent is also experimental or internal-only and belongs here. Tests may use them as development dependencies.
- Promotion moves a package to its product-role group without renaming its `@deepseek-ai/dsh-*` package. Require explicit review of its public contract, limitations, test evidence, and a named owner accepting stable-package obligations.
