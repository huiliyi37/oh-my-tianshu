import type { ToolSchema } from '@deepseek-ai/dsh-llm/types'
import type { HistoryEntry } from '@deepseek-ai/dsh-client-connection/client'
import type {
  ConversationNode, PartialAssistant, RunningToolCall,
} from './conversation.ts'
import type { ConversationContext } from './conversation-context.ts'
import { projectConversationHistory } from '../session-history/history-fold.ts'
import { inspectRequests, type RequestView } from './request-inspection.ts'

function assistantStepKey(turn: number, step: number): string {
  return `${turn}\u0000${step}`
}

function isFirstTokenCandidate(entry: HistoryEntry): boolean {
  const event = entry.event
  if (event.type !== 'assistant/chunk') return false
  switch (event.data.chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return event.data.chunk.text !== ''
    case 'tool-call-delta':
      return event.data.chunk.argumentsDelta !== '' || event.data.chunk.name !== undefined
    default:
      return false
  }
}

/** Lazily derived inspection data for one immutable session-history window. */
export interface SessionHistoryInspection {
  eventNodes: readonly ConversationNode[]
  contexts: readonly ConversationContext[]
  requests: readonly RequestView[]
  callSchemas: ReadonlyMap<string, ToolSchema>
  interruptedNodes: readonly ConversationNode[]
  partial: PartialAssistant | null
  runningCalls: readonly RunningToolCall[]
}

/**
 * Remove completed-step token payloads that no inspection projection reads.
 * The first visible token preserves timing, usage chunks preserve accounting,
 * and unfinished steps retain every chunk for live or interrupted content.
 * @param entries - Contiguous raw history entries in sequence order.
 * @returns A projection-equivalent, usually much smaller entry ledger.
 */
export function compactHistoryInspectionEntries(
  entries: readonly HistoryEntry[],
): readonly HistoryEntry[] {
  const completedSteps = new Set<string>()
  for (const { event } of entries) {
    if (event.type === 'assistant/message') {
      completedSteps.add(assistantStepKey(event.data.turn, event.data.step))
    }
  }

  const firstTokenSteps = new Set<string>()
  const compacted: HistoryEntry[] = []
  let changed = false
  for (const entry of entries) {
    const event = entry.event
    if (event.type !== 'assistant/chunk') {
      compacted.push(entry)
      continue
    }
    const key = assistantStepKey(event.data.turn, event.data.step)
    if (!completedSteps.has(key) || event.data.chunk.type === 'usage') {
      compacted.push(entry)
      continue
    }
    if (isFirstTokenCandidate(entry) && !firstTokenSteps.has(key)) {
      firstTokenSteps.add(key)
      compacted.push(entry)
    } else {
      changed = true
    }
  }
  return changed ? compacted : entries
}

/**
 * Create a lazy inspection projection over an immutable history window.
 * Conversation consumers retain the cheap wrapper; only Trajectory snapshots
 * the entries and replays event order and request lifecycle state.
 * @param loadEntries - Lazily snapshots contiguous raw entries in sequence order.
 * @returns Lazy, memoized inspection fields for that exact window.
 */
export function createHistoryInspection(
  loadEntries: () => readonly HistoryEntry[],
): SessionHistoryInspection {
  let entries: ReadonlyArray<HistoryEntry> | undefined
  let conversation: ReturnType<typeof projectConversationHistory> | undefined
  let requests: ReturnType<typeof inspectRequests> | undefined
  const historyEntries = () => entries ??= loadEntries()
  const conversationProjection = () =>
    conversation ??= projectConversationHistory(historyEntries())
  const requestProjection = () =>
    requests ??= inspectRequests(historyEntries())
  return {
    get eventNodes() {
      return conversationProjection().eventNodes
    },
    get contexts() {
      return conversationProjection().contexts
    },
    get interruptedNodes() {
      return conversationProjection().interruptedNodes
    },
    get partial() {
      return conversationProjection().partial
    },
    get runningCalls() {
      return conversationProjection().runningCalls
    },
    get requests() {
      return requestProjection().requests
    },
    get callSchemas() {
      return requestProjection().callSchemas
    },
  }
}
