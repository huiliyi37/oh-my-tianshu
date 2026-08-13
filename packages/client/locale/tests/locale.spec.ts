// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import { LocaleService, STORAGE_KEY } from '@deepseek-ai/dsh-client-locale/client'

const make = (): { ctx: Context; svc: LocaleService; events: LocaleSnapshot[] } => {
  const ctx = new Context()
  const events: LocaleSnapshot[] = []
  ctx.on('locale/change', (snapshot) => { events.push(snapshot) })
  return { ctx, svc: new LocaleService(ctx), events }
}

/**
 * Pin the browser environment a fresh service reads its initial locale from.
 * This package's own specs stub the globals directly instead of using
 * `usePinnedBrowserLanguages` (dsh-client-test-runtime): they need the shapes
 * that helper deliberately cannot express — a missing `languages` list, a
 * list decoupled from `language`, and a non-browser run with no `window`.
 */
const stubLanguages = (...tags: string[]): void => {
  vi.stubGlobal('navigator', { languages: tags, language: tags[0] ?? '' })
}

describe('LocaleService', () => {
  beforeEach(() => {
    localStorage.clear()
    // A Chinese browser is the baseline these specs assert their zh state on.
    stubLanguages('zh-CN')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('translates through the active-locale -> zh -> key chain', () => {
    const { svc } = make()
    svc.register('ns', 'zh', { hello: '你好', onlyZh: '仅中文' })
    svc.register('ns', 'en', { hello: 'Hello' })
    const t = svc.bind('ns')
    expect(svc.getLocale().active).toBe('zh')
    expect(t('hello')).toBe('你好')
    svc.setLocale('en')
    expect(t('hello')).toBe('Hello')
    expect(t('onlyZh')).toBe('仅中文')
    expect(t('missing.key')).toBe('missing.key')
  })

  it('falls through to the common vocabulary after the namespace misses (production keys)', () => {
    const { svc } = make()
    // The shipped common pair is registered by apply; the bench registers it
    // directly to pin the production chain: ns -> common -> zh -> key.
    svc.register('common', 'zh', { retry: '重试' })
    svc.register('common', 'en', { retry: 'Retry' })
    svc.register('ns', 'zh', { own: '自有' })
    const t = svc.bind('ns')
    expect(t('retry')).toBe('重试')
    svc.setLocale('en')
    expect(t('retry')).toBe('Retry')
    expect(t('own')).toBe('自有')
    // common itself must not recurse: a miss inside common echoes the key.
    // (Wide-string ns hits the untyped bind overload — the typed one rejects
    // unknown keys at compile time, which is the point of the typed registry contract.)
    expect(svc.bind('common' as string)('nope')).toBe('nope')
  })

  it('interpolates {name} params and leaves unknown placeholders intact', () => {
    const { svc } = make()
    svc.register('ns', 'zh', { greet: '你好，{name}！第 {n} 次', partial: '{known} 与 {unknown}' })
    const t = svc.bind('ns')
    expect(t('greet', { name: '世界', n: 2 })).toBe('你好，世界！第 2 次')
    expect(t('partial', { known: 'A' })).toBe('A 与 {unknown}')
  })

  it('bind returns a stable per-namespace function identity', () => {
    const { svc } = make()
    expect(svc.bind('a')).toBe(svc.bind('a'))
    expect(svc.bind('a')).not.toBe(svc.bind('b'))
  })

  it('rejects duplicate (ns, locale) and disposer only removes its own dict', () => {
    const { svc } = make()
    const dispose = svc.register('ns', 'zh', { k: 'v1' })
    expect(() => svc.register('ns', 'zh', { k: 'v2' })).toThrow('already has locale')
    dispose()
    const t = svc.bind('ns')
    expect(t('k')).toBe('k')
    svc.register('ns', 'zh', { k: 'v2' })
    expect(t('k')).toBe('v2')
    dispose()
    expect(t('k')).toBe('v2')
  })

  it('serves the LocaleFace: snapshot revision moves on switch and registration, subscribers fire, unsubscribe stops them', () => {
    const { svc } = make()
    const seen: number[] = []
    const off = svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
    expect(svc.getSnapshot()).toBe(svc.getLocale())
    const r0 = svc.getSnapshot().revision
    svc.register('ns', 'zh', { k: 'v' })
    expect(svc.getSnapshot().revision).toBe(r0 + 1)
    svc.setLocale('en')
    expect(seen).toEqual([r0 + 1, r0 + 2])
    off()
    svc.setLocale('zh')
    expect(seen).toHaveLength(2)
  })

  it('isolates a throwing subscriber: the rest still see the new revision', () => {
    const { svc } = make()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const seen: number[] = []
      svc.subscribe(() => { throw new Error('boom') })
      svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
      svc.setLocale('en')
      expect(seen).toEqual([1])
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      spy.mockRestore()
    }
  })

  it('register disposer republishes (mounted outlets drop the dead dictionary)', () => {
    const { svc } = make()
    const dispose = svc.register('ns', 'zh', { k: 'v' })
    const before = svc.getSnapshot().revision
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
    // Second run hits the idempotent arm: nothing removed, no republish.
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
  })

  it('setLocale persists, republishes an immutable snapshot, and no-ops on same value', () => {
    const { svc, events } = make()
    svc.setLocale('en')
    expect(svc.getLocale().active).toBe('en')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('en')
    expect(events).toHaveLength(1)
    expect(events[0]).toBe(svc.getLocale())
    expect(events[0]!.revision).toBe(1)
    svc.setLocale('en')
    expect(events).toHaveLength(1)
  })

  it('throws on unknown locale ids', () => {
    const { svc } = make()
    expect(() => { svc.setLocale('fr') }).toThrow('not registered')
  })

  it('restores a persisted locale over the browser language, and garbage reads as no preference', () => {
    localStorage.setItem(STORAGE_KEY, 'en')
    expect(make().svc.getLocale().active).toBe('en')
    localStorage.setItem(STORAGE_KEY, 'fr')
    expect(make().svc.getLocale().active).toBe('zh')
  })

  it('opens in the browser language when nothing is persisted, matching regional variants on their primary subtag', () => {
    stubLanguages('en-GB', 'zh-CN')
    expect(make().svc.getLocale().active).toBe('en')
    stubLanguages('zh-Hant-TW')
    expect(make().svc.getLocale().active).toBe('zh')
    // An unshipped language walks the list to the first one this app ships.
    stubLanguages('fr-FR', 'en-US')
    expect(make().svc.getLocale().active).toBe('en')
    // Only `language` populated: an empty ordered list, and a host that
    // exposes no `languages` property at all.
    vi.stubGlobal('navigator', { languages: [], language: 'en-US' })
    expect(make().svc.getLocale().active).toBe('en')
    vi.stubGlobal('navigator', { language: 'en-US' })
    expect(make().svc.getLocale().active).toBe('en')
    // No shipped language anywhere in the browser's preferences: zh remains
    // the product default rather than an arbitrary near-match.
    stubLanguages('fr-FR', 'de')
    expect(make().svc.getLocale().active).toBe('zh')
  })

  it('runs outside a browser (node boots): the fallback decides, the machine language does not, writes no-op', () => {
    vi.stubGlobal('localStorage', undefined)
    vi.stubGlobal('window', undefined)
    // Node exposes its own global navigator; without a window it must not
    // reach the resolution at all.
    stubLanguages('en-US')
    const { svc } = make()
    expect(svc.getLocale().active).toBe('zh')
    svc.setLocale('en')
    expect(svc.getLocale().active).toBe('en')
  })

  it('keeps the browser language out of the way once a preference exists', () => {
    stubLanguages('en-US')
    const { svc } = make()
    svc.setLocale('zh')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('zh')
    expect(make().svc.getLocale().active).toBe('zh')
  })

  it('exposes the two shipped locales with self-described labels', () => {
    const { svc } = make()
    expect(svc.getLocale().locales).toEqual([
      { id: 'zh', label: '中文' },
      { id: 'en', label: 'English' },
    ])
  })
})
