# @deepseek-ai/dsh-client-ui-sidebar

English | [中文](README.zh.md)

Sidebar plugin: real Host Workspaces in stable Host order, each containing its `sessionIds` in Workspace order with `parentId` nesting; Sessions outside every Workspace appear in a trailing `Ungrouped` section. Search, state dots, and collapse into the layout-owned 56px rail are presentation-local. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

New Session starts the runtime's page-local frontend Session Intent; a real Workspace's "+" starts one targeted to that Workspace. The Workspace header "+" opens ui-workspace's shared picker, whose selection also targets a frontend Session. A Workspace Intent does not appear in the sidebar.

`SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the declared `sidebar.workspace` and `sidebar.settings` child slots, and injected `startSession`, `open`, and sidebar-toggle callbacks. There is no plugin store: `deriveGroups` consumes object-layer snapshots and component-local expansion/search state.

Scrollbars in the column are a pointer affordance: the shell rebinds ui-theme's [scrollbar indirection](../ui-theme/README.md) to `transparent` whenever the pointer is outside it, and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The reservation that keeps rows from moving belongs to the scrolling region ([ui-workspace](../ui-workspace/README.md)), so revealing a thumb never reflows.

The foot is the `sidebar.settings` seat: the sidebar renders only the bottom-pinned layout slot and shares its column state (`wide`); ui-settings registers the trigger row and settings panel there.

The `/client` export surface is the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

## Model Experience

None, as the sidebar renders the browser session list; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Session state-dot rendering is owned by [ui-workspace](../ui-workspace/README.md)** — no done/error notification sources are available.
- **Group-by supports Workspace only** — Update and Status are not available strategies.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.
