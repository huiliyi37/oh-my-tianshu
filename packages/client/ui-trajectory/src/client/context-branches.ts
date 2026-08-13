/** Rewind-delimited trajectory branches assembled across surface rewrites. */

import type {
  ConversationContext, ConversationNode, RequestView,
} from '@deepseek-ai/dsh-client-runtime/client'

/** One continuous context branch; compactions stay inline while rewinds start a successor branch. */
export interface TrajectoryContextBranch {
  id: number
  /** Identity stable when older context generations are prepended. */
  key: string
  contexts: readonly ConversationContext[]
  latest: ConversationContext
  nodes: readonly ConversationNode[]
  /** Seq that opened this branch; earlier requests require retained cited surface events. */
  startSeq: number
  /** Exact pre-rewind surface records inherited by this branch. */
  retainedSurfaceSeqs: ReadonlySet<number>
}

interface MutableBranch {
  id: number
  key: string
  contexts: ConversationContext[]
  latest: ConversationContext
  nodes: Map<number, ConversationNode>
  startSeq: number
  retainedSurfaceSeqs: Set<number>
}

function isCompactionCheckpoint(node: ConversationNode): boolean {
  if (node.kind !== 'context') { return false }
  const source = node.source
  return typeof source === 'object'
    && source !== null
    && 'kind' in source
    && source.kind === 'plugin'
    && 'plugin' in source
    && source.plugin === 'compact'
}

/**
 * Join context generations across compaction/rewrite operations and split only at rewind.
 * @param contexts - Append-only context generations from the runtime fold.
 * @returns Rewind-delimited branches in creation order.
 */
export function deriveTrajectoryContextBranches(
  contexts: readonly ConversationContext[],
): readonly TrajectoryContextBranch[] {
  const mutable: MutableBranch[] = []
  for (const context of contexts) {
    const startsBranch = mutable.length === 0 || context.origin === 'rewind'
    if (startsBranch) {
      const previous = mutable.at(-1)
      const retainedSurfaceSeqs = new Set(
        context.nodes
          .filter(node =>
            context.originSeq !== undefined && node.seq < context.originSeq,
          )
          .map(node => node.seq),
      )
      const inheritedNodes = previous === undefined
        ? []
        : [...previous.nodes.values()].filter(node =>
          retainedSurfaceSeqs.has(node.seq),
        )
      mutable.push({
        id: context.id,
        key: context.origin === 'rewind' && context.originSeq !== undefined
          ? `rewind:${context.originSeq}`
          : 'root',
        contexts: [context],
        latest: context,
        nodes: new Map(
          [...inheritedNodes, ...context.nodes.filter(node => !isCompactionCheckpoint(node))]
            .map(node => [node.seq, node]),
        ),
        startSeq: context.originSeq ?? Number.NEGATIVE_INFINITY,
        retainedSurfaceSeqs,
      })
      continue
    }
    const branch = mutable.at(-1)
    if (branch === undefined) continue
    branch.contexts.push(context)
    branch.latest = context
    for (const node of context.nodes) {
      if (!isCompactionCheckpoint(node)) branch.nodes.set(node.seq, node)
    }
  }
  return mutable.map(branch => ({
    id: branch.id,
    key: branch.key,
    contexts: branch.contexts,
    latest: branch.latest,
    nodes: [...branch.nodes.values()].sort((left, right) => left.seq - right.seq),
    startSeq: branch.startSeq,
    retainedSurfaceSeqs: branch.retainedSurfaceSeqs,
  }))
}

/**
 * Test whether a provider request belongs to one rewind branch.
 * @param branch - Branch carrying the exact inherited surface event seqs.
 * @param request - Provider request to classify.
 * @returns Whether the request began on this branch or produced a retained surface record.
 */
export function trajectoryBranchContainsRequest(
  branch: TrajectoryContextBranch,
  request: RequestView,
): boolean {
  if (request.startSeq >= branch.startSeq) return true
  return (
    request.resultSeq !== undefined
    && branch.retainedSurfaceSeqs.has(request.resultSeq)
  ) || (
    request.purpose === 'compaction'
    &&
    request.replacementSeq !== undefined
    && branch.retainedSurfaceSeqs.has(request.replacementSeq)
  )
}
