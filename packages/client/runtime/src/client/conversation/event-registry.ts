import type { Context } from 'cordis'
import type { ConversationNodeDefinition } from '../contract/conversation.ts'
import { ConversationDefinitionRegistry } from './definition-registry.ts'

/** Runtime registry of independently owned Conversation business Definitions. */
export class ConversationEventRegistry extends ConversationDefinitionRegistry<ConversationNodeDefinition> {
  private fallback: ConversationNodeDefinition | undefined

  /** @param ctx - owning Client Runtime context. */
  constructor(ctx: Context) {
    super(ctx, 'conversationEvents')
  }

  /**
   * Register a uniquely named business Definition for the caller's lifetime.
   * @param definition - Definition contribution.
   * @returns idempotent disposer.
   */
  register(definition: ConversationNodeDefinition): () => void {
    return this.registerDefinition(
      definition.kind,
      definition,
      `conversation Definition "${definition.kind}" is already registered`,
      `conversationEvents.register(${JSON.stringify(definition.kind)})`,
    )
  }

  /**
   * Register the sole fallback used only when no ordinary Definition matches.
   * @param definition - fallback Definition.
   * @returns idempotent disposer.
   */
  registerFallback(definition: ConversationNodeDefinition): () => void {
    if (this.fallback !== undefined) throw new Error('conversation fallback Definition is already registered')
    const owner = this.ctx
    const dispose = owner.effect(() => {
      this.fallback = definition
      this.refresh()
      return () => {
        if (this.fallback !== definition) return
        this.fallback = undefined
        this.refresh()
      }
    }, `conversationEvents.registerFallback(${JSON.stringify(definition.kind)})`)
    return () => { void dispose() }
  }

  /**
   * Return the current unmatched-event fallback.
   * @returns installed fallback, when present.
   */
  fallbackEntry(): ConversationNodeDefinition | undefined {
    return this.fallback
  }

}
