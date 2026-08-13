import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'
import { call, dummyTool, LISTENER_CODE, REVERSE_TOOL_CODE, setup, text } from './helpers.ts'

/**
 * Disposal semantics: `cordis_unmount` reaches quiescence before returning,
 * and disposing the tool-cordis fiber itself (the HMR path) cascades over the
 * whole dynamic subtree through the ordinary parent→child fiber lifecycle.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('cordis_unmount', () => {
  it('disposes the mount and its registrations have stopped by the time it returns (quiescence)', async () => {
    const ctx = await setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await call(ctx, 'cordis_mount', { code: LISTENER_CODE })

    ctx.tools.register(dummyTool('trigger_before'))
    expect(log).toHaveBeenCalledTimes(1)

    const result = await call(ctx, 'cordis_unmount', { id: 'dyn-1' })
    expect(result.isError).toBe(false)
    if (result.isError) { throw new Error('expected cordis_unmount success') }
    expect(result.value).toEqual({ id: 'dyn-1', pluginName: 'change-logger' })
    expect(text(result)).toBe('Temporary Plugin dyn-1 was unmounted and removed.')

    // Immediately after the awaited unmount, the listener must be gone — no
    // grace period, no eventual consistency.
    ctx.tools.register(dummyTool('trigger_after'))
    expect(log).toHaveBeenCalledTimes(1)
    expect(text(await call(ctx, 'cordis_inspect', { what: 'temporary' }))).toContain('No temporary Plugins are running.')
  })

  it('unregisters a self-made tool on unmount', async () => {
    const ctx = await setup()
    await call(ctx, 'cordis_mount', { code: REVERSE_TOOL_CODE })
    expect(ctx.tools.get('reverse_text')).toBeDefined()

    await call(ctx, 'cordis_unmount', { id: 'dyn-1' })
    expect(ctx.tools.get('reverse_text')).toBeUndefined()
  })

  it('rejects an unknown id, and a second unmount of the same id', async () => {
    const ctx = await setup()
    const unknown = await call(ctx, 'cordis_unmount', { id: 'dyn-99' })
    expect(unknown.isError).toBe(true)
    expect(text(unknown)).toContain('no temporary Plugin with id "dyn-99"')

    await call(ctx, 'cordis_mount', { code: LISTENER_CODE })
    await call(ctx, 'cordis_unmount', { id: 'dyn-1' })
    const again = await call(ctx, 'cordis_unmount', { id: 'dyn-1' })
    expect(again.isError).toBe(true)
  })
})

describe('HMR safety', () => {
  it('disposing the tool-cordis fiber cascades over the dynamic subtree and its registrations', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    const fiber = await ctx.plugin(tool)

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await call(ctx, 'cordis_mount', { code: LISTENER_CODE })
    await call(ctx, 'cordis_mount', { code: REVERSE_TOOL_CODE })
    expect(ctx.tools.get('reverse_text')).toBeDefined()

    await fiber.dispose()

    // The whole subtree is gone: the self-made tool, the cordis tools, and the
    // mounted listener (no log on a fresh tools/change).
    expect(ctx.tools.get('reverse_text')).toBeUndefined()
    expect(ctx.tools.get('cordis_mount')).toBeUndefined()
    const calls = log.mock.calls.length
    ctx.tools.register(dummyTool('trigger_post_dispose'))
    expect(log).toHaveBeenCalledTimes(calls)
  })
})
