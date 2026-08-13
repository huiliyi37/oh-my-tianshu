import { Context } from '@huiliyi37/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import ToolRegistry from '@huiliyi37/dsh-tools'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import UserInteractionService from '@huiliyi37/dsh-user-interaction'
import { apply, inject } from '../src/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

describe('ui-question node plugin', () => {
  it('exposes ask_user_question only for the selected Web feature lifecycle', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(UserInteractionService)
    const feature = ctx.plugin({ inject: [...inject], apply })
    await feature.await()
    expect(ctx.tools.get('ask_user_question')).toBeDefined()

    await feature.dispose()
    expect(ctx.tools.get('ask_user_question')).toBeUndefined()
  })
})
