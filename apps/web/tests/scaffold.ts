// Shared scaffold for the keyless browser e2e lane (Agent Note:
// .agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.md).
// Boots the REAL web composition — the dsh-base and dsh-web-app bundle
// patches over the empty profile root through the vendored Loader (the same
// layer stack the profile boot composes), patched the
// snapshot way — so a real chromium exercises the real HTTP uplink/WebSocket
// downlink, api-gateway, agent loop, tools, and persistence. Modes ride $DSH_SNAPSHOT:
// replay (default, keyless: normally disables the llm-deepseek row and
// inserts dsh-llm-replay in providers mode), record (real adapter + key,
// harvests fixtures from live session memory), refresh (keyless replay that
// rewrites goldens). A first-run option keeps the real adapter mounted while
// masking its credential, without making a model call.
//
// Composition divergences from `dsh web`, all deliberate, all via include
// patches after the shipped bundle layers, over the SAME tree (never a
// second yml): temp persistenceRoot; host-level skill roots confined to the
// temp workspace while project skill discovery remains real; workspace-context
// disabled (recorded fixtures must not embed this repo's AGENTS.md);
// session-title-llm disabled (its fire-and-forget title call would race the
// loop for the session's replay cursor); webserver pinned to port 0 with the
// built dist; ordinary keyless modes disable llm-deepseek and fill the open
// llm seam post-boot with installLlmReplay on the settled root ctx
// (the plugin-row path discards the ReplayHandle; the direct install keeps
// assertConsumed for the teardown fixture-consumption check).
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Page } from 'playwright'
import { expect } from 'vitest'
import { Context } from '@huiliyi37/cordis'
import Loader from '@huiliyi37/cordis-plugin-loader'
import Include, { type PatchOptions } from '@huiliyi37/cordis-plugin-include'
import { scrubRequestHeaders, stabilizeFixtureMessageIds } from '@huiliyi37/dsh-acp-snapshot'
import {
  addHarnessSourceSection,
  assertEntriesLoaded,
  composeEntries,
  healProfilesModuleFallback,
  loadOverlayPatches,
} from '@huiliyi37/dsh-app-boot'
import { dshHomePath } from '@huiliyi37/dsh-paths'
import {
  WELCOME_NOTICE_ACK_FIELD, WELCOME_NOTICE_SETTINGS_NAMESPACE, WELCOME_NOTICE_VERSION,
} from '@huiliyi37/dsh-client-ui-settings-general'
import { settingsNamespace } from '@huiliyi37/dsh-settings'
import { LlmAdapter } from '@huiliyi37/dsh-llm'
import type {
  LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk,
} from '@huiliyi37/dsh-llm'
import type { ReplayHandle } from '@huiliyi37/dsh-llm-replay'
import { installLlmReplay, parseSessionLog } from '@huiliyi37/dsh-llm-replay'
import SessionStore, {
  packChunkRuns,
  SESSION_FORMAT_VERSION,
  SessionId,
  type Session,
  type SessionEvent,
  type SessionHeader,
} from '@huiliyi37/dsh-session'
import SessionPersistenceJsonl from '@huiliyi37/dsh-session-persistence-jsonl'
import * as ToolCordis from '@huiliyi37/dsh-tool-cordis'
// Empty type imports carry the httpServer/agents/sessionPersistence Context merges.
import type {} from '@huiliyi37/dsh-host-webserver'
import type {} from '@huiliyi37/dsh-agent'
import { REPO_ROOT, requireDist } from './support.ts'

/** Snapshot mode for the lane, from $DSH_SNAPSHOT (same vocabulary as the other snapshot suites). */
export type WebSnapshotMode = 'replay' | 'record' | 'refresh'

/**
 * Resolve and validate the lane's snapshot mode.
 * @returns the active mode; unset/empty selects replay.
 */
export function webSnapshotMode(): WebSnapshotMode {
  const value = process.env.DSH_SNAPSHOT
  if (value === undefined || value === '' || value === 'replay') return 'replay'
  if (value === 'record' || value === 'refresh') return value
  throw new Error(`DSH_SNAPSHOT must be replay, record, or refresh; got ${JSON.stringify(value)}`)
}

/** The shipped composition under test: the dsh-base and dsh-web-app bundle patches over the empty profile root. */
const BASE_PATCH_PATH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH_PATH = join(REPO_ROOT, 'packages/bundle/web-app/cordis.patch.yml')
/** The installation anchor whose dependency surface the profile module fallback mirrors. */
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')

