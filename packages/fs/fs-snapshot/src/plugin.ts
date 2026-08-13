import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from 'cordis'
import z from 'schemastery'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { FileHistory } from './file-history.js'

/**
 * fs-snapshot 插件：在 `tools/execute` waterfall 注入文件快照钩子（移植自
 * opencode-tui 的 `tool-pipeline.ts` trackEdit 模式）。写工具
 * （`str_replace_editor` 的写命令 / `write` / `edit`）执行**前**对目标文件做
 * full-file 快照，供 rewind 回退。快照按会话缓存（per-session FileHistory），
 * 备份落在 `<backupDir>/<sessionId>/<sha256(path)[:16]>@v<N>`。
 *
 * 与 checkpoint-policy 的区分：checkpoint 是事件日志持久化（防崩溃丢 turn），
 * 本插件是文件内容快照（供 rewind 文件回退）——两者正交。
 *
 * @param ctx - cordis 上下文。
 * @param config - `backupDir` 快照根目录（默认 `<os.tmpdir()>/dsh-fs-snapshot`）。
 */
export const name = 'fs-snapshot'
/** 依赖工具注册表：无 tools 时 waterfall 钩子静默不生效（fail loud）。 */
export const inject = ['tools']

export function apply(ctx: Context, config: FsSnapshotConfig = {}): void {
  const backupDir = config.backupDir ?? join(tmpdir(), 'dsh-fs-snapshot')
  const histories = new Map<string, FileHistory>()

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const path = writeTargetPath(exec.name, exec.arguments)
    if (path !== undefined && exec.agent !== undefined) {
      const sessionId = exec.agent.session.id
      let fh = histories.get(sessionId)
      if (fh === undefined) {
        fh = new FileHistory(backupDir, sessionId)
        histories.set(sessionId, fh)
      }
      await fh.trackEdit(path, exec.callId)
    }
    return next()
  })

  // 供同进程消费者（如 TUI rewind overlay）取回快照索引。
  ctx.provide(HISTORIES_KEY, histories)
}

/** 插件配置。 */
export interface FsSnapshotConfig {
  /** 快照根目录（备份落在 `<backupDir>/<sessionId>/`）。 */
  backupDir?: string
}

export const Config = z.object({
  backupDir: z.string().default(join(tmpdir(), 'dsh-fs-snapshot')),
})

/** 插件上下文键：per-session FileHistory 映射（rewind 消费者经此取回）。 */
export const HISTORIES_KEY = 'fsSnapshot.histories'

/**
 * 取回某会话的 FileHistory（无快照记录时返回 undefined）。
 * @param ctx - 已挂载本插件的上下文。
 * @param sessionId - 目标会话 id。
 * @returns 该会话的快照索引；插件未挂载或该会话尚无写工具编辑时为 undefined。
 */
export function getFileHistory(ctx: Context, sessionId: string): FileHistory | undefined {
  const histories = ctx.get(HISTORIES_KEY, false) as Map<string, FileHistory> | undefined
  return histories?.get(sessionId)
}

/** 写工具名 → 变更文件路径（arguments 中提取）；非写工具返回 undefined。 */
function writeTargetPath(name: string, args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const a = args as Record<string, unknown>
  if (name === 'write' || name === 'edit') {
    return typeof a.path === 'string' ? a.path : undefined
  }
  if (name === 'str_replace_editor') {
    // 仅写命令（create/str_replace/insert）快照；view 只读不触发。
    const command = a.command
    if (command !== 'create' && command !== 'str_replace' && command !== 'insert') return undefined
    return typeof a.path === 'string' ? a.path : undefined
  }
  return undefined
}
