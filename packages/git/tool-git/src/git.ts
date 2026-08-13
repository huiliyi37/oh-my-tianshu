/**
 * git 单工具：`operation` 判别（status | diff | log | commit），合并原四工具
 * 为一个 schema——提示词占用从 4 份 tool 定义收敛为 1 份（净省约一半），
 * 模型仍能完成全部四个 git 操作。
 * @module @huiliyi37/dsh-tool-git/src/git
 */

import type { Context } from '@huiliyi37/cordis'
import { defineTool } from '@huiliyi37/dsh-tools'
import type {} from '@huiliyi37/dsh-system-prompt'
import type {} from '@huiliyi37/dsh-git'
import { resolveCwd } from './cwd.ts'

/** log 默认条数。 */
const DEFAULT_MAX_COUNT = 20
/** log 条数上限。 */
const MAX_MAX_COUNT = 100
/** 合法 operation 集合。 */
const OPERATIONS = ['status', 'diff', 'log', 'commit'] as const

/**
 * 注册 git 单工具。
 * @param ctx - 携带 tools/git/systemPrompt 服务的 Cordis context。
 */
export function applyGitTool(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:git',
    order: 100,
    text: 'git: run one git operation (status/diff/log/commit) in the session workspace; inspect before commit.',
  })
  ctx.tools.register(defineTool({
    name: 'git',
    description: 'Run a git operation in the repository: status (branch + dirty), diff (uncommitted changes, stat or full), log (history), commit (stage all + commit with message).',
    parameters: {
      operation: {
        type: 'string',
        enum: [...OPERATIONS],
        required: true,
        description: 'Which git operation to run: status | diff | log | commit.',
      },
      workdir: {
        type: 'string',
        description: 'Git repository directory; defaults to the session workspace.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restrict diff/log to these paths.',
      },
      stat: {
        type: 'boolean',
        description: 'diff only: output the --stat summary instead of the full diff.',
      },
      maxCount: {
        type: 'number',
        description: `log only: number of commits to list (default ${DEFAULT_MAX_COUNT}, cap ${MAX_MAX_COUNT}).`,
      },
      message: {
        type: 'string',
        description: 'commit only: commit message (required, non-empty).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          operation: { type: 'string', required: true },
          branch: { type: 'string' },
          dirty: { type: 'boolean' },
          diff: { type: 'string' },
          commits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                hash: { type: 'string', required: true },
                subject: { type: 'string', required: true },
              },
            },
          },
          hash: { type: 'string' },
          summary: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const block = (text: string) => [{ type: 'text' as const, text }]
        switch (value.operation) {
          case 'status':
            return block(`branch ${value.branch ?? 'HEAD'}${value.dirty ? ' — dirty (uncommitted changes)' : ' — clean'}`)
          case 'diff':
            return block(value.diff === undefined || value.diff === '' ? '(no uncommitted changes)' : value.diff)
          case 'log':
            return block(value.commits === undefined || value.commits.length === 0
              ? '(no commits)'
              : value.commits.map(entry => `${entry.hash} ${entry.subject}`).join('\n'))
          case 'commit':
            return block(`committed ${value.summary ?? ''}`)
          default:
            return block(`git ${value.operation}`)
        }
      },
    },
    isConcurrencySafe: args => (args as { operation?: string }).operation !== 'commit',
    async execute(args, exec) {
      const cwd = resolveCwd(exec, args.workdir)
      switch (args.operation) {
        case 'status':
          return {
            operation: 'status',
            ...(await ctx.git.status(cwd, {}, exec.signal)),
          }
        case 'diff':
          return {
            operation: 'diff',
            diff: (await ctx.git.diff(cwd, {
              ...args.paths === undefined ? {} : { paths: args.paths },
              ...args.stat === undefined ? {} : { stat: args.stat },
            }, exec.signal)).diff,
          }
        case 'log': {
          const maxCount = args.maxCount === undefined ? DEFAULT_MAX_COUNT : Math.min(args.maxCount, MAX_MAX_COUNT)
          const result = await ctx.git.log(cwd, {
            maxCount,
            ...args.paths === undefined ? {} : { paths: args.paths },
          }, exec.signal)
          return { operation: 'log', commits: [...result.commits] }
        }
        case 'commit': {
          if (args.message === undefined || args.message.trim() === '') {
            throw new Error('git: message is required for the commit operation')
          }
          const result = await ctx.git.commit(cwd, { message: args.message }, exec.signal)
          return { operation: 'commit', hash: result.hash, summary: result.summary }
        }
        default: {
          const narrowed: never = args.operation
          throw new Error(`git: unknown operation ${String(narrowed)}`)
        }
      }
    },
  }))
}