// Replay publishes the provider catalog the gateway routes to (providers
// mode, never catch-all: with llm-deepseek disabled no adapter exists, so a
// catch-all would leave resolveModelInfo unroutable and compact-basic's
// post-step pressure check would warn every step). The published
// contextWindow keeps that pressure path provably inert for small fixtures.
const REPLAY_PROVIDERS = [{
  id: 'deepseek-official',
  name: 'DeepSeek',
  models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 128_000 }],
}]

/**
 * The routes a shipped composition always has, with no ability to stream.
 * A fixture-less keyless scenario issues no model calls, but its tree must
 * still answer `listProviders()` — surfaces legitimately gate on whether any
 * adapter serves a session's route, and an empty registry is a test artifact,
 * not a product state.
 */
class RouteOnlyAdapter extends LlmAdapter {
  constructor(private readonly providers: typeof REPLAY_PROVIDERS) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.providers.find(entry => entry.id === provider)?.name ?? provider }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve((this.providers.find(entry => entry.id === provider)?.models ?? [])
      .map(model => ({ provider, id: model.id, name: model.name })))
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const listed = this.providers.find(entry => entry.id === provider)?.models
      .find(entry => entry.id === model)
    return Promise.resolve({
      provider,
      id: model,
      name: listed?.name ?? model,
      ...listed?.contextWindow === undefined ? {} : { contextWindow: listed.contextWindow },
    })
  }

  override async *stream(): AsyncIterable<StreamChunk> {
    throw new Error(
      'web e2e scaffold: a model call was issued by a scenario that declared no replay fixture'
      + ' — pass replayFixture, or keep the scenario free of model calls',
    )
  }
}

function replayProviders(contextWindow: number | undefined): typeof REPLAY_PROVIDERS {
  if (contextWindow === undefined) return REPLAY_PROVIDERS
  return REPLAY_PROVIDERS.map(provider => ({
    ...provider,
    models: provider.models.map(model => ({ ...model, contextWindow })),
  }))
}

/** A booted web scaffold: real composition, mode-selected model backend, temp world. */
export interface WebScaffold {
  /** The active snapshot mode this scaffold booted under. */
  mode: WebSnapshotMode
  /** Browser-facing origin for the bound test server. */
  baseUrl: string
  /** Settled root context (the in-process readiness barrier; headless event subscription is its sanctioned use). */
  ctx: Context
  /** Temp project directory sessions run in (bash/fs tool cwd). */
  workspaceCwd: string
  /** Temp persistence root (seeded sessions land here through the real API). */
  persistenceRoot: string
  /** Isolated harness home the settings/credentials rows write ($DSH_HOME double). */
  harnessHome: string
  /** Await a settled turn end: in-process turn/end, then the agent's idle flip (which follows the persistence flush). */
  whenTurnSettled(timeoutMs?: number): Promise<SessionId>
  /** Tear everything down; asserts the replay fixture was fully consumed first (replay/refresh). */
  close(): Promise<void>
}

