---
name: dsh-customize
description: Customize or maintain any dsh source checkout — the one powering the current DSH process, the installed `dsh` command, or a sibling dsh/deepseek-harness clone. Use before any requested action that alters such a checkout's files or git state. Read-only questions that only inspect the checkout do not trigger this. Do not edit the personal staging checkout directly.
---

# DSH Customize

Make personal DSH changes in task worktrees and integrate them under the staging lock. Repository instructions still apply.

## Find staging

Do not assume a path or branch name. DSH is usually installed from source with a personal staging branch; create one for the user only when none exists.

1. Inspect `command -v dsh` in the user's launch environment before resolving symlinks.
2. Follow the launcher through the full symlink chain to reach the source checkout, then ask Git for everything else. The `dsh` on PATH is a symlink, usually through a stable `current` symlink into the active staging worktree; resolve the chain physically and take the launcher's parent directory as the checkout. Derive the rest from that checkout rather than from any path convention: `git -C <checkout> rev-parse --show-toplevel` confirms the checkout root, and `git -C <checkout> rev-parse --git-common-dir` gives the shared git directory — a linked worktree reports the real clone's, not its own — whose parent is the main clone, the one real clone whose object store every worktree shares. `--git-common-dir` answers relatively for a plain clone, so anchor it against the checkout before use, and resolve it physically: Git reports resolved paths, so comparing one against an unresolved path silently misidentifies the clone whenever a symlink sits anywhere above the checkout, which a symlinked home directory alone is enough to cause. `git -C <main clone> worktree list` then enumerates every checkout sharing it.

   This resolves every checkout, so depend on nothing else: not an environment variable, not a container path, not the main clone's location or branch. A checkout whose launcher links straight at it, with no `current` in the chain, resolves the same way.
3. Verify the checkout with Git, then record its branch, tip, status, remotes, worktrees, in-progress operations, and applicable `AGENTS.md` files.
4. Treat the launcher checkout's branch as staging unless the user says otherwise. The installed launcher must resolve to a staging worktree on a staging branch, never the main clone or a task, preparation, review, publication, or detached checkout. Ask if the launcher, checkout, or branch ownership is ambiguous; warn explicitly for a detached HEAD, the main clone, or a non-staging branch.

## Customize

1. Create a fresh task branch and worktree from the recorded staging tip, using the repository-required worktree location — default to `.worktrees/` under the repository root unless the repository requires otherwise. Never implement or commit directly on staging.
2. Implement the change, then select and run the repository-required review and checks. If a check fails, fix the cause and rerun it before integration.
3. Test assembled interactive behavior in the Web UI; unit tests and snapshots alone are insufficient.
4. Record the task tip and confirm the task worktree is clean before integration.

## Integrate under the lock

1. Resolve the worktree that owns staging and use `<staging-worktree>/.agents/merge.lock`. Keep it Git-ignored; never remove or replace it. Require `flock`.
2. Acquire the lock, then re-check branch ownership, exact staging tip, clean status, and absence of an in-progress Git operation. If staging moved, unlock and restart discovery against its current owner's lock.
3. Hold the same lock through final precondition checks, `git merge --no-ff`, required post-merge checks, conflict handling, and rollback.
4. If the merge or a post-merge check fails, abort the merge or restore the recorded clean staging tip before unlocking. Never discard unknown user files.
5. Before unlocking, verify staging's branch, commit, clean status, and required checks. Report that evidence and the commands run.
6. Remove the task worktree and branch only when their commits are reachable from staging and no longer needed.

Use [`dsh-upstream-customization`](../dsh-upstream-customization/SKILL.md) when the user wants to contribute a personal feature upstream.
