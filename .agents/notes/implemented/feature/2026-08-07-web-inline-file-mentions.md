# Agent Note: inline-code file mentions open the file they name

Status: implemented

English | [中文](2026-08-07-web-inline-file-mentions.zh.md)

> Scope: linking inline-code tokens in the closing message's prose to the files the turn produced. Not in scope: recognizing paths in plain prose, linking files the turn did not produce, and mentions in streaming or mid-turn messages.

## Problem

The produced-files row lists a turn's output, but the closing message usually also *names* the file in prose — as inline code, like `` `deepseek-homepage.html` `` — and that mention was inert text. The reader's eye lands on the sentence first; the affordance sat one row below it.

## Decision

**A prose mention links only when it matches a produced file.** The [produced-files decision](2026-07-31-web-workspace-file-links.md) rejected linkifying the closing message because rendering must not depend on the model spelling a path recognizably; that holds. The row remains the authoritative, prose-independent account. This feature adds a second consumer of the same `locations` vocabulary: `producedFileMentions` resolves an inline-code token by exact path, or by being exactly the basename of exactly one produced path. A basename two paths share stays inert rather than guessing, and a token naming nothing the turn wrote stays inert — a mention link can never 404.

**The renderer owns no vocabulary, and the provider is the deliverables plugin.** `MarkdownText` takes an optional `MarkdownFileMentions` resolver and consults it for inline-code tokens — after URL promotion, which wins, and never inside an anchor, where a button cannot nest. What names a file is decided behind the optional `chatFileMentions` service ui-conversation reaches via `ctx.get`: ui-deliverables provides it beside its turn-tail chain entry, so one cordis.yml line composes the row and the prose links in or out together, and ui-primitives gains no session concepts. Mentions apply to settled renders only — the streaming cache must not bake in handlers that could go stale, and the vocabulary is not final until the turn closes. The consumer memoizes the resolver on the closing seq rather than the growing transcript, so a settled message's cached parse survives stream appends.

## Alternatives considered

- **Path-shaped regex over all prose** — links `package.json` mentioned abstractly and examples that were never written; every false positive is a click that opens nothing or the wrong file. The vocabulary approach cannot produce a dead link.
- **Linking suffix matches (`out/index.html` mentioned as `index.html` in a subdirectory listing)** — deferred; exact path and unique basename cover the observed closing-message shapes, and a wider matcher can loosen later without breaking the seam.
- **Resolving in ui-primitives against a passed path list** — puts matching policy in the generic renderer, where other consumers would inherit it unasked. The resolver contract keeps policy with the owner.
- **Threading the vocabulary through the turn-tail chain** — the chain is a render dispatch below the message; mentions decorate markdown inside it, which only data reaching MarkdownText can do. The optional service is that data path, and its absence is the off state.

## Consequences

The mention and the row are two affordances for one fact (full path as `title` on both); the mention itself wears the markdown sheet's anchor language — link-blue at rest, hover underline — because an at-rest underline collides with monospace descenders inside the code chip. `apps/web/tests/produced-file-mentions.e2e.ts` pins the assembled behavior with a built write-turn seed: unique basename links, ambiguous and unknown tokens stay inert; it does not click, for the produced-files restraint (the opener launches a real application). Mentions in mid-turn narration stay inert even for files the turn later produces, because the vocabulary attaches to the closing message only. The window-prepend edge — a window that starts mid-turn later gaining earlier same-turn writes — leaves a mention unlinked until remount, never wrongly linked.