/** Options for {@link launchWebScaffold}. */
export interface LaunchOptions {
  /**
   * Optional product overlay applied after the shipped Web surface and before
   * the scaffold's hermetic test patches, matching the launcher's `--patch`
   * ordering.
   */
  extraOverlayPath?: string
  /**
   * Replay fixture (session.jsonl) served by the inserted dsh-llm-replay row
   * in replay/refresh modes; ignored in record mode (the real adapter
   * answers). Omit for scenarios issuing no model calls — a stray stream then
   * fails loud with NO_ADAPTER (llm-deepseek is disabled and no replay row
   * mounts).
   */
  replayFixture?: string
  /**
   * Recorded child logs assigned in child creation order. Each child owns its
   * own positional replay cursor across initial and continuation turns.
   */
  replayChildFixtures?: string[]
  /**
   * Optional replay.override.json sidecar (whole-script replacement or
   * `{ patches }` augmentation) for throw/hang scenarios not expressible as
   * recorded chunks; replay/refresh only.
   */
  replayOverride?: string
  /** Per-chunk replay pacing (ms) so the browser observes genuinely incremental SSE; replay/refresh only. */
  paceMs?: number
  /** Synthetic model capacity for UI scenarios whose seeded history must remain uncompacted. */
  replayContextWindow?: number
  /**
   * Tool presentation mode patched onto the shipped `tools` row (`code`
   * collapses the wire to run_code + the SDK prompt section). Omit for the
   * yml default. The code runtime row is always in the tree, so no extra
   * insertion is needed.
   */
  toolsMode?: 'native' | 'code' | 'both'
  /**
   * Insert the opt-in self-referential Cordis tools into the shipped tree.
   * Record and replay use the same tool surface, so captured request headers
   * remain reconstructable without making the tools a product default.
   */
  cordisTools?: boolean
  /**
   * Keep the shipped DeepSeek adapter mounted while masking the process
   * environment's DEEPSEEK_API_KEY for this scaffold lifetime. This is the
   * keyless first-run configuration lane; the default disables the adapter.
   */
  deepSeekMissingCredential?: boolean
  /**
   * Patch the shipped DeepSeek search row to a deterministic endpoint and
   * credential reference. Browser search scenarios keep the real provider and
   * credentials seam while avoiding external search traffic and ambient keys.
   */
  deepSeekSearch?: {
    /** Anthropic-compatible base URL; the provider appends `/messages`. */
    baseURL: string
    /** Credential reference resolved by the shipped search provider. */
    apiKeyEnv: string
  }
  /** Leave the current welcome notice unacknowledged; ordinary scenarios publish it as complete before browser boot. */
  welcomeNoticePending?: boolean
  /**
   * Browse through a trusted non-loopback hostname that the browser resolves
   * to loopback (for example `*.localhost`). The test server stays bound to
   * 127.0.0.1; a non-resolving authority fails before Host trust is exercised.
   */
  remoteAuthority?: string
}

