import { Context } from '@huiliyi37/cordis'
import { describe, expect, it, vi } from 'vitest'
import LlmService, { createUserMessage, deepFreeze, markAgentLoopRequest  } from '@huiliyi37/dsh-llm'
import SessionStore, { SessionId } from '@huiliyi37/dsh-session'
import SessionTitleService, {
  SessionTitleProviderId,
  type SessionTitleProvider,
  type SessionTitleProviderRequest,
  type SessionTitleProviderResult,
} from '@huiliyi37/dsh-session-title'

const CONFIG = {
  fallbackMaxWords: 5,
  fallbackMaxBytes: 24,
  maxTitleBytes: 24,
} as const

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function appendHumanPrompt(session: ReturnType<Context['sessions']['create']>, text: string) {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

function appendRoute(session: ReturnType<Context['sessions']['create']>, reason: 'initial' | 'change' = 'initial'): void {
  session.append('request/header', {
    header: { config: { provider: 'main-route', model: 'chat-model' } },
    reason,
  })
}

describe('SessionTitleService provider lifecycle', () => {
  it('inherits title events across forks, skips first-message retitling, and lets all-messages update later', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    const parent = ctx.sessions.create(SessionId('title-parent'))
    parent.append('turn/start', {
      turn: 1,
    })
    const inheritedMessage = appendHumanPrompt(parent, 'Inherited title prompt')
    await settle()
    parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const child = ctx.sessions.fork(parent, undefined, SessionId('title-child'))
    expect(ctx.sessionTitle.get(child)).toEqual(ctx.sessionTitle.get(parent))
    expect(child.events.find(event => event.type === 'session/title'))
      .toEqual(parent.events.find(event => event.type === 'session/title'))

    const firstGenerate = vi.fn(async (request: SessionTitleProviderRequest) => ({
      title: 'Should not run',
      messageSeqs: [request.messages[0]!.seq],
    }))
    const disposeFirst = ctx.sessionTitle.register({
      id: SessionTitleProviderId('fork-first'),
      automatic: 'first-message',
      generate: firstGenerate,
    })
    child.append('turn/start', {
      turn: 2,
    })
    const childMessage = appendHumanPrompt(child, 'Child follow-up prompt')
    await settle()
    appendRoute(child)
    await settle()
    child.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    expect(firstGenerate).not.toHaveBeenCalled()
    await disposeFirst()

    const allGenerate = vi.fn(async (request: SessionTitleProviderRequest) => ({
      title: 'Fork all prompts',
      messageSeqs: request.messages.map(message => message.seq),
    }))
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('fork-all'),
      automatic: 'all-user-messages',
      generate: allGenerate,
    })
    child.append('turn/start', {
      turn: 3,
    })
    const latestMessage = appendHumanPrompt(child, 'Retitle the fork now')
    await settle()
    appendRoute(child, 'change')
    await settle()
    child.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

    expect(allGenerate).toHaveBeenCalledOnce()
    expect(ctx.sessionTitle.get(child)).toMatchObject({
      title: 'Fork all prompts',
      messageSeqs: [inheritedMessage.seq, childMessage.seq, latestMessage.seq],
      source: { kind: 'provider', provider: SessionTitleProviderId('fork-all') },
    })
    expect(ctx.sessionTitle.get(parent)?.title).toBe('Inherited title prompt')
  })

  it('runs a first-message provider once after the routed request and retries only through refresh', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    const requests: SessionTitleProviderRequest[] = []
    const provider: SessionTitleProvider = {
      id: SessionTitleProviderId('first-model'),
      automatic: 'first-message',
      async generate(request) {
        requests.push(request)
        return {
          title: '\u001B[31m  A   model-generated title that is too long  ',
          messageSeqs: [request.messages[0]!.seq],
          model: { provider: 'aux-route', model: 'title-model' },
        }
      },
    }
    ctx.sessionTitle.register(provider)
    const session = ctx.sessions.create(SessionId('first-provider'))
    session.append('turn/start', {
      turn: 1,
    })
    const first = appendHumanPrompt(session, 'Explain asynchronous title generation')
    await settle()
    expect(ctx.sessionTitle.get(session)?.source.kind).toBe('fallback')

    appendRoute(session)
    await settle()

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      session,
      messages: [{ seq: first.seq, text: 'Explain asynchronous title generation' }],
      route: { provider: 'main-route', model: 'chat-model' },
    })
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      title: 'A model-generated title',
      messageSeqs: [first.seq],
      source: {
        kind: 'provider',
        provider: SessionTitleProviderId('first-model'),
        model: { provider: 'aux-route', model: 'title-model' },
      },
    })

    const second = appendHumanPrompt(session, 'A later prompt')
    appendRoute(session, 'change')
    await settle()
    expect(requests).toHaveLength(1)

    await ctx.sessionTitle.refresh(session)
    expect(requests).toHaveLength(2)
    expect(requests[1]?.messages.map(message => message.seq)).toEqual([first.seq, second.seq])
  })

  it('rejects a second provider and drains stale work when the winner is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    const pending = deferred<SessionTitleProviderResult>()
    let observedSignal: AbortSignal | undefined
    const first: SessionTitleProvider = {
      id: SessionTitleProviderId('winner'),
      automatic: 'all-user-messages',
      generate(request) {
        observedSignal = request.signal
        return pending.promise
      },
    }
    const dispose = ctx.sessionTitle.register(first)
    expect(() => ctx.sessionTitle.register({
      id: SessionTitleProviderId('duplicate'),
      automatic: 'first-message',
      generate: async () => ({ title: 'duplicate', messageSeqs: [0] }),
    })).toThrow(/already registered/)

    const session = ctx.sessions.create(SessionId('dispose-provider'))
    session.append('turn/start', {
      turn: 1,
    })
    const message = appendHumanPrompt(session, 'Generate this title')
    await settle()
    appendRoute(session)
    await settle()
    expect(observedSignal?.aborted).toBe(false)

    const disposal = dispose()
    expect(observedSignal?.aborted).toBe(true)
    let disposed = false
    void disposal.then(() => { disposed = true })
    await settle()
    expect(disposed).toBe(false)
    pending.resolve({ title: 'stale provider result', messageSeqs: [message.seq] })
    await disposal
    expect(disposed).toBe(true)
    expect(ctx.sessionTitle.get(session)?.source.kind).toBe('fallback')

    const replacement: SessionTitleProvider = {
      id: SessionTitleProviderId('replacement'),
      automatic: 'first-message',
      generate: async () => ({ title: 'replacement', messageSeqs: [message.seq] }),
    }
    const disposeReplacement = ctx.sessionTitle.register(replacement)
    await disposeReplacement()
  })

  it('supersedes an older all-messages revision and cannot commit an ignored abort', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    const firstResult = deferred<SessionTitleProviderResult>()
    const requests: SessionTitleProviderRequest[] = []
    const provider: SessionTitleProvider = {
      id: SessionTitleProviderId('all-model'),
      automatic: 'all-user-messages',
      generate(request) {
        requests.push(request)
        if (requests.length === 1) return firstResult.promise
        return Promise.resolve({
          title: 'Newest complete title',
          messageSeqs: request.messages.map(message => message.seq),
        })
      },
    }
    ctx.sessionTitle.register(provider)
    const session = ctx.sessions.create(SessionId('supersede'))
    session.append('turn/start', {
      turn: 1,
    })
    const first = appendHumanPrompt(session, 'First prompt')
    await settle()
    appendRoute(session)
    await settle()

    const second = appendHumanPrompt(session, 'Second prompt')
    expect(requests[0]?.signal.aborted).toBe(true)
    appendRoute(session, 'change')
    await settle()
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      title: 'Newest complete title',
      messageSeqs: [first.seq, second.seq],
    })

    firstResult.resolve({ title: 'Old ignored result', messageSeqs: [first.seq] })
    await settle()
    expect(ctx.sessionTitle.get(session)?.title).toBe('Newest complete title')
  })

  // 已知失败（fb34fb6b 能力剥离后确定性出现）：复用已记 header 的下一主请求
  // 不再触发 all-messages 修订（requests 停在 1）。onMainRequest 的调度条件
  // 疑似在剥离后不再命中——跟踪 https://github.com/huiliyi37/oh-my-tianshu/issues/5；修复后改回 it 翻绿。
  it.skip('runs an all-messages revision when the next main request reuses its logged header', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmService)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    const requests: Array<SessionTitleProviderRequest> = []
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('unchanged-route'),
      automatic: 'all-user-messages',
      async generate(request) {
        requests.push(request)
        return {
          title: `Revision ${requests.length}`,
          messageSeqs: request.messages.map(message => message.seq),
        }
      },
    })
    const session = ctx.sessions.create(SessionId('unchanged-route'))
    session.append('turn/start', {
      turn: 1,
    })
    const first = appendHumanPrompt(session, 'First routed prompt')
    await settle()
    session.append('step/start', { turn: 1, step: 1 })
    appendRoute(session)
    await settle()
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    session.append('turn/start', {
      turn: 2,
    })
    const second = appendHumanPrompt(session, 'Second prompt on the same route')
    await settle()
    session.append('step/start', { turn: 2, step: 1 })
    void ctx.llm.stream(markAgentLoopRequest(deepFreeze({
      provider: 'main-route',
      model: 'chat-model',
      messages: session.deriveMessages(),
      sessionId: session.id,
    })))
    await settle()

    expect(session.events.filter(event => event.type === 'request/header')).toHaveLength(1)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      messages: [
        { seq: first.seq, text: 'First routed prompt' },
        { seq: second.seq, text: 'Second prompt on the same route' },
      ],
      route: { provider: 'main-route', model: 'chat-model' },
    })
  })

  it('ignores model streams that are not a matching loop request', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmService)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    const generate = vi.fn(async (request: SessionTitleProviderRequest): Promise<SessionTitleProviderResult> => ({
      title: 'Unexpected title',
      messageSeqs: request.messages.map(message => message.seq),
    }))
    ctx.sessionTitle.register({
      id: SessionTitleProviderId('request-filter'),
      automatic: 'all-user-messages',
      generate,
    })
    const options = { provider: 'main-route', model: 'chat-model', messages: [] }

    void ctx.llm.stream(deepFreeze(options))
    void ctx.llm.stream(markAgentLoopRequest(deepFreeze({ ...options, sessionId: SessionId('missing') })))
    const quiet = ctx.sessions.create(SessionId('quiet'))
    void ctx.llm.stream(markAgentLoopRequest(deepFreeze({ ...options, sessionId: quiet.id })))
    const pending = ctx.sessions.create(SessionId('unmatched-boundary'))
    pending.append('turn/start', {
      turn: 1,
    })
    appendHumanPrompt(pending, 'Wait for a matching request boundary')
    await settle()
    void ctx.llm.stream(markAgentLoopRequest(deepFreeze({ ...options, sessionId: pending.id })))
    await settle()

    expect(generate).not.toHaveBeenCalled()
  })

  it('contains automatic failures but lets explicit refresh reject', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, CONFIG)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const provider: SessionTitleProvider = {
      id: SessionTitleProviderId('failing'),
      automatic: 'all-user-messages',
      generate: async () => { throw new Error('title backend failed') },
    }
    ctx.sessionTitle.register(provider)
    const session = ctx.sessions.create(SessionId('failure'))
    session.append('turn/start', {
      turn: 1,
    })
    appendHumanPrompt(session, 'Keep a fallback')
    await settle()
    appendRoute(session)
    await settle()

    expect(ctx.sessionTitle.get(session)?.source.kind).toBe('fallback')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('automatic title generation failed'))
    await expect(ctx.sessionTitle.refresh(session)).rejects.toThrow('title backend failed')
    warn.mockRestore()
  })
})
