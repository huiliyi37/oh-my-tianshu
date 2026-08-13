/**
 * The `node:vm` sandbox `cordis_mount` code evaluates in: a fresh realm whose globals are a
 * tagged write-through console, the `harness` registration helpers, the encoding primitives a
 * bare vm context lacks, and callable traps over the Node APIs the sandbox deliberately
 * withholds. Traps steer filesystem, network, process, and timer work to `ctx.fs`, `ctx.web`,
 * `ctx.bash`, and Cordis timers. This keeps cooperative mounts inspectable and disposable but
 * is not containment: host-realm helper functions remain an escape route.
 * @module @deepseek-ai/dsh-tool-cordis/sandbox
 */

import { createContext, runInContext } from 'node:vm'
import { sandboxDefineTool, sandboxRegisterTool } from './guard.ts'

/**
 * A write-through console for one sandbox, tagging every line with the mount
 * id. Write-through (host stdout/stderr), NOT buffered into the tool result:
 * a mounted listener fires long after the mount call returned, and its output
 * must land somewhere the user can see — for a terminal front door, the host terminal.
 */
function taggedConsole(id: string): Record<'log' | 'info' | 'warn' | 'error' | 'debug', (...args: unknown[]) => void> {
  const tag = `[cordis:${id}]`
  const log = (...args: unknown[]): void => { console.log(tag, ...args) }
  const error = (...args: unknown[]): void => { console.error(tag, ...args) }
  return { log, info: log, warn: log, debug: log, error }
}

/**
 * Patch only VM constructors so `instanceof` accepts both VM values and host values passed as
 * arguments, events, or service results; host intrinsics remain untouched.
 */
const DUAL_REALM_INSTANCEOF_PRELUDE = `
(hostIntrinsics) => {
  'use strict'
  const ordinary = Function.prototype[Symbol.hasInstance]
  for (const name of Object.keys(hostIntrinsics)) {
    const VmCtor = globalThis[name]
    const HostCtor = hostIntrinsics[name]
    if (typeof VmCtor !== 'function' || typeof HostCtor !== 'function') continue
    Object.defineProperty(VmCtor, Symbol.hasInstance, {
      value: (instance) => ordinary.call(VmCtor, instance) || ordinary.call(HostCtor, instance),
      configurable: true,
    })
  }
}
`

/** Run {@link DUAL_REALM_INSTANCEOF_PRELUDE} in a freshly created sandbox, handing it the host intrinsics to pair up. */
function patchDualRealmInstanceof(sandbox: object): void {
  const patch = runInContext(DUAL_REALM_INSTANCEOF_PRELUDE, sandbox) as (intrinsics: Record<string, unknown>) => void
  patch({ Object, Array, Function, Error, TypeError, RangeError, SyntaxError, Promise, RegExp, Date, Map, Set })
}

const TIMER_REDIRECT
  = 'Node timers are unavailable. Use the cordis timer service instead: declare inject: [\'timer\'] on your plugin '
    + 'and call ctx.setTimeout / ctx.setInterval — those are fiber effects, cleaned up automatically when unmounted.'

/**
 * The callable Node APIs the sandbox deliberately disables, each mapped to the
 * cordis alternative its trap error names. Only FUNCTION-shaped globals are
 * trapped — a data-shaped global like `process` stays `undefined`, because a
 * throwing accessor would detonate the common `typeof process` feature probe
 * at resolution time.
 */
const NODE_API_REDIRECTS: Record<string, string> = {
  require:
    'Node modules are unavailable. Use the cordis services on ctx instead — e.g. inject: [\'fs\'] for files, '
    + '[\'web\'] for HTTP, [\'bash\'] for processes; cordis_inspect what:"api" lists what THIS runtime provides.',
  setTimeout: TIMER_REDIRECT,
  setInterval: TIMER_REDIRECT,
  setImmediate: TIMER_REDIRECT,
  clearTimeout: TIMER_REDIRECT,
  clearInterval: TIMER_REDIRECT,
  fetch:
    'Network access goes through the cordis web service: declare inject: [\'web\'] and call ctx.web '
    + '(see cordis_inspect what:"api" for its methods).',
}

/** Build the trap functions for {@link NODE_API_REDIRECTS}: calling one throws the redirect. */
function nodeApiTraps(): Record<string, () => never> {
  const traps: Record<string, () => never> = {}
  for (const [name, redirect] of Object.entries(NODE_API_REDIRECTS)) {
    traps[name] = () => {
      throw new Error(`${name} is not available in the temporary Plugin sandbox — ${redirect}`)
    }
  }
  return traps
}

