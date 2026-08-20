/**
 * tool-memory-recall apply：named export、真 Context 注册与 HMR 卸载。
 *
 * @module @huiliyi37/dsh-tool-memory-recall/tests/plugin
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import SystemPrompt from '@huiliyi37/dsh-system-prompt'
import ToolRegistry from '@huiliyi37/dsh-tools'
import * as tool from '../src/index.ts'
import { Config, inject, name } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('tool-memory-recall plugin apply', () => {
  it('named export 与 Config schema 存在，且无 default（Loader 保留 inject）', () => {
    expect(name).toBe('tool-memory-recall')
    expect(inject).toEqual(['tools', 'systemPrompt'])
    expect(Config).toBeDefined()
    expect('default' in tool).toBe(false)
  })

  it('unregisters the tool when its contributing fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    const fiber = await ctx.plugin(tool)
    expect(ctx.tools.get('memory_deep_recall')).toBeDefined()
    await fiber.dispose()
    expect(ctx.tools.get('memory_deep_recall')).toBeUndefined()
  })
})
