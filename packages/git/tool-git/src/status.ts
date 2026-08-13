/**
 * git_status 工具：工作区状态（分支 + 是否有未提交变更）。
 * @module @huiliyi37/dsh-tool-git/src/status
 */

import type { Context } from '@huiliyi37/cordis'
import { defineTool } from '@huiliyi37/dsh-tools'
import type {} from '@huiliyi37/dsh-system-prompt'
import type {} from '@huiliyi37/dsh-git'
import { resolveCwd } from './cwd.ts'

/**
 * 注册 git_status。
 * @param ctx - 携带 tools/git/systemPrompt 服务的 Cordis context。
 */
export function applyGitStatusTool(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:git-status',
    order: 100,
    text: 'git_status: inspect the git working tree (current branch and uncommitted changes).',
  })
  ctx.tools.register(defineTool({
    name: 'git_status',
    description: 'Inspect the git working tree: current branch and whether it has uncommitted changes.',
    parameters: {
      workdir: {
        type: 'string',
        description: 'Git repository directory; defaults to the session workspace.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branch: { type: 'string', required: true },
          dirty: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `branch ${value.branch}${value.dirty ? ' — dirty (uncommitted changes)' : ' — clean'}`,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const cwd = resolveCwd(exec, args.workdir)
      return ctx.git.status(cwd, {}, exec.signal)
    },
  }))
}
