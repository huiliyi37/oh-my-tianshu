/** Bounded, escalating process shutdown for the long-lived CLI surfaces. */

/** Maximum grace allowed for the application tree to dispose before process exit. */
export const PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000

/** Process-exit controller shared by normal completion and Unix signal handlers. */
export interface ProcessShutdown {
  /** Start or join graceful disposal before exiting with `code`. */
  shutdown(code: number): Promise<void>
  /** Start graceful disposal, or force exit when a shutdown is already running. */
  interrupt(code: number): void
}

/**
 * Create one process-exit controller around an application disposer.
 * @param dispose - Whole-application teardown that resolves at quiescence.
 * @param exit - Process exit boundary, replaceable by tests.
 * @param timeoutMs - Grace before forced exit, replaceable by tests.
 * @returns A controller whose normal calls coalesce and whose repeated signal call escalates.
 */
export function createProcessShutdown(
  dispose: () => Promise<void>,
  exit: (code: number) => void = (code) => { process.exit(code) },
  timeoutMs = PROCESS_SHUTDOWN_TIMEOUT_MS,
): ProcessShutdown {
  let pending: Promise<void> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let exited = false

  const exitOnce = (code: number): void => {
    if (exited) return
    exited = true
    /* v8 ignore else -- shutdown() arms the timer before any asynchronous exit path can run. */
    if (timeout !== undefined) clearTimeout(timeout)
    exit(code)
  }

  const shutdown = (code: number): Promise<void> => {
    if (pending !== undefined) return pending
    timeout = setTimeout(() => { exitOnce(code) }, timeoutMs)
    pending = Promise.resolve().then(dispose).then(
      () => { exitOnce(code) },
      () => { exitOnce(code) },
    )
    return pending
  }

  return {
    shutdown,
    interrupt(code) {
      if (pending !== undefined) {
        exitOnce(code)
        return
      }
      void shutdown(code)
    },
  }
}
