import { describe, expect, it, vi } from 'vitest'
import { createUserMessage, CallId, CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, createMessage, LlmError, OFFLOADED_IMAGE_TEXT } from '@huiliyi37/dsh-llm'
import type { ContentBlock, StreamChunk } from '@huiliyi37/dsh-llm'
import type { AssistantMessage, AssistantMessageEvent, Usage } from '@earendil-works/pi-ai'
import { toPiContext } from '../src/context.ts'
import { toPiReplayState } from '../src/replay.ts'
import { mapStopReason, mapUsage, toStreamChunks } from '../src/stream.ts'

function usage(input = 0, output = 0, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 0,
    ...overrides,
  }
}

async function* feed(...events: AssistantMessageEvent[]): AsyncGenerator<AssistantMessageEvent> {
  for (const event of events) yield event
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

describe('toPiContext', () => {
  it('maps system prompt, user text, and tools', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      system: 'be helpful',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
      tools: [{ name: 'f', description: 'F', parameters: { type: 'object', properties: {} } }],
    })
    expect(context.systemPrompt).toBe('be helpful')
    expect(context.messages).toEqual([{ role: 'user', content: 'hi', timestamp: 0 }])
    expect(context.tools).toEqual([
      { name: 'f', description: 'F', parameters: { type: 'object', properties: {} } },
    ])
  })

  it('omits empty tools and absent system prompt', () => {
    const context = toPiContext({ provider: 'deepseek', model: 'm', messages: [], tools: [] })
    expect(context.systemPrompt).toBeUndefined()
    expect(context.tools).toBeUndefined()
  })

  it('maps assistant text/reasoning/tool-call blocks', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'hmm' },
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: CallId('c1'), name: 'f', arguments: '{"a":1}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    const message = context.messages[0] as AssistantMessage
    expect(message.role).toBe('assistant')
    expect(message.stopReason).toBe('toolUse')
    expect(message.content).toEqual([
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'calling' },
      { type: 'toolCall', id: 'c1', name: 'f', arguments: { a: 1 } },
    ])
  })

  it('marks tool-call-free assistant messages with stopReason stop', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant', content: [{ type: 'text', text: 'done' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect((context.messages[0] as AssistantMessage).stopReason).toBe('stop')
  })

  it('preserves provider and model for foreign assistant messages without replay state', () => {
    const context = toPiContext({
      provider: 'openai',
      model: 'new-model',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: { kind: 'model', provider: 'deepseek', model: 'old-model' },
      })],
    })
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'dsh-foreign',
      provider: 'deepseek',
      model: 'old-model',
    })
  })

  it('parses malformed tool-call arguments to {}', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: CallId('c1'), name: 'f', arguments: '{broken' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    const message: AssistantMessage = context.messages[0] as AssistantMessage
    expect(message.content[0]).toEqual({ type: 'toolCall', id: 'c1', name: 'f', arguments: {} })
  })

  it('parses non-object argument JSON (arrays, scalars) to {}', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: CallId('c1'), name: 'f', arguments: '[1,2]' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect((context.messages[0] as AssistantMessage).content[0]).toMatchObject({ arguments: {} })
  })

  it('recovers toolName for tool results from the preceding assistant call', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [
        createMessage({
          role: 'assistant',
          content: [{ type: 'tool-call', id: CallId('c1'), name: 'get_weather', arguments: '{}' }],
          source: { kind: 'plugin', plugin: 'test' },
        }),
        createUserMessage({
          content: [{ type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'Sunny' }] }],
          source: { kind: 'plugin', plugin: 'test' },
        }),
      ],
    })
    expect(context.messages[1]).toEqual({
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'get_weather',
      content: [{ type: 'text', text: 'Sunny' }],
      isError: false,
      timestamp: 0,
    })
  })

  it('labels unmatched tool results with toolName unknown and keeps isError', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createUserMessage({
        content: [{ type: 'tool-result', toolCallId: CallId('zz'), content: [], isError: true }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(context.messages[0]).toMatchObject({
      role: 'toolResult',
      toolName: 'unknown',
      isError: true,
      content: [{ type: 'text', text: '(no output)' }],
    })
  })

  it('splits mixed user text + tool results and folds history system messages', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [
        createMessage({
          role: 'system', content: [{ type: 'text', text: 'rule' }],
          source: { kind: 'plugin', plugin: 'test' },
        }),
        createUserMessage({
          content: [
            { type: 'text', text: 'note' },
            { type: 'tool-result', toolCallId: CallId('c1'), content: [{ type: 'text', text: 'ok' }] },
          ],
          source: { kind: 'plugin', plugin: 'test' },
        }),
      ],
    })
    expect(context.messages.map(message => message.role)).toEqual(['user', 'user', 'toolResult'])
  })

  it('skips plugin-added (unknown) blocks in assistant content', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [
          { type: 'chart', data: 'x' } as unknown as ContentBlock,
          { type: 'text', text: 'visible' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect((context.messages[0] as AssistantMessage).content).toEqual([{ type: 'text', text: 'visible' }])
  })

  it('recombines durable content with pi-ai replay metadata across target providers and models', () => {
    const state = toPiReplayState(assistant({
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-5',
      responseModel: 'gpt-5-2026-01-01',
      responseId: 'resp_123',
      stopReason: 'toolUse',
      content: [
        { type: 'thinking', thinking: 'private reasoning', thinkingSignature: 'think-sig', redacted: true },
        { type: 'text', text: 'calling', textSignature: 'text-sig' },
        { type: 'toolCall', id: 'c1', name: 'f', arguments: { a: 1 }, thoughtSignature: 'tool-sig' },
      ],
    }))
    const context = toPiContext({
      provider: 'anthropic',
      model: 'claude-next',
      messages: [createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'private reasoning' },
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: CallId('c1'), name: 'f', arguments: '{"a":1}' },
        ],
        source: {
          kind: 'model',
          ...{ provider: 'openai', model: 'gpt-5', replayState: state },
        },
      })],
    })

    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-5',
      responseModel: 'gpt-5-2026-01-01',
      responseId: 'resp_123',
      stopReason: 'toolUse',
      content: [
        { type: 'thinking', thinking: 'private reasoning', thinkingSignature: 'think-sig', redacted: true },
        { type: 'text', text: 'calling', textSignature: 'text-sig' },
        { type: 'toolCall', id: 'c1', name: 'f', arguments: { a: 1 }, thoughtSignature: 'tool-sig' },
      ],
    })
  })

  it('replays all native block kinds when optional metadata is absent', () => {
    const state = toPiReplayState(assistant({
      content: [
        { type: 'thinking', thinking: 'private reasoning' },
        { type: 'text', text: 'calling' },
        { type: 'toolCall', id: 'c1', name: 'f', arguments: { a: 1 } },
      ],
    }))
    const context = toPiContext({
      provider: 'deepseek',
      model: 'new-model',
      messages: [createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'private reasoning' },
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: CallId('c1'), name: 'f', arguments: '{"a":1}' },
        ],
        source: {
          kind: 'model',
          ...{ provider: 'deepseek', model: 'deepseek-v4-flash', replayState: state },
        },
      })],
    })

    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'private reasoning' },
        { type: 'text', text: 'calling' },
        { type: 'toolCall', id: 'c1', name: 'f', arguments: { a: 1 } },
      ],
    })
    expect(context.messages[0]).not.toHaveProperty('responseModel')
    expect(context.messages[0]).not.toHaveProperty('responseId')
  })

  it('degrades unsupported replay-state versions to provider-neutral history', () => {
    const onDegrade = vi.fn()
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: {
          kind: 'model',
          ...{
            provider: 'deepseek',
            model: 'old',
            replayState: { response: { kind: 'pi-ai', version: 3 }, blocks: [] },
          },
        },
      })],
    }, onDegrade)
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'dsh-foreign',
      provider: 'deepseek',
      model: 'old',
      content: [{ type: 'text', text: 'done' }],
    })
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining('unsupported version 3'))
  })

  it('degrades the flat pre-envelope replay state a legacy session log carries', () => {
    const onDegrade = vi.fn()
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: {
          kind: 'model',
          ...{
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            replayState: {
              kind: 'pi-ai',
              version: 1,
              api: 'openai-completions',
              provider: 'deepseek',
              model: 'deepseek-v4-flash',
              stopReason: 'stop',
              blocks: [{ type: 'text' }],
            },
          },
        },
      })],
    }, onDegrade)
    expect(context.messages[0]).toMatchObject({ role: 'assistant', api: 'dsh-foreign' })
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining('expected a response object'))
  })

  it('degrades replay metadata whose blocks do not match the durable content', () => {
    const onDegrade = vi.fn()
    const state = toPiReplayState(assistant({ content: [{ type: 'text', text: 'done' }] }))
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'done' }],
        source: {
          kind: 'model',
          ...{ provider: 'deepseek', model: 'deepseek-v4-flash', replayState: state },
        },
      })],
    }, onDegrade)
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'dsh-foreign',
      content: [{ type: 'thinking', thinking: 'done' }],
    })
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining('block 0 does not match assistant content'))
  })

  it('degrades replay metadata whose block count differs from durable content', () => {
    const onDegrade = vi.fn()
    const state = toPiReplayState(assistant())
    const context = toPiContext({
      provider: 'deepseek',
      model: 'm',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: {
          kind: 'model',
          ...{ provider: 'deepseek', model: 'deepseek-v4-flash', replayState: state },
        },
      })],
    }, onDegrade)
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'dsh-foreign',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      content: [{ type: 'text', text: 'done' }],
      stopReason: 'stop',
    })
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining('block count does not match assistant content'))
  })

  const validResponse = {
    kind: 'pi-ai',
    version: 2,
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    stopReason: 'stop',
  }
  const validReplay = { response: validResponse, blocks: [{ type: 'text' }] }

  /** Convert with the given state and assert the message degraded to foreign with the given reason. */
  function expectDegraded(replayState: unknown, message: string): void {
    const onDegrade = vi.fn()
    const context = toPiContext({
      provider: 'deepseek',
      model: 'next-model',
      messages: [createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: {
          kind: 'model',
          ...{ provider: 'deepseek', model: 'deepseek-v4-flash', replayState },
        },
      })],
    }, onDegrade)
    expect(context.messages[0]).toMatchObject({
      role: 'assistant',
      api: 'dsh-foreign',
      content: [{ type: 'text', text: 'done' }],
    })
    expect(onDegrade).toHaveBeenCalledWith(expect.stringContaining(message))
  }

  it.each([
    ['provider', { ...validReplay, response: { ...validResponse, provider: 'openai' } }],
    ['model', { ...validReplay, response: { ...validResponse, model: 'deepseek-v4-pro' } }],
  ])('degrades replay metadata whose %s differs from assistant source', (field, replayState) => {
    expectDegraded(replayState, `${field} does not match assistant source`)
  })

  it.each([
    ['number state', 1, 'expected a replay envelope'],
    ['null state', null, 'expected a replay envelope'],
    ['array state', [], 'expected a replay envelope'],
    ['missing response', { blocks: [] }, 'expected a response object'],
    ['array response', { ...validReplay, response: [] }, 'expected a response object'],
    ['unknown kind', { ...validReplay, response: { ...validResponse, kind: 'other' } }, 'unknown state kind'],
    ['non-string api', { ...validReplay, response: { ...validResponse, api: 1 } }, 'api must be a non-empty string'],
    ['empty provider', { ...validReplay, response: { ...validResponse, provider: '' } }, 'provider must be a non-empty string'],
    ['missing model', { ...validReplay, response: { ...validResponse, model: undefined } }, 'model must be a non-empty string'],
    ['unknown stop reason', { ...validReplay, response: { ...validResponse, stopReason: 'pause' } }, 'unknown stopReason'],
    ['non-string response model', { ...validReplay, response: { ...validResponse, responseModel: 1 } }, 'responseModel must be a string'],
    ['non-string response id', { ...validReplay, response: { ...validResponse, responseId: 1 } }, 'responseId must be a string'],
    ['missing blocks', { response: validResponse }, 'blocks must be an array'],
    ['non-array blocks', { ...validReplay, blocks: 'text' }, 'blocks must be an array'],
    ['number block', { ...validReplay, blocks: [1] }, 'block 0 must be an object'],
    ['null block', { ...validReplay, blocks: [null] }, 'block 0 must be an object'],
    ['array block', { ...validReplay, blocks: [[]] }, 'block 0 must be an object'],
    ['unknown block type', { ...validReplay, blocks: [{ type: 'audio' }] }, 'block 0 has an unknown type'],
    ['non-string signature', { ...validReplay, blocks: [{ type: 'text', textSignature: 1 }] }, 'textSignature must be a string'],
    ['non-boolean redaction', { ...validReplay, blocks: [{ type: 'reasoning', redacted: 'yes' }] }, 'redacted must be boolean'],
  ])('degrades malformed replay state: %s', (_name, replayState, message) => {
    expectDegraded(replayState, message)
  })

  it('recursively converts nested tool-result text and images', () => {
    const callId = CallId('nested-call')
    const context = toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          content: [
            {
              type: 'tool-result',
              toolCallId: callId,
              content: [{ type: 'text', text: 'nested text' }],
            },
            {
              type: 'tool-result',
              toolCallId: callId,
              content: [{ type: 'image', dataUrl: 'data:image/png;base64,AQ==' }],
            },
          ],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })

    expect(context.messages).toEqual([{
      role: 'toolResult',
      toolCallId: 'nested-call',
      toolName: 'unknown',
      content: [
        { type: 'text', text: 'nested text' },
        { type: 'image', data: 'AQ==', mimeType: 'image/png' },
      ],
      isError: false,
      timestamp: 0,
    }])
  })

  it('flattens nested text-only tool results and ignores unknown block types', () => {
    const callId = CallId('nested-text')
    expect(toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          content: [
            { type: 'chart', data: 'ignored' } as unknown as ContentBlock,
            {
              type: 'tool-result',
              toolCallId: callId,
              content: [{ type: 'text', text: 'nested' }],
            },
          ],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).toMatchObject({
      messages: [{
        role: 'toolResult',
        content: [{ type: 'text', text: 'nested' }],
      }],
    })
  })

  it('replaces the oldest images with placeholders once the request payload bound is exceeded', () => {
    const callId = CallId('shot-call')
    // Three data-URL images carry a 4-character base64 payload each (12
    // total); a bound of 8 forces exactly the oldest one out, including one
    // nested in a tool result.
    const context = toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [
        createUserMessage({
          content: [{
            type: 'tool-result',
            toolCallId: callId,
            content: [{ type: 'image', dataUrl: 'data:image/png;base64,AQID' }],
          }],
          source: { kind: 'tool', callId },
        }),
        createUserMessage({
          content: [
            { type: 'image', dataUrl: 'data:image/png;base64,AQID' },
            { type: 'text', text: 'newer' },
          ],
          source: { kind: 'user' },
        }),
        createUserMessage({
          content: [{ type: 'image', dataUrl: 'data:image/png;base64,AQID' }],
          source: { kind: 'user' },
        }),
      ],
    }, undefined, 8)

    expect(context.messages).toEqual([
      {
        role: 'toolResult',
        toolCallId: 'shot-call',
        toolName: 'unknown',
        content: [{ type: 'text', text: OFFLOADED_IMAGE_TEXT }],
        isError: false,
        timestamp: 0,
      },
      {
        role: 'user',
        content: [
          { type: 'image', data: 'AQID', mimeType: 'image/png' },
          { type: 'text', text: 'newer' },
        ],
        timestamp: 0,
      },
      { role: 'user', content: [{ type: 'image', data: 'AQID', mimeType: 'image/png' }], timestamp: 0 },
    ])
  })

  it('keeps every image at exactly the payload bound and drops all of them when even the newest cannot fit', () => {
    const exact = toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [
        createUserMessage({
          content: [{ type: 'image', dataUrl: 'data:image/png;base64,AQID' }],
          source: { kind: 'user' },
        }),
        createUserMessage({
          content: [{ type: 'image', dataUrl: 'data:image/png;base64,AQID' }],
          source: { kind: 'user' },
        }),
      ],
    }, undefined, 8)
    expect(exact.messages).toEqual([
      { role: 'user', content: [{ type: 'image', data: 'AQID', mimeType: 'image/png' }], timestamp: 0 },
      { role: 'user', content: [{ type: 'image', data: 'AQID', mimeType: 'image/png' }], timestamp: 0 },
    ])

    // A single image whose payload alone exceeds the bound unloads too; the
    // all-text content then collapses to the plain string form, so the
    // placeholder still reaches the model.
    const oversized = toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [{ type: 'image', dataUrl: `data:image/png;base64,${'A'.repeat(300)}` }],
        source: { kind: 'user' },
      })],
    }, undefined, 8)
    expect(oversized.messages).toEqual([
      { role: 'user', content: OFFLOADED_IMAGE_TEXT, timestamp: 0 },
    ])
  })

  it('offloads repeated image-block occurrences by position rather than shared object identity', () => {
    const shared: ContentBlock = { type: 'image', dataUrl: 'data:image/png;base64,AQID' }
    const aliased = toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({ content: [shared, shared], source: { kind: 'user' } })],
    }, undefined, 4)
    const replayed = toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [
          { type: 'image', dataUrl: 'data:image/png;base64,AQID' },
          { type: 'image', dataUrl: 'data:image/png;base64,AQID' },
        ],
        source: { kind: 'user' },
      })],
    }, undefined, 4)

    const expected = [{
      role: 'user',
      content: [
        { type: 'text', text: OFFLOADED_IMAGE_TEXT },
        { type: 'image', data: 'AQID', mimeType: 'image/png' },
      ],
      timestamp: 0,
    }]
    expect(aliased.messages).toEqual(expected)
    expect(replayed.messages).toEqual(expected)
  })

  it.each(['system', 'assistant'] as const)('rejects an image in an in-history %s message', (role) => {
    const image: ContentBlock[] = [{ type: 'image', dataUrl: 'data:image/png;base64,AQID' }]
    // A bound of 1 would offload the image, but the role check fires first.
    const convert = () => toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [role === 'assistant'
        ? createMessage({
          role,
          content: image,
          source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4-flash' },
        })
        : createMessage({ role, content: image, source: { kind: 'plugin', plugin: 'test' } })],
    }, undefined, 1)

    let caught: unknown
    try {
      convert()
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(LlmError)
    expect(caught).toMatchObject({
      code: 'UNSUPPORTED_CONTENT',
      message: `pi-ai cannot represent an image in an in-history ${role} message`,
    })
  })

  it('prefers an image block mime over the data-URL header', () => {
    const context = toPiContext({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [
          { type: 'image', dataUrl: 'data:image/png;base64,AQID', mime: 'image/jpeg' },
          { type: 'image', dataUrl: 'data:image/webp;base64,AQID' },
        ],
        source: { kind: 'user' },
      })],
    })
    expect(context.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'image', data: 'AQID', mimeType: 'image/jpeg' },
        { type: 'image', data: 'AQID', mimeType: 'image/webp' },
      ],
      timestamp: 0,
    }])
  })
})

