---
name: dsh-upstream-customization
description: Classifies personal DSH customizations for upstream contribution and, after explicit per-feature approval, rebuilds one on upstream master and opens a draft pull request. Use when the user asks to contribute, publish, or upstream a local DSH change, or asks whether one is worth proposing.
---

# DSH Upstream Customization

Classify and propose personal customizations upstream one feature at a time.

## Classify

- **Definitely propose:** bug fixes.
- **Propose:** additive, non-conflicting features implemented as plugins; visual improvements.
- **Do not propose without maintainer approval:** intrusive changes that alter existing architecture, core behavior, or broad contracts.
- Explain the classification and upstream value. If unsure whether a change is intrusive, treat it as intrusive.

Classification and a recommendation are not publishing approval. Obtain explicit user approval naming one feature before pushing or opening a PR; approval for another feature, an upgrade, or local integration does not apply.

## Publish an approved feature

1. Fetch current upstream `master`, then rebuild only the approved feature on a fresh branch and worktree at that exact commit. Never publish the personal staging branch or unrelated customizations.
2. Follow repository instructions for implementation, review, testing, disclosure, PR writing, and pre-push checks. Fix failures and rerun the affected checks before publishing.
3. Review the outgoing commits and diff against upstream. Confirm they contain only the approved feature, no credentials or personal data, and a clean worktree.
4. Reconfirm the approved feature name and publishing target before the first push. Do not infer authorization from earlier local work.
5. Push only that branch and open only a draft PR. Keep its description synchronized with later changes.
6. For a Web UI feature, attach a screenshot or GIF from the assembled application after removing credentials and personal data.
7. Report the upstream base and branch commits, commands and checks run, pushed branch, and draft PR URL.
