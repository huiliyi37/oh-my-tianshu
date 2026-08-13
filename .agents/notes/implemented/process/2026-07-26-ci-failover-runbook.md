# Agent Note: CI failover runbook — hosted pools → in-house pool

Status: implemented

English | [中文](2026-07-26-ci-failover-runbook.zh.md)

## Problem

The three required Linux worker jobs in [CI](../../../../.github/workflows/ci.yml) (`node 24 / static`, `node 24 / coverage`, `node 24 / snapshots and artifacts`) run on the hosted enterprise 32-core pools; the required verdict job that aggregates them (`all checks passed`) runs on standard `ubuntu-latest`. When the enterprise pools degrade — jobs queue indefinitely or the enterprise labels vanish — every open pull request becomes unmergeable, and the ordinary recovery of merging a fix is itself deadlocked behind the very required checks that cannot run. **Scope: this switch recovers an enterprise Linux-pool outage.** The verdict's other required dependencies (`node-compat`, `python-sdk`, `windows`) stay on standard hosted runners by design (the portable boundary); in a broader GitHub-hosted capacity failure that also takes out the standard pools, those dependencies still block `all checks passed`, and only the Windows leg has no in-house substitute at all — during the 2026-07-27 outage the standard pools recovered first, which is the ordering this design bets on. An outage therefore needs a switch any responder with repository write access can throw without merging anything.

## Decision

Each of the three required Linux worker jobs — and the `all checks passed` verdict job, which would otherwise stay queued on the failed pool even after every worker passed — resolves its runner pool through the `DSH_CI_FAILOVER` repository variable. Unset (normal), they run on the hosted enterprise pools. Set to `selfhosted` by any repository writer, all four retarget onto the in-house self-hosted `vm-backup` pool, coverage and snapshot concurrency drop to shared-VM bounds, and the hosted-path pnpm cache restores are skipped. The switch is writer-manageable repository state, not a merge, so it works while every check is red. The in-house pool's readiness is continuously re-proven by the `serial / linux (self-hosted standby)` lane, which runs the complete unsharded aggregate on every master push.

### What the in-house pool is

`vm-backup`: one 64-core VM, six always-on systemd-managed runner instances. Its image must preinstall Playwright Chromium's Linux system packages; CI downloads the lockfile-selected browser but never runs `apt` on this persistent shared host. Check the latest `serial / linux (self-hosted standby)` run before switching: its aggregate includes browser replay, so a green standby verifies both ordinary capacity and this browser prerequisite.

### Switch (any repository writer, ~1 minute, no merge)

1. Repository **Settings → Secrets and variables → Actions → Variables → New repository variable**: name `DSH_CI_FAILOVER`, value `selfhosted`.
2. Retrigger the required jobs so they re-resolve their pool. Jobs already **queued** for the hosted labels do not retarget and cannot be re-run in place, so for the documented indefinite-queue outage, cancel the stuck run and re-run all jobs, or push a new commit; "Re-run failed jobs" only helps once a job has actually failed rather than queued.
3. That is the entire switch. Under failover the workflow also, automatically: drops `DSH_COVERAGE_MAX_WORKERS` to 8 and `DSH_SNAPSHOT_MAX_CONCURRENCY` to 12 (sized for six always-on instances: worst case 6 × 8 = 48 coverage workers on the 64-core VM) (shared-VM contention bounds), and skips the hosted-path pnpm cache restores (the VM's persistent store serves warm installs).

#**Dependabot exception.** All four selectors deliberately exclude `dependabot[bot]`: under failover, Dependabot PRs stay queued for the hosted pool rather than executing dependency-supplied code on the persistent VM. A Dependabot PR that remains queued during an outage is expected behavior, not a failed switch; it completes when the hosted pool recovers.

**Who can flip the variable.** GitHub's API lets any collaborator with write access manage repository variables, so the switch is writer-level, not strictly admin-only. In this repository's trust model that is not an escalation: the runner group admits all workflows of this private, fork-disabled repository (a deliberate trade to make PR-ref failover possible at all), so any writer could already reach the VM by pushing a branch workflow. The boundary against untrusted code is repository membership; the variable only routes work for members.

## Capacity during failover

Six always-on instances absorb normal PR traffic (the pool's steady-state load is one serial standby job per master push, so failover capacity is effectively the full pool). If queues still build, register additional instances with an org registration token (org Settings → Actions → Runners → New runner). Clone an existing runner directory **excluding its identity files** — `rsync -a --exclude '.runner*' --exclude '.credentials*' --exclude '_diag' --exclude '_work' <src>/ <dst>/` (the globs also catch `.runner_migrated`/`.credentials_migrated`, which GitHub writes on migrated runners and which equally trigger the already-configured refusal) — then run `config.sh` (copying `.runner`/`.credentials` verbatim makes it refuse with "already configured"), and **start the listener**: `sudo ./svc.sh install ubuntu && sudo ./svc.sh start`. Registration alone leaves the runner offline; only a started service adds capacity. About a minute per instance.


### Switch back

Delete the `DSH_CI_FAILOVER` variable (or set it to anything other than `selfhosted`). New runs resolve back to the hosted enterprise pools. Remove any extra instances that were registered during the incident.

### Trust boundary

The variable is writer-manageable repository state; a pull request event itself can neither set it nor read a different value into effect, and the selector expressions live in workflow definitions. Note that under failover, `pull_request` runs execute the PR merge ref's own workflow definition — the boundary against untrusted code is repository membership (private, forking disabled, Dependabot excluded by the selectors), not the variable. Note on runner-group policy: pinning the runner group to the master-ref workflow is **incompatible** with this failover — the four failover jobs are `pull_request` runs evaluated from PR merge refs, and a master-pinned group leaves them queued (observed live on 2026-07-27; the group was widened to all workflows of this repository to unblock the switch). A stricter runner-side policy therefore costs PR failover; the shipped posture accepts repository-scoped, all-workflow group access.

## Alternatives considered

**Merge a workflow change to switch pools.** Rejected because the outage that motivates the switch is exactly the state in which no PR can merge: the required checks are the ones failing. A repository variable is writer-manageable state that takes effect on re-run without a merge.

**Keep the self-hosted pool always in the required path.** Rejected because it trades hosted-pool availability for the in-house VM's, moving a single point of failure rather than adding a fallback. The variable keeps the hosted pools primary and the self-hosted pool a proven, one-action standby.

## Consequences

Recovering from a hosted-pool outage is a single variable (any writer) plus a re-run, with no merge on the critical path. The cost is a second runner topology to keep working: the standby lane exercises it on every master push so the failover target never goes stale, and the concurrency and cache-restore branches in `ci.yml` carry a `selfhosted` leg that must stay in step with the hosted leg.