/** Dispose the booted tree and remove both owned temp roots, reporting every independent cleanup failure. */
async function cleanupScaffoldWorld(ctx: Context, workspaceCwd: string, persistenceRoot: string): Promise<unknown[]> {
  const failures: unknown[] = []
  await Promise.resolve(ctx.fiber.dispose()).catch((error: unknown) => failures.push(error))
  await rm(workspaceCwd, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  await rm(persistenceRoot, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  return failures
}

/**
 * Boot the real web composition under the current snapshot mode.
 * @param options - replay fixture selection and pacing.
 * @returns the running scaffold.
 */
export async function launchWebScaffold(options: LaunchOptions = {}): Promise<WebScaffold> {
  requireDist()
  const mode = webSnapshotMode()
  const browserHost = options.remoteAuthority ?? '127.0.0.1'
  if (mode === 'record') {
    // Both owning vitest configs (web unconditionally, snapshot in record
    // mode) load the repo-root .env before this file runs.
    if (process.env.DEEPSEEK_API_KEY === undefined || process.env.DEEPSEEK_API_KEY.length === 0) {
      throw new Error('web e2e record mode needs DEEPSEEK_API_KEY (env or repo-root .env)')
    }
  }
  if (mode === 'record' && options.deepSeekMissingCredential === true) {
    throw new Error('deepSeekMissingCredential is a keyless replay/refresh option')
  }
  const maskDeepSeekCredential = mode !== 'record' && options.deepSeekMissingCredential === true
  const originalDeepSeekCredential = process.env.DEEPSEEK_API_KEY
  let credentialEnvironmentRestored = false
  const restoreCredentialEnvironment = (): void => {
    if (credentialEnvironmentRestored || !maskDeepSeekCredential) return
    credentialEnvironmentRestored = true
    if (originalDeepSeekCredential === undefined) {
      Reflect.deleteProperty(process.env, 'DEEPSEEK_API_KEY')
    } else {
      process.env.DEEPSEEK_API_KEY = originalDeepSeekCredential
    }
  }
  const workspaceCwd = await realpath(await mkdtemp(join(tmpdir(), 'dsh-web-e2e-ws-')))
  // Isolated harness home: the settings/credentials rows resolve $DSH_HOME
  // paths at load, and an in-process boot must NEVER touch the developer's
  // real ~/.dsh document or credential file.
  const harnessHome = join(workspaceCwd, '.dsh-home')
  let persistenceRoot: string
  try {
    persistenceRoot = await mkdtemp(join(tmpdir(), 'dsh-web-e2e-sessions-'))
  } catch (error) {
    const failures: unknown[] = [error]
    await rm(workspaceCwd, { recursive: true, force: true }).catch((cleanupError: unknown) => failures.push(cleanupError))
    if (failures.length > 1) throw new AggregateError(failures, 'web scaffold temp-root setup failed')
    throw error
  }
  if (maskDeepSeekCredential) Reflect.deleteProperty(process.env, 'DEEPSEEK_API_KEY')

  // The include patch set — the same layer stack the profile boot composes
  // (bundle patches in dsh.profile.bundles order), applied over the SAME empty root (a
  // patch id that stops matching a row fails the boot sweep loudly instead of
  // drifting).
  const basePatches = loadOverlayPatches('web e2e scaffold', BASE_PATCH_PATH)
  const surfacePatches = loadOverlayPatches('web e2e scaffold', WEB_PATCH_PATH)
  const extraOverlayPatches = options.extraOverlayPath === undefined
    ? []
    : loadOverlayPatches('web e2e scaffold', options.extraOverlayPath)
  const composedRows = composeEntries([basePatches, surfacePatches, extraOverlayPatches])
  const webRuntimeConfig = composedRows.find(row => row.id === 'web-runtime')?.config as {
    surfaceContext?: boolean
  } | undefined
  const surfaceContext = webRuntimeConfig?.surfaceContext !== false
  const patches: PatchOptions[] = [
    ...basePatches,
    ...surfacePatches,
    ...extraOverlayPatches,
    { id: 'session-persistence-jsonl', config: { root: persistenceRoot } },
    { id: 'session-query-sqlite', config: { path: ':memory:', openAt: 'first-search' } },
    // storage-json's yml root is anchored to the real $DSH_HOME; pin the row
    // to an absolute temp root (removed with the workspace at close) so tests
    // never write the user's harness home.
    { id: 'storage-json', config: { root: join(workspaceCwd, '.dsh-storages') } },
    // Skill discovery is model-visible input. Pin every host-level root inside
    // the owned temp world so ~/.dsh, ~/.agents, and a bundled-root env setting
    // cannot change replay requests or conversation goldens. Project roots stay
    // enabled against the same empty temp workspace, preserving the real seam.
    {
      id: 'skill-local',
      config: {
        dshHome: join(workspaceCwd, '.dsh-home'),
        agentsHome: join(workspaceCwd, '.agents-home'),
        bundledSkillDir: join(workspaceCwd, '.bundled-skills'),
        watch: false,
      },
    },
    // fs/bash cwd default to process.cwd(); the gateway injects the same
    // value into session.cwd — chdir below anchors all three to the temp
    // workspace, keeping the composition untouched.
    { id: 'workspace-context', disabled: true },
    { id: 'session-title-llm', disabled: true },
    // Fixture sessions must never leave the process: the shipped row defaults
    // to the production OTLP endpoint (or whatever DSH_TELEMETRY_OTLP_URL
    // names in the ambient environment).
    { id: 'telemetry-otel', disabled: true },
    {
      id: 'webserver',
      config: { host: '127.0.0.1', port: 0 },
    },
    // The bundle's web-runtime row resolves the same built dist under test
    // (apps/web IS @huiliyi37/dsh-frontend); only the URL line is silenced.
    // Preserve the composed surface-context choice because a patch replaces
    // the row's complete config.
    { id: 'web-runtime', config: { mode: 'production', printUrl: false, surfaceContext } },
    ...options.remoteAuthority === undefined
      ? []
      : [{ id: 'connection', config: { trustedHosts: [options.remoteAuthority] } }],
    { id: 'settings', config: { dshHome: harnessHome } },
    { id: 'credentials', config: { dshHome: harnessHome } },
    // The shipped directory-picker row is the -auto chooser, which resolves
    // the interaction from the RUNNING host (display, SSH launch, bind). The
    // lane's goldens are interaction-specific (workspace-management drives
    // the in-app browse dialog), so pin -browse deterministically on every
    // host: patch `name` is an assertion, not an override, hence the
    // disable+insert pair.
    { id: 'directory-picker', disabled: true },
    { insert: [{ id: 'directory-picker-browse', name: '@huiliyi37/dsh-host-directory-picker-browse' }] },
    ...options.toolsMode !== undefined ? [{ id: 'tools', config: { mode: options.toolsMode } }] : [],
    ...options.cordisTools === true
      ? [{ insert: [{ id: 'tool-cordis', name: 'cordis:tool-cordis' }] }]
      : [],
    ...options.deepSeekSearch === undefined
      ? []
      : [{
        id: 'web-search-deepseek',
        config: {
          apiKeyEnv: options.deepSeekSearch.apiKeyEnv,
          baseURL: options.deepSeekSearch.baseURL,
        },
      }],
    ...mode === 'record' || options.deepSeekMissingCredential === true
      ? []
      : [{ id: 'llm-deepseek', disabled: true }],
  ]

  // Sessions inherit the gateway's process.cwd() default; run the boot from
  // the temp workspace so tool cwd, session cwd, and fixtures agree.
  const originalCwd = process.cwd()
  const ctx = new Context()
  let port = 0
  let replayHandle: ReplayHandle | undefined
  try {
    process.chdir(workspaceCwd)
    // The production resolution shape: an empty profile root inside the temp
    // harness home, with bare plugin names resolving through the flat module
    // fallback the launcher heals under <home>/profiles.
    healProfilesModuleFallback(INSTALL_ANCHOR, harnessHome)
    const profileDir = join(harnessHome, 'profiles', 'scaffold')
    await mkdir(profileDir, { recursive: true })
    const rootConfig = join(profileDir, 'cordis.yml')
    await writeFile(rootConfig, '[]\n')
    ctx.baseUrl = pathToFileURL(profileDir).href + '/'
    // This direct Loader harness supplies the same root-path capability as app-boot.
    ctx.provide('dshHomePath', dshHomePath)
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    // The shipped CLI deliberately has no dependency on this opt-in package.
    // Keep the Loader row real without broadening the product installation.
    if (options.cordisTools === true) ctx.loader.builtins['tool-cordis'] = ToolCordis
    if (surfaceContext) {
      ctx.inject(['systemPrompt'], (promptCtx) => { addHarnessSourceSection(promptCtx, REPO_ROOT) })
    }
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(rootConfig).href, patches },
    })
    await ctx.loader.await()
    assertEntriesLoaded(ctx, 'web e2e scaffold')
    if (options.welcomeNoticePending !== true) {
      await ctx.settings.mutate(settingsNamespace(WELCOME_NOTICE_SETTINGS_NAMESPACE), [{
        op: 'set', path: [WELCOME_NOTICE_ACK_FIELD], value: WELCOME_NOTICE_VERSION,
      }])
    }
    const boundPort = ctx.get('httpServer')?.port
    if (boundPort === undefined) {
      throw new Error('web e2e scaffold: httpServer service missing after settled boot')
    }
    port = boundPort

    // Fill the open llm seam on the settled root ctx. Ordinary keyless modes
    // disable llm-deepseek; the first-run lane keeps it mounted but has no
    // replay fixture and never streams. The direct install, unlike the plugin
    // row, returns the ReplayHandle for the teardown consumption check.
    if (mode !== 'record' && options.replayFixture !== undefined) {
      replayHandle = installLlmReplay(ctx, {
        file: options.replayFixture,
        providers: replayProviders(options.replayContextWindow),
        ...(options.replayOverride === undefined ? {} : { overrideFile: options.replayOverride }),
        ...(options.replayChildFixtures === undefined ? {} : { childFiles: options.replayChildFixtures }),
        ...(options.paceMs === undefined ? {} : { paceMs: options.paceMs }),
      })
    } else if (mode !== 'record' && options.deepSeekMissingCredential !== true) {
      // No fixture and no shipped adapter would leave the tree with ZERO
      // provider routes — a state no product composition has, and one the
      // composer now correctly refuses to type into. Register the same routes
      // a fixture would, with streaming that still fails loud: the scenario
      // issues no model calls, and one that slipped in must not pass quietly.
      ctx.effect(() => ctx.llm.registerAdapter(
        replayProviders(options.replayContextWindow).map(provider => provider.id),
        new RouteOnlyAdapter(replayProviders(options.replayContextWindow)),
      ), 'web e2e scaffold: route-only adapter')
    }
  } catch (error) {
    if (process.cwd() !== originalCwd) process.chdir(originalCwd)
    const cleanupFailures = await cleanupScaffoldWorld(ctx, workspaceCwd, persistenceRoot)
    restoreCredentialEnvironment()
    if (cleanupFailures.length > 0) {
      throw new AggregateError([error, ...cleanupFailures], 'web scaffold setup failed and cleanup was incomplete')
    }
    throw error
  } finally {
    if (process.cwd() !== originalCwd) process.chdir(originalCwd)
  }

  return {
    harnessHome,
    mode,
    baseUrl: `http://${browserHost}:${port}`,
    ctx,
    workspaceCwd,
    persistenceRoot,
    // Barrier stack: the in-process turn/end identifies the session, its
    // explicit flush makes the transcript durable, and the caller's browser
    // settled-poll comes last because host completion strictly precedes render.
    whenTurnSettled(timeoutMs = mode === 'record' ? 180_000 : 30_000): Promise<SessionId> {
      return new Promise<SessionId>((resolveSettled, reject) => {
        const timer = setTimeout(() => {
          off()
          reject(new Error(`no turn/end within ${timeoutMs}ms`))
        }, timeoutMs)
        const off = ctx.on('session/event', (session: Session, event: SessionEvent) => {
          if (event.type !== 'turn/end') return
          clearTimeout(timer)
          off()
          ctx.sessions.flush(session)
            .then(() => { resolveSettled(session.id) }, reject)
        })
      })
    },
    async close(): Promise<void> {
      const failures: unknown[] = []
      // Fixture-consumption check first, while the run's binding state is
      // still authoritative — a scenario that drove fewer model calls than
      // recorded fails here instead of drifting green.
      try {
        replayHandle?.assertConsumed()
      } catch (error) {
        failures.push(error)
      }
      try {
        failures.push(...await cleanupScaffoldWorld(ctx, workspaceCwd, persistenceRoot))
      } finally {
        restoreCredentialEnvironment()
      }
      if (failures.length > 0) throw new AggregateError(failures, 'web scaffold teardown failed')
    },
  }
}

