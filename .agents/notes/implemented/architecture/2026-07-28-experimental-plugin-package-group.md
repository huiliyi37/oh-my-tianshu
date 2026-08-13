# Agent Note: Experimental and internal package group

Status: implemented

English | [中文](2026-07-28-experimental-plugin-package-group.zh.md)

## Problem

The [package hierarchy](../../../../packages/README.md) groups plugins by product role, but it cannot distinguish release packages from prototypes or internal-only packages. The team needs an obvious shared place for useful work that is not part of the official release.

## Decision

The subtree rules in [`packages/experimental/AGENTS.md`](../../../../packages/experimental/AGENTS.md) make `packages/experimental/<pkg>/` the required home for Cordis plugin packages whose whole public contract is experimental or internal-only. Package names remain `@huiliyi37/dsh-<pkg>`.

The group is the team's in-repository place to share engineering and product-manager prototypes: members can discover, run, review, and extend one another's work against the real plugin graph without implying product support.

Official releases exclude this directory. A package enters a release only after moving to its product-role group; release packages cannot take runtime dependencies on packages here. Examples may use them, while any other runtime dependent also belongs here. Tests may use them as development dependencies.

Experimental packages carry no stability, compatibility, migration, or support promise: they may change APIs, configuration, or data, or disappear without deprecation or migration. Internal-only packages may define narrower internal contracts but make no public release promise. Neither status relaxes engineering, security, documentation, lifecycle, testing, or snapshot requirements.

The pending `@huiliyi37/dsh-tui-session-changes` `/diff` viewer and `/btw` plugin are examples governed by this rule. Promotion into an official release requires explicit review of the public contract, limitations, test evidence, and a named owner accepting stable-package obligations.

## Alternatives considered

**Keep experimental and internal-only packages in product-role groups with README labels.** Labels are easy to miss and cannot enforce dependency boundaries.

**Treat every package as experimental until the first tagged release.** This provides no durable incubation boundary.

**Develop prototypes and internal packages elsewhere.** This loses the real plugin graph, examples, snapshots, and lifecycle checks needed to evaluate them.

## Consequences

The path makes release exclusion and dependency blast radius visible while retaining the real plugin graph for team sharing. It gives up product-role colocation and creates path churn on promotion, while the npm name remains stable. The subtree rules, repository [current-owner/current-need rule](../../../../packages/AGENTS.md), and unchanged engineering gates limit junk-drawer growth. Because official release tooling does not yet exist, contributor policy enforces the exclusion; when such tooling is added, the directory is its required exclusion boundary.
