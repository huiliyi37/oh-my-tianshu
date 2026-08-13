/**
 * 工具 cwd 推导：workdir 参数优先，其次 agent session cwd，最后进程 cwd。
 * @module @huiliyi37/dsh-tool-git/src/cwd
 */

import type { ToolRunContext } from '@huiliyi37/dsh-tools'

/**
 * 解析工具执行目录（参数 > session header > 进程 cwd）。
 * @param exec - 工具执行上下文（携带 agent session）。
 * @param workdir - 调用方显式传入的目录；空串视为未传。
 * @returns 生效的仓库工作目录。
 */
export function resolveCwd(exec: ToolRunContext, workdir: string | undefined): string {
  if (workdir !== undefined && workdir !== '') return workdir
  const sessionCwd = exec.agent?.session.header.cwd
  if (sessionCwd !== undefined && sessionCwd !== '') return sessionCwd
  return process.cwd()
}
