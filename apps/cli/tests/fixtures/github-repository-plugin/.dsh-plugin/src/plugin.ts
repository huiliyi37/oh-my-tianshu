import type { Context } from 'cordis'

const PROOF_TOOL_NAME = 'mcp__github_repository__proof'

interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

interface ToolExecution {
  readonly name: string
}

interface ToolResult {
  readonly isError: boolean
  readonly content: readonly TextBlock[]
}

type PostDecision =
  | { readonly kind: 'accept'; readonly content?: readonly TextBlock[]; readonly value?: unknown; readonly additionalContexts?: readonly unknown[] }
  | { readonly kind: 'block'; readonly feedback: readonly TextBlock[] }

type PostListener = (
  execution: ToolExecution,
  result: ToolResult,
  next: () => Promise<PostDecision>,
) => Promise<PostDecision>

type DshContext = Context & {
  on(event: 'tools/post-execute', listener: PostListener): () => void
}

/** Cordis plugin name used by the repository acceptance fixture. */
export const name = 'github-repository-typescript-proof'

/** DSH tool registry required by the post-execute contribution. */
export const inject = ['tools']

/**
 * Append a marker after the repository MCP proof tool succeeds.
 * @param ctx - trusted DSH Cordis context supplied to the repository package.
 */
export function apply(ctx: Context): void {
  const dsh = ctx as DshContext
  dsh.on('tools/post-execute', async (execution, result, next): Promise<PostDecision> => {
    const decision = await next()
    if (execution.name !== PROOF_TOOL_NAME || result.isError || decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) {
      return decision
    }
    return {
      kind: 'accept',
      content: [
        ...(decision.content ?? result.content),
        { type: 'text', text: 'TS_PLUGIN_FROM_GITHUB_REPOSITORY' },
      ],
      ...decision.additionalContexts === undefined ? {} : { additionalContexts: decision.additionalContexts },
    }
  })
}
