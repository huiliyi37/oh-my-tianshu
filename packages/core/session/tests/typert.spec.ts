import { describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import SessionStore, { SessionId } from '@huiliyi37/dsh-session'
import TypertRegistry from '@huiliyi37/dsh-typert-registry'

describe('Session TypeRT provider', () => {
  it('contributes live Session lookup in either service load order', async () => {
    const ctx = new Context()
    const sessionFiber = ctx.plugin(SessionStore)
    await sessionFiber
    await ctx.plugin(TypertRegistry)
    const session = ctx.sessions.create(SessionId('remote-session'))

    const lookup = ctx.typert.lookups.get('session')
    expect(lookup).toMatchObject({
      parameter: 'session',
      wire: 'sessionId',
      hostTypeSymbol: '@huiliyi37/dsh-session#Session',
      wireTypeSymbol: '@huiliyi37/dsh-session/types#SessionId',
    })
    expect(lookup?.resolve(session.id)).toBe(session)

    await sessionFiber.dispose()
    expect(ctx.typert.lookups.get('session')).toBeUndefined()
  })
})
