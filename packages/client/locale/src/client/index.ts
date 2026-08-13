/**
 * Browser-side locale registry. Bound translation functions retain stable
 * identity for injected consumers. The plugin also registers the Language
 * preference row into the settings General section — the locale feature owns
 * its own settings surface.
 */
/* oxlint-disable typescript/no-redundant-type-constituents --
 * `keyof LocaleNamespaceMap & string` is the declare-merge key pattern (see
 * ui-slots): in THIS unit the map holds only this package's own merges, but
 * consumers merge more namespaces in and the intersection keeps them
 * string-typed. The rule fires on the narrow-map view, not real redundancy. */
import type { Context } from 'cordis'
import {
  type BoundActions, type LocaleDictOf, type LocaleNamespaceMap, type Translate, type TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { en, zh, type CommonKey } from '../locales/index.ts'
import {
  en as settingsEn, zh as settingsZh, type SettingsLocaleKey,
} from '../locales/settings.ts'
import type { LanguageRowInjected } from './LanguageRow.tsx'
import { LanguageRow } from './LanguageRow.tsx'
import { createLanguageRowStore } from './settings-store.ts'

export type { LanguageRowComponentProps, LanguageRowInjected } from './LanguageRow.tsx'
export type { LanguageOptionRow, LanguageRowState } from './settings-store.ts'
export type { SettingsGeneralItemOwnerProps } from './settings-contract.ts'
export type { CommonKey } from '../locales/index.ts'

// The translate currency lives in ui-slots (the render machinery synthesizes
// the seat); re-exported here so dictionary owners import one package.
// TranslateNS<'model'> is the namespace-addressed developer-facing form.
export type { Translate, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shared cross-feature vocabulary, consulted by the lookup chain after the entry's own namespace misses. */
    common: CommonKey
    /** This feature's own settings-row copy (the Language row). */
    'settings.locale': SettingsLocaleKey
  }
}

/** Locale dictionary: flat key to template string ({name} placeholders). */
export type LocaleDict = Record<string, string>

/** Locale identifier: the two shipped locales. */
export type LocaleId = 'zh' | 'en'

/** One selectable locale: id plus its self-described display name. */
export interface LocaleDefinition {
  /** Locale id (persisted; the setLocale argument). */
  id: LocaleId
  /** Display name in its own language (中文 / English). */
  label: string
}

/** Immutable locale state published on every change. */
export interface LocaleSnapshot {
  /** Active locale id. */
  active: LocaleId
  /** Selectable locales in display order. */
  locales: readonly LocaleDefinition[]
  /** Monotonic change counter (registry or active changes). */
  revision: number
}

declare module 'cordis' {
  interface Context {
    locale: LocaleService
  }
  interface Events {
    /**
     * The active locale switched. Dictionary registrations do NOT emit this
     * event (listeners may re-register slots in response, and boot registers
     * one namespace per package); continuous render refresh rides the
     * LocaleFace revision instead.
     * @param snapshot - Current immutable locale snapshot.
     * @mode emit
     */
    'locale/change'(snapshot: LocaleSnapshot): void
  }
}

/** Fallback locale consulted after the active locale misses (also the last-resort initial locale). */
export const FALLBACK_LOCALE: LocaleId = 'zh'

/** Shared namespace for shell-level texts. */
export const COMMON_NS = 'common'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.locale'

/** localStorage key holding the persisted locale id. */
export const STORAGE_KEY = 'dsh.locale'

/** The two shipped locales. */
const LOCALES: ReadonlyArray<LocaleDefinition> = Object.freeze([
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
])

/**
 * Dictionary registry plus locale preference. Lookup chain per key: the
 * entry's namespace in the active locale -> that namespace's zh fallback ->
 * the shared common namespace (active, then zh) -> the key itself (missing
 * text stays visible, fail loud in the UI rather than blank). Reads go
 * through {@link getLocale}; writes only through {@link setLocale};
 * continuous sync through the `locale/change` event, or through the
 * LocaleFace getSnapshot/subscribe pair the render machinery consumes
 * (installed via `ctx.slots.installLocale`).
 */
export class LocaleService {
  private dicts = new Map<string, Map<string, LocaleDict>>()
  private bound = new Map<string, Translate>()
  private snapshot: LocaleSnapshot
  private listeners = new Set<() => void>()
  private readonly ctx: Context

  /**
   * @param ctx - owning context (change events are emitted on it).
   */
  constructor(ctx: Context) {
    this.ctx = ctx
    this.snapshot = Object.freeze({ active: resolveInitialLocale(), locales: LOCALES, revision: 0 })
  }

