# @deepseek-ai/dsh-client-ui-theme

English | [中文](README.zh.md)

Theme plugin: ThemeService over the --dsw-* token base stylesheets (static scale + alias semantic layers). The service owns the theme preference (`light`/`dark`/`system`, persisted under `dsh.theme`), resolves `system` through `prefers-color-scheme`, and publishes immutable `ThemeSnapshot`s on the `theme/change` event; it never touches the DOM — ui-layout's presenter applies the resolved snapshot (`html { color-scheme }`, `body[data-ds-dark-theme]`, and inline alias tokens). Contract: api-contracts v3 §8.

`src/styles/` holds five sheets, all imported by the web shell's `base.css`: `base.css`, `design-platform.css`, `scrollbar.css`, `gradient-shadow-text.css`, and `shiki.css`. `scrollbar.css` is the sole consumer of the `--dsw-alias-scrollbar-*` tokens and must follow `design-platform.css`, which declares them.

Scrollbar rebinding contract: `scrollbar.css` binds `--dsh-scrollbar-thumb` and `--dsh-scrollbar-thumb-hover` on `body` to the l1 (base-surface) tokens, and both rendering paths read that pair. An elevated surface (menu, popover, dialog) sets `--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2)` and `--dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2)` on its own container; one rebind retints whichever path the engine took. The pair's other legal target is `transparent`, which draws no thumb at all — [ui-sidebar](../ui-sidebar/README.md) rebinds its column that way while the pointer is elsewhere. A rebind to the l1 pair is not a rebind; it restates the base-surface default.

The two paths are mutually exclusive by construction. `scrollbar-width`/`scrollbar-color` sit inside `@supports not selector(::-webkit-scrollbar)` because a non-`auto` value of either makes Chromium and Safari discard every `::-webkit-scrollbar*` rule for that element, `::-webkit-scrollbar-thumb:hover` included — declaring both unconditionally leaves `--dsh-scrollbar-thumb-hover` with no rendering anywhere. Firefox therefore takes the standard properties and WebKit-based engines take the pseudo-elements, so the hover token only ever renders through the pseudo-element path. Reasoning and the measured computed values: [the scrollbar Agent Note](../../../.agents/notes/implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md).

## Model Experience

None, as the theme service manages a browser preference; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Third-party themes are a surface, not a product** — registering one means overriding same-named alias variables; no validation exists that an override set is complete.
- **The token sheets are the sole color authority** — values absent from cssdesign (for example the design's #4176E6 tab blue) are deliberately not appended; the nearest semantic token wins (arbitrated 2026-07-22). Design-owner-approved additions are the exception and enter as a static step plus a semantic alias in the same change (`--dsw-static-blue-900` / `--dsw-alias-label-primary-bluish`, 2026-08-07).
