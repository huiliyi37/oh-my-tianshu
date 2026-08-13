/**
 * git_diff 工具：工作区 diff（未暂存），可选 paths 限定与 --stat 摘要。
 * @module @huiliyi37/dsh-tool-git/src/diff
 */

import type { Context } from '@huiliyi37/cordis'
import { defineTool } from '@huiliyi37/dsh-tools'
import type {} from '@huiliyi37/dsh-system-prompt'
import type {} from '@huiliyi37/dsh-git'
import { resolveCwd } from './cwd.ts'

/**
 * 注册 git_diff。
 * @param ctx - 携带 tools/git/systemPrompt 服务的 Cordis context。
 */
export function applyGitDiffTool(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:git-diff',
    order: 100,
    text: 'git_diff: inspect uncommitted changes (full diff, or --stat summary; optional path filter).',
  })
  ctx.tools.register(defineTool({
    name: 'git_diff',
    description: 'Show the uncommitted working-tree diff (paths-filterable, stat-summary mode).',
    parameters: {
      workdir: {
        type: 'string',
        description: 'Git repository directory; defaults to the session workspace.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restrict the diff to these paths.',
      },
      stat: {
        type: 'boolean',
        description: 'Output only the --stat summary instead of the full diff.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          diff: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.diff === '' ? '(no uncommitted changes)' : value.diff,
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const cwd = resolveCwd(exec, args.workdir)
      return ctx.git.diff(cwd, {
        ...args.paths === undefined ? {} : { paths: args.paths },
        ...args.stat === undefined ? {} : { stat: args.stat },
      }, exec.signal)
    },
  }))
}