describe('toStreamChunks', () => {
  const partialWithToolCall = assistant({
    content: [{ type: 'toolCall', id: 'call-1', name: 'f', arguments: {} }],
  })

  it('maps text events to text blocks', async () => {
    const done = assistant({ content: [{ type: 'text', text: 'hi' }], usage: usage(3, 2) })
    const chunks = await collect(toStreamChunks(feed(
      { type: 'start', partial: assistant() },
      { type: 'text_start', contentIndex: 0, partial: assistant() },
      { type: 'text_delta', contentIndex: 0, delta: 'hi', partial: assistant() },
      { type: 'text_end', contentIndex: 0, content: 'hi', partial: assistant() },
      { type: 'done', reason: 'stop', message: done },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hi' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
      {
        type: 'finish',
        reason: { kind: 'stop' },
        replayState: {
          response: {
            kind: 'pi-ai',
            version: 2,
            api: 'openai-completions',
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            stopReason: 'stop',
          },
          blocks: [{ type: 'text' }],
        },
      },
    ])
  })

  it('maps thinking events to reasoning blocks', async () => {
    const chunks = await collect(toStreamChunks(feed(
      { type: 'thinking_start', contentIndex: 0, partial: assistant() },
      { type: 'thinking_delta', contentIndex: 0, delta: 'mull', partial: assistant() },
      { type: 'thinking_end', contentIndex: 0, content: 'mull', partial: assistant() },
      { type: 'done', reason: 'stop', message: assistant() },
    )))
    expect(chunks.slice(0, 3)).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'mull' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'mull' } },
    ])
  })

  it('maps tool-call events, re-stringifying parsed arguments', async () => {
    const chunks = await collect(toStreamChunks(feed(
      { type: 'toolcall_start', contentIndex: 0, partial: partialWithToolCall },
      { type: 'toolcall_delta', contentIndex: 0, delta: '{"a"', partial: partialWithToolCall },
      { type: 'toolcall_delta', contentIndex: 0, delta: ':1}', partial: partialWithToolCall },
      {
        type: 'toolcall_end',
        contentIndex: 0,
        toolCall: { type: 'toolCall', id: 'call-1', name: 'f', arguments: { a: 1 } },
        partial: partialWithToolCall,
      },
      { type: 'done', reason: 'toolUse', message: assistant({ content: partialWithToolCall.content, stopReason: 'toolUse' }) },
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'f', argumentsDelta: '{"a"' },
      { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'f', argumentsDelta: ':1}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1', name: 'f', arguments: '{"a":1}' } },
      { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
      {
        type: 'finish',
        reason: { kind: 'tool-calls' },
        replayState: {
          response: {
            kind: 'pi-ai',
            version: 2,
            api: 'openai-completions',
            provider: 'deepseek',
            model: 'deepseek-v4-flash',
            stopReason: 'toolUse',
          },
          blocks: [{ type: 'tool-call' }],
        },
      },
    ])
  })

  it('tolerates toolcall_start with a missing partial entry', async () => {
    const chunks = await collect(toStreamChunks(feed(
      { type: 'toolcall_start', contentIndex: 0, partial: assistant() },
      { type: 'toolcall_delta', contentIndex: 0, delta: '{}', partial: assistant() },
      { type: 'done', reason: 'stop', message: assistant() },
    )))
    expect(chunks[1]).toEqual({ type: 'tool-call-delta', index: 0, id: '', argumentsDelta: '{}' })
  })

  it('maps error events to error finish chunks (in-stream error style)', async () => {
    const error = assistant({ stopReason: 'error', errorMessage: 'boom', usage: usage(1, 0) })
    const chunks = await collect(toStreamChunks(feed(
      { type: 'error', reason: 'error', error },
    )))
    expect(chunks).toEqual([
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 0 } },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'PI_AI_ERROR' } } },
    ])
  })

  it('maps aborted error events to aborted finish', async () => {
    const error = assistant({ stopReason: 'aborted' })
    const chunks = await collect(toStreamChunks(feed({ type: 'error', reason: 'aborted', error })))
    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: { kind: 'aborted', failure: { message: 'pi-ai stream aborted', code: 'ABORTED' } },
    })
  })

  it('rejects a stream that ends without done or error', async () => {
    await expect(collect(toStreamChunks(feed({ type: 'start', partial: assistant() }))))
      .rejects.toThrow(/without done\/error/)
  })

  it('preserves an unknown SDK iterator Error exactly', async () => {
    const original = Object.assign(new Error('SDK transport exploded'), { code: 'ECONNRESET' })
    async function* failedSdkStream(): AsyncGenerator<AssistantMessageEvent> {
      throw original
    }

    await expect(collect(toStreamChunks(failedSdkStream()))).rejects.toBe(original)
  })
})

