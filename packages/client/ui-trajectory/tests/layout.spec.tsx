// @vitest-environment jsdom
/**
 * Trajectory turn chrome and layout fold: expand blocks, usage on Message,
 * tool own-duration, group wall-span descriptions, in-flight rows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type {
  ConversationSnapshot, RequestView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { TrajectoryGroupHeader } from '../src/client/TrajectoryGroupHeader.tsx'
import { TrajectoryTurn } from '../src/client/TrajectoryTurn.tsx'
import { TrajectoryTurnHeader } from '../src/client/TrajectoryTurnHeader.tsx'
import {
  appendTrajectoryPartialLayout, deriveTrajectoryLayout,
} from '../src/client/layout.ts'

afterEach(cleanup)

describe('TrajectoryTurnHeader', () => {
  it('renders Turn N and the four metric column labels', () => {
    render(<TrajectoryTurnHeader turn={1} />)
    expect(screen.getByText('Turn 1')).toBeTruthy()
    expect(screen.getByText('Input')).toBeTruthy()
    expect(screen.getByText('Output')).toBeTruthy()
    expect(screen.getByText('Think')).toBeTruthy()
    expect(screen.getByText('Time')).toBeTruthy()
  })
})

describe('TrajectoryGroupHeader', () => {
  it('renders title and optional description', () => {
    render(<TrajectoryGroupHeader title="Step 1" description="2.2s skill" />)
    expect(screen.getByText('Step 1')).toBeTruthy()
    expect(screen.getByText('2.2s skill')).toBeTruthy()
  })

  it('omits the description node when absent', () => {
    const { container } = render(<TrajectoryGroupHeader title="Message" />)
    expect(screen.getByText('Message')).toBeTruthy()
    expect(container.querySelectorAll('span')).toHaveLength(1)
  })
})

describe('TrajectoryTurn', () => {
  it('wraps a sticky header and body children', () => {
    render(
      <TrajectoryTurn turn={3}>
        <TrajectoryGroupHeader title="Message" description="49s" />
      </TrajectoryTurn>,
    )
    expect(screen.getByText('Turn 3')).toBeTruthy()
    expect(screen.getByText('Message')).toBeTruthy()
    expect(screen.getByText('49s')).toBeTruthy()
  })
})

describe('deriveTrajectoryLayout', () => {
  it('expands assistant blocks, hangs usage on Message, and folds call+result into Tool', () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1_000, content: [{ type: 'text', text: 'hello' }], source: null },
      {
        kind: 'assistant', seq: 2, time: 6_000, turn: 1, step: 1,
        blocks: [
          { kind: 'reasoning', text: 'thinking…' },
          { kind: 'text', text: 'I will run bash' },
          { kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{"command":"ls"}' },
        ],
        usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 5 },
      },
      {
        kind: 'tool-result', seq: 3, time: 7_500, callId: 'c1',
        call: { name: 'bash', argsRaw: '{"command":"ls"}' }, callTime: 6_200,
        content: [{ type: 'text', text: 'a.txt' }], isError: false, callView: null, resultView: null,
      },
    ] as unknown as ConversationSnapshot['nodes']
    const turns = deriveTrajectoryLayout({ nodes, partial: null, runningCalls: [] })
    expect(turns).toHaveLength(1)
    expect(turns[0]?.turn).toBe(1)
    const kinds = turns[0]?.groups.flatMap(g => g.cells.map(c => c.kind))
    expect(kinds).toEqual(['user', 'message', 'tool'])
    const message = turns[0]?.groups.flatMap(g => g.cells).find(c => c.kind === 'message')
    expect(message).toMatchObject({
      input: 10, output: 20, think: 5, timeSeconds: 5,
    })
    const tool = turns[0]?.groups.flatMap(g => g.cells).find(c => c.kind === 'tool')
    expect(tool?.text).toBe('bash · {"command":"ls"}')
    expect(tool?.timeSeconds).toBe(1.3)
  })

  it('adds runningCalls not already present and leaves their time blank', () => {
    const turns = deriveTrajectoryLayout({
      nodes: [],
      partial: null,
      runningCalls: [{
        callId: 'r1', name: 'bash', argsRaw: '{"command":"pwd"}',
        turn: 1, step: 2, time: 9_000, callView: null, subCalls: [],
      }],
    })
    expect(turns[0]?.groups.map(g => g.title)).toEqual(['Step 2'])
    expect(turns[0]?.groups[0]?.cells[0]).toMatchObject({
      kind: 'tool', text: 'bash · {"command":"pwd"}', timeSeconds: null,
    })
  })

  it('appends a streaming partial without rebuilding unaffected finalized turns', () => {
    const nodes = [{
      kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1,
      blocks: [{ kind: 'text', text: 'finalized' }],
    }] as unknown as ConversationSnapshot['nodes']
    const partial = {
      turn: 2,
      step: 1,
      blocks: [{ kind: 'reasoning' as const, text: 'streaming' }],
    }
    const request = {
      purpose: 'assistant', startSeq: 3, turn: 2, step: 1,
      startedAt: 3_000, completedAt: null, status: 'running',
    } as unknown as RequestView
    const base = deriveTrajectoryLayout({
      nodes,
      partial: { ...partial, blocks: [] },
      requests: [request],
      runningCalls: [],
    })
    expect(base).toHaveLength(1)

    const streamed = appendTrajectoryPartialLayout(base, partial, 1)

    expect(streamed[0]).toBe(base[0])
    expect(streamed).toHaveLength(2)
    expect(streamed[1]?.groups[0]?.cells).toMatchObject([{
      index: 2,
      kind: 'message',
      text: 'streaming',
      timeSeconds: null,
    }])
    expect(streamed[1]?.groups[0]?.cells[0]?.requestOnly).toBeUndefined()
  })

  it('replaces a running-call placeholder with the matching streamed tool call', () => {
    const partial = {
      turn: 1,
      step: 1,
      blocks: [{
        kind: 'tool-call' as const,
        callId: 'c1',
        name: 'bash',
        argsRaw: '{"command":"pwd"}',
      }],
    }
    const base = deriveTrajectoryLayout({
      nodes: [],
      partial: { ...partial, blocks: [] },
      runningCalls: [{
        callId: 'c1', name: 'bash', argsRaw: '{"command":"pwd"}',
        turn: 1, step: 1, time: 9_000, callView: null, subCalls: [],
      }],
    })

    const streamed = appendTrajectoryPartialLayout(base, partial, 1)
    const cells = streamed[0]?.groups[0]?.cells ?? []

    expect(cells.map(cell => cell.kind)).toEqual(['message', 'tool'])
    expect(cells.filter(cell => cell.callId === 'c1')).toHaveLength(1)
  })

  it('omits duration when node times are missing instead of rendering NaN', () => {
    const nodes = [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'hi' }], source: null },
      {
        kind: 'assistant', seq: 2, turn: 1, step: 1,
        blocks: [
          { kind: 'reasoning', text: '…' },
          { kind: 'text', text: 'ok' },
        ],
        usage: { inputTokens: 1, outputTokens: 2, reasoningTokens: 3 },
      },
    ] as unknown as ConversationSnapshot['nodes']
    const turns = deriveTrajectoryLayout({ nodes, partial: null, runningCalls: [] })
    const cells = turns[0]?.groups.flatMap(g => g.cells) ?? []
    expect(cells.find(c => c.kind === 'message')?.timeSeconds).toBeNull()
    expect(turns[0]?.groups.find(g => g.title === 'Step 1')?.description).toBeUndefined()
  })

  it('builds a wall-span step description with a tool histogram', () => {
    const nodes = [
      {
        kind: 'assistant', seq: 1, time: 1_000, turn: 1, step: 1,
        blocks: [
          { kind: 'tool-call', callId: 'a', name: 'bash', argsRaw: '{}' },
          { kind: 'tool-call', callId: 'b', name: 'bash', argsRaw: '{}' },
        ],
      },
      {
        kind: 'tool-result', seq: 2, time: 2_500, callId: 'a',
        call: { name: 'bash', argsRaw: '{}' }, callTime: 1_100,
        content: [], isError: false, callView: null, resultView: null,
      },
      {
        kind: 'tool-result', seq: 3, time: 4_000, callId: 'b',
        call: { name: 'bash', argsRaw: '{}' }, callTime: 2_600,
        content: [], isError: false, callView: null, resultView: null,
      },
    ] as unknown as ConversationSnapshot['nodes']
    const turns = deriveTrajectoryLayout({ nodes, partial: null, runningCalls: [] })
    expect(turns[0]?.groups[0]?.description).toBe('3,000 ms bash×2')
  })

  it('assigns each user message to its enclosing turn instead of pooling into Turn 1', () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1_000, content: [{ type: 'text', text: 'first' }], source: null },
      {
        kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 0,
        blocks: [{ kind: 'text', text: 'ok1' }],
      },
      { kind: 'user', seq: 3, time: 3_000, content: [{ type: 'text', text: 'second' }], source: null },
      {
        kind: 'assistant', seq: 4, time: 4_000, turn: 2, step: 0,
        blocks: [{ kind: 'text', text: 'ok2' }],
      },
    ] as unknown as ConversationSnapshot['nodes']
    const turns = deriveTrajectoryLayout({ nodes, partial: null, runningCalls: [] })
    expect(turns.map(t => t.turn)).toEqual([1, 2])
    expect(turns[0]?.groups.flatMap(g => g.cells.map(c => c.text))).toEqual(['first', 'ok1'])
    expect(turns[1]?.groups.flatMap(g => g.cells.map(c => c.text))).toEqual(['second', 'ok2'])
  })

  it('places standalone compaction chronologically in its own between-turn section', () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1_000, content: [{ type: 'text', text: 'first' }], source: null },
      {
        kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1,
        blocks: [{ kind: 'text', text: 'before compaction' }],
      },
      { kind: 'user', seq: 5, time: 5_000, content: [{ type: 'text', text: 'second' }], source: null },
      {
        kind: 'assistant', seq: 6, time: 6_000, turn: 2, step: 1,
        blocks: [{ kind: 'text', text: 'after compaction' }],
      },
    ] as unknown as ConversationSnapshot['nodes']
    const compaction: RequestView = {
      purpose: 'compaction',
      startSeq: 3,
      turn: null,
      step: 0,
      startedAt: 3_000,
      completedAt: 4_000,
      status: 'complete',
      summary: [{ type: 'text', text: 'standalone summary' }],
    }

    const turns = deriveTrajectoryLayout({
      nodes,
      partial: null,
      runningCalls: [],
      requests: [compaction],
    })

    expect(turns.map(turn => turn.turn)).toEqual([1, null, 2])
    expect(turns[1]?.groups).toMatchObject([{
      title: 'Compaction 3',
      cells: [{
        kind: 'compacted',
        sourceSeq: 3,
        text: 'standalone summary',
      }],
    }])
  })

  it('keeps usage and a meaningful summary when assistant has no text block', () => {
    const nodes = [
      {
        kind: 'assistant', seq: 1, time: 5_000, turn: 1, step: 0,
        blocks: [{ kind: 'reasoning', text: '…' }],
        usage: { inputTokens: 11, outputTokens: 22, reasoningTokens: 3 },
      },
    ] as unknown as ConversationSnapshot['nodes']
    const turns = deriveTrajectoryLayout({ nodes, partial: null, runningCalls: [] })
    const message = turns[0]?.groups.flatMap(g => g.cells).find(c => c.kind === 'message')
    expect(message).toMatchObject({
      text: '…', input: 11, output: 22, think: 3,
    })
  })

  it('bounds a long Markdown-like thinking preview while retaining its full detail', () => {
    const thinking = `# Investigation\n\n**NAVIGATION_OK file_path** ${'- repeated detail '.repeat(1_000)}`
    const nodes = [{
      kind: 'assistant', seq: 1, time: 5_000, turn: 1, step: 0,
      blocks: [{ kind: 'reasoning', text: thinking }],
    }] as unknown as ConversationSnapshot['nodes']

    const turns = deriveTrajectoryLayout({
      nodes, partial: null, runningCalls: [],
    })
    const message = turns[0]?.groups.flatMap(group => group.cells)
      .find(cell => cell.kind === 'message')

    expect(message?.text.startsWith('Investigation NAVIGATION_OK file_path')).toBe(true)
    expect(message?.text.endsWith('…')).toBe(true)
    expect(message?.text.length).toBeLessThanOrEqual(513)
    expect(message?.thinkingDetail).toBe(thinking)
  })

  it('advances the duration cursor over context and compaction nodes', () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1_000, content: [{ type: 'text', text: 'hi' }], source: null },
      {
        kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1,
        blocks: [{ kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{}' }],
      },
      {
        kind: 'tool-result', seq: 3, time: 3_000, callId: 'c1',
        call: { name: 'bash', argsRaw: '{}' }, callTime: 2_100,
        content: [], isError: false, callView: null, resultView: null,
      },
      {
        kind: 'context', seq: 4, time: 9_000,
        content: [{ type: 'text', text: 'extra' }], source: null,
      },
      // A landed compaction renders no cell, but is still a real log position,
      // so it moves the cursor after the visible context row.
      {
        kind: 'compaction', seq: 5, time: 9_500, summary: 'checkpoint facts',
        summaryEventSeq: 4, shadowedItemCount: 2, shadowedTokenCount: 100,
      },
      {
        kind: 'assistant', seq: 6, time: 10_000, turn: 1, step: 0,
        blocks: [{ kind: 'text', text: 'done' }],
      },
    ] as unknown as ConversationSnapshot['nodes']
    const turns = deriveTrajectoryLayout({ nodes, partial: null, runningCalls: [] })
    const cells = turns[0]?.groups.flatMap(g => g.cells) ?? []
    const message = cells.find(c => c.kind === 'message' && c.text === 'done')
    // From the compaction marker at 9.5s, not from context at 9s or the earlier surfaces.
    expect(message?.timeSeconds).toBe(0.5)
    // Context remains inspectable in trajectory; the Chat marker is not duplicated.
    expect(cells.map(cell => cell.kind)).toEqual(['user', 'message', 'tool', 'context', 'message'])
  })

  it('uses the recorded step start for assistant duration when timing exists', () => {
    const nodes = [
      { kind: 'user', seq: 1, time: 1_000, content: [{ type: 'text', text: 'hi' }], source: null },
      {
        kind: 'assistant', seq: 2, time: 4_000, turn: 1, step: 1,
        blocks: [{ kind: 'text', text: 'done' }],
        timing: { stepStartTime: 3_000, firstTokenTime: 3_500, completedTime: 4_000 },
      },
    ] as unknown as ConversationSnapshot['nodes']
    const turns = deriveTrajectoryLayout({
      nodes, partial: null, runningCalls: [],
    })
    const message = turns[0]?.groups.flatMap(group => group.cells)
      .find(cell => cell.kind === 'message')
    expect(message).toMatchObject({ startedAt: 3_000, timeSeconds: 1 })
  })
})

describe('run_code sub-dispatch cells', () => {
  const runCodeNodes = [
    {
      kind: 'assistant', seq: 2, time: 6_000, turn: 1, step: 1,
      blocks: [
        { kind: 'tool-call', callId: 'p1', name: 'run_code', argsRaw: '{"code":"…","description":"批量读取"}' },
      ],
    },
    {
      kind: 'tool-result', seq: 3, time: 9_000, callId: 'p1',
      call: { name: 'run_code', argsRaw: '{"code":"…","description":"批量读取"}' }, callTime: 6_200,
      content: [{ type: 'text', text: 'done' }], isError: false, callView: null, resultView: null,
      subCalls: [],
    },
  ] as unknown as ConversationSnapshot['nodes']

  const settledSub = (n: number, name: string, start: number, end: number) => ({
    kind: 'tool-result' as const, seq: 100 + n, time: end,
    callId: `p1:code:${n}`,
    call: { name, argsRaw: '{"x":1}' }, callTime: start,
    content: [{ type: 'text' as const, text: 'ok' }], isError: false, callView: null, resultView: null,
    subCalls: [],
  })

  const withSubCalls = (subCalls: readonly ReturnType<typeof settledSub>[] | readonly object[]) =>
    runCodeNodes.map(node => node.kind === 'tool-result' ? { ...node, subCalls } : node) as ConversationSnapshot['nodes']

  it('nests settled sub-cells after their parent Tool cell with real durations', () => {
    const subCalls = [
      settledSub(1, 'bash', 6_300, 7_300),
      settledSub(2, 'read', 7_300, 7_800),
    ]
    const turns = deriveTrajectoryLayout({ nodes: withSubCalls(subCalls), partial: null, runningCalls: [] })
    const cells = turns[0]!.groups.flatMap(g => g.cells)
    expect(cells.map(c => c.kind)).toEqual(['message', 'tool', 'subtool', 'subtool'])
    expect(cells[0]?.text).toBe('Tool call only')
    // Sequential indexes across the interleave; durations from the pair times.
    expect(cells.map(c => c.index)).toEqual([1, 2, 3, 4])
    expect(cells[2]).toMatchObject({ text: 'bash · {"x":1}', timeSeconds: 1 })
    expect(cells[3]).toMatchObject({ timeSeconds: 0.5 })
  })

  it('a running (unsettled) sub-call renders a subtool cell with blank time', () => {
    const running = {
      callId: 'p1:code:1', name: 'grep', argsRaw: '{"pattern":"x"}',
      turn: 0, step: 0, time: 6_400, callView: null, subCalls: [],
    }
    const turns = deriveTrajectoryLayout({ nodes: withSubCalls([running]), partial: null, runningCalls: [] })
    const sub = turns[0]!.groups.flatMap(g => g.cells).find(c => c.kind === 'subtool')
    expect(sub).toMatchObject({ text: 'grep · {"pattern":"x"}', timeSeconds: null })
  })

  it('recursively flattens nested child calls immediately after their parent', () => {
    const leaf = {
      ...settledSub(2, 'read', 7_300, 7_800),
      callId: 'p1:code:1:code:1',
    }
    const child = {
      ...settledSub(1, 'run_code', 6_300, 8_000),
      subCalls: [leaf],
    }
    const turns = deriveTrajectoryLayout({ nodes: withSubCalls([child]), partial: null, runningCalls: [] })
    const cells = turns[0]!.groups.flatMap(group => group.cells)
    expect(cells.map(cell => cell.kind)).toEqual(['message', 'tool', 'subtool', 'subtool'])
    expect(cells.slice(2).map(cell => cell.callId)).toEqual([
      'p1:code:1',
      'p1:code:1:code:1',
    ])
    expect(cells.map(cell => cell.index)).toEqual([1, 2, 3, 4])
  })
})
