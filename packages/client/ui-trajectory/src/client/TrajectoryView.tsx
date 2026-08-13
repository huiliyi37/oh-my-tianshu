/** Trajectory view: compact summary over a turn-aware event ledger. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AssistantBlock, AssistantMessageNode, ConversationContext, ConversationSnapshot,
  SessionHistoryFace, SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  deriveTrajectoryContextBranches, trajectoryBranchContainsRequest,
} from './context-branches.ts'
import {
  TrajectoryTable,
  type TrajectoryRequestNumber,
  type TrajectoryUsage,
} from './TrajectoryTable.tsx'
import { TrajectoryToolbar } from './TrajectoryToolbar.tsx'
import { TrajectoryTimeline } from './TrajectoryTimeline.tsx'
import {
  appendTrajectoryPartialLayout, deriveTrajectoryLayout,
  type TrajectoryTurnModel,
} from './layout.ts'
import {
  trajectoryTimelineFocusIndexes,
  type TrajectoryTimelineMode,
  type TrajectoryTimeRange,
} from './timeline.ts'
import { trajectoryRecordId } from './trajectory-record.ts'
import css from './views.module.css'

const EMPTY_TURN_IDS: ReadonlySet<number> = new Set()
const EMPTY_RECORD_IDS: ReadonlySet<string> = new Set()

function lastCellIndex(turns: readonly TrajectoryTurnModel[]): number {
  let last = 0
  for (const turn of turns) {
    for (const group of turn.groups) {
      for (const cell of group.cells) last = Math.max(last, cell.index)
    }
  }
  return last
}

function timelineBlock(block: AssistantBlock): AssistantBlock {
  switch (block.kind) {
    case 'text': return { kind: 'text', text: '' }
    case 'reasoning': return { kind: 'reasoning', text: '' }
    case 'tool-call': return {
      kind: 'tool-call',
      callId: block.callId,
      name: block.name,
      argsRaw: '',
    }
    case 'other': return { kind: 'other', block: null }
  }
}

function partialStructureSignature(partial: ConversationSnapshot['partial']): string {
  if (partial === null) return ''
  return partial.blocks.map(block => block.kind === 'tool-call'
    ? `${block.kind}:${block.callId}:${block.name}`
    : block.kind).join('\u0000')
}

/** Session-history paging needed by the event-complete trajectory view. */
export interface TrajectoryViewInjected {
  hooks: {
    history: SessionHistoryFace
    duration: SnapshotStore<boolean>
  }
  loadHistoryTail: (signal: AbortSignal) => Promise<void>
  loadOlderHistory: (signal: AbortSignal) => Promise<boolean>
  setActualDuration: (actualDuration: boolean) => void
}