  /**
   * Read the current immutable locale snapshot.
   * @returns the current snapshot (stable reference until the next change).
   */
  getLocale(): LocaleSnapshot {
    return this.snapshot
  }

  /**
   * LocaleFace getSnapshot: the current snapshot (carries `revision`; stable
   * reference between changes, uSES-safe).
   * @returns the current snapshot.
   */
  getSnapshot(): LocaleSnapshot {
    return this.snapshot
  }

  /**
   * LocaleFace subscribe: notified on every snapshot change (locale switch
   * or dictionary registration — registrations bump the revision so already
   * rendered outlets pick up late-arriving dictionaries).
   * @param fn - change callback.
   * @returns unsubscribe.
   */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /**
   * Switch the active locale — the only preference write entry. Persists the
   * id and emits `locale/change`.
   * @param id - a registered locale id; unknown ids throw.
   */
  setLocale(id: string): void {
    const match = this.snapshot.locales.find(l => l.id === id)
    if (match === undefined) throw new Error(`locale "${id}" is not registered`)
    if (this.snapshot.active === match.id) return
    persistPreference(match.id)
    this.publish(match.id, true)
  }

  /**
   * Register a declared namespace's dictionaries, all locales in one call —
   * the typed form: each dictionary is checked against the namespace's
   * {@link LocaleNamespaceMap} key union (a missing or extra key is a
   * compile error), and every shipped locale is required (bilingual balance
   * enforced at registration). Duplicate (ns, locale) throws (single occupant; a
   * namespace's texts have one owner). Registration bumps the revision so
   * mounted outlets pick up late-arriving dictionaries.
   * @param ns - a namespace merged into LocaleNamespaceMap.
   * @param dicts - complete dictionaries keyed by locale id.
   * @returns disposer removing every locale registered by this call (idempotent).
   */
  register<N extends keyof LocaleNamespaceMap & string>(ns: N, dicts: Record<LocaleId, LocaleDictOf<N>>): () => void
  /**
   * Single-locale untyped form for namespaces outside the merge table
   * (dynamic composition, tests).
   * @param ns - namespace.
   * @param locale - locale tag.
   * @param dict - dictionary.
   * @returns disposer (idempotent).
   */
  register(ns: string, locale: string, dict: LocaleDict): () => void
  register(ns: string, localeOrDicts: string | Record<string, LocaleDict>, dict?: LocaleDict): () => void {
    const pairs: [string, LocaleDict][] = typeof localeOrDicts === 'string'
      // Overload guarantees dict on the single-locale arm.
      ? [[localeOrDicts, dict as LocaleDict]]
      : Object.entries(localeOrDicts)
    let locales = this.dicts.get(ns)
    if (!locales) {
      locales = new Map()
      this.dicts.set(ns, locales)
    }
    for (const [locale] of pairs) {
      if (locales.has(locale)) throw new Error(`locale namespace "${ns}" already has locale "${locale}"`)
    }
    for (const [locale, entries] of pairs) locales.set(locale, entries)
    this.publish(this.snapshot.active, false)
    return () => {
      const owner = this.dicts.get(ns)
      /* v8 ignore next -- defensive: a namespace's locales map is created on
       * first register and never removed, so the disposer always finds it. */
      if (!owner) return
      let removed = false
      for (const [locale, entries] of pairs) {
        if (owner.get(locale) === entries) {
          owner.delete(locale)
          removed = true
        }
      }
      if (removed) this.publish(this.snapshot.active, false)
    }
  }

  /**
   * Bind a declared namespace to a translate function typed to its
   * dictionary key union (plus the shared common vocabulary) — the same key
   * domain the framework-injected `t` seat carries. The returned reference
   * is stable per namespace (repeat binds return the same function), so it
   * can ride inject surfaces without breaking memoization.
   * @param ns - a namespace merged into LocaleNamespaceMap.
   * @returns the typed translate function (reads the active locale at call time).
   */
  bind<N extends keyof LocaleNamespaceMap & string>(ns: N): TranslateNS<N>
  /**
   * Untyped form for namespaces outside the merge table (dynamic
   * composition, tests).
   * @param ns - namespace.
   * @returns the translate function.
   */
  bind(ns: string): Translate
  bind(ns: string): Translate {
    let t = this.bound.get(ns)
    if (!t) {
      t = (key, params) => this.translate(ns, key, params)
      this.bound.set(ns, t)
      return t
    }
    return t
  }

  private translate(ns: string, key: string, params?: Record<string, unknown>): string {
    const template = this.lookup(ns, key)
      ?? (ns !== COMMON_NS ? this.lookup(COMMON_NS, key) : undefined)
      ?? key
    if (!params) { return template }
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
  }