/**
 * Build the vm context one `cordis_mount` call evaluates in: the tagged
 * console, the `harness` registration helpers, the encoding primitives, the
 * Node-API traps, and the dual-realm `instanceof` patch, already
 * `createContext`-ed.
 * @param id - the mount id (`dyn-<n>`), used as the console tag and filename stem.
 * @returns the contextified sandbox object to pass to {@link evaluateMountCode}.
 */
export function createSandbox(id: string): object {
  const sandbox = {
    ...nodeApiTraps(),
    console: taggedConsole(id),
    harness: { defineTool: sandboxDefineTool, registerTool: sandboxRegisterTool },
    // Web APIs absent from fresh vm contexts — made available so the model
    // can encode/decode base64 without Buffer (which is also absent). Host
    // closures over Buffer, never Buffer itself.
    btoa: (s: string) => Buffer.from(s, 'utf-8').toString('base64'),
    atob: (s: string) => { return Buffer.from(s, 'base64').toString('utf-8') },
    TextEncoder,
    TextDecoder,
  }
  createContext(sandbox)
  patchDualRealmInstanceof(sandbox)
  return sandbox
}

/**
 * Cross-realm SyntaxError detection: a compile failure inside `runInContext`
 * constructs its error in the SANDBOX realm, so a host `instanceof
 * SyntaxError` is silently false — the `name` property is the realm-safe tag.
 */
function isSyntaxError(error: unknown): error is Error {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'SyntaxError'
}

/**
 * The parse-failure context a vm `SyntaxError` carries: the vm prints the
 * offending source line and a caret before the message, which is exactly what
 * a model needs to self-correct — surface it instead of the bare message.
 * Falls back to `String(error)` when the stack carries no such prelude.
 * @param error - the `SyntaxError` (host- or sandbox-realm) thrown while compiling mount code.
 * @returns the stack prefix up to and including the `SyntaxError: …` line.
 */
export function syntaxErrorContext(error: Error): string {
  const lines = (error.stack ?? '').split('\n')
  const messageIndex = lines.findIndex(line => line.startsWith('SyntaxError'))
  if (messageIndex === -1) return String(error)
  return lines.slice(0, messageIndex + 1).join('\n')
}

/**
 * Evaluate mount code as the body of an async function inside the sandbox. `vmTimeoutMs` only
 * bounds the SYNCHRONOUS portion; an async body escapes it — acceptable under the module's
 * trust stance. Parse errors include the offending line and a TypeScript-removal or bracket-
 * balance hint.
 * @param sandbox - the contextified object from {@link createSandbox}.
 * @param code - the model-written function body; must `return` a plugin.
 * @param id - the mount id, used as the vm filename (`cordis-mount-<id>.js`).
 * @param vmTimeoutMs - the synchronous evaluation bound in milliseconds.
 * @returns whatever the code returned, still un-narrowed (the mount lifecycle checks plugin shape).
 */
export async function evaluateMountCode(sandbox: object, code: string, id: string, vmTimeoutMs: number): Promise<unknown> {
  try {
    return await runInContext(
      `(async () => {\n${code}\n})()`,
      sandbox,
      { filename: `cordis-mount-${id}.js`, timeout: vmTimeoutMs },
    )
  } catch (error) {
    if (!isSyntaxError(error)) throw error
    const context = syntaxErrorContext(error)
    // Scope the TypeScript heuristic to the OFFENDING line, not the whole
    // code: an ` as ` inside an ordinary description string must not turn a
    // plain syntax error into a misleading remove-annotations message.
    const offendingLine = context.split('\n')[1] ?? ''
    if (/\bas\b/.test(offendingLine)) {
      throw new Error(
        `temporary Plugin code failed to parse:\n${context}\n`
        + 'The sandbox runs plain JavaScript, not TypeScript. Remove type annotations:\n'
        + '  ✗ { type: \'text\' as const, text: x }\n'
        + '  ✓ { type: \'text\', text: x }',
      )
    }
    throw new Error(
      `temporary Plugin code failed to parse:\n${context}\n`
      + 'Note: `code` runs as the BODY of an async function (line numbers are offset by the 1-line wrapper). '
      + 'Check bracket balance — ending the returned plugin object with `});` closes a call that was never opened; '
      + 'a plain `return { … }` ends with `}` (an optional `;`), never `)`.',
    )
  }
}
