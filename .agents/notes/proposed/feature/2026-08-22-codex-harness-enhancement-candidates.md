# Agent Note: Codex harness benchmarking — remaining enhancement and fusion candidates

Status: proposed

English | [中文](2026-08-22-codex-harness-enhancement-candidates.zh.md)

## Problem

A read-only benchmarking pass over OpenAI Codex (`codex-rs`, external checkout cloned 2026-08-21; all `codex-rs/…` paths below are time-point references into that checkout, not links into this repository) produced an enhancement/fusion candidate list against this fork's current capability set — and without a recorded home, that analysis ages into scattered half-memories. The [automatic memory pipeline](../../implemented/feature/2026-08-21-memory-auto-pipeline.md) from the same analysis has already landed (`85461be679`); the remainder needs one decision-ready record.

## Proposal

This note records the selected remainder as a decision-ready catalog, tiered by cost and value. Inclusion is a candidate inventory, not an implementation commitment; each item lands through its own note when adopted. Two earlier P0 candidates — a sandbox network proxy with domain policies (Codex `network-proxy`) and a prefix-based command-policy DSL (Codex `execpolicy`, Starlark) — are NOT part of this record and await separate evaluation.

## P0 — model-facing context tools (small cost, high value)

**`get_context_remaining` + `new_context_window`.** The model can query its remaining context budget and restart a fresh context window without summarizing history (`codex-rs/core/src/tools/handlers/get_context_remaining.rs`, `new_context_window.rs`). Tianshu's `dsh-token-meter` already projects replay-aware pressure but exposes nothing model-facing. Landing shape: two small tool packages consuming the token-meter projection, registered on `ctx.tools`.

## P1 — interaction and ecosystem surface

- **`tool_search` + deferred tools.** When MCP catalogs explode, only `tool_search` stays mounted and everything else loads on demand ("Search query for deferred tools", `tools/src/tool_search_spec.rs`). The skill family has progressive disclosure; the tool surface does not — every `mcp-client` addition widens the need.
- **`request_permissions`.** A model-initiated permission-escalation request normalized through a policy-transform layer (`sandboxing::policy_transforms::normalize_additional_permissions`). Tianshu elevation is user-side only (Shift+Tab preset cycling); the model has no发起 channel. Requires a local equivalent of the policy-transform normalization on the sandbox seam.
- **`view_image`.** Lets the model read arbitrary image files from disk — closing the screenshot→self-check verification loop. `vision-ask` covers user-attached images only; images the agent itself produces are invisible to it. Can reuse vision-ask's registry and vision-model routing.
- **Plugin discovery/install flow.** `list_available_plugins_to_install` / `request_plugin_install` plus a TUI npm-registry browser. Tianshu installs plugins only manually via `plugin add`.
- **External-agent migration.** An importer for config/hooks/memory/sessions/subagents/plugins from Claude Code and Cursor (`external-agent-migration`). Adoption-funnel feature; the existing `hooks-claude` compatibility plugin is the natural foundation.

## P2 — platform extensions

- **Windows sandbox** (`windows-sandbox-rs` + windows proxy ingress). The sandbox family currently ships bwrap/Landlock/Seatbelt only (Termux is supported, Windows confinement is not).
- **App-server daemon.** A resident background service exposing an MCP-compatible stable RPC face — thread/start·resume·fork·list, turn/start·steer·interrupt, config read/write, model/list, fuzzy file search sessions (`codex-rs/docs/codex_mcp_interface.md`). The foundation of an editor-extension ecosystem; ACP/Web host exist locally but not the daemon + versioned-RPC form.
- **Cloud task delegation** with a scrollable-diff review UI (`cloud-tasks/src/`).
- **Staged feature flags.** Features classified UnderDevelopment / Experimental / stable behind a `/experimental` menu (`features`) — a safe release channel for experimental behavior.
- **OS keychain credential storage** (`keyring-store`). `credentials-local` is file-backed today.

## Polish items (low-cost pickups)

- **apply_patch constrained grammar** — a `.lark` grammar constraining patch-format decoding (`handlers/apply_patch.lark`).
- **TUI details**: table detection, OSC 8 terminal hyperlinks, terminal palette probing, tooltips, motion animations, resume picker with transcript preview, self-update prompt flow (`codex-rs/tui/src/`).
- **Rollout tail scanning** — a reverse JSONL scanner speeding up large-file session resume.
- **Utility trio**: sleep / current_time / wait_for_environment.

## Order and dependencies

P0 first (two small tools, no seam changes). P1 items are independent and parallelizable; `tool_search` grows urgent with every mounted MCP server, and `view_image` is cheapest while vision-ask's registry is still fresh. P2 items need product decisions beyond engineering (Windows sandbox scope, daemon protocol ownership, cloud backend choice). Polish items attach to whatever PR touches the same area.

## Alternatives considered

### Why not evaluate the network proxy and execpolicy DSL here too?

Both touch the sandbox seam's trust boundary and deserve their own threat-model pass; bundling them into a broad catalog would bury that weight under UI-chrome items. They stay out of this record and await separate evaluation.

### Why a catalog instead of per-item proposals now?

Each item's adoption decision needs its own evidence (consumer demand, seam fit, snapshots), and most items are not yet demanded by any consumer. The catalog preserves the benchmark's findings cheaply; promoting an item means writing its own note, not re-deriving it from a stale checkout.

## Acceptance criteria

Each adopted item lands as its own package/plugin under the house rules — opt-in mounting, validated Config fields, evidence matched to surface (unit + real-assembly e2e, keyless snapshots for model-visible output), bilingual README pairs, and its own Agent Note that marks the catalog entry landed with the landing commit. This catalog note itself never becomes the implementation record.

## Risks

- The `codex-rs/…` references are time-point pointers into an external checkout; they rot as Codex moves and name where an idea was seen, not a durable API.
- A catalog invites cargo-culting: an entry's presence signals "seen and recorded", never "wanted" — adoption still requires a consumer or an explicit product call.
- Items may duplicate capabilities that land independently in the meantime; adopting an item starts from the current tree, not from this text.