interface UsageLike {
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

function requestUsage(value: unknown): TrajectoryUsage | undefined {
  const usage = value as UsageLike | undefined
  if (usage === undefined) return undefined
  return {
    ...(usage.inputTokens === undefined ? {} : { input: usage.inputTokens }),
    ...(usage.cacheReadTokens === undefined ? {} : { cacheRead: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWrite: usage.cacheWriteTokens }),
    ...(usage.outputTokens === undefined ? {} : { output: usage.outputTokens }),
    ...(usage.reasoningTokens === undefined ? {} : { reasoning: usage.reasoningTokens }),
  }
}

function addUsage(
  total: TrajectoryUsage | undefined,
  usage: TrajectoryUsage | undefined,
): TrajectoryUsage | undefined {
  if (usage === undefined) return total
  return {
    ...(total?.input === undefined && usage.input === undefined
      ? {}
      : { input: (total?.input ?? 0) + (usage.input ?? 0) }),
    ...(total?.cacheRead === undefined && usage.cacheRead === undefined
      ? {}
      : { cacheRead: (total?.cacheRead ?? 0) + (usage.cacheRead ?? 0) }),
    ...(total?.cacheWrite === undefined && usage.cacheWrite === undefined
      ? {}
      : { cacheWrite: (total?.cacheWrite ?? 0) + (usage.cacheWrite ?? 0) }),
    ...(total?.output === undefined && usage.output === undefined
      ? {}
      : { output: (total?.output ?? 0) + (usage.output ?? 0) }),
    ...(total?.reasoning === undefined && usage.reasoning === undefined
      ? {}
      : { reasoning: (total?.reasoning ?? 0) + (usage.reasoning ?? 0) }),
  }
}

function searchableJson(value: unknown): string {
  if (value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function searchMatches(
  turns: ReturnType<typeof deriveTrajectoryLayout>,
  query: string,
): ReadonlySet<number> | null {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return null
  const matches = new Set<number>()
  for (const turn of turns) {
    for (const group of turn.groups) {
      for (const cell of group.cells) {
        if (cell.requestOnly === true) continue
        const blocks = [
          ...(cell.sourceBlocks ?? []),
          ...(cell.outputBlocks ?? []),
        ]
        const text = [
          turn.turn === null ? 'between turns' : `turn ${turn.turn}`,
          group.title,
          cell.kind,
          cell.kind === 'message' ? 'assistant' : undefined,
          cell.text,
          cell.inputDetail,
          cell.outputDetail,
          cell.thinkingDetail,
          cell.schemaDetail,
          cell.result,
          cell.callId,
          ...blocks.flatMap(block => [
            block.type,
            block.content,
            block.callId,
            block.toolName,
            block.imageAlt,
          ]),
          searchableJson(cell.messageSource),
          searchableJson(cell.promptDetail),
          searchableJson(cell.previousPromptDetail),
        ].filter((value): value is string => typeof value === 'string')
          .join('\n')
          .toLocaleLowerCase()
        if (terms.every(term => text.includes(term))) matches.add(cell.index)
      }
    }
  }
  return matches
}

function mergeSearchMatches(
  finalized: ReadonlySet<number> | null,
  partial: ReadonlySet<number> | null,
): ReadonlySet<number> | null {
  if (finalized === null || partial === null) return null
  return new Set([...finalized, ...partial])
}

export function TrajectoryView({
  useHistory, useDuration, loadHistoryTail, loadOlderHistory, setActualDuration,
  inspect, onInspectDone,
}: ConvViewProps & InjectFace<TrajectoryViewInjected>) {
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(EMPTY_TURN_IDS)
  const [collapsedAssistants, setCollapsedAssistants] =
    useState<ReadonlySet<string>>(EMPTY_RECORD_IDS)
  const [timelineSelection, setTimelineSelection] = useState<{
    branchKey: string
    range: TrajectoryTimeRange
  } | null>(null)
  const actualDuration = useDuration(value => value)
  const [actualTime, setActualTime] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTimelineIndex, setSelectedTimelineIndex] = useState<number | null>(null)
  const [timelineRecordSelection, setTimelineRecordSelection] = useState<{
    readonly index: number
  } | null>(null)
  const [timelineRecordFocus, setTimelineRecordFocus] = useState<{
    readonly index: number
  } | null>(null)
  const inspection = useHistory(snapshot => snapshot.inspection)
  const historyLoading = useHistory(snapshot =>
    snapshot.state === 'cold' || snapshot.state === 'loading')
  const hasOlderHistory = useHistory(snapshot => snapshot.hasMore)
  const historyBaseSeq = useHistory(snapshot => snapshot.baseSeq)
  const nodes = inspection.eventNodes
  const partial = inspection.partial
  const runningCalls = inspection.runningCalls
  const loadHistoryTailRef = useRef(loadHistoryTail)
  loadHistoryTailRef.current = loadHistoryTail
  const historyControllerRef = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    historyControllerRef.current = controller
    void loadHistoryTailRef.current(controller.signal)
    return () => { controller.abort() }
  }, [])
  const requests = inspection.requests
  const callSchemas = inspection.callSchemas
  const historyContexts = inspection.contexts
  const interruptedNodes = inspection.interruptedNodes
  const contexts = useMemo<readonly ConversationContext[]>(
    () => historyContexts.length === 0
      ? [{ id: 0, nodes }]
      : historyContexts,
    [historyContexts, nodes],
  )
  const branches = useMemo(
    () => deriveTrajectoryContextBranches(contexts),
    [contexts],
  )
  const currentBranch = branches.at(-1)
  if (currentBranch === undefined) throw new Error('trajectory branch projection must not be empty')
  const selectedNodes = useMemo(() => {
    const selected = new Map(currentBranch.nodes.map(node => [node.seq, node]))
    for (const node of interruptedNodes) {
      selected.set(node.seq, node)
    }
    return [...selected.values()].sort((left, right) => left.seq - right.seq)
  }, [currentBranch.nodes, interruptedNodes])
  const selectedRequests = useMemo(
    () => requests.filter(request =>
      trajectoryBranchContainsRequest(currentBranch, request),
    ),
    [currentBranch, requests],
  )
  const requestNumbers = useMemo<readonly TrajectoryRequestNumber[]>(() => {
    const assistantsByStep = new Map<string, AssistantMessageNode>()
    for (const context of contexts) {
      for (const node of context.nodes) {
        if (node.kind !== 'assistant' || node.step <= 0) continue
        assistantsByStep.set(`${node.turn}\u0000${node.step}`, node)
      }
    }
    for (const node of nodes) {
      if (node.kind !== 'assistant' || node.step <= 0) continue
      assistantsByStep.set(`${node.turn}\u0000${node.step}`, node)
    }
    const requestsByStep = new Map(
      requests
        .filter(request => request.purpose === 'assistant')
        .map(request => [
          `${request.turn}\u0000${request.step}`,
          request,
        ]),
    )
    const orderedRequests = [
      ...requests.map(request => ({
        seq: request.startSeq,
        request,
        node: request.purpose === 'assistant'
          ? assistantsByStep.get(`${request.turn}\u0000${request.step}`)
          : undefined,
      })),
      ...[...assistantsByStep.entries()].flatMap(([key, node]) =>
        requestsByStep.has(key)
          ? []
          : [{
            seq: node.seq,
            request: undefined,
            node,
          }],
      ),
    ].sort((left, right) => left.seq - right.seq)
    const numbered: TrajectoryRequestNumber[] = []
    let cumulativeUsage: TrajectoryUsage | undefined
    for (const [index, entry] of orderedRequests.entries()) {
      const usage = requestUsage(entry.request?.usage ?? entry.node?.usage)
      cumulativeUsage = addUsage(cumulativeUsage, usage)
      if (entry.request?.purpose !== 'compaction') {
        const request = entry.request
        const node = entry.node
        const turn = request?.turn ?? node?.turn
        const step = request?.step ?? node?.step
        if (turn === undefined || step === undefined) continue
        const provider = request?.provenance?.provider ?? node?.provenance?.provider
        const model = request?.provenance?.model ?? node?.provenance?.model
        const requestConfig = request?.requestConfig ?? node?.requestConfig
        numbered.push({
          seq: entry.seq,
          turn,
          step,
          group: `Step ${step}`,
          number: index + 1,
          ...(request?.status === undefined ? {} : { status: request.status }),
          ...(request?.startedAt === undefined ? {} : { startedAt: request.startedAt }),
          ...(request?.completedAt === undefined ? {} : { completedAt: request.completedAt }),
          ...(request?.error === undefined ? {} : { error: request.error }),
          ...(request?.resultSeq === undefined ? {} : { resultSeq: request.resultSeq }),
          ...(request?.retry === undefined ? {} : { retry: request.retry }),
          ...(request?.maxRetries === undefined ? {} : { maxRetries: request.maxRetries }),
          ...(request?.retryDelayMs === undefined
            ? {}
            : { retryDelayMs: request.retryDelayMs }),
          ...(provider === undefined ? {} : { provider }),
          ...(model === undefined ? {} : { model }),
          ...(requestConfig === undefined ? {} : { requestConfig }),
          ...(usage === undefined ? {} : { usage }),
          ...(cumulativeUsage === undefined ? {} : { cumulativeUsage }),
        })
        continue
      }
      const request = entry.request
      numbered.push({
        seq: request.startSeq,
        turn: request.turn,
        step: 0,
        group: `Compaction ${request.startSeq}`,
        number: index + 1,
        purpose: 'compaction',
        status: request.status,
        startedAt: request.startedAt,
        completedAt: request.completedAt,
        ...(request.error === undefined ? {} : { error: request.error }),
        resultSeq: request.startSeq,
        ...(request.provenance?.provider === undefined
          ? {}
          : { provider: request.provenance.provider }),
        ...(request.provenance?.model === undefined
          ? {}
          : { model: request.provenance.model }),
        ...(request.requestConfig === undefined ? {} : { requestConfig: request.requestConfig }),
        ...(usage === undefined ? {} : { usage }),
        ...(cumulativeUsage === undefined ? {} : { cumulativeUsage }),
      })
    }

    return numbered
  }, [
    contexts, nodes, requests,
  ])
  const partialTurn = partial?.turn ?? null
  const partialStep = partial?.step ?? null
  const finalized = useMemo(() => {
    const turns = deriveTrajectoryLayout({
      nodes: selectedNodes,
      partial: partialTurn === null || partialStep === null
        ? null
        : { turn: partialTurn, step: partialStep, blocks: [] },
      runningCalls,
      requests: selectedRequests,
      callSchemas,
    })
    return { turns, lastIndex: lastCellIndex(turns) }
  }, [
    selectedNodes, partialTurn, partialStep,
    runningCalls, selectedRequests, callSchemas,
  ])
  const timelinePartialSignature = partialStructureSignature(partial)
  const timelinePartial = useMemo<ConversationSnapshot['partial']>(() => partial === null
    ? null
    : {
      turn: partial.turn,
      step: partial.step,
      blocks: partial.blocks.map(block => timelineBlock(block)),
    },
  [partialStep, partialTurn, timelinePartialSignature])
  const timelineTurns = useMemo(
    () => appendTrajectoryPartialLayout(finalized.turns, timelinePartial, finalized.lastIndex),
    [finalized, timelinePartial],
  )
  const timelineMode: TrajectoryTimelineMode = actualDuration
    ? actualTime ? 'actual' : 'duration'
    : actualTime ? 'time' : 'sequence'
  const finalizedSearchMatches = useMemo(
    () => searchMatches(finalized.turns, searchQuery),
    [finalized, searchQuery],
  )
  const partialSearchTurns = useMemo(
    () => appendTrajectoryPartialLayout([], partial, finalized.lastIndex),
    [finalized.lastIndex, partial],
  )
  const streamingCells = useMemo(
    () => partialSearchTurns.flatMap(turn =>
      turn.groups.flatMap(group => group.cells),
    ),
    [partialSearchTurns],
  )
  const partialSearchMatches = useMemo(
    () => searchMatches(partialSearchTurns, searchQuery),
    [partialSearchTurns, searchQuery],
  )
  const searchMatchIndexes = useMemo(
    () => mergeSearchMatches(finalizedSearchMatches, partialSearchMatches),
    [finalizedSearchMatches, partialSearchMatches],
  )
  const timelineRange = timelineSelection?.branchKey === currentBranch.key
    ? timelineSelection.range
    : null
  const timelineFocusIndexes = useMemo(
    () => timelineRange === null
      ? null
      : trajectoryTimelineFocusIndexes(timelineTurns, timelineRange, timelineMode),
    [timelineMode, timelineRange, timelineTurns],
  )
  const handleRecordSelect = useCallback((index: number) => {
    if (
      timelineFocusIndexes !== null
      && !timelineFocusIndexes.has(index)
    ) {
      setTimelineSelection(null)
    }
  }, [timelineFocusIndexes])
  const handleTimelineRangeChange = useCallback((range: TrajectoryTimeRange | null) => {
    setTimelineSelection(range === null ? null : {
      branchKey: currentBranch.key,
      range,
    })
  }, [currentBranch.key])
  const handleTimelineRecordSelect = useCallback((index: number) => {
    setTimelineSelection(null)
    setTimelineRecordSelection({ index })
    setSelectedTimelineIndex(index)
  }, [])
  const handleTimelineRecordFocus = useCallback((index: number) => {
    setTimelineRecordFocus({ index })
  }, [])
  const collapsibleTurnIds = useMemo(
    () => timelineTurns
      .filter(turn =>
        turn.turn !== null
        &&
        turn.groups.reduce(
          (count, group) =>
            count + group.cells.filter(cell =>
              cell.requestOnly !== true && cell.kind !== 'system').length,
          0,
        ) > 1)
      .flatMap(turn => turn.turn === null ? [] : [turn.turn]),
    [timelineTurns],
  )
  const allTurnsCollapsed = collapsibleTurnIds.length > 0
    && collapsibleTurnIds.every(turn => collapsedTurns.has(turn))
  const collapsibleAssistantIds = useMemo(() => {
    const ids: string[] = []
    for (const turn of timelineTurns) {
      const cells = turn.groups.flatMap(group => group.cells)
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]
        if (cell?.kind !== 'message') continue
        const next = cells[i + 1]
        if (next?.kind === 'tool' || next?.kind === 'subtool') {
          ids.push(trajectoryRecordId(cell))
        }
      }
    }
    return ids
  }, [timelineTurns])
  const allAssistantsCollapsed = collapsibleAssistantIds.length > 0
    && collapsibleAssistantIds.every(index => collapsedAssistants.has(index))

  const toggleTurn = (turn: number) => {
    setCollapsedTurns((current) => {
      const collapsed = new Set(current)
      if (collapsed.has(turn)) collapsed.delete(turn)
      else collapsed.add(turn)
      return collapsed
    })
  }

  const toggleAllTurns = () => {
    setCollapsedTurns((current) => {
      const collapsed = new Set(current)
      if (allTurnsCollapsed) {
        for (const turn of collapsibleTurnIds) collapsed.delete(turn)
      } else {
        for (const turn of collapsibleTurnIds) collapsed.add(turn)
      }
      return collapsed
    })
  }

  const toggleAssistant = (id: string) => {
    setCollapsedAssistants((current) => {
      const collapsed = new Set(current)
      if (collapsed.has(id)) collapsed.delete(id)
      else collapsed.add(id)
      return collapsed
    })
  }

  const toggleAllAssistants = () => {
    setCollapsedAssistants((current) => {
      const collapsed = new Set(current)
      if (allAssistantsCollapsed) {
        for (const index of collapsibleAssistantIds) collapsed.delete(index)
      } else {
        for (const index of collapsibleAssistantIds) collapsed.add(index)
      }
      return collapsed
    })
  }

  const loadEarlierHistory = useCallback(() => {
    const signal = historyControllerRef.current?.signal
    return signal?.aborted === false
      ? loadOlderHistory(signal)
      : Promise.resolve(false)
  }, [loadOlderHistory])

  return (
    <div className={css.root} data-conversation-composer-overlay="">
      <TrajectoryToolbar
        actualDuration={actualDuration}
        onActualDurationChange={(nextActualDuration) => {
          setActualDuration(nextActualDuration)
          setTimelineSelection(null)
        }}
        actualTime={actualTime}
        onActualTimeChange={(nextActualTime) => {
          setActualTime(nextActualTime)
          setTimelineSelection(null)
        }}
        allTurnsCollapsed={allTurnsCollapsed}
        onToggleAllTurns={toggleAllTurns}
        allAssistantsCollapsed={allAssistantsCollapsed}
        onToggleAllAssistants={toggleAllAssistants}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
      />
      <TrajectoryTimeline
        turns={timelineTurns}
        mode={timelineMode}
        range={timelineRange}
        hasEarlierRecords={hasOlderHistory}
        onLoadEarlier={loadEarlierHistory}
        selectedIndex={selectedTimelineIndex}
        searchMatchIndexes={searchMatchIndexes}
        onRangeChange={handleTimelineRangeChange}
        onRecordSelect={handleTimelineRecordSelect}
        onRecordFocus={handleTimelineRecordFocus}
      />
      <div className={css.ledger}>
        <TrajectoryTable
          key={currentBranch.key}
          requestNumbers={requestNumbers}
          turns={timelineTurns}
          streamingCells={streamingCells}
          timelineFocusIndexes={timelineFocusIndexes}
          searchMatchIndexes={searchMatchIndexes}
          onSelectedIndexChange={setSelectedTimelineIndex}
          onRecordSelect={handleRecordSelect}
          recordSelection={timelineRecordSelection}
          recordFocus={timelineRecordFocus}
          historyLoading={historyLoading}
          historyStartSeq={historyBaseSeq}
          hasOlderRecords={hasOlderHistory}
          onLoadOlder={loadEarlierHistory}
          onClearSelection={() => { setTimelineSelection(null) }}
          collapsedTurns={collapsedTurns}
          onToggleTurn={toggleTurn}
          collapsedAssistants={collapsedAssistants}
          onToggleAssistant={toggleAssistant}
          inspectCallId={inspect?.callId ?? null}
          onInspectApplied={onInspectDone}
        />
      </div>
    </div>
  )
}
