/**
 * Re-export outlet for the `settings.general.item` slot type consumed by this
 * package's Appearance row. The canonical home is the locale package (the
 * common dependency of every item registrant); this file exists so row
 * modules import the type from within their own package.
 */
export type { SettingsGeneralItemOwnerProps } from '@deepseek-ai/dsh-client-locale/client'
// Side-effect type import: pulls the SlotMap merge into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
