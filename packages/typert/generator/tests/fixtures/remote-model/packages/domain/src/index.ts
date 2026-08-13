import type { TypeRTContext, TypeRTLookup } from '@huiliyi37/dsh-type-meta'
import type { AgentId } from './types.ts'

/** Host-only live Agent object. */
export class Agent {
  constructor(readonly id: AgentId) {}
}

declare module '@huiliyi37/dsh-type-meta' {
  interface TypeRTLookupMap {
    agent: TypeRTLookup<Agent, AgentId>
  }

  interface TypeRTContextMap {
    agent: TypeRTContext<AgentId>
  }
}

export type { AgentId } from './types.ts'