/**
 * Serialize a live session to the canonical raw session-JSONL layout — the
 * in-memory record-mode harvest, so the on-disk zstd default never matters.
 */
function rawSessionLog(session: Session): string {
  return [
    JSON.stringify({ type: 'session', ...session.header }),
    ...packChunkRuns(session.events).map(record => JSON.stringify(record)),
    '',
  ].join('\n')
}

/**
 * Record-mode fixture write-back: harvest the live session, scrub request
 * headers to {{system}}/{{tools}} (TODO(web-header-pin): the web lane pins no
 * header class — a deliberate deviation logged in the Agent Note's deferred
 * work), tokenize the run-local session id, cwd, and browser RPC id
 * ({{sessionId}}/{{cwd}}/{{rpcId}}, the committed fixture convention —
 * re-records then diff only on real content), and write the fixture.
 * @param scaffold - the record-mode scaffold.
 * @param sessionId - the driven session.
 * @param fixturePath - the committed session.jsonl / seed.jsonl target.
 */
export async function recordFixture(scaffold: WebScaffold, sessionId: SessionId, fixturePath: string): Promise<void> {
  const agent = scaffold.ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error(`record harvest: no live agent for ${sessionId}`)
  const fresh = scrubRequestHeaders(rawSessionLog(agent.session))
    .split(sessionId).join('{{sessionId}}')
    .split(scaffold.workspaceCwd).join('{{cwd}}')
    .replace(/"rpcId":"[^"]+"/g, '"rpcId":"{{rpcId}}"')
  const existing = existsSync(fixturePath) ? await readFile(fixturePath, 'utf8') : ''
  const stable = stabilizeFixtureMessageIds([fresh], [existing])[0]
  if (stable === undefined) throw new Error('record harvest: no stabilized fixture')
  await writeFile(fixturePath, stable)
}