describe('mapStopReason / mapUsage', () => {
  it.each([
    ['stop', { kind: 'stop' }],
    ['length', { kind: 'max-tokens' }],
    ['toolUse', { kind: 'tool-calls' }],
    ['aborted', { kind: 'aborted', failure: { message: 'pi-ai stream aborted', code: 'ABORTED' } }],
  ] as const)('maps %s', (stopReason, expected) => {
    expect(mapStopReason(assistant({ stopReason, content: [{ type: 'text', text: 'ok' }] }))).toEqual(expected)
  })

  it('classifies a completed stop with no content as an EMPTY_RESPONSE error', () => {
    expect(mapStopReason(assistant({ stopReason: 'stop' }))).toEqual({
      kind: 'error',
      failure: {
        message: 'model "deepseek-v4-flash" returned a completed response with no content',
        code: EMPTY_RESPONSE_CODE,
      },
    })
  })

  it('keeps a thinking-only stop successful (any block counts as content)', () => {
    expect(mapStopReason(assistant({ stopReason: 'stop', content: [{ type: 'thinking', thinking: 'mull' }] })))
      .toEqual({ kind: 'stop' })
  })

  it('defaults the error message when pi-ai omits it', () => {
    expect(mapStopReason(assistant({ stopReason: 'error' })))
      .toEqual({ kind: 'error', failure: { message: 'pi-ai stream error', code: 'PI_AI_ERROR' } })
  })

  it('maps routable HTTP-ish error messages to stable codes', () => {
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 401: bad key' })))
      .toMatchObject({ kind: 'error', failure: { code: 'AUTH' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 429: rate limit' })))
      .toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 429: insufficient_quota' })))
      .toMatchObject({ kind: 'error', failure: { code: 'QUOTA' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'OpenAI API error (429): You exceeded your current quota, please check your plan and billing details.',
    }))).toMatchObject({ kind: 'error', failure: { code: 'QUOTA' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 500: backend down' })))
      .toMatchObject({ kind: 'error', failure: { code: 'SERVER' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'provider timed out' })))
      .toMatchObject({ kind: 'error', failure: { code: 'TIMEOUT' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'ECONNRESET socket closed' })))
      .toMatchObject({ kind: 'error', failure: { code: 'TRANSPORT' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'HTTP 400: input exceeds the model context window limit',
    }))).toMatchObject({ kind: 'error', failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'HTTP 400: request too large for model context',
    }))).toMatchObject({ kind: 'error', failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'HTTP 400: invalid input: temperature exceeds maximum allowed value',
    }))).toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 413: Payload Too Large' })))
      .toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'Failed to buffer the request body: length limit exceeded',
    }))).toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST' } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'vector length limit exceeded',
    }))).toMatchObject({ kind: 'error', failure: { code: 'PI_AI_ERROR' } })
  })

  it.each([
    'other side closed',
    'HTTP2 request did not get a response',
    'WebSocket closed unexpectedly',
    // undici flattens a mid-stream socket drop to this bare word (its SocketError
    // cause is discarded upstream before it reaches us).
    'terminated',
    'Premature close',
    // pi-ai's per-provider throws when the wire closes before the terminal event.
    'Anthropic stream ended before message_stop',
    'OpenAI Responses stream ended before a terminal response event',
    'openrouter stream ended without a terminal event',
    'Stream ended without finish_reason',
  ])('maps pi-ai transport wording %j', (errorMessage) => {
    expect(mapStopReason(assistant({ stopReason: 'error', errorMessage })))
      .toMatchObject({ kind: 'error', failure: { code: 'TRANSPORT' } })
  })

  it('uses pi-ai provider-specific overflow classification without losing rate-limit exclusions', () => {
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum',
    }))).toMatchObject({ kind: 'error', failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE } })
    expect(mapStopReason(assistant({
      stopReason: 'error',
      errorMessage: 'ThrottlingException: Too many tokens, rate limit reached',
    }))).toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT' } })
  })

  it('uses the resolved context window for silent and length-stop overflows', () => {
    // Non-empty content keeps the no-window branch on the successful stop path
    // (an empty stop is EMPTY_RESPONSE, covered above); overflow wins over both.
    const silent = assistant({ stopReason: 'stop', usage: usage(101, 0), content: [{ type: 'text', text: 'x' }] })
    expect(mapStopReason(silent)).toEqual({ kind: 'stop' })
    expect(mapStopReason(silent, 100)).toEqual({
      kind: 'error',
      failure: {
        message: 'pi-ai detected context overflow for model "deepseek-v4-flash"',
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    })

    const truncated = assistant({ stopReason: 'length', usage: usage(80, 0, 19) })
    expect(mapStopReason(truncated)).toEqual({ kind: 'max-tokens' })
    expect(mapStopReason(truncated, 100)).toMatchObject({
      kind: 'error',
      failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE },
    })
  })

  it('maps cache fields only when nonzero', () => {
    expect(mapUsage(usage(10, 5, 8, 2))).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 8,
      cacheWriteTokens: 2,
    })
    expect(mapUsage(usage(10, 5))).toEqual({ inputTokens: 10, outputTokens: 5 })
  })
})

describe('toStreamChunks edge branches', () => {
  it('omits the name field for tool calls whose partial carried an empty name', async () => {
    const blank = assistant({ content: [{ type: 'toolCall', id: 'x', name: '', arguments: {} }] })
    const chunks = await collect(toStreamChunks(feed(
      { type: 'toolcall_start', contentIndex: 0, partial: blank },
      { type: 'toolcall_delta', contentIndex: 0, delta: '{}', partial: blank },
      { type: 'done', reason: 'stop', message: assistant() },
    )))
    expect(chunks[1]).toEqual({ type: 'tool-call-delta', index: 0, id: 'x', argumentsDelta: '{}' })
  })
})

describe('toStreamChunks defensive branches', () => {
  it('tolerates a toolcall_delta with no preceding toolcall_start', async () => {
    const chunks = await collect(toStreamChunks(feed(
      { type: 'toolcall_delta', contentIndex: 0, delta: '{}', partial: assistant() },
      { type: 'done', reason: 'stop', message: assistant() },
    )))
    expect(chunks[0]).toEqual({ type: 'tool-call-delta', index: 0, id: '', argumentsDelta: '{}' })
  })
})
