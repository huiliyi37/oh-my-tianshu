/**
 * Per-turn cache snapshot folding over the durable session log. Each turn
 * aggregates the provider usage of every assistant message that reported it;
 * a turn with no usage produces no snapshot. Adapted from the opencode-tui
 * upstream `TurnCacheSnapshot` accumulation with the harness field vocabulary.
 *
 * Pure module: `foldTurnSnapshots` replays a full event list; the service
 * layer runs the same fold incrementally over the live log.
 *
 * @module @huiliyi37/dsh-cache-diagnostic/turn-snapshot
 */

import type { SessionEvent } from '@huiliyi37/dsh-session'
import type { TurnCacheSnapshot } from './diagnose.ts'

/**
 * Fold a session log (or any prefix of it) into per-turn cache snapshots.
 * @param events - session events in log order.
 * @returns one snapshot per turn that reported provider usage, in turn order.
 */
export function foldTurnSnapshots(events: readonly SessionEvent[]): TurnCacheSnapshot[] {
  const byTurn = new Map<number, TurnCacheSnapshot>()
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const usage = event.data.usage
    if (usage === undefined) continue
    const turn = event.data.turn
    const existing = byTurn.get(turn)
    if (existing === undefined) {
      byTurn.set(turn, {
        turn,
        cacheRead: usage.cacheReadTokens ?? 0,
        cacheWrite: usage.cacheWriteTokens ?? 0,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      })
    } else {
      existing.cacheRead += usage.cacheReadTokens ?? 0
      existing.cacheWrite += usage.cacheWriteTokens ?? 0
      existing.inputTokens += usage.inputTokens
      existing.outputTokens += usage.outputTokens
    }
  }
  const entries = [...byTurn.entries()].sort(([a], [b]) => a - b)
  return entries.map(([, snapshot]) => snapshot)
}
