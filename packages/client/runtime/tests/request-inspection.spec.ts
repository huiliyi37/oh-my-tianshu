import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '@deepseek-ai/dsh-client-connection/client'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { inspectRequests } from '../src/client/sessions/request-inspection.ts'

const at = (seq: number, type: string, data: unknown): SessionEvent =>
  ({ seq, time: 1_700_000_000_000 + seq, type, data }) as SessionEvent

const entriesOf = (events: readonly SessionEvent[]): HistoryEntry[] =>
  events.map(event => ({ event }))

describe('inspectRequests', () => {
  it('projects ordinary and compaction calls into one chronological request stream', () => {
    const events = [
      at(0, 'step/start', { turn: 1, step: 1 }),
      at(1, 'request/header', {
        reason: 'initial',
        header: {
          config: { provider: 'fake', model: 'model' },
          system: 'system',
          tools: [{
            name: 'read',
            description: 'Read a file.',
            parameters: { type: 'object' },
          }],
        },
      }),
      at(2, 'tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-1',
        name: 'read',
        arguments: '{}',
      }),
      at(3, 'assistant/message', {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'done' }],
          source: { provider: 'fake', model: 'model' },
        }),
        usage: { inputTokens: 5, outputTokens: 2 },
      }),
      at(4, 'step/end', { turn: 1, step: 1 }),
      at(5, 'compact/start', { turn: 1 }),
      at(6, 'compact/summary', {
        summary: [{ type: 'text', text: 'summary' }],
        rawOutput: [
          { type: 'reasoning', text: 'thought' },
          { type: 'text', text: 'summary' },
        ],
        provider: 'fake',
        model: 'compact-model',
        usage: { inputTokens: 8, outputTokens: 3 },
      }),
      at(7, 'user/message', createUserMessage({
        content: [{ type: 'text', text: 'checkpoint' }],
        source: { kind: 'plugin', plugin: 'compact' },
      })),
      at(8, 'compact/end', { turn: 1 }),
    ]
    const snapshot = inspectRequests(entriesOf(events))
    expect(snapshot.requests).toMatchObject([
      {
        purpose: 'assistant',
        startSeq: 0,
        resultSeq: 3,
        status: 'complete',
        prompt: {
          config: { provider: 'fake', model: 'model' },
          system: 'system',
        },
        promptChange: { seq: 1, kind: 'initial' },
      },
      {
        purpose: 'compaction',
        startSeq: 5,
        resultSeq: 6,
        replacementSeq: 7,
        status: 'complete',
        summary: [{ type: 'text', text: 'summary' }],
      },
    ])
    expect(snapshot.callSchemas.get('call-1')?.name).toBe('read')
  })

  it('does not promote a truncated resume or change header to the initial prompt', () => {
    for (const reason of ['resume', 'change'] as const) {
      const snapshot = inspectRequests(entriesOf([
        at(10, 'step/start', { turn: 3, step: 1 }),
        at(11, 'request/header', {
          reason,
          header: {
            config: { provider: 'fake', model: 'model' },
            system: 'tail-window prompt',
          },
        }),
      ]))

      expect(snapshot.requests[0]).toMatchObject({
        purpose: 'assistant',
        prompt: { system: 'tail-window prompt' },
      })
      expect(snapshot.requests[0]).not.toHaveProperty('promptChange')
    }
  })

  it('classifies a prompt change once the preceding header is loaded', () => {
    const snapshot = inspectRequests(entriesOf([
      at(0, 'step/start', { turn: 1, step: 1 }),
      at(1, 'request/header', {
        reason: 'initial',
        header: {
          config: { provider: 'fake', model: 'model' },
          system: 'before',
        },
      }),
      at(2, 'step/start', { turn: 1, step: 2 }),
      at(3, 'request/header', {
        reason: 'change',
        header: {
          config: { provider: 'fake', model: 'model' },
          system: 'after',
        },
      }),
    ]))

    expect(snapshot.requests[1]).toMatchObject({
      promptChange: {
        seq: 3,
        kind: 'system',
        previous: { system: 'before' },
      },
    })
  })

  it('preserves a standalone compaction owner without widening assistant turns', () => {
    const snapshot = inspectRequests(entriesOf([
      at(0, 'compact/start', { turn: null }),
      at(1, 'compact/summary', {
        summary: [{ type: 'text', text: 'standalone summary' }],
        provider: 'fake',
        model: 'compact-model',
      }),
      at(2, 'compact/end', { turn: null }),
      at(3, 'step/start', { turn: 2, step: 1 }),
    ]))

    const [compaction, assistant] = snapshot.requests
    expect(compaction).toMatchObject({
      purpose: 'compaction',
      turn: null,
      step: 0,
      status: 'complete',
    })
    expect(assistant).toMatchObject({
      purpose: 'assistant',
      turn: 2,
      step: 1,
      status: 'running',
    })
    if (assistant?.purpose === 'assistant') {
      const turn: number = assistant.turn
      expect(turn).toBe(2)
    }
  })

  it('interrupts an orphaned compaction at end-seed before projecting a new attempt', () => {
    const snapshot = inspectRequests(entriesOf([
      at(0, 'compact/start', { turn: null }),
      at(1, 'session/end-seed', {}),
      at(2, 'compact/start', { turn: null }),
      at(3, 'compact/summary', {
        summary: [{ type: 'text', text: 'replacement summary' }],
        provider: 'fake',
        model: 'compact-model',
      }),
      at(4, 'compact/end', { turn: null }),
    ]))

    expect(snapshot.requests).toMatchObject([
      {
        purpose: 'compaction',
        startSeq: 0,
        status: 'error',
        completedAt: 1_700_000_000_001,
        error: 'Compaction was interrupted before completion.',
      },
      {
        purpose: 'compaction',
        startSeq: 2,
        status: 'complete',
        completedAt: 1_700_000_000_004,
        summary: [{ type: 'text', text: 'replacement summary' }],
      },
    ])
  })

  it('captures schemas for nested tool dispatches from the active request header', () => {
    const snapshot = inspectRequests(entriesOf([
      at(0, 'request/header', {
        reason: 'initial',
        header: {
          config: { provider: 'fake', model: 'model' },
          tools: [{
            name: 'read',
            description: 'Read a file.',
            parameters: { type: 'object' },
          }],
        },
      }),
      at(1, 'tool/code-dispatch-start', {
        parentCallId: 'parent',
        subCallId: 'nested',
        name: 'read',
        arguments: {},
      }),
    ]))

    expect(snapshot.callSchemas.get('nested')?.name).toBe('read')
  })

  it('keeps chunk-reported usage through request failure and prefers it to message fallback', () => {
    const chunkUsage = { inputTokens: 21, outputTokens: 3 }
    const retryUsage = {
      inputTokens: 5,
      outputTokens: 2,
      cacheReadTokens: 8,
      reasoningTokens: 1,
    }
    const snapshot = inspectRequests(entriesOf([
      at(0, 'step/start', { turn: 1, step: 1 }),
      at(1, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'usage', usage: chunkUsage },
      }),
      at(2, 'llm/retry', {
        turn: 1,
        step: 1,
        retry: 1,
        maxRetries: 2,
        delayMs: 100,
        failure: { message: 'rate limited' },
      }),
      at(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'usage', usage: retryUsage },
      }),
      at(4, 'assistant/message', {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: 'text', text: 'recovered' }],
          source: { provider: 'fake', model: 'model' },
        }),
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    ]))

    expect(snapshot.requests[0]).toMatchObject({
      status: 'complete',
      usage: {
        inputTokens: 26,
        outputTokens: 5,
        cacheReadTokens: 8,
        reasoningTokens: 1,
      },
    })
  })

  it('keeps provider credential fragments out of projected request errors', () => {
    const snapshot = inspectRequests(entriesOf([
      at(0, 'step/start', { turn: 1, step: 1 }),
      at(1, 'turn/end', {
        turn: 1, reason: { kind: 'error', error: {
          code: 'AUTH',
          message: 'Authentication Fails, Your api key: sk-preview-secret is invalid',
        },
        },
      }),
      at(2, 'step/start', { turn: 2, step: 1 }),
      at(3, 'turn/end', {
        turn: 2, reason: { kind: 'error', error: { message: 'plugin exploded', code: 'UNKNOWN' } },
      }),
    ]))

    expect(snapshot.requests).toMatchObject([
      { status: 'error', error: 'API key is invalid' },
      { status: 'error', error: 'plugin exploded' },
    ])
  })

  it('treats a scrubbed durable-fixture tool catalog as unavailable', () => {
    const snapshot = inspectRequests(entriesOf([
      at(0, 'step/start', { turn: 1, step: 1 }),
      at(1, 'request/header', {
        reason: 'initial',
        header: {
          config: { provider: 'fake', model: 'model' },
          tools: '{{tools}}',
        },
      }),
      at(2, 'tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-1',
        name: 'read',
        arguments: '{}',
      }),
    ]))

    expect(snapshot.callSchemas).toEqual(new Map())
    const [request] = snapshot.requests
    expect(request?.purpose === 'assistant' ? request.prompt?.tools : undefined).toEqual([])
  })
})