/**
 * The user prompts recorded in a fixture, in order — the single source tying
 * spec drive steps to recorded reality so script and fixture cannot drift.
 * @param fixtureText - raw session.jsonl contents.
 * @returns the recorded user prompt texts.
 */
export function fixtureUserPrompts(fixtureText: string): string[] {
  return parseSessionLog(fixtureText).flatMap((event) => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return []
    const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('')
    return text.length > 0 ? [text] : []
  })
}

/**
 * Seed a recorded session fixture into the scaffold's persistence root
 * through the REAL backend API (throwaway Context + SessionStore + JSONL
 * plugin — the semantic-checkpoint precedent), never raw file writes: no
 * knowledge of bucket hashing, filename encoding, or compression, and
 * malformed shapes fail loud at seed time. The fixture's tokenized identity
 * ({{sessionId}}/{{cwd}}) is realized for this world before parsing.
 * @param scaffold - the target scaffold.
 * @param fixtureText - raw recorded session.jsonl contents.
 * @param id - the seeded session id (stable for deterministic goldens).
 * @returns the seeded id.
 */
/**
 * Realize a recorded seed fixture against one scaffold: substitute the
 * `{{sessionId}}`/`{{cwd}}` placeholders and rewrite the recorded cwd to the
 * scaffold's workspace. Idempotent, so a caller may realize early (e.g. to
 * price content exactly as the host will fold it) and still pass the result
 * through {@link seedSession}.
 * @param scaffold - the booted scaffold whose workspace the seed targets.
 * @param fixtureText - the committed seed fixture text.
 * @param id - the session id the seed is realized for.
 * @returns the realized fixture text.
 */
