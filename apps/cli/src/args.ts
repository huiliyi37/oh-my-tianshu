/**
 * Commander adapter for the `dsh` command-line entry. The default command
 * boots a named profile (`--profile <name>`), optionally with extra `--patch`
 * overlays. `run` owns one-shot task execution, defaulting to the headless
 * profile; `web` is a hardcoded alias for `--profile web` that adds the Web
 * flag family; `plugin` manages a profile's plugin dependencies by forwarding
 * to pnpm. Commander owns help, version, and parse errors.
 * @module @huiliyi37/dsh-tianshu/args
 */

import { Command, CommanderError } from 'commander'

/** Boot a named profile. */
interface ProfileInvocation {
  mode: 'profile'
  profile: string
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
}

/** Run one task through a profile mounting the headless runner. */
interface RunInvocation {
  mode: 'run'
  profile: string
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
  /** Non-blank task text joined from the variadic positional arguments. */
  task: string
}

/** Print a composed profile tree and exit without booting. */
interface DumpConfigInvocation {
  mode: 'dump-config'
  profile: string
  /** Omit the profile's user layer and --patch overlays; print bundle layers only. */
  defaultOnly: boolean
  patches: string[]
}

/**
 * Browser UI: `tianshu web` (alias of `--profile web`). Host and port remain
 * unvalidated pass-throughs to the webserver schema; absent values leave the
 * shipped web bundle values intact.
 */
interface WebInvocation {
  mode: 'web'
  patches: string[]
  host?: string
  port?: number
  dev: boolean
  workspaceRoot?: string
  /** Extra authorities for the /api browser-trust fence. */
  trustedHosts?: string[]
}

/** Manage a profile's plugins: forward `args` to pnpm inside the profile directory. */
interface PluginInvocation {
  mode: 'plugin'
  profile: string
  /** Raw pnpm arguments, verbatim. */
  args: string[]
}

/**
 * Terminal UI: `tianshu tui` (alias of `--profile tui`). Boots the tui profile
 * with optional patch overlays.
 */
interface TuiInvocation {
  mode: 'tui'
  /** Extra patch-list overlays applied after the profile's own layer, in argv order. */
  patches: string[]
}

/** The resolved `dsh` invocation. Help, version, and errors exit inside {@link parseDshArgs}. */
export type DshInvocation = ProfileInvocation | RunInvocation | DumpConfigInvocation | WebInvocation | PluginInvocation | TuiInvocation

/** Raw web-subcommand options straight from Commander. */
interface WebOptions {
  patch?: string[]
  host?: string
  port?: string
  dev?: boolean
  workspaceRoot?: string
  trustedHost?: string[]
  dumpConfig?: boolean
  dumpDefaultConfig?: boolean
}

/** Raw run-subcommand options straight from Commander. */
interface RunOptions {
  profile: string
  patch?: string[]
}

/**
 * Repeatable single-value collector: `--patch a.yml --patch b.yml`. Never
 * variadic — a variadic `--patch` would swallow a following positional task.
 */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/**
 * Resolve argv into one invocation, or print and exit for help, version, or an
 * error.
 * @param argv - arguments after the Node binary and script.
 * @param version - version string printed by `--version`.
 * @returns the resolved invocation.
 */
