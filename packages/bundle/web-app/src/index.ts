/**
 * @huiliyi37/dsh-web-app — the browser-surface bundle's runtime glue plugin
 * plus the bundle patch (`cordis.patch.yml`, declared by the `dsh.bundle.patch`
 * manifest field). The plugin owns what used to be launcher code: it resolves
 * the built frontend dist (workspace knowledge of this bundle, never user
 * config), mounts the `frontend-static` fallback owner over it, registers the
 * web-surface prompt section and the bash-visible web runtime variables, and
 * publishes readiness through the URL line and the default-browser handoff.
 * Flag-derived values (`mode`, `lanAddresses`, `printUrl`, `openBrowser`)
 * arrive as launcher patches over this row.
 * @module @huiliyi37/dsh-web-app
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import type { Context } from '@huiliyi37/cordis'
import z from '@huiliyi37/schemastery'
import * as FrontendStatic from '@huiliyi37/dsh-frontend-static'
import { environmentOf } from '@huiliyi37/dsh-environment'
import { scrubbedParentEnv } from '@huiliyi37/dsh-subprocess'
import type {} from '@huiliyi37/cordis-plugin-loader'
import type {} from '@huiliyi37/dsh-host-webserver'
import type {} from '@huiliyi37/dsh-system-prompt'
import type {} from '@huiliyi37/dsh-bash-env'

/** Stable Cordis plugin name. */
export const name = 'web-app'

/** Services required before the web runtime can mount. */
export const inject = ['httpServer']

/** Web runtime mode: production, or development when the client-plugin HMR receiver is active. */
export type WebMode = 'production' | 'development'

/** Plugin config: the surface facts the launcher patches over this bundle's defaults. */
export interface Config {
  /** Whether this process mounted the client-plugin HMR receiver (`tianshu web --dev`). */
  mode: WebMode
  /** Permit default-browser handoff after the Loader tree settles; an SSH launch suppresses it. */
  openBrowser: boolean
  /** Print the URL line on activation; a headless layer over this bundle turns it off. */
  printUrl: boolean
  /**
   * Register the model-visible surface context (the `app:web-surface` prompt
   * section and the `DSH_WEB_URL`/`DSH_WEB_MODE` bash variables). A one-shot
   * layer turns it off: its user is not interacting through the GUI, so the
   * orientation text would be false.
   */
  surfaceContext: boolean
  /**
   * LAN IPv4 addresses sampled once by the launcher when the effective bind
   * is all-interfaces — the exact snapshot the /api trust fence was
   * configured with, so the printed LAN URL can never name an address the
   * fence rejects. Empty on a loopback bind.
   */
  lanAddresses: string[]
}

export const Config: z<Config> = z.object({
  mode: z.union([z.const('production'), z.const('development')]).default('production'),
  openBrowser: z.boolean().default(true),
  printUrl: z.boolean().default(true),
  surfaceContext: z.boolean().default(true),
  lanAddresses: z.array(String).default([]),
})

/** Environment variable naming the canonical local URL of this Web GUI. */
const DSH_WEB_URL = 'DSH_WEB_URL' as const
/** Environment variable naming the Web runtime mode. */
const DSH_WEB_MODE = 'DSH_WEB_MODE' as const

// Display-only mirror of the webserver schema's loopback host: the address the
// local URL always prints. Not a source of truth — the schema is.
const LOOPBACK_HOST = '127.0.0.1'

/** Whether this process was launched through SSH, including a forwarded-port session. */
function launchedThroughSsh(ctx: Context): boolean {
  const environment = environmentOf(ctx)
  return ['SSH_CONNECTION', 'SSH_TTY'].some((name) => {
    const value = environment.getFrom(name, ['process'])?.value
    return value !== undefined && value !== ''
  })
}

const BROWSER_OPENER_MODULE = import.meta.resolve('open')