export function realizeSeedFixture(scaffold: WebScaffold, fixtureText: string, id: string): string {
  const realized = fixtureText
    .split('{{sessionId}}').join(id)
    .split('{{cwd}}').join(scaffold.workspaceCwd)
  const fixtureCwd = (JSON.parse(realized.split('\n', 1)[0]!) as { cwd?: string }).cwd
  return fixtureCwd === undefined
    ? realized
    : realized.split(fixtureCwd).join(scaffold.workspaceCwd)
}

export async function seedSession(scaffold: WebScaffold, fixtureText: string, id: string): Promise<SessionId> {
  const events = parseSessionLog(realizeSeedFixture(scaffold, fixtureText, id))
  if (events.length === 0) throw new Error('seed fixture has no events')
  const last = events[events.length - 1]!
  // An open final turn would be mutated by resume's crash repair on first
  // open; a committed seed must be a closed recording.
  if (last.type !== 'turn/end') throw new Error(`seed fixture must end in turn/end, got ${last.type}`)
  const meta: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: Date.now() - 60_000,
    cwd: scaffold.workspaceCwd,
    delegationDepth: 0,
  }
  const seeder = new Context()
  try {
    await seeder.plugin(SessionStore)
    // Same root as the booted tree with the plugin's own default compression,
    // so the host's directory-scan list() sees one consistent encoding.
    await seeder.plugin(SessionPersistenceJsonl, { root: scaffold.persistenceRoot })
    await seeder.sessionPersistence.create(meta)
    await seeder.sessionPersistence.append(meta.id, events)
    // Deterministic sidebar order: cold summaries take updatedAt from mtime.
    const located = seeder.sessionPersistence.locate(meta)
    if (located !== undefined) {
      const backdated = new Date(meta.createdAt)
      await utimes(located.path, backdated, backdated)
    }
  } finally {
    await seeder.fiber.dispose()
  }
  return meta.id
}

/**
 * Normalize an aria snapshot: uuid, cwd, workspace-basename, duration,
 * decode-throughput, and path-sensitive compaction estimates collapse to
 * stable tokens.
 *
 * Throughput needs a token for the same reason durations do, and no fixture
 * can supply one: the figure divides a replayed step's output tokens by the
 * wall time the local run took to stream them, so it moves between two runs
 * on one machine (measured 69 → 70 tok/s) and swings wildly on a fast replay
 * (26333 tok/s for a 3 ms stream).
 */
function normalizeAria(snapshot: string, workspaceCwd: string): string {
  // The session heading renders the workspace's basename, not the full
  // path, so both spellings must collapse to the token.
  const base = workspaceCwd.split('/').pop()!
  return snapshot
    .split(workspaceCwd).join('{{cwd}}')
    .split(base).join('{{workspace}}')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{{uuid}}')
    // The optional space in `\d+m ?\d+s` covers both minute spellings: the
    // stats line's compact `2m42s` and the message-chrome template's `2m 42s`.
    .replace(
      /~\d+(?:y(?: \d+mo)?|mo(?: \d+d)?)|\b(?:\d+d(?: \d+h(?: \d+m \d+s)?)?|\d+h \d+m \d+s|\d+m ?\d+s|\d+(?:\.\d+)?s|\d+(?:\.\d+)?ms)\b/g,
      duration => duration.startsWith('~') ? duration : '{{duration}}',
    )
    .replace(
      /约\d+(?:年(?:\d+个月)?|个月(?:\d+天)?)|\d+(?:天(?:\d+小时(?:\d+分\d+秒)?)?|小时\d+分\d+秒|分\d+秒|(?:\.\d+)?秒)/g,
      duration => duration.startsWith('约') ? duration : '{{duration}}',
    )
    .replace(/\d+(?:\.\d+)?(?= tok\/s(?!\w))/g, '{{throughput}}')
    // Seeded compaction prices realized file paths, whose length differs
    // between local worktrees and CI scratch directories.
    .replace(/(Compacted \d+ history items \(~)\d+( tokens\))/g, '$1{{tokens}}$2')
    // Message IconActions clocks widen by calendar day/year; collapse every
    // shape so goldens stay stable across midnight and year boundaries.
    .replace(/\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}/g, '{{clock}}')
    .replace(/\d{1,2}月\d{1,2}日 \d{2}:\d{2}/g, '{{clock}}')
    .replace(/(?<!\d)\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?:\s*[AP]M)?(?!\d)/gi, '{{clock}}')
    .replace(/(?<!\d)\d{2}:\d{2}(?!\d)/g, '{{clock}}')
}

