import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import LlmService, { CallId, createUserMessage } from '@huiliyi37/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@huiliyi37/dsh-llm'
import * as LlmInvariant from '@huiliyi37/dsh-llm/invariant'
import InvariantService from '@huiliyi37/dsh-invariants'
import AgentLoop from '@huiliyi37/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@huiliyi37/dsh-agent-loop-testkit'
import { defineContentToolFixture } from '@huiliyi37/dsh-tools'
import type { Agent } from '@huiliyi37/dsh-agent'
import { SessionId, type SessionEvent } from '@huiliyi37/dsh-session'
import * as ToolJsonRepair from '@huiliyi37/dsh-tool-json-repair'
import type { Config } from '@huiliyi37/dsh-tool-json-repair'
import { detectToolCallJson } from '@huiliyi37/dsh-tool-json-repair/src/detect.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Behavior suite for the tool-JSON repair plugin: fail-closed detection
 * (whole-block single-object, fence, escape repair, prose/truncation/multi-
 * object rejection), stream protocol preservation through the real
 * `llm/stream` waterfall with the `dsh-llm` invariant live, and one assembled
 * agent-loop turn proving the repaired call executes and the repaired stream
 * is the one logged (model-visible ⟺ logged).
 */

const options: GenerateOptions = { provider: 'mock', model: 'mock', messages: [] }
const detectDefaults = { allowFenced: true, maxBlockChars: 65536 }

async function* source(chunks: readonly StreamChunk[]): AsyncIterable<StreamChunk> {
  yield* chunks
}

/** Mount invariants + the repair plugin, then consume one synthetic stream through the real waterfall. */
async function consumeWithPlugin(config: Config, chunks: readonly StreamChunk[]): Promise<StreamChunk[]> {
  const ctx = new Context()
  await ctx.plugin(InvariantService)
  await ctx.plugin(LlmInvariant)
  await ctx.plugin(LlmService)
  await ctx.plugin(ToolJsonRepair, config)
  const stream = ctx.waterfall(ctx as never, 'llm/stream', options, () => source(chunks))
  const consumed: StreamChunk[] = []
  for await (const chunk of stream) consumed.push(chunk)
  return consumed
}

const finish: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }
const usage: StreamChunk = { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } }

/** One text block carrying a tool-call JSON object — the bug shape. */
function jsonTextChunks(index: number, text: string): StreamChunk[] {
  return [
    { type: 'block-start', index, blockType: 'text' },
    { type: 'text-delta', index, text: text.slice(0, 7) },
    { type: 'text-delta', index, text: text.slice(7) },
    { type: 'block-end', index, block: { type: 'text', text } },
  ]
}

