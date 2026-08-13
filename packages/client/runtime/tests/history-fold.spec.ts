import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { projectConversationHistory } from '../src/client/session-history/history-fold.ts'
import { compactHistoryInspectionEntries } from '../src/client/sessions/history.ts'
import { inspectRequests } from '../src/client/sessions/request-inspection.ts'
import { ev } from './event-script.ts'

const at = (seq: number, event: Record<string, unknown>): SessionEvent =>
  ({ seq, time: 1_700_000_000_000 + seq, ...event }) as unknown as SessionEvent

describe('projectConversationHistory', () => {
  it('names an injected context node from its durable source, like the live adapter', () => {
    // The fold declares its own node mapping (jscpd:ignore in the source), so
    // the source projection is pinned on both sides independently.
    const injected = at(0, {
      type: 'user/message',
      surfaceOp: 'append',
      data: createUserMessage({
        content: [{ type: 'text', text: '<available_skills>…</available_skills>' }],
        // A plugin source, because the client program does not see the host
        // packages that merge richer source kinds; those arms are pinned in
        // context-provenance.spec.ts.
        source: { kind: 'plugin', plugin: 'dsh-tool-skill', form: 'catalog' },
      }),
    })
    const { contexts } = projectConversationHistory([{ event: injected }])
    expect(contexts[contexts.length - 1]?.nodes).toMatchObject([{
      kind: 'context',
      seq: 0,
      provenance: { role: 'inject', label: 'dsh-tool-skill' },
      form: 'catalog',
    }])
  })

  it('projects next-step human input as durable steering', () => {
    const steering = createUserMessage({
      content: [{ type: 'text', text: 'change course' }],
      source: { kind: 'user' },
    })
    const events = [
      at(0, { type: 'agent/inbox/spliced', data: {
        target: 'next-step', start: 0, inserted: [steering],
      } }),
      at(1, { type: 'agent/inbox/spliced', data: {
        target: 'next-step', start: 0, removedCount: 1, inserted: [],
      } }),
      at(2, { type: 'user/message', surfaceOp: 'append', data: steering }),
    ]
    const projection = projectConversationHistory(events.map(event => ({ event })))
    expect(projection.eventNodes).toMatchObject([{
      kind: 'steering', messageId: steering.id, seq: 2,
    }])
  })

  it('projects a high-sequence history window without synthesizing its unloaded prefix', () => {
    const baseSeq = 400_000
    const events = [
      ev.user(baseSeq, 'loaded tail'),
      at(baseSeq + 1, {
        type: 'assistant/message',
        surfaceOp: { op: 'replace', start: baseSeq, end: baseSeq },
        sourceEventSeqs: [baseSeq],
        data: {
          turn: 80,
          step: 1,
          message: createMessage({
            role: 'assistant',
            content: [{ type: 'text', text: 'tail summary' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          }),
        },
      }),
    ]

    const projection = projectConversationHistory(events.map(event => ({ event })))
    expect(projection.eventNodes.map(node => node.seq)).toEqual([baseSeq, baseSeq + 1])
    expect(projection.contexts.map(context => ({
      originSeq: context.originSeq,
      nodes: context.nodes.map(node => node.seq),
    }))).toEqual([
      { originSeq: undefined, nodes: [baseSeq] },
      { originSeq: baseSeq + 1, nodes: [baseSeq + 1] },
    ])
  })

  it('projects frozen surface generations without widening the core live surface', () => {
    const events = [
      ev.user(0, 'a'),
      ev.user(1, 'b'),
      at(2, {
        type: 'assistant/message',
        surfaceOp: { op: 'replace', start: 0, end: 0 },
        sourceEventSeqs: [0],
        data: {
          turn: 1,
          step: 1,
          message: createMessage({
            role: 'assistant',
            content: [{ type: 'text', text: 'summary' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          }),
        },
      }),
      at(3, {
        type: 'assistant/message',
        surfaceOp: { op: 'replace', start: 2, end: 1 },
        sourceEventSeqs: [2, 1],
        data: {
          turn: 1,
          step: 2,
          message: createMessage({
            role: 'assistant',
            content: [{ type: 'text', text: 'summary 2' }],
            source: { kind: 'model', provider: 'fake', model: 'fake' },
          }),
        },
      }),
    ]

    expect(projectConversationHistory(events.map(event => ({ event }))).contexts.map(context => ({
      id: context.id,
      parentId: context.parentId,
      originSeq: context.originSeq,
      nodes: context.nodes.map(node => node.seq),
    }))).toEqual([
      { id: 0, parentId: undefined, originSeq: undefined, nodes: [0, 1] },
      { id: 1, parentId: 0, originSeq: 2, nodes: [2, 1] },
      { id: 2, parentId: 1, originSeq: 3, nodes: [3] },
    ])
  })

  it('projects assistant timing and the active request header from history', () => {
    const projection = projectConversationHistory([
      ev.stepStart(0, 1, 2),
      at(1, { type: 'request/header', data: {
        reason: 'initial',
        header: {
          config: { provider: 'fake', model: 'first' },
          tools: [],
        },
      } }),
      ev.chunkStart(2, 1, 2),
      ev.chunkText(3, 1, 'token', 2),
      ev.assistant(4, 1, 'done', 2),
      ev.stepStart(5, 2, 1),
      ev.chunkText(6, 2, 'next', 1),
      ev.assistant(7, 2, 'next done', 1),
    ].map(event => ({ event })))

    expect(projection.eventNodes[0]).toMatchObject({
      kind: 'assistant',
      timing: {
        stepStartTime: 1_700_000_000_000,
        firstTokenTime: 1_700_000_000_003,
        completedTime: 1_700_000_000_004,
      },
      requestConfig: { provider: 'fake', model: 'first' },
    })

    expect(projection.eventNodes.at(-1)).toMatchObject({
      timing: {
        stepStartTime: 1_700_000_000_005,
        firstTokenTime: 1_700_000_000_006,
        completedTime: 1_700_000_000_007,
      },
      requestConfig: { provider: 'fake', model: 'first' },
    })
  })

  it('projects nested dispatches onto settled and interrupted history calls', () => {
    const projection = projectConversationHistory([
      ev.turnStart(0, 1),
      ev.toolCall(1, 1, 'settled', 'run_code', '{}'),
      ev.codeDispatchStart(2, 'settled', 1, 'run_code', { code: 'nested' }),
      ev.codeDispatchStart(3, 'settled:code:1', 1, 'read', { path: 'a.txt' }),
      ev.codeDispatch(4, 'settled:code:1', 1, 'read', { path: 'a.txt' }, 'alpha'),
      ev.codeDispatch(5, 'settled', 1, 'run_code', { code: 'nested' }, 'alpha'),
      ev.toolResult(6, 1, 'settled', 'done'),
      ev.turnEnd(7, 1),
      ev.turnStart(8, 2),
      ev.toolCall(9, 2, 'interrupted', 'run_code', '{}'),
      ev.codeDispatchStart(10, 'interrupted', 1, 'bash', { command: 'sleep 1' }),
      ev.turnEnd(11, 2, 'aborted'),
    ].map(event => ({ event })))

    const settled = {
      callId: 'settled',
      subCalls: [{
        callId: 'settled:code:1',
        subCalls: [{ callId: 'settled:code:1:code:1', call: { name: 'read' } }],
      }],
    }
    expect(projection.eventNodes).toMatchObject([settled])
    expect(projection.contexts[0]?.nodes).toMatchObject([settled])
    expect(projection.interruptedNodes).toMatchObject([{
      callId: 'interrupted',
      subCalls: [{ callId: 'interrupted:code:1', name: 'bash' }],
    }])
  })

  it('drops completed token payloads without changing inspection projections', () => {
    const events = [
      ev.user(0, 'before'),
      ev.stepStart(1, 1, 0),
      ev.chunkStart(2, 1),
      ev.chunkText(3, 1, ''),
      ev.chunkText(4, 1, 'first'),
      ev.chunkText(5, 1, ' discarded'),
      at(6, { type: 'assistant/chunk', data: {
        turn: 1,
        step: 0,
        chunk: { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } },
      } }),
      ev.assistant(7, 1, 'first discarded'),
      ev.compactSummary(8, 'summary', 0, 7),
      ev.compactCheckpoint(9, 8, 0, 7),
      ev.stepStart(10, 2, 0),
      ev.chunkStart(11, 2),
      ev.chunkText(12, 2, 'interrupted'),
      ev.turnEnd(13, 2, 'aborted'),
    ]
    const raw = events.map(event => ({ event }))
    const compacted = compactHistoryInspectionEntries(raw)

    expect(compacted.map(entry => entry.event.seq)).toEqual([
      0, 1, 4, 6, 7, 8, 9, 10, 11, 12, 13,
    ])
    expect(projectConversationHistory(compacted)).toEqual(projectConversationHistory(raw))
    expect(inspectRequests(compacted)).toEqual(inspectRequests(raw))
  })
})
