/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '产物',
  'produced.more': '还有 {count} 个',
  'produced.open': '打开 {name}',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.more': '{count} more',
  'produced.open': 'Open {name}',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
