/**
 * Packaged-runtime ripgrep sidecar resolution: a pkg single-file executable
 * spawns the `<exe>-rg` sibling (its virtual filesystem cannot spawn a native
 * helper), while an ordinary Node process keeps using `@vscode/ripgrep`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { dependencyRgPath, existsSync } = vi.hoisted(() => ({
  dependencyRgPath: '/node_modules/@vscode/ripgrep/bin/rg',
  existsSync: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync }
})

vi.mock('@vscode/ripgrep', () => ({ rgPath: dependencyRgPath }))

beforeEach(() => {
  vi.resetModules()
  existsSync.mockReset()
  Reflect.deleteProperty(process, 'pkg')
})

afterEach(() => {
  Reflect.deleteProperty(process, 'pkg')
})

describe('ripgrep resolution', () => {
  it('uses the native sidecar beside the current executable', async () => {
    Reflect.defineProperty(process, 'pkg', { configurable: true, value: {} })
    existsSync.mockReturnValue(true)
    const sidecar = `${process.execPath}-rg`
    const { resolveRgPath } = await import('@huiliyi37/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(sidecar)
    expect(existsSync).toHaveBeenCalledWith(sidecar)
  })

  it('uses the dependency binary in an ordinary Node process', async () => {
    existsSync.mockReturnValue(true)
    const { resolveRgPath } = await import('@huiliyi37/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(dependencyRgPath)
    expect(existsSync).not.toHaveBeenCalled()
  })

  it('uses the dependency binary when a packaged runtime has no sidecar', async () => {
    Reflect.defineProperty(process, 'pkg', { configurable: true, value: {} })
    existsSync.mockReturnValue(false)
    const { resolveRgPath } = await import('@huiliyi37/dsh-tool-fs-search')

    await expect(resolveRgPath()).resolves.toBe(dependencyRgPath)
    expect(existsSync).toHaveBeenCalledWith(`${process.execPath}-rg`)
  })
})