  private lookup(ns: string, key: string): string | undefined {
    const locales = this.dicts.get(ns)
    return locales?.get(this.snapshot.active)?.[key] ?? locales?.get(FALLBACK_LOCALE)?.[key]
  }

  /**
   * Advance the snapshot revision and notify LocaleFace subscribers (render
   * refresh). Only an active-locale switch additionally emits
   * `locale/change` — dictionary registrations stay off the event so
   * registration-heavy boot cannot storm event listeners (which may
   * re-register slots in response).
   */
  private publish(active: LocaleId, localeChanged: boolean): void {
    this.snapshot = Object.freeze({
      active,
      locales: this.snapshot.locales,
      revision: this.snapshot.revision + 1,
    })
    if (localeChanged) this.ctx.emit('locale/change', this.snapshot)
    for (const fn of [...this.listeners]) {
      try {
        fn()
      } catch (error) {
        // One throwing subscriber must not strand the rest on a stale
        // revision (outlets would keep the previous language).
        console.error('locale subscriber crashed:', error)
      }
    }
  }
}

/**
 * The locale a fresh service opens with: an explicit preference the user
 * already chose wins over the browser's own language, which in turn wins over
 * {@link FALLBACK_LOCALE} (non-browser boots and browsers set to a language
 * this app does not ship).
 */
function resolveInitialLocale(): LocaleId {
  return restorePreference() ?? detectBrowserLocale() ?? FALLBACK_LOCALE
}

/** Read the persisted locale id; unknown or unreadable values read as no preference. */
function restorePreference(): LocaleId | undefined {
  // Non-browser runs (node e2e booting the client tree) have no localStorage.
  if (typeof localStorage === 'undefined') return undefined
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'zh' || stored === 'en') return stored
  } catch {
    // Storage access can throw (privacy mode); an unreadable store simply
    // records no preference, and the browser language decides instead.
  }
  return undefined
}

/**
 * The first shipped locale the browser asks for, matched on the primary
 * subtag so every regional variant lands on its language (`zh-Hans-CN` -> zh,
 * `en-GB` -> en). `window` is the browser test, not `navigator`: Node exposes
 * a global `navigator` reporting the machine's own language, which would
 * otherwise decide the locale for non-browser runs (node e2e booting the
 * client tree). `navigator.language` trails the ordered `languages` list and
 * covers its absence on hosts that expose only the single tag.
 */
function detectBrowserLocale(): LocaleId | undefined {
  if (typeof window === 'undefined') return undefined
  /* oxlint-disable-next-line typescript/no-unnecessary-condition --
   * The DOM lib types `languages` as always present; embedders and older
   * WebViews ship a Navigator without it, and spreading undefined would
   * throw at boot. Same environment-boundary distrust as the localStorage
   * guards below. */
  for (const tag of [...(navigator.languages ?? []), navigator.language]) {
    const primary = tag.toLowerCase().split('-')[0]
    const match = LOCALES.find(locale => locale.id === primary)
    if (match) return match.id
  }
  return undefined
}

/** Persist the locale id; storage failures are non-fatal (preference resets next boot). */
function persistPreference(id: LocaleId): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage access can throw (privacy mode / quota); the preference simply
    // does not survive the session.
  }
}

/** Required services: the slot registry (the feature registers its own settings row). */
export const inject = ['slots']

/**
 * Client plugin body: provide the locale service with base dictionaries and
 * register the feature-owned Language preference row into the General
 * section's item slot (a feature owns its settings surface).
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const locale = new LocaleService(ctx)
  locale.register(COMMON_NS, { zh, en })
  locale.register(SETTINGS_NS, { zh: settingsZh, en: settingsEn })
  ctx.provide('locale', locale)
  // The service IS the LocaleFace (bind + getSnapshot/subscribe): install it
  // so the render machinery can synthesize the `t` standard seat.
  ctx.slots.installLocale(locale)

  const store = createLanguageRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (snapshot: LocaleSnapshot): void => {
    bound?.sync(
      snapshot.active,
      snapshot.locales.map(l => ({ id: l.id, label: l.label })),
      snapshot.revision,
    )
  }
  ctx.on('locale/change', sync)
  const injected = (actions: BoundActions<typeof store>): LanguageRowInjected => {
    bound = actions
    // Re-sync from the getter so no event is lost between registration and
    // first render (the store's revision guard drops stale duplicates).
    sync(locale.getLocale())
    return {
      setLocale: (id) => { locale.setLocale(id) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'language',
    order: 0,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, LanguageRow))
}
