# Agent Note: Hosted verify workflow and the main-branch trigger fix

Status: implemented

English | [中文](2026-08-16-hosted-verify-ci.zh.md)

## Problem

Two gaps let red states land on `main`: the inherited `ci.yml` only triggered push jobs on `master` (the default branch has been `main` since the fork, so no push ever fired them) and its pull-request lanes target custom runner pools that are not guaranteed to exist outside the original organization. Separately, the per-package `tsc -b` build does not typecheck `tests/`, so changes that passed package-level checks could still break the repo-wide `typecheck` gate undetected until someone pushed.

## Decision

Add `.github/workflows/verify.yml` — a minimal rigor loop on standard hosted runners (`ubuntu-latest`, Node `22.19` + `24`): immutable install, repo-wide `typecheck`, full unit `test`, and `build`, on every push to `main` and every pull request. It intentionally duplicates nothing from the enterprise `ci.yml` topology; it only requires infrastructure that exists everywhere. In the same change, retarget the inherited `ci.yml` push triggers and master-gated jobs from `master` to `main` so its own push lanes can fire again (its custom-pool PR lanes are unchanged — that infrastructure decision stays with the failover runbook).

## Alternatives considered

- **Only fix `master` → `main` in ci.yml**: the PR lanes would still depend on the `dsh-ubuntu-*` / `vm-backup` pools, which are not verifiably available to this repo — a queue-forever check is worse than none.
- **Reproduce the full enterprise matrix on hosted runners**: the coverage/consumer/wine lanes pull large caches and long runtimes; replicating them hosted is a separate capacity decision, not a correctness one.
- **Wait for a runner-inventory decision first**: the loop's value is immediate (red states blocked on day one), and it composes with any later pool topology.

## Consequences

Every push and PR now gets a hosted verdict for the three gates that actually gate local pushes (typecheck/test/build), and `master`-era push jobs in `ci.yml` are live again on `main`. The enterprise lanes (coverage, consumers, Wine) keep their existing triggers and are not required for this loop. If the full `pnpm run test` baseline carries intermittent failures, they surface here as repo-visible signal rather than local-only knowledge.

## Testing

- Workflow syntax validated by structure review against the existing workflow files; the loop's three steps (`pnpm run typecheck`, `pnpm run test`, `pnpm run build`) were each run green locally on the commit that introduces this workflow.
