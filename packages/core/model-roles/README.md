# @huiliyi37/dsh-model-roles

English | [中文](README.zh.md)

Per-role model pins resolved from the user settings document. `ModelRolesService` provides `ctx.modelRoles` and stores a provider/model pin for each of three model-consuming roles, so a deployment can route them independently of the default Agent model:

- `vision` — image descriptions produced by the vision bridge.
- `secondary` — cheap background work such as session titles and compaction summaries.
- `subagent` — the default route of delegated subagent sessions.

The plugin config is empty by contract: every pin lives in the `model-roles` Settings section, whose user layer is read live at each `resolve()` call, so a committed change applies at the next read with no restart. The service emits no change event of its own; observers use the existing `settings/updated` event.

- `ctx.modelRoles.resolve(role)` returns the role's pinned `{ provider, model }`, or `undefined` when the role carries no pin. This package stores pins only — the fallback chain an unpinned role follows (for example, the deployment default model) is each consumer's own contract.
- `ctx.modelRoles.pin(role, selection)` persists a pin through the settings user layer; `ctx.modelRoles.unpin(role)` removes it so the role follows the default route again. Without a settings provider both are no-ops and every role resolves to `undefined`.

```yaml
# settings.yaml
model-roles:
  vision:
    provider: acme-gateway
    model: acme-vision-large
  secondary:
    provider: acme-gateway
    model: acme-small
  subagent:
    provider: acme-gateway
    model: acme-large
```

The service does not validate catalog membership. A provider route may serve an unadvertised model, and the consumer that actually opens a model request owns availability diagnostics.

## Model Experience

Indirectly, through the provider/model selection each consumer resolves for its role; consumers own the model-visible request.

#### KV Cache effect

A pin affects only requests resolved after it lands. A session whose request log already names a selection keeps that selection, so this service does not invalidate its established prefix.

## Known Limitations and Deferred Work

- The package stores pins only; a role takes effect only once its consumer (vision bridge, secondary-task owner, subagent routing) resolves it, and each consumer owns its unpinned fallback chain.
- Without a settings provider, `pin()` and `unpin()` cannot retain a selection for a later read.
