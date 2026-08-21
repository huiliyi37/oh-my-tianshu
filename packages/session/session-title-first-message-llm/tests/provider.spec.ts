import { Context } from '@huiliyi37/cordis'
import { describe, expect, it, vi } from 'vitest'
import LlmService, { createUserMessage, LlmAdapter  } from '@huiliyi37/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@huiliyi37/dsh-llm'
import ModelRolesService from '@huiliyi37/dsh-model-roles'
import SessionStore, { Session, SessionId } from '@huiliyi37/dsh-session'
import SessionTitleService, { type SessionTitleProvider } from '@huiliyi37/dsh-session-title'
import * as providerPlugin from '@huiliyi37/dsh-session-title-first-message-llm'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'First-message model title' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const TITLE_CONFIG = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } as const
const LLM_CONFIG = {
  targetWords: 5,
  targetCjkCharacters: 10,
  maxInputBytes: 1_000,
  maxOutputTokens: 32,
  timeoutMs: 1_000,
  provider: 'title-route',
  model: 'title-model',
} as const

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('first-message LLM title provider', () => {
  it('rejects an impossible empty provider request at its own boundary', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmService)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    let registered: SessionTitleProvider | undefined
    vi.spyOn(ctx.sessionTitle, 'register').mockImplementation((provider) => {
      registered = provider
      return async () => undefined
    })
    providerPlugin.apply(ctx, LLM_CONFIG)

    await expect(registered!.generate({
      session: Session.create(SessionId('empty-first-provider')),
      messages: [],
      signal: new AbortController().signal,
    })).rejects.toThrow(/requires one human message/)
  })

  it('always selects only the first eligible human message, including explicit refresh', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmService)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    const adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['title-route'], adapter)
    await ctx.plugin(providerPlugin, LLM_CONFIG)
    const session = ctx.sessions.create(SessionId('first-plugin'))
    session.append('turn/start', { turn: 1 })
    const first = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first input' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settle()
    session.append('request/header', {
      header: { config: { provider: 'main', model: 'main-model' } }, reason: 'initial',
    })
    await settle()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'second input must be ignored' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await ctx.sessionTitle.refresh(session)

    expect(adapter.requests).toHaveLength(2)
    for (const options of adapter.requests) {
      const content = options.messages[0]?.content[0]
      expect(content?.type === 'text' && content.text).toContain('first input')
      expect(content?.type === 'text' && content.text).not.toContain('second input must be ignored')
    }
    expect(ctx.sessionTitle.get(session)).toMatchObject({ messageSeqs: [first.seq] })
  })

  it('routes title generation through a secondary-role pin above the configured pair', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmService)
    await ctx.plugin(SessionStore)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(ModelRolesService)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    await ctx.modelRoles.pin('secondary', { provider: 'pin-route', model: 'pin-model' })
    const pinAdapter = new RecordingAdapter()
    const configAdapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['pin-route'], pinAdapter)
    ctx.llm.registerAdapter(['title-route'], configAdapter)
    await ctx.plugin(providerPlugin, LLM_CONFIG)
    const session = ctx.sessions.create(SessionId('pinned-first-plugin'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first input' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settle()
    session.append('request/header', {
      header: { config: { provider: 'main', model: 'main-model' } }, reason: 'initial',
    })
    await settle()

    await ctx.sessionTitle.refresh(session)

    // Every dispatch — automatic and explicit refresh — follows the pin; the
    // configured pair and the logged main route stay untouched below it.
    expect(pinAdapter.requests.length).toBeGreaterThan(0)
    for (const options of pinAdapter.requests) {
      expect(options).toMatchObject({ provider: 'pin-route', model: 'pin-model' })
    }
    expect(configAdapter.requests).toHaveLength(0)
  })
})
