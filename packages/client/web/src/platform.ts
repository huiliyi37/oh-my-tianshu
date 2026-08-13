/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * @module @huiliyi37/dsh-client-web/src/platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@huiliyi37/cordis',
  '@huiliyi37/dsh-client-ui-slots',
  '@huiliyi37/dsh-client-web-react',
  '@huiliyi37/dsh-client-ui-primitives',
  '@huiliyi37/dsh-client-schema-form',
] as const

/** One platform module specifier (a seed-table key). */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]
