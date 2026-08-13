import { Context } from 'cordis'
import { afterEach, describe, expect, it } from 'vitest'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserInteractionService from '@deepseek-ai/dsh-user-interaction'
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
