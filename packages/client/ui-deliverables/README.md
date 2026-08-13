# @deepseek-ai/dsh-client-ui-deliverables

English | [中文](README.zh.md)

Produced-files feature owner: registers the deliverables row a finished turn ends with into the chat view's `conversation.chat.turnTail` hole. All policy lives here; removing this plugin's line from cordis.yml removes the surface entirely, and the owning view renders an empty hole at zero cost.

`deliverablesDefinition` folds each Turn's successful mutation calls into engine-published `DeliverablesTurnData`; `producedForClosing` reads that data with the closing Assistant seq. The vocabulary is the mutation tools' own follow-along `locations`, never the closing prose: a produced file is listed whether or not the model remembered to name it. A mutation is recognized by render intent, not tool name — a diff card, or a generic card whose `kind` is `edit` (the shape `str_replace_editor`'s insert presents) — so a new mutation tool joins by declaring what it does. Reads, deletes, and failed calls contribute nothing; a path appears once per Turn in first-seen order. The Conversation Location index owns Turn membership, so a Turn that mutates and then ends without content text cannot spill into the next Turn's row.

`ProducedFiles` renders the row between the closing message's body and its IconActions footer: a quiet label, up to six chips (basename text, full path as the `title`), and an explicit remainder count past the cap. Each chip opens through the owner-supplied `openFile` — the same Host opener the tool rows use, with the chat view resolving relative paths against the session cwd. Design rationale: the [workspace file links Agent Note](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md).

The closing prose carries the same vocabulary. This plugin provides the `chatFileMentions` service the chat view consults per closing message: `producedFileMentions` resolves an inline-code token by exact path, or by being exactly the basename of exactly one produced path — a basename two paths share stays inert rather than guessing, so a mention link can never open the wrong file or 404. A resolved mention keeps its code chip and takes the markdown sheet's link language — link-blue at rest, underlined on hover, exactly like URL-promoted inline code — with the full path as its `title`; mentions never render inside anchors or streaming text. Decision record: the [inline file mentions Agent Note](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md).

## Model Experience

None, as the row is a pure client derivation over already-logged tool metadata and nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- **Mention matching is exact path or unique basename only.** A suffix mention (`out/index.html` written as `index.html` resolves; `deep/out/index.html` written as `out/index.html` does not) stays inert; widening the matcher is deferred until a real closing-message shape needs it.
