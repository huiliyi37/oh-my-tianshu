# Agent Note: Command image-attachment envelope

Status: implemented

English | [中文](2026-08-17-command-image-attachment-envelope.zh.md)

## Problem

The TUI composer submits one envelope — draft text plus attached images — but the two submission planes consumed it asymmetrically. A plain message serialized the images into prompt content; a slash command rode `ctx.commands.execute(agent, line, signal)`, a text-only transaction: `/plan` with reference screenshots executed the command, cleared the draft, and silently stranded the images. The model never saw them, and no surface said so. The defect was contract-level, not a missed call site: nothing in the command registry modeled attachments, so any command could consume the text half of a submission and drop the rest. The composer additionally misclassified plugin-only commands like `/plan off` as file paths, so they never reached the cordis command plane at all.

Merging the two planes was not on the table — the [plugin command registration Agent Note](2026-07-19-plugin-command-registration.md) deliberately keeps human commands out of the model plane, and that separation is correct. The gap was that the envelope fractured at the plane fork.

## Decision

The submission envelope is modeled end to end, and every command route either consumes it whole or refuses it loudly.

**Declaration.** `CommandDefinition.input.images: boolean` (absent = false) declares whether composer images may accompany an invocation. The flag is validated as a boolean at registration and rides the frozen `CommandDescriptor` through `commands/list` to every client.

**Payload without an admission store.** The composer validates images when they enter the draft, so the command path carries the data URLs as-is: an accepted invocation receives frozen, ordered `ImageBlock`s on `invocation.attachments`. There is no attachment store, admission batch, or content addressing on this path; images are the only non-text attachment with defined model-block semantics.

**Executor enforcement.** `CommandRuntime.execute(agent, line, signal, images)` carries the submission's images as an optional fourth parameter (defaulting to none), so the existing three-argument call sites — including ones inside packages this change does not own — compile unchanged; the upstream `(agent, line, images, signal)` order was deliberately not adopted. The executor — not the composer — enforces the declaration: images sent to a non-declaring command settle as a logged `command/done` error before the handler runs.

**Producer-owned model visibility.** The registry never schedules the images itself. `/goal` submits one `agent.followup` user message — image blocks plus the fixed text `Reference images for the goal objective.` — after a successful create or edit, so later goal rounds read the images from ordinary session history and the goal domain stores no attachment state. `/plan <message>` folds the images into its steered text message, while bare `/plan` steers an image-only user message because the images may contain the whole task. Producer control forms with no model input (`/goal pause`, `/plan off`) return a direct error and keep the composer's images in place. The plan projection treats `command/run` as a candidate and drops it on a paired `command/done` error, so a rejected image-carrying `/plan off` cannot leave a pending exit.

**TUI carrier.** The composer's slash path converts attached data URLs into image blocks and passes them to `execute`; the draft images are cleared only on a success outcome and kept on an error or a throw. Slash-command recognition now falls back to a cordis registry `find`, so plugin-only commands like `/plan` are no longer misread as file paths. One known shadow remains: the TUI's built-in `/goal` command intercepts that name, so the goal envelope is unreachable from the TUI composer and is exercised through the registry layer instead.

## Testing

Registry declaration validation, executor enforcement, and frozen invocation attachments are covered in `packages/interaction/commands/tests/commands.spec.ts`; producer behavior in `packages/goal/command-goal/tests/command-goal.spec.ts` and `packages/plan/plan-mode/tests/plan-mode.spec.ts` (including the projection's command-settlement cases); the TUI carrier passthrough, clear-on-success, and keep-on-error paths in `packages/tui/tui` `app.spec.ts`.

## Alternatives considered

- **Block commands whenever images are attached (no acceptance path)** — rejected: predictable, but `/goal` with reference images is the motivating use case; the user's images would have no route to the model at all.
- **Auto-send stranded images as a follow-up user message after any command** — rejected: surprising for host-state commands (`/model`, `/compact`), and it moves the message contract from the producer to the composer, against the command registry's "producer owns model-visible work" rule.
- **Store attachment references in the goal domain and render them into round prompts** — rejected: requires durable goal schema changes and either duplicates image blocks into every round prompt or adds round-one-only prompt shape; the round-prompt invariant would need attachment state. One ordinary logged user message achieves the same model visibility.
- **Consume images on any command success regardless of grammar** — rejected: `/goal pause` with images attached would silently discard them, recreating the original defect one layer deeper. Consumption is tied to the producer's explicit success, and grammar misfits return errors.
- **Keep enforcement client-side only** — rejected: declaration without executor enforcement is advisory; direct `ctx.commands.execute` callers could bypass the composer. The executor settles the declaration itself.
- **Upstream's required third parameter `execute(agent, line, images, signal)`** — rejected locally: it obliges every caller to state its envelope, but three call sites sit in packages outside this change's ownership and dozens more would churn for a parameter most never use. The defaulted fourth parameter carries the same envelope with zero call-site changes; the parameter order is the one deliberate deviation from upstream.
- **Generalize the command payload to a multimedia attachment union** — rejected: files and videos lack shared intake and model-visible semantics, and an untagged union would not supply them. A second supported attachment kind is the reintroduction condition; the envelope then widens to a tagged union and commands declare the accepted kinds.

## Consequences

- No command route can consume a submission's text and strand its images: the contract forces whole-envelope consumption or a visible refusal, for current and future commands alike.
- The commands package now depends on `dsh-llm`, and `commands/execute` carries an optional fourth `images` parameter — existing three-argument callers state an empty envelope by default.
- `/goal` and `/plan` gain reference-image input at the cost of one extra logged user message (goal) and image blocks in the steered message (plan), including an image-only message for bare `/plan`; all are billed like any image prompt.
- Image validity on the command path is the composer's responsibility: without an admission store, a plugin calling `execute` directly can hand arbitrary data URLs to a declaring command. Introducing the attachment package's admission here is deferred until a second carrier needs it.
- The TUI built-in `/goal` shadow means the envelope's goal producer is currently reachable only through the cordis command plane, not the TUI composer; lifting the shadow is a separate decision about the built-in command's own grammar.