describe('detectToolCallJson', () => {
  it('converts a whole-block single tool-call object', () => {
    expect(detectToolCallJson('{"name": "probe", "arguments": {"path": "/tmp/x"}}', detectDefaults)).toEqual({
      name: 'probe',
      arguments: '{"path":"/tmp/x"}',
    })
  })

  it('treats an absent arguments field as {}', () => {
    expect(detectToolCallJson('{"name": "probe"}', detectDefaults)).toEqual({ name: 'probe', arguments: '{}' })
  })

  it('strips one json fence and leaves an unknown-language fence alone', () => {
    const fenced = '```json\n{"name": "probe", "arguments": {"path": "/tmp/x"}}\n```'
    expect(detectToolCallJson(fenced, detectDefaults)).toEqual({ name: 'probe', arguments: '{"path":"/tmp/x"}' })
    expect(detectToolCallJson(fenced, { ...detectDefaults, allowFenced: false })).toBeUndefined()
    expect(detectToolCallJson('```python\n{"name": "probe"}\n```', detectDefaults)).toBeUndefined()
  })

  it('recovers invalid backslash escapes in arguments (Windows paths)', () => {
    // \智 is not a valid JSON escape; the repair doubles it (the opencode-tui
    // documented failure shape: F:\智慧项目\src\app).
    const text = '{"name": "bash", "arguments": {"file_path": "F:\\智慧项目\\src\\app"}}'
    expect(detectToolCallJson(text, detectDefaults)).toEqual({
      name: 'bash',
      arguments: '{"file_path":"F:\\\\智慧项目\\\\src\\\\app"}',
    })
  })

  it.each([
    ['leading prose', 'I will call the tool: {"name": "probe", "arguments": {}}'],
    ['trailing prose', '{"name": "probe", "arguments": {}} done'],
    ['truncated', '{"name": "pro'],
    ['two objects', '{"name": "a", "arguments": {}} {"name": "b", "arguments": {}}'],
    ['array root', '[{"name": "probe", "arguments": {}}]'],
    ['missing name', '{"arguments": {}}'],
    ['non-string name', '{"name": 7}'],
    ['padded name', '{"name": " probe ", "arguments": {}}'],
    ['empty name', '{"name": "", "arguments": {}}'],
    ['scalar root', '"probe"'],
  ])('stays text for %s', (_label, text) => {
    expect(detectToolCallJson(text, detectDefaults)).toBeUndefined()
  })

  it('never converts a block over the char cap', () => {
    const text = `{"name": "probe", "arguments": {"path": "${'x'.repeat(100)}"}}`
    expect(detectToolCallJson(text, { ...detectDefaults, maxBlockChars: 50 })).toBeUndefined()
  })
})

describe('repairStream through the llm/stream waterfall', () => {
  it('converts the bug-shape text block into a tool-call block with the same index', async () => {
    const text = '{"name": "probe", "arguments": {"path": "/tmp/x"}}'
    const converted = await consumeWithPlugin({}, [...jsonTextChunks(0, text), usage, finish])
    expect(converted[0]).toEqual({ type: 'block-start', index: 0, blockType: 'tool-call' })
    expect(converted[1]).toMatchObject({ type: 'tool-call-delta', index: 0, name: 'probe', argumentsDelta: '{"path":"/tmp/x"}' })
    const callId = (converted[1] as { id: CallId }).id
    expect(String(callId)).toMatch(/^repair-0-[0-9a-f]{12}$/)
    expect(converted[2]).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: callId, name: 'probe', arguments: '{"path":"/tmp/x"}' },
    })
    expect(converted.slice(3)).toEqual([usage, finish])
  })

  it('derives the same call id for the same block content (snapshot-stable)', async () => {
    const text = '{"name": "probe", "arguments": {"path": "/tmp/x"}}'
    const first = await consumeWithPlugin({}, [...jsonTextChunks(0, text), usage, finish])
    const second = await consumeWithPlugin({}, [...jsonTextChunks(0, text), usage, finish])
    expect(first[1]).toEqual(second[1])
  })

  it('passes a non-matching text block through byte-identically', async () => {
    const chunks = [...jsonTextChunks(0, 'plain prose'), usage, finish]
    expect(await consumeWithPlugin({}, chunks)).toEqual(chunks)
  })

  it('keeps text intact once a proper tool-call block has opened', async () => {
    const text = '{"name": "probe", "arguments": {}}'
    // toolCallResponse already ends with usage + finish; drop them so the
    // text block follows the proper call inside one stream.
    const proper = toolCallResponse('c1', 'other', {})
    const chunks = [
      ...proper.slice(0, -2),
      ...jsonTextChunks(1, text),
      usage,
      finish,
    ]
    const consumed = await consumeWithPlugin({}, chunks)
    // The text block survives unconverted after the real tool call.
    expect(consumed.filter(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')).toHaveLength(1)
    expect(consumed.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'text' && chunk.block.text === text)).toBe(true)
  })

  it('converts each of two interleaved JSON text blocks with distinct indexes', async () => {
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '{"name": "a", "arguments": {}}' },
      { type: 'block-start', index: 1, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 1, text: 'r' },
      { type: 'block-end', index: 1, block: { type: 'reasoning', text: 'r' } },
      { type: 'block-end', index: 0, block: { type: 'text', text: '{"name": "a", "arguments": {}}' } },
      { type: 'block-start', index: 2, blockType: 'text' },
      { type: 'text-delta', index: 2, text: '{"name": "b", "arguments": {}}' },
      { type: 'block-end', index: 2, block: { type: 'text', text: '{"name": "b", "arguments": {}}' } },
      usage,
      finish,
    ]
    const consumed = await consumeWithPlugin({}, chunks)
    const calls = consumed.filter(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    expect(calls).toHaveLength(2)
    expect(calls.map(chunk => (chunk as { block: { name: string } }).block.name)).toEqual(['a', 'b'])
    // The reasoning block passed through in order.
    expect(consumed.filter(chunk => chunk.type === 'reasoning-delta')).toHaveLength(1)
  })

  it('registers nothing when disabled and leaves the stream untouched', async () => {
    const chunks = [...jsonTextChunks(0, '{"name": "probe", "arguments": {}}'), usage, finish]
    expect(await consumeWithPlugin({ enabled: false }, chunks)).toEqual(chunks)
  })

  it('rejects an invalid maxBlockChars at load', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantService)
    await ctx.plugin(LlmInvariant)
    await ctx.plugin(LlmService)
    await expect(ctx.plugin(ToolJsonRepair, { maxBlockChars: 0 })).rejects.toThrow(/maxBlockChars/)
  })
})