const BROWSER_OPENER_PROGRAM = `
try {
  const { default: open } = await import(${JSON.stringify(BROWSER_OPENER_MODULE)})
  const launcher = await open(process.argv[1])
  if (process.platform === 'win32') {
    // open resolves at PowerShell spawn; keep it referenced until that launcher hands the URL to Windows.
    const code = launcher.exitCode ?? await new Promise((resolve, reject) => {
      function onError(error) {
        launcher.off('close', onClose)
        reject(error)
      }
      function onClose(code) {
        launcher.off('error', onError)
        resolve(code)
      }
      launcher.ref()
      launcher.once('error', onError)
      launcher.once('close', onClose)
    })
    if (code !== 0) throw new Error('browser operating-system launcher exited with code ' + String(code))
  }
  process.exitCode = 0
} catch (error) {
  // The parent turns this exit into the manual-URL warning.
  console.error(error)
  process.exitCode = 1
}
`

/** Model-visible orientation and acceptance boundary for sessions created through `tianshu web`. */
function webSurfacePrompt(webUrl: string, mode: WebMode): string {
  const updateContract = mode === 'development'
    ? 'This Web process was launched with `tianshu web --dev`, so its client-plugin HMR receiver is active. '
      + 'No-refresh updates occur only when `pnpm run dev:web` is also running from this same checkout to rebuild client-plugin bundles; verify that watcher before promising automatic updates. '
      + 'Client-plugin changes then reload automatically, while apps/web shell and other plain-package changes still require a rebuild and page refresh. '
    : 'This Web process was launched without `--dev`, so HMR is inactive: rebuild the affected Web artifacts and verify this existing URL after a page refresh. '
      + 'If the user wants no-refresh client-plugin updates, explain that this GUI must be restarted with `tianshu web --dev` and `pnpm run dev:web` must also run from this same checkout; do not present either command alone as sufficient. '
  return `You are interacting with the user through the Tianshu Harness Web GUI at ${webUrl}. `
    + 'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. '
    + 'The browser provides no implicit DOM, route, or screenshot context. '
    + updateContract
    + 'Starting another server does not update this GUI. '
    + 'The apps/web Vite entry builds the shell but is not a standalone application because only tianshu web injects window.__DSH_BOOT__. '
    + 'Do not start a replacement server unless the user asks; if one is needed, use a managed background task and verify its exact URL.'
}

/** Resolve the canonical loopback URL from the active Web server. */
function localWebUrl(ctx: Context): string {
  const port = ctx.get('httpServer')?.port
  if (port === undefined) throw new Error('web-app: httpServer service missing while resolving Web runtime')
  return `http://${LOOPBACK_HOST}:${String(port)}`
}

/** Dist location is workspace knowledge of this bundle: resolved through the frontend package exports, not configured. */
function resolveDistIndex(): string {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve('@huiliyi37/dsh-frontend/dist/index.html')
  } catch {
    /* v8 ignore next 2 -- reachable only on a checkout without a built dist; the test tree builds it */
    throw new Error('web-app: frontend dist not built; run pnpm run build from the repository root first')
  }
}

/** Start the maintained platform opener without forwarding Harness credentials. */
function spawnBrowserLauncher(url: string): ChildProcess {
  return spawn(process.execPath, [
    '--input-type=module',
    '--eval', BROWSER_OPENER_PROGRAM,
    '--', url,
  ], {
    env: scrubbedParentEnv(),
    stdio: ['ignore', 'inherit', 'pipe'],
  })
}

