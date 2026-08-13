# Agent Note: Declaring a provider from the Models page

Status: implemented

English | [中文](2026-08-04-declaring-a-provider-from-the-models-page.zh.md)

## Problem

The two layers below made a pi-ai route [a declaration](2026-08-03-pi-ai-declared-provider-catalog.md) and gave the host a way to [interrogate a draft endpoint](2026-08-04-draft-provider-endpoint-interrogation.md). Neither reached a person who does not edit YAML: the Models page still offered one API-key field per provider and a fold with a base URL, so adding a gateway meant opening `$DSH_HOME/settings.yaml` and knowing the profile shape, and correcting a stale context window meant the same. The capability existed and the surface did not expose it.

Two things were missing, and they are not the same shape. Editing an existing route's models is a *field* on a card that already exists. Declaring a route is a *create*: the route id is being chosen, so until it is chosen there is no settings address to edit.

## Decision

The model list is a component shared by both flows; the create is its own card.

`ModelListEditor` edits a profile's `models` array — one row per model with id, display name, context window, and output cap — and owns the fetch action. An empty list means "serve this route's built-in catalog", so a row is only ever added deliberately; clearing an optional field drops it rather than storing a value the schema would reject, and a capacity that is not a positive integer is not stored at all.

Fetching asks about the endpoint **the form currently shows** — a base URL edited but unsaved, a key typed but unstored — so adding a provider is one pass instead of save-then-return. The reply opens a picker rather than being written: candidates already configured start unchecked, so adopting a selection never overwrites a capacity the user corrected. A provider that cannot be interrogated is a detour, not a dead end; the adapter's own message appears beside rows that stay editable by hand.

`CustomProviderCard` declares a route pi-ai does not ship. It is a separate card because the route id is chosen here: one `settings.mutate` sets the whole profile at `providers.<route>`, and the key travels separately through `credentials.set` under the same `<ROUTE>_API_KEY` derivation an existing provider uses. The three facts a hand-declared route cannot default — endpoint, protocol, and at least one model — gate the create button, so a failure names the field while the user is still looking at it.

The protocol choices come from the namespace's **own schema**, read through the settings descriptor the page already fetches (`providers.*.api` is a union of the adapter's `supportedProtocols()`). No new wire field, no constant in the client, and no way for the offered choices to drift from the accepted ones.

## Alternatives considered

**Declare a provider through `ProviderEditor` with extra fields.** One card instead of two, but the editor is addressed by `settingsPath`, and a route being named has no path yet. Recomputing the path per keystroke would remount the card and discard the draft; deferring it would mean the editor's whole write path no longer described what it was editing.

**Add a wire field for the protocol list.** Explicit, and the obvious first instinct. But the settings schema already crosses the wire and already contains the union, so a second copy could disagree with the first — and the one the adapter enforces is the schema.

**Fetch against the stored profile instead of the live form.** No key would leave the form for an unsaved provider. But the flow that needs fetching most is the one where nothing is stored yet, and a form whose endpoint was edited would quietly interrogate the old one.

**Write adopted candidates straight into the list.** Fewer clicks, but a fetch would then overwrite capacities the user had corrected, and a listing that discloses only ids would replace real numbers with nothing.

## Consequences

A gateway, a self-hosted server, or a model newer than the installed catalog is now configurable without leaving the browser, and the endpoint itself supplies the model ids where it can. The page grew two components and one shared list editor; the editor card's pi-ai fold grew from two fields to a list.

What it costs: only pi-ai routes can be hand-declared, because `llm-pi-ai` is the one namespace whose profiles describe a whole provider — a `llm-deepseek` route stays a composition fact. Interrogation reaches only OpenAI-compatible endpoints, so a gateway speaking another protocol reports that it cannot be asked and its models are typed in. And the page now holds a key in component state for the duration of a fetch, which is the same exposure `credentials.set` already has and no longer than the card lives.

## Testing

`packages/client/ui-models/tests/provider-form.spec.tsx` drives the rendered page over a scripted wire face: adding, editing, and removing rows; a cleared optional field leaving the profile and a non-integer capacity never entering it; the interrogation carrying the edited endpoint, the unsaved key, and the profile's protocol; the picker's default selection, toggling, cancel, and adopt-keeps-tuned-rows; the empty, refused, and rejected-transport paths; the create writing one profile plus its credential; every gate on the create button; and the read-only posture. `protocolChoices` is covered against a schema that declares the union and one that does not.
