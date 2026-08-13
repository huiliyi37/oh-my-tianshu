/**
 * git_log 工具：提交历史（oneline），可选 maxCount 与 paths 限定。
 * @module @huiliyi37/dsh-tool-git/src/log
 */

import type { Context } from '@huiliyi37/cordis'
import { defineTool } from '@huiliyi37/dsh-tools'
import type {} from '@huiliyi37/dsh-system-prompt'
import type {} from '@huiliyi37/dsh-git'
import { resolveCwd } from './cwd.ts'

/** log 默认条数（与服务默认一致）。 */
const DEFAULT_MAX_COUNT = 20
/** log 条数上限（防刷屏）。 */
const MAX_MAX_COUNT = 100

/** 注册 git_log。 */
export function applyGitLogTool(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:git-log',
    order: 100,
    text: 'git_log: list recent commit history (one-line entries).',
  })
  ctx.tools.register(defineTool({
    name: 'git_log',
    description: 'List recent git commit history (hash + subject, newest first).',
    parameters: {
      workdir: {
        type: 'string',
        description: 'Git repository directory; defaults to the session workspace.',
      },
      maxCount: {
        type: 'number',
        description: `Number of commits to list (default ${DEFAULT_MAX_COUNT}, cap ${MAX_MAX_COUNT}).`,
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restrict the history to commits touching these paths.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          commits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                hash: { type: 'string', required: true },
                subject: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.commits.length === 0
          ? '(no commits)'
          : value.commits.map(entry => `${entry.hash} ${entry.subject}`).join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const cwd = resolveCwd(exec, args.workdir)
      const maxCount = args.maxCount === undefined ? DEFAULT_MAX_COUNT : Math.min(args.maxCount, MAX_MAX_COUNT)
      const result = await ctx.git.log(cwd, {
        maxCount,
        ...args.paths === undefined ? {} : { paths: args.paths },
      }, exec.signal)
      // 服务返回 readonly 数组；schema 推断可变数组——展开适配。
      return { commits: [...result.commits] }
    },
  }))
}
