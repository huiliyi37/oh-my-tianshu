/**
 * Model-facing git tool — `git` with an `operation` discriminator
 * (status | diff | log | commit). The four operations share one tool schema to
 * keep the prompt footprint small (H1: Claude Code native git tools
 * counterpart, C6 benchmark). This is the consumer layer of the git seam: it
 * owns the tool name, JSON schema, argument validation, prompt section, and
 * result formatting, and executes through the `ctx.git` provider contract
 * (@deepseek-ai/dsh-git) — the tool never touches git subprocesses directly.
 *
 * @module @deepseek-ai/dsh-tool-git
 */

import type { Context } from 'cordis'
import z from 'schemastery'
import { applyGitTool } from './git.ts'

export const name = 'tool-git'
export const inject = ['tools', 'git', 'systemPrompt']

/** 工具配置：无部署可变项（单工具无 tunables）。 */
export interface Config {
  /** 是否启用工具；false 时不注册（默认 true）。 */
  enabled?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

/**
 * 注册 git 工具。
 * @param ctx - plugin context; the tool is disposed with it.
 * @param config - total switch; false skips registration.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.enabled === false) return
  applyGitTool(ctx)
}
