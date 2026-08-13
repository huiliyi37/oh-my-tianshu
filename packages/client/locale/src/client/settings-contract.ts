/**
 * The `settings.general.item` slot type — one preference row inside the
 * settings General section, contributed by the feature plugin that owns the
 * preference (locale → Language, ui-theme → Appearance). Options: `id` (row
 * key), `order` (row position). Rows draw their own internals (row layout,
 * separators via CSS); the section column only stacks them.
 *
 * TYPE HOME RATIONALE: the slot is declared at runtime by
 * ui-settings-general's General entry, but its type lives here — this
 * package is the common dependency of every item registrant (any settings
 * row carries copy, so every registrant already depends on locale), whereas
 * the declarer's own contract is unreachable for locale/ui-theme without a
 * reference cycle.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One preference row inside the settings General section (see module JSDoc). */
    'settings.general.item': { kind: 'list'; scope: 'root'; owner: SettingsGeneralItemOwnerProps }
  }
}

/** Owner share of a General preference row (the section supplies nothing). */
export interface SettingsGeneralItemOwnerProps {
  /** Marker field: item owner props are intentionally empty. */
  children?: never
}