export function parseDshArgs(argv: readonly string[], version: string): DshInvocation {
  let resolved: DshInvocation | undefined
  const program = new Command()
    .name('tianshu')
    .version(version, '-V, --version', 'output the version number')
    .description('tianshu: boot a Tianshu Harness profile — an ordered stack of plugin-bundle patch layers under your own overrides.')
    .addHelpText('after', `
Examples:
  tianshu --profile web                          boot the web profile (same as: tianshu web)
  tianshu run "run the tests"                    answer one task, print the result, and exit
  tianshu run --profile custom "run the tests"   run one task through a custom one-shot profile
  tianshu --profile tui --patch ./extra.yml      boot a custom profile with one extra overlay
  tianshu plugin --profile tui add <package>     install a plugin into the tui profile
  tianshu web --port 8080                        the web alias with its flag family
`)
    .exitOverride()
    .enablePositionalOptions()
    .option('--profile <name>', 'the profile under $DSH_HOME/profiles to boot')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--dump-config', 'print the composed profile tree and exit')
    .option('--dump-default-config', 'print the profile tree without its user layer or --patch overlays and exit')
    .action((options: {
      profile?: string
      patch?: string[]
      dumpConfig?: boolean
      dumpDefaultConfig?: boolean
    }) => {
      const profile = options.profile ?? program.error('error: --profile <name> is required')
      if (profile === '') program.error('error: --profile needs a name')
      const patches = options.patch ?? []
      if (patches.includes('')) program.error('error: --patch needs a path')
      if (options.dumpConfig === true || options.dumpDefaultConfig === true) {
        if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
          program.error('error: --dump-config and --dump-default-config are mutually exclusive')
        }
        const defaultOnly = options.dumpDefaultConfig === true
        if (defaultOnly && patches.length > 0) {
          program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
        }
        resolved = { mode: 'dump-config', profile, defaultOnly, patches }
        return
      }
      resolved = { mode: 'profile', profile, patches }
    })

  /** Reject parent options that crossed a subcommand boundary. */
  const rejectParentOptions = (command: string): void => {
    const parent = program.opts<{
      profile?: string
      patch?: string[]
      dumpConfig?: boolean
      dumpDefaultConfig?: boolean
    }>()
    if (parent.profile !== undefined || parent.patch !== undefined
      || parent.dumpConfig !== undefined || parent.dumpDefaultConfig !== undefined) {
      program.error(`error: ${command} takes none of parent --profile, --patch, --dump-config, or --dump-default-config`)
    }
  }

  const run = program.command('run').description('run one task through a profile mounting the headless runner')
  run
    .option('--profile <name>', 'one-shot profile under $DSH_HOME/profiles', 'headless')
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .argument('<task...>', 'task text')
    .action((task: string[], options: RunOptions) => {
      rejectParentOptions('run')
      const profile = options.profile
      if (profile === '') program.error('error: --profile needs a name')
      const patches = options.patch ?? []
      if (patches.includes('')) program.error('error: --patch needs a path')
      const joined = task.join(' ')
      if (joined.trim() === '') program.error('error: run needs a non-blank task')
      resolved = { mode: 'run', profile, patches, task: joined }
    })

  const web = program.command('web').description('serve the browser UI (alias of --profile web) on the configured host and port')
  web
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .option('--host <host>', 'bind host; pass 0.0.0.0 to reach it from another machine')
    .option('--port <port>', 'listen port; pass 0 to let the OS pick a free one')
    .option('--dev', 'mount the client-plugin HMR receiver (run pnpm run dev:web separately to rebuild bundles)')
    .option('--workspace-root <path>', 'parent directory for workspaces created from the browser UI')
    .option('--trusted-host <authority...>', 'extra authority the /api browser-trust fence accepts (host or host:port; repeatable)')
    .option('--dump-config', 'print the composed web-profile tree (with the user layer and any --patch) and exit')
    .option('--dump-default-config', 'print the web profile\'s bundle layers (no user layer) and exit')
    .action((options: WebOptions) => {
      rejectParentOptions('web')
      const patches = options.patch ?? []
      if (patches.includes('')) program.error('error: --patch needs a path')
      if (options.dumpConfig === true || options.dumpDefaultConfig === true) {
        if (options.dumpConfig === true && options.dumpDefaultConfig === true) {
          program.error('error: --dump-config and --dump-default-config are mutually exclusive')
        }
        const defaultOnly = options.dumpDefaultConfig === true
        if (defaultOnly && patches.length > 0) {
          program.error('error: --dump-default-config prints the bundle layers and takes no --patch')
        }
        // The dump is boot-free and does not derive flag patches; silently
        // dropping them would print a tree that differs from the same
        // invocation's boot.
        if (options.host !== undefined || options.port !== undefined || options.dev === true
          || options.workspaceRoot !== undefined || options.trustedHost !== undefined) {
          program.error('error: config dumps take no web flags (--host/--port/--dev/--workspace-root/--trusted-host)')
        }
        resolved = { mode: 'dump-config', profile: 'web', defaultOnly, patches }
        return
      }
      if (options.port !== undefined && !/^\d+$/.test(options.port)) {
        program.error(`error: --port must be a number, got ${JSON.stringify(options.port)}`)
      }
      resolved = {
        mode: 'web',
        patches,
        ...options.host !== undefined && { host: options.host },
        ...options.port !== undefined && { port: Number(options.port) },
        dev: options.dev === true,
        ...options.workspaceRoot !== undefined && { workspaceRoot: options.workspaceRoot },
        ...options.trustedHost !== undefined && { trustedHosts: options.trustedHost },
      }
    })

  const tui = program.command('tui').description('boot the terminal UI profile (alias of --profile tui)')
  tui
    .option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)
    .action((options: { patch?: string[] }) => {
      rejectParentOptions('tui')
      const patches = options.patch ?? []
      if (patches.includes('')) program.error('error: --patch needs a path')
      resolved = { mode: 'tui', patches }
    })

  const plugin = program.command('plugin').description('manage a profile\'s plugins by forwarding the remaining arguments to pnpm in the profile directory')
  plugin
    .requiredOption('--profile <name>', 'the profile whose plugins to manage (initialized on first use)')
    .allowUnknownOption()
    .argument('[args...]', 'pnpm arguments, forwarded verbatim (add <pkg>, remove <pkg>, why <pkg>, ...)')
    .action((args: string[], options: { profile: string }) => {
      rejectParentOptions('plugin')
      if (options.profile === '') program.error('error: --profile needs a name')
      if (args.length === 0) program.error('error: plugin needs pnpm arguments to forward (e.g. add <package>)')
      resolved = { mode: 'plugin', profile: options.profile, args }
    })

  try {
    program.parse(argv, { from: 'user' })
  } catch (error) {
    return process.exit(error instanceof CommanderError ? error.exitCode : 1)
  }
  /* v8 ignore next -- an action resolves or Commander throws */
  if (resolved === undefined) { throw new Error('tianshu: no invocation resolved') }
  return resolved
}