/** Hand one URL to the operating system's default browser. */
async function openBrowser(url: string): Promise<void> {
  const launcher = spawnBrowserLauncher(url)
  let launcherStderr = ''
  launcher.stderr?.setEncoding('utf8')
  launcher.stderr?.on('data', (chunk: string) => { launcherStderr += chunk })
  await new Promise<void>((resolve, reject) => {
    function onError(error: Error): void {
      launcher.off('close', onClose)
      reject(error)
    }
    function onClose(code: number | null): void {
      launcher.off('error', onError)
      if (code !== 0) {
        const firstLine = launcherStderr.trim().split(/\r?\n/u)[0]
        const reason = firstLine === undefined || firstLine === ''
          ? `browser launcher exited with code ${String(code)}`
          : firstLine.replace(/^(?:[A-Za-z]*Error):\s*/u, '')
        reject(new Error(reason))
        return
      }
      if (launcherStderr !== '') process.stderr.write(launcherStderr)
      resolve()
    }
    launcher.once('error', onError)
    launcher.once('close', onClose)
  })
}

/** Test hooks for the built dist and native browser handoff; production never mutates them. */
export const internals: {
  resolveDistIndex: () => string
  openBrowser: (url: string) => Promise<void>
} = { resolveDistIndex, openBrowser }

/**
 * Mount the Web runtime: dist serving, surface prompt, bash runtime
 * variables, the URL line, and the default-browser handoff.
 * @param ctx - plugin context carrying the httpServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // The loopback URL belongs to this host. Under SSH, the operator reaches it
  // through a local forwarding address that this process cannot derive.
  const handoffBrowser = config.openBrowser && !launchedThroughSsh(ctx)
  ctx.plugin(FrontendStatic, { distIndex: internals.resolveDistIndex() })
  if (config.surfaceContext) {
    ctx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.section({
        name: 'app:web-surface',
        order: -98,
        text: () => webSurfacePrompt(localWebUrl(promptCtx), config.mode),
      })
    })
    ctx.inject(['bashEnv'], (runtimeCtx) => {
      runtimeCtx.bashEnv.register({
        name: 'web-runtime',
        variables: {
          [DSH_WEB_URL]: { description: 'Canonical local URL of the Tianshu Harness Web GUI serving this session.' },
          [DSH_WEB_MODE]: { description: 'Web runtime mode: production, or development when the client-plugin HMR receiver is active.' },
        },
        resolve: () => ({ [DSH_WEB_URL]: localWebUrl(runtimeCtx), [DSH_WEB_MODE]: config.mode }),
      })
    })
  }
  if (config.printUrl || handoffBrowser) {
    // The URL line and browser handoff are readiness signals: supervisors RPC
    // as soon as they observe the line, while a browser requests the page as
    // soon as it opens. Neither may run while sibling rows such as the /api
    // route owner are still mounting. Await Loader settlement first; a
    // hand-built tree without a Loader is already the complete tree.
    const announceReady = (): void => {
      const webUrl = localWebUrl(ctx)
      // The launcher's boot-time LAN snapshot, not a fresh sample: the printed
      // LAN URL must name an address the /api trust fence was configured with.
      const lanCandidate = config.lanAddresses[0]
      const port = ctx.httpServer.port
      if (config.printUrl) {
        console.log(`tianshu web: ${webUrl}${lanCandidate === undefined ? '' : ` (LAN: http://${lanCandidate}:${String(port)})`}`)
      }
      if (handoffBrowser) {
        console.log('tianshu web: opening the default browser; pass --no-open to disable')
        void internals.openBrowser(webUrl).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error)
          console.error(`web-app: could not open the default browser because ${reason}; visit ${webUrl} manually`)
        })
      }
    }
    // This row's own activation can precede a sibling failure. The app owns
    // readiness by waiting for its Loader tree, or announces at once in a
    // hand-built context without Loader.
    const loader = ctx.get('loader')
    if (loader === undefined) announceReady()
    else {
      void loader.await().then(() => {
        // The tree can be disposed while settlement was in flight (early
        // SIGTERM); a URL line or browser tab for a dead server would only
        // mislead, and reading the torn-down port would turn a clean shutdown
        // into a crash.
        if (ctx.get('httpServer') !== undefined) announceReady()
      // Loader reports a failed boot; this row only stays quiet.
      }, () => {})
    }
  }
}
