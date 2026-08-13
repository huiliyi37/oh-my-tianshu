# @deepseek-ai/dsh-client-locale

English | [中文](README.zh.md)

Locale plugin: LocaleService — the browser locale preference (`zh`/`en`, persisted under `dsh.locale`; with nothing persisted a fresh browser opens in the language `navigator` asks for — matched on the primary subtag, `zh` when it asks for none this app ships; `locale/change` fires on switches only) plus the ns×locale dictionary registry (typed `register(ns, {zh, en})` checked against `LocaleNamespaceMap`, `bind(ns)`→`TranslateNS<ns>`; lookup chain ns → common → zh → key). The service implements the slot system's `LocaleFace` and installs itself through `ctx.slots.installLocale`, backing the framework-injected `t` standard seat (`Translate`/`TranslateNS` are ui-slots types; import them from there — this package only re-exports for dictionary owners' convenience).

## Model Experience

None, as the locale registry serves browser UI copy; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Some surfaces keep inline copy** — Settings rows, the sidebar, question composer, and model select use locale seats; other packages still own static text directly.
- **Registry-held text reads its translation once** — copy captured at registration time outside the slot render path (e.g. the `/model` command description in the command registry) keeps the language it was registered under until re-registration; slot-rendered copy follows switches live.