/**
 * Capture the region's aria snapshot at a settled milestone: poll until two
 * consecutive normalized captures are equal — a single-shot capture races the
 * last React commits.
 * @param page - the page under test.
 * @param selector - the region locator selector.
 * @param workspaceCwd - normalization input.
 * @returns the stable normalized snapshot.
 */
export async function captureStableAria(page: Page, selector: string, workspaceCwd: string): Promise<string> {
  const region = page.locator(selector).first()
  let previous = normalizeAria(await region.ariaSnapshot(), workspaceCwd)
  await expect.poll(async () => {
    const current = normalizeAria(await region.ariaSnapshot(), workspaceCwd)
    const stable = current === previous
    previous = current
    return stable
  }, { timeout: 5_000, message: 'aria snapshot did not stabilize' }).toBe(true)
  return previous
}

/**
 * Compare a normalized golden, or rewrite it under refresh. Refresh is the
 * ONLY writer: a missing golden in replay mode fails with the healing command
 * instead of silently self-bootstrapping.
 * @param goldenPath - the committed ui.expected.md path.
 * @param actual - the stable normalized snapshot.
 * @param mode - the active snapshot mode.
 */
export async function compareOrRefreshGolden(goldenPath: string, actual: string, mode: WebSnapshotMode): Promise<void> {
  const payload = `${actual}\n`
  if (mode === 'refresh') {
    await writeFile(goldenPath, payload)
    return
  }
  if (!existsSync(goldenPath)) {
    throw new Error(`missing golden ${goldenPath} — run DSH_SNAPSHOT=refresh pnpm run test:web to generate it`)
  }
  expect(payload).toBe(await readFile(goldenPath, 'utf8'))
}

/**
 * Fixture-inventory guard: the scenario directory holds exactly the expected
 * files and every committed JSONL is a scrub fixed-point without a run-local
 * browser RPC id.
 * @param dir - the scenario snapshot directory.
 * @param expected - the exact expected file inventory.
 */
export async function assertFixtureInventory(dir: string, expected: string[]): Promise<void> {
  const entries = (await readdir(dir)).sort()
  expect(entries).toEqual([...expected].sort())
  for (const entry of entries.filter(name => name.endsWith('.jsonl'))) {
    const content = await readFile(join(dir, entry), 'utf8')
    expect(scrubRequestHeaders(content), `${dir}/${entry} carries request-header bulk`).toBe(content)
    expect(content, `${dir}/${entry} carries a run-local rpcId`)
      .not.toMatch(/"rpcId":"(?!\{\{rpcId\}\})[^"]+"/)
  }
}

/**
 * Console tripwires: reconnect/gap-repair self-healing or a pageerror must
 * fail the scenario, not mask a dead wire behind eventual consistency.
 * @param page - the page under test.
 * @returns live warning/pageerror collectors to assert empty at scenario end.
 */
export function watchConsole(page: Page): { warnings: string[]; pageErrors: string[] } {
  const warnings: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (/connection lost|gap repair|discontinuous/i.test(text)) warnings.push(text)
  })
  page.on('pageerror', (error) => { pageErrors.push(String(error)) })
  return { warnings, pageErrors }
}

/**
 * Remove only connection-loss warnings emitted after an intentional reload.
 * Earlier warnings and all gap-repair/discontinuity warnings remain fatal.
 * @param tripwire - the live console-warning collector.
 * @param warningStart - warning count captured immediately before reloading.
 */
export function acknowledgeReloadConnectionLoss(
  tripwire: ReturnType<typeof watchConsole>,
  warningStart: number,
): void {
  const reloadWarnings = tripwire.warnings.splice(warningStart)
  tripwire.warnings.push(...reloadWarnings.filter(text => !/connection lost/i.test(text)))
}
