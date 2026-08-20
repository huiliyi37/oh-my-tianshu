/**
 * Multi-language LSP manager（移植自天枢 Tianshu src/lsp/multi-manager.ts，
 * Apache-2.0；spawn 路径简化：dsh-tui 是纯 Node 进程，弃上游 spawnHidden /
 * resolve-node-cli 桌面 bundle 适配，用 node:child_process spawn 直连）。
 *
 * Wraps the single-server `createLspManager` and routes each request to the
 * language server matching the file's extension, lazily spawning + initializing
 * each server on first use. This gives polyglot go-to-definition / diagnostics
 * (pyright / gopls / rust-analyzer / clangd / jdtls / typescript-language-server)
 * behind the existing single `LspManager` interface.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createLspManager, type LspManager, type LspDiagnostic } from './manager.js'
import {
  serverForFile,
  availableServers,
  defaultWhich,
  type LspServerDef,
  type WhichFn,
} from './server-registry.js'

interface Location {
  uri: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
}

/** Options for {@link createMultiLspManager} (availability probe + spawn injection). */
export interface MultiLspOptions {
  which?: WhichFn
  /** Injected for tests; defaults to a real child-process spawn. */
  spawnFor?: (def: LspServerDef, cwd: string) => ChildProcess
}

type LspSpawnFn = (cmd: string, args: string[], opts: Record<string, unknown>) => ChildProcess

/**
 * Default spawn for LSP servers: plain child_process.spawn (non-win32).
 * Windows 上 npx 与 npm 全局装的 langserver 都是 .cmd，不经 shell 直接
 * spawn 抛 EINVAL（CVE-2024-27980 后行为）——win32 经 ComSpec（cmd.exe）
 * /d /c 以 argv 数组显式派发；shell 保持 false，避开 DEP0190 弃用警告
 * 渲染进 TUI。command/args 均来自仓内 server-registry 固定表，无用户输入，
 * 无注入面（移植 dsh-tui e33052c）。
 * @param def - Server definition (command + args) to launch.
 * @param cwd - Working directory for the spawned server.
 * @param spawnFn - Process launcher; injectable for tests, defaults to node:child_process spawn.
 * @returns The spawned child process with piped stdio.
 */
export function defaultLspSpawn(
  def: LspServerDef,
  cwd: string,
  spawnFn: LspSpawnFn = spawn,
): ChildProcess {
  const isWin = process.platform === 'win32'
  const command = isWin ? (process.env.ComSpec ?? 'cmd.exe') : def.command
  const args = isWin ? ['/d', '/c', def.command, ...def.args] : def.args
  return spawnFn(command, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

/**
 * Create the multi-language facade: routes each request to the server matching
 * the file's extension, lazily spawning + initializing servers on first use.
 * @param cwd - Workspace root shared by every spawned server.
 * @param opts - Availability probe / spawn injection (tests).
 * @returns LspManager facade over the per-language servers; dispose() kills all.
 */
export function createMultiLspManager(cwd: string, opts: MultiLspOptions = {}): LspManager {
  const which = opts.which ?? defaultWhich
  const spawnFor = opts.spawnFor ?? ((def, c) => defaultLspSpawn(def, c))

  const managers = new Map<string, { mgr: LspManager; ready: Promise<void> }>()
  let availableCache: LspServerDef[] | null = null

  const getAvailable = (): LspServerDef[] => {
    if (availableCache === null) availableCache = availableServers(which)
    return availableCache
  }

  const ensure = async (def: LspServerDef): Promise<LspManager | null> => {
    let entry = managers.get(def.id)
    if (!entry) {
      const mgr = createLspManager(() => spawnFor(def, cwd), cwd)
      const ready = mgr.initialize().catch(() => { /* server unavailable */ })
      entry = { mgr, ready }
      managers.set(def.id, entry)
    }
    await entry.ready
    return entry.mgr.isReady() ? entry.mgr : null
  }

  const resolve = (filePath: string): LspServerDef | null => serverForFile(filePath, which)

  return {
    async initialize(): Promise<void> {
      // Lazy: servers spawn on first matching file. Nothing to do eagerly.
    },
    isReady(): boolean {
      // Ready when at least one server is installed; per-file readiness is
      // resolved at call time.
      return getAvailable().length > 0
    },
    supportsDefinition(): boolean {
      return getAvailable().length > 0
    },
    supportsReferences(): boolean {
      return getAvailable().length > 0
    },
    async gotoDefinition(filePath: string, line: number, character: number): Promise<Location[]> {
      const def = resolve(filePath)
      if (!def) return []
      const mgr = await ensure(def)
      return mgr ? mgr.gotoDefinition(filePath, line, character) : []
    },
    async findReferences(filePath: string, line: number, character: number): Promise<Location[]> {
      const def = resolve(filePath)
      if (!def) return []
      const mgr = await ensure(def)
      return mgr ? mgr.findReferences(filePath, line, character) : []
    },
    changeFile(filePath: string): void {
      const def = resolve(filePath)
      if (!def) return
      void ensure(def).then(mgr => mgr?.changeFile(filePath)).catch(() => { /* best-effort */ })
    },
    async getFileDiagnostics(filePath: string, timeoutMs?: number): Promise<LspDiagnostic[]> {
      const def = resolve(filePath)
      if (!def) return []
      const mgr = await ensure(def)
      return mgr ? mgr.getFileDiagnostics(filePath, timeoutMs) : []
    },
    dispose(): void {
      for (const { mgr } of managers.values()) {
        try { mgr.dispose() } catch { /* best-effort */ }
      }
      managers.clear()
    },
  }
}
