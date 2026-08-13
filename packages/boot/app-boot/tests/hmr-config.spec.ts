import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from 'cordis'
import Hmr from '@cordisjs/plugin-hmr'
import Loader from '@cordisjs/plugin-loader'
import Timer from '@cordisjs/plugin-timer'
import { describe, expect, it } from 'vitest'

async function bootHmr(dir: string): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(dir).href + '/'
  await ctx.plugin(Loader)
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  return ctx
}

async function eventually(test: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!test()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('HMR exact config paths', () => {
  it('observes add, change, and unlink outside its module roots', { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    const filename = join(dir, 'plugins.yml')
    const ctx = await bootHmr(dir)
    const observed: string[] = []
    try {
      await ctx.hmr.registerConfig(filename, () => {
        try {
          observed.push(readFileSync(filename, 'utf8'))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          observed.push('missing')
        }
      })

      writeFileSync(filename, 'one', { flag: 'wx' })
      await eventually(() => observed.includes('one'), 'HMR did not observe config creation')
      writeFileSync(filename, 'two')
      await eventually(() => observed.includes('two'), 'HMR did not observe config change')
      unlinkSync(filename)
      await eventually(() => observed.includes('missing'), 'HMR did not observe config removal')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('observes creation when the config parent did not exist at registration', { timeout: 20_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    const dir = join(root, 'later')
    const filename = join(dir, 'plugins.yml')
    const ctx = await bootHmr(root)
    const observed: string[] = []
    try {
      await ctx.hmr.registerConfig(filename, () => {
        observed.push(readFileSync(filename, 'utf8'))
      })
      mkdirSync(dir)
      writeFileSync(filename, 'created')
      await eventually(() => observed.includes('created'), 'HMR did not observe config creation under a new parent')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('serializes refreshes and waits for them during disposal', { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    const filename = join(dir, 'plugins.yml')
    writeFileSync(filename, 'one')
    const ctx = await bootHmr(dir)
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const observed: string[] = []
    let active = 0
    let maxActive = 0
    try {
      const dispose = await ctx.hmr.registerConfig(filename, async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        observed.push(readFileSync(filename, 'utf8'))
        if (observed.length === 1) {
          started.resolve(undefined)
          await release.promise
        }
        active -= 1
      })
      await started.promise
      writeFileSync(filename, 'two')
      // Chokidar coalesces atomic writes for 100 ms by default. Wait beyond
      // that window so this edit is queued before registration disposal.
      await new Promise(resolve => setTimeout(resolve, 250))

      let disposed = false
      const disposal = dispose().then(() => { disposed = true })
      await Promise.resolve()
      expect(disposed).toBe(false)
      release.resolve(undefined)
      await disposal
      expect(maxActive).toBe(1)
      expect(observed).toEqual(['one', 'two'])
    } finally {
      release.resolve(undefined)
      await ctx.fiber.dispose()
    }
  })

  it('normalizes refresh failures and broadcasts them without escaping the watcher', { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-hmr-config-'))
    const filename = join(dir, 'plugins.yml')
    const ctx = await bootHmr(dir)
    const failure = Promise.withResolvers<{ filename: string; error: Error }>()
    let failureCount = 0
    try {
      ctx.on('hmr/config-update-failed', () => {
        throw new Error('observer failed')
      })
      ctx.on('hmr/config-update-failed', (failedFilename, error) => {
        failureCount += 1
        failure.resolve({ filename: failedFilename, error })
      })
      await ctx.hmr.registerConfig(filename, () => { throw 42 })
      writeFileSync(filename, 'invalid')

      const observed = await failure.promise
      expect(observed.filename).toBe(filename)
      expect(observed.error).toBeInstanceOf(Error)
      expect(observed.error.message).toBe('42')

      writeFileSync(filename, 'invalid again')
      await eventually(() => failureCount === 2, 'HMR stopped broadcasting after an observer rejected')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
