/**
 * The `/welcome` mascot-toggle command factory.
 *
 * Kept out of the app assembly so the monolith carries one registration call
 * instead of the command body. The settled welcome block is append-only
 * scrollback, so a switch takes effect on the next startup (or immediately
 * while the intro is still unsettled, since settlement re-reads the
 * preference).

 * @module @huiliyi37/dsh-tui/controllers/welcome-mascot-command
 */

import type { SlashCommand } from '../commands/registry.js'
import { WELCOME_MASCOTS, type WelcomeMascot } from '../format/welcome-mascots.js'

/** Caller's view of the welcome mascot preference. */
export interface WelcomeMascotCommandDeps {
  /** Effective mascot: user preference over the deployment default. */
  currentMascot(): WelcomeMascot
  /** Persists the user's mascot choice. */
  setMascot(mascot: WelcomeMascot): void
}

/**
 * Creates the `/welcome [whale|fox]` command: no argument echoes the active
 * mascot and the choices; a valid argument persists the choice; anything else
 * is rejected with the valid set.
 *
 * @param deps - Preference read/write closures.
 * @returns The slash command registration.
 */
export function createWelcomeMascotCommand(deps: WelcomeMascotCommandDeps): SlashCommand {
  return {
    name: 'welcome',
    description: '切换欢迎页吉祥物（whale 鲸鱼 / fox 狐狸）',
    argsHint: '[whale|fox]',
    run: ({ text, echo }) => {
      const arg = text.trim()
      const current = deps.currentMascot()
      if (arg === '') {
        echo(`欢迎页吉祥物：${current}（可选: ${WELCOME_MASCOTS.join(' / ')}）`)
        return
      }
      if (!(WELCOME_MASCOTS as readonly string[]).includes(arg)) {
        echo(`未知吉祥物: ${arg}。可用: ${WELCOME_MASCOTS.join(', ')}`)
        return
      }
      if (arg === current) {
        echo(`欢迎页吉祥物已是 ${arg}`)
        return
      }
      deps.setMascot(arg as WelcomeMascot)
      echo(`欢迎页吉祥物已切换: ${arg}（下次启动生效）`)
    },
  }
}
