/** Default-browser startup over a real Loader tree and listening Web server. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import Include from '@huiliyi37/cordis-plugin-include'
import Loader from '@huiliyi37/cordis-plugin-loader'
import HttpServer from '@huiliyi37/dsh-host-webserver'
import { apply, internals } from '../src/index.ts'

const contexts: Context[] = []
const tempRoots: string[] = []
const originalResolveDistIndex = internals.resolveDistIndex
const originalOpenBrowser = internals.openBrowser

beforeEach(() => {
  vi.stubEnv('SSH_CONNECTION', '')
  vi.stubEnv('SSH_TTY', '')
})

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  internals.resolveDistIndex = originalResolveDistIndex
  internals.openBrowser = originalOpenBrowser
  vi.unstubAllEnvs()
  Reflect.deleteProperty(globalThis, '__dshWebAppApply')
  Reflect.deleteProperty(globalThis, '__dshWebServer')
})

describe('web app browser startup', () => {
  it('opens the canonical URL only after the complete page is reachable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-web-browser-open-'))
    tempRoots.push(root)
    const dist = join(root, 'dist')
    mkdirSync(dist)
    const index = join(dist, 'index.html')
    writeFileSync(index, '<!doctype html><title>ready</title>')
    internals.resolveDistIndex = () => index

    const webserverModule = join(root, 'webserver.mjs')
    const webAppModule = join(root, 'web-app.mjs')
    writeFileSync(webserverModule, 'export default globalThis.__dshWebServer\n')
    writeFileSync(webAppModule, [
      "export const name = 'fixture-web-app'",
      "export const inject = ['webServer']",
      'export const apply = (ctx, config) => globalThis.__dshWebAppApply(ctx, config)',
      '',
    ].join('\n'))
    const config = join(root, 'cordis.yml')
    writeFileSync(config, [
      '- id: webserver',
      `  name: ${pathToFileURL(webserverModule).href}`,
      '  config:',
      '    host: 127.0.0.1',
      '    port: 0',
      '- id: web-app',
      `  name: ${pathToFileURL(webAppModule).href}`,
      '  config:',
      '    mode: production',
      '    openBrowser: true',
      '    printUrl: false',
      '    surfaceContext: false',
      '    lanAddresses: []',
      '',
    ].join('\n'))

    const globals = globalThis as unknown as {
      __dshWebAppApply: typeof apply
      __dshWebServer: typeof HttpServer
    }
    globals.__dshWebAppApply = apply
    globals.__dshWebServer = HttpServer

    let openedUrl: string | undefined
    let openedStatus: number | undefined
    let resolveOpened!: () => void
    const opened = new Promise<void>((resolve) => { resolveOpened = resolve })
    internals.openBrowser = async (url) => {
      openedUrl = url
      openedStatus = (await fetch(url)).status
      resolveOpened()
    }

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(config).href },
    })
    await ctx.loader.await()
    await opened

    expect(openedUrl).toBe(`http://127.0.0.1:${String(ctx.get('webServer')?.port)}`)
    expect(openedStatus).toBe(200)
  })
})
