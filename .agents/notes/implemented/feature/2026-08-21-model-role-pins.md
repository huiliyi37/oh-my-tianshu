# Agent Note: Per-role model pins (vision / secondary / subagent)

Status: implemented

English | [中文](2026-08-21-model-role-pins.zh.md)

## Problem

Three model-consuming roles want routing independent of the default Agent model: the vision bridge describing images, cheap secondary background work (session titles, compaction summaries), and the default route of delegated subagent sessions. Without a shared owner, each consumer would grow its own settings namespace, write path, and no-op-without-provider handling, and a user could not see or edit the three pins in one settings section.

## Decision

`packages/core/model-roles` (`@huiliyi37/dsh-model-roles`) owns the `model-roles` settings namespace and the `ctx.modelRoles` service. The section schema holds one optional pin per role — `vision`, `secondary`, `subagent` — each a `{ provider, model }` pair whose fields are both required once the role is present (the schemastery `union(object, never)` optional-object idiom). `resolve(role)` reads the live settings scope at the consumer's point of use, so a committed settings change applies on the next read with no restart; `pin(role, selection)` and `unpin(role)` write through `settings.mutate` path ops and are no-ops when no settings provider is mounted.

The composition entry is empty by contract (`Config = Record<string, never>`, unknown keys rejected at load): every pin lives in the settings user layer, never in `cordis.yml`. The service emits no change event of its own — consumers resolve at their point of use, and observers subscribe to the existing `settings/updated`. The package stores pins only; each consumer owns its unpinned fallback chain (for example, following the deployment default model).

The invariant companion listens to `settings/updated` for the `model-roles` namespace and fails when `resolve()` does not already reflect the committed section — the check that pins the live-source wiring in the service constructor against a regression to an attach-time snapshot, which the settings seam's own commit invariant cannot see.

## Alternatives considered

- **One settings namespace per consumer** — three parallel sections would triple the write/no-op machinery and scatter one user decision across the document; a single namespace keeps the vocabulary in one place.
- **Extend `dsh-agent-default-model` with role keys** — that service owns the Agent-front-door default whose composition entry *requires* provider/model; role pins are strictly optional overlays with no composition value, a different lifecycle.
- **A package-owned change event** — no consumer needs one: every read goes through `resolve()` at the point of use, so the seam's `settings/updated` already carries the observation path.
- **Pins in plugin config (`cordis.yml`)** — a pin is a user-layer choice that must be writable at runtime; a deployment composition entry cannot serve that and would shadow the settings document.

## Consequences

Consumers (vision bridge, secondary-task owners, subagent routing) adopt the seam individually; until one resolves its role, the pin it would read has no effect. A deployment without a settings provider cannot retain pins. The service does not validate provider/catalog membership — the consumer opening a model request owns availability diagnostics, matching `dsh-agent-default-model`.

## Testing

Package tests cover the schema boundary (empty section valid, incomplete role rejected), pin/unpin visibility, external provider republish, provider detach fallback, and the no-provider no-op path; the invariant spec proves the companion rejects a `settings/updated` emission the service cannot resolve and one without a live service.
