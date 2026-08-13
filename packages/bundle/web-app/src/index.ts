/**
 * @deepseek-ai/dsh-web-app — the browser-surface bundle's runtime glue plugin
 * plus the bundle patch (`cordis.patch.yml`, declared by the `dsh.bundle.patch`
 * manifest field). The plugin owns what used to be launcher code: it resolves
 * the built frontend dist (workspace knowledge of this bundle, never user
 * config), mounts the `frontend-static` fallback owner over it, registers the
 * web-surface prompt section and the bash-visible web runtime variables, and
 * prints the URL line when configured to. Flag-derived values (`mode`,
 * `lanAddresses`, `printUrl`) arrive as launcher patches over this row.
 * @module @deepseek-ai/dsh-web-app
 */

import { createRequire } from 'node:module'
import type { Context } from 'cordis'
import z from 'schemastery'
import * as FrontendStatic from '@deepseek-ai/dsh-frontend-static'
import type {} from '@cordisjs/plugin-loader'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-bash-env'

/** Stable Cordis plugin name. */
export const name = 'web-app'

/** Services required before the web runtime can mount. */
export const inject = ['httpServer']

/** Web runtime mode: production, or development when the client-plugin HMR receiver is active. */
export type WebMode = 'production' | 'development'

/** Plugin config: the surface facts the launcher patches over this bundle's defaults. */
export interface Config {
  /** Whether this process mounted the client-plugin HMR receiver (`dsh web --dev`). */
  mode: WebMode
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

/** Model-visible orientation and acceptance boundary for sessions created through `dsh web`. */
function webSurfacePrompt(webUrl: string, mode: WebMode): string {
  const updateContract = mode === 'development'
    ? 'This Web process was launched with `dsh web --dev`, so its client-plugin HMR receiver is active. '
      + 'No-refresh updates occur only when `pnpm run dev:web` is also running from this same checkout to rebuild client-plugin bundles; verify that watcher before promising automatic updates. '
      + 'Client-plugin changes then reload automatically, while apps/web shell and other plain-package changes still require a rebuild and page refresh. '
    : 'This Web process was launched without `--dev`, so HMR is inactive: rebuild the affected Web artifacts and verify this existing URL after a page refresh. '
      + 'If the user wants no-refresh client-plugin updates, explain that this GUI must be restarted with `dsh web --dev` and `pnpm run dev:web` must also run from this same checkout; do not present either command alone as sufficient. '
  return `You are interacting with the user through the DeepSeek Harness Web GUI at ${webUrl}. `
    + 'When the user refers to "this page", "this GUI", or "this app" without naming another target, they mean this GUI. '
    + 'The browser provides no implicit DOM, route, or screenshot context. '
    + updateContract
    + 'Starting another server does not update this GUI. '
    + 'The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. '
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
    return require.resolve('@deepseek-ai/dsh-frontend/dist/index.html')
  } catch {
    /* v8 ignore next 2 -- reachable only on a checkout without a built dist; the test tree builds it */
    throw new Error('web-app: frontend dist not built; run pnpm run build from the repository root first')
  }
}

/** Test hook: hosts with no built frontend dist substitute the resolver; production never touches this. */
export const internals: { resolveDistIndex: () => string } = { resolveDistIndex }

/**
 * Mount the Web runtime: dist serving, surface prompt, bash runtime
 * variables, and the URL line.
 * @param ctx - plugin context carrying the httpServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
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
          [DSH_WEB_URL]: { description: 'Canonical local URL of the DeepSeek Harness Web GUI serving this session.' },
          [DSH_WEB_MODE]: { description: 'Web runtime mode: production, or development when the client-plugin HMR receiver is active.' },
        },
        resolve: () => ({ [DSH_WEB_URL]: localWebUrl(runtimeCtx), [DSH_WEB_MODE]: config.mode }),
      })
    })
  }
  if (config.printUrl) {
    // The URL line is a readiness signal: supervisors (and the keyless CLI
    // smoke) RPC as soon as they observe it, so it must not print while
    // sibling rows (the /api route owner) are still mounting. Await Loader
    // settlement first; a hand-built tree without a Loader prints at once.
    const printUrl = (): void => {
      // The launcher's boot-time LAN snapshot, not a fresh sample: the printed
      // LAN URL must name an address the /api trust fence was configured with.
      const lanCandidate = config.lanAddresses[0]
      const port = ctx.httpServer.port
      console.log(`dsh web: ${localWebUrl(ctx)}${lanCandidate === undefined ? '' : ` (LAN: http://${lanCandidate}:${String(port)})`}`)
    }
    const loader = ctx.get('loader')
    if (loader === undefined) printUrl()
    else {
      void loader.await().then(() => {
        // The tree can be disposed while settlement was in flight (early
        // SIGTERM); a URL line for a dead server would only mislead, and
        // reading the torn-down port would turn a clean shutdown into a crash.
        if (ctx.get('httpServer') !== undefined) printUrl()
      })
    }
  }
}
