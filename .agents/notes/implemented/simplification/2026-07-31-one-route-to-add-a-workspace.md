# Agent Note: One route to add a Workspace

Status: implemented

English | [中文](2026-07-31-one-route-to-add-a-workspace.zh.md)

## Problem

Both Workspace surfaces — the sidebar region header's `+` and the conversation hero's chip — offered two ways to get a Workspace: **Open local folder…**, which raised the composed directory flow, and **Create a new workspace**, which took a name and created `<workspaceRoot>/<name>`. The two overlapped: the browse occupant carries its own **New folder** affordance, so picking a directory already covered creating one. Two entries meant two vocabularies for one outcome, a name dialog with its own duplicate-name rule, and a create target the operator could neither see nor choose.

Removing the weaker entry leaves the sidebar header with exactly one action, which raised the presentation question this Note also settles: what a popover with a single row should look like.

## Decision

Adding a Workspace has one route: pick a host directory through the composed directory flow, new or existing. `menu.addWorkspace` ("添加工作区…" / "Add workspace…") is the entry; the create-by-name dialog and its `create.*` / `menu.createWorkspace` / `workspace.new` strings are gone. The label names the outcome, not the mechanism, because it is now the only door to that outcome — a user looking for "新建" must find it.

**A menu exists to disambiguate between targets.** When the only entry left is the add action — the add-only sidebar surface, or the hero with an empty list — the anchor gesture *is* that action: the flow opens directly and no popover renders. A one-row popover costs a click and offers nothing to choose between. The rule is one predicate (`addIsTheOnlyEntry`) covering both surfaces rather than a per-surface special case.

Two boundaries fall out of that rule and are part of it:

- **An empty list is only final once the baseline lands.** While `phase` is `pending` the hero keeps its menu and loading status instead of jumping into a flow that the arriving workspaces would have made unnecessary. The add-only surface lists nothing and never waits.
- **An unoccupied directory-flow hole leaves nothing to add with.** The sidebar header then renders no button at all rather than a dead one; the hero's menu keeps working as a picker over whatever is listed, and shows nothing when nothing is listed either — an empty popover would claim a choice that does not exist. This is the seam's documented no-flow default reaching its conclusion: with the occupant gone, so is the only creation affordance. The hero's anchor chip belongs to ui-conversation, so this package can suppress the popover but cannot hide the chip.

The direct-open path carries the busy rule the menu entry states: while a pick is still being adopted (`flowBusy`), the anchor gesture is held exactly as the entry is disabled, so a late outcome cannot race a second flow.

`WorkspaceCreateFlow` is now `WorkspacePickFlow` and its `createOnly` prop is `addOnly`; the injected `createWorkspace` narrows from `{ name } | { path }` to `{ path }`.

## Wire and CLI residue

The host's `workspace.create` still accepts `{ name }`, and `dsh web --workspace-root` still feeds its target directory, but no product surface reaches either any more. The same is true of the client contract that carried the name to the wire: `WorkspaceCreateInput`, `WorkspacesService.create`'s `{ name }` arm, `intentName`'s name branch, and the manager's "name under workspaceRoot" contract. `apps/cli/README.md` and its Chinese counterpart still document `--workspace-root` as creating named Workspaces. The whole set is marked for deletion at the call site in `packages/host/apiproxy/src/api-proxy.ts` and left to a follow-up change: it is backend, client-contract, and CLI surface with its own reviewer and its own test fallout (the api-proxy workspace suite, the runtime workspace suite, the config catalog), and the release-blocking part of this decision is the UI.

## Testing

`connectFreshWorkspace` — the helper every web e2e scenario boots through — stages `<root>/workspace` and adopts it through the dialog's path editor, so the produced session cwd stays identical to what create-by-name produced and scenario goldens stay valid. Staging rather than creating in-dialog keeps the helper idempotent across the repeated connects a scenario may make (a second create of the same folder fails, and the create dialog holds the flow open on that failure). Creating a folder from inside the chooser — the other half of the same route — is covered by `workspace-management.e2e.ts`, which owns the focused coverage: two workspaces added on folders the dialog creates, distinct same-basename directories adopted independently, a deleted title reused on a different directory, and the browser-dialog aria golden.

`smoke-real.e2e.ts` is the one scenario booting the unpatched shipped tree, where the `-auto` row resolves per host; it now pins `-browse` through a `--config` overlay so the developer's display environment cannot decide whether the picker is drivable at all.

## Alternatives considered

**Keep `Open local folder…` as the label.** Rejected: after the merge the entry both opens and creates, and naming it after the mechanism hides the creation half from exactly the users whose entry we removed. The counter-argument — "本地" usefully disambiguates the browser's machine from the harness's — is answered one step later by the dialog's own title and breadcrumbs.

**Keep the two-entry menu and make `Create a new workspace` open the same flow.** Rejected: two labels for one action is the confusion we were asked to remove, not a smaller version of it.

**Keep a one-row popover for consistency with the hero's menu.** Rejected: a popover that offers no choice is a wasted click and reads as unfinished. Consistency here is the *rule* (menu ⇔ a choice exists), not the widget.

**Keep the menu shell for entries we might add later (clone a repo, remote directory).** Rejected under "require a current owner and need": no such entry exists, and restoring a menu when one arrives is a smaller change than shipping an empty frame now.

**Delete the wire's create-by-name branch in the same change.** Rejected for this PR: it is backend/CLI surface with a different reviewer and a wider test fallout, and the urgent decision is the UI. See the residue section — it is marked, not forgotten.

**Register the workspace through the host in the e2e scaffold instead of driving the dialog.** Rejected: it would have decoupled all 15 scenarios from the picker, so nothing in the lane would prove the surviving route reaches a live composer. Every scenario now walks the real dialog to adopt its directory; only the create-a-folder half is concentrated in one scenario, because repeating it everywhere makes the shared helper non-idempotent for no extra signal.

## Consequences

- Creating a Workspace outside the operator's chosen directory is no longer possible from the UI; the server-controlled `--workspace-root` target was the one way to constrain where new workspace folders land, and nothing replaces it. A deployment that needs that constraint has to re-introduce it deliberately.
- The one remaining route browses the host filesystem, so the picker's reach is now the whole host rather than one configured parent. That is already the browse occupant's contract; this change makes it the only contract.
- A composition that mounts `ui-workspace` without any directory-picker package can no longer add a Workspace at all, and now says so by omitting the button instead of offering a create-by-name fallback.
- The hero chip still announces `aria-haspopup="menu"` while the direct-open path raises a dialog instead. Making that truthful means routing the flow's presentation choice up through the `conversation.hero.workspace` owner contract — the flow owns the decision, the chip owns the announcement, and they sit in different packages — so it is a named follow-up rather than a silent inconsistency. The sidebar button this change added makes no popup claim at all.