describe('assembled agent loop', () => {
  /** Boot the spine + repair plugin; callers register the adapter and tools. */
  async function harness(config: Config = {}): Promise<Context> {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(InvariantService)
    await ctx.plugin(LlmInvariant)
    await ctx.plugin(ToolJsonRepair, config)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.tools.register(defineContentToolFixture({ name: 'probe', description: 'p', parameters: {}, async execute() { return [{ type: 'text', text: 'ok' }] } }))
    return ctx
  }

  function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
    return new Promise((resolve) => { const d = ctx.on('agent/status', ({ agent: s, status: st }) => { if (s === agent && st === 'idle') { d(); resolve() } }) })
  }

  it('executes the tool call the model serialized as JSON text, and logs the repaired stream', async () => {
    const ctx = await harness()
    const adapter = new MockAdapter([
      textResponse('{"name": "probe", "arguments": {"path": "/tmp/x"}}'),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock-provider'], adapter)
    const agent = ctx.agentLoop.create(SessionId('repair-loop'), { provider: 'mock-provider', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = [...agent.session.events]
    // The repaired stream is what the loop logged for the step that carried
    // the bug-shape block (step 1 of the turn; step 2 answers "done").
    const chunkTypes = events.filter((event): event is SessionEvent<'assistant/chunk'> =>
      event.type === 'assistant/chunk' && event.data.turn === 1 && event.data.step === 1)
      .map(event => event.data.chunk.type)
    expect(chunkTypes).toContain('tool-call-delta')
    expect(chunkTypes).not.toContain('text-delta')

    const message = events.find((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
    expect(message?.data.message.content.some(block => block.type === 'tool-call' && block.name === 'probe')).toBe(true)

    const call = events.find((event): event is SessionEvent<'tool/call'> => event.type === 'tool/call')
    expect(call).toMatchObject({ data: { name: 'probe', arguments: '{"path":"/tmp/x"}' } })
    expect(events.some(event => event.type === 'tool/result')).toBe(true)
  })

  it('leaves the text message untouched when disabled', async () => {
    const ctx = await harness({ enabled: false })
    ctx.llm.registerAdapter(['mock-provider'], new MockAdapter([
      textResponse('{"name": "probe", "arguments": {"path": "/tmp/x"}}'),
    ]))
    const agent = ctx.agentLoop.create(SessionId('repair-off'), { provider: 'mock-provider', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const events = [...agent.session.events]
    expect(events.some(event => event.type === 'tool/call')).toBe(false)
    const message = events.find((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
    expect(message?.data.message.content.some(block => block.type === 'text' && block.text.includes('"name": "probe"'))).toBe(true)
  })
})
