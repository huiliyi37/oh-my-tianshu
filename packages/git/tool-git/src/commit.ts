/**
 * git_commit 工具：暂存全部变更并提交（message 必填）。
 * 语义提示：commit 前应先用 git_status / git_diff 检查——README 与引导均注明。
 * @module @huiliyi37/dsh-tool-git/src/commit
 */

import type { Context } from '@huiliyi37/cordis'
import { defineTool } from '@huiliyi37/dsh-tools'
import type {} from '@huiliyi37/dsh-system-prompt'
import type {} from '@huiliyi37/dsh-git'
import { resolveCwd } from './cwd.ts'

/** 注册 git_commit。 */
export function applyGitCommitTool(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:git-commit',
    order: 100,
    text: 'git_commit: stage all changes and commit. Inspect with git_status/git_diff first; the message must describe the change.',
  })
  ctx.tools.register(defineTool({
    name: 'git_commit',
    description: 'Stage all working-tree changes and create a commit with the given message.',
    parameters: {
      workdir: {
        type: 'string',
        description: 'Git repository directory; defaults to the session workspace.',
      },
      message: {
        type: 'string',
        description: 'Commit message (required, non-empty).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hash: { type: 'string', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `committed ${value.summary}`,
      }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const cwd = resolveCwd(exec, args.workdir)
      if (args.message === undefined || args.message.trim() === '') {
        throw new Error('git_commit: message is required')
      }
      return ctx.git.commit(cwd, { message: args.message }, exec.signal)
    },
  }))
}
