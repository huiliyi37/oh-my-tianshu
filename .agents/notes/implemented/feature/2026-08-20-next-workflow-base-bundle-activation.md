# Agent Note: `/next-workflow` ships from the base bundle

Status: implemented

English | [中文](2026-08-20-next-workflow-base-bundle-activation.zh.md)

## Problem

The fixed intent pipeline is complete, but an opt-in-only package leaves every shipped profile without `/next-workflow`. Users must discover and maintain a profile overlay before they can invoke a harness-owned command whose required subagent, bash, and git capabilities already ship in the shared composition. A repository-independent verification command does not exist, so availability and verification policy must remain separate decisions.

## Decision

`dsh-base` mounts one `next-workflow` row and declares `@huiliyi37/dsh-next-workflow` as a workspace dependency. Every shipped profile inherits the command through its first bundle layer; Web and TUI leaf bundles do not duplicate the row. The [intent-pipeline decision](2026-08-17-next-workflow-intent-pipeline.md) continues to own the phase machine, artifacts, logging, capability probes, and model-visible behavior.

The base row carries no config. Package defaults therefore select the `spawn` provider and one plan candidate. `verifyCommand` remains unset, so VERIFY reports `unverified` and proceeds to REVIEW rather than claiming success. A later profile layer may replace the row to configure a deployment-specific verification command.

IMPLEMENT steers the invoking session and inherits its current tool face. The command does not bypass or advance TUI zen; users invoke it after zen promotion when implementation needs the full tool set.

## Alternatives considered

**Keep the command opt-in.** Rejected because the shared composition already supplies its capabilities, while an undiscoverable overlay requirement makes shipped behavior differ from the documented product command.

**Mount separate rows in Web and TUI bundles.** Rejected because the command is profile-independent. Leaf ownership would duplicate configuration, omit other profiles, and permit the shipped command sets to drift.

**Set a verification command in the base row.** Rejected because user workspaces do not share one package manager, test command, or timeout policy. Reporting `unverified` is accurate; pretending a universal gate exists is not.

**Automatically promote zen before IMPLEMENT.** Rejected because zen promotion is owned by its verified predicate. A command must not bypass that lifecycle boundary.

## Consequences

All shipped profiles expose `/next-workflow [candidates] <objective>` exactly once. The neutral base configuration improves discovery without weakening verification claims or zen ownership, at the cost that deployments wanting a deterministic VERIFY gate must configure `verifyCommand`.

Coverage pins the unique base row and leaf non-duplication, the real Web command catalog and slash menu, the generated CLI composition graph, and the built default-config dump. The pipeline's Loader, integration, and phase-machine tests remain owned by `packages/workflow/next-workflow/tests/`.
