/** Deterministic provider adapter for the tool-json-repair snapshot: the
 * DeepSeek failure shape — the tool call serialized as JSON inside `content`
 * with a `stop` finish — followed by one plain text answer. */

import { LlmAdapter } from '@huiliyi37/dsh-llm'

class ToolJsonRepairAdapter extends LlmAdapter {
  requests = 0

  async * stream(_options) {
    this.requests++
    if (this.requests === 1) {
      const text = '{"name": "todo_write", "arguments": {"todos": [{"content": "repair probe", "status": "in_progress"}]}}'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: text.slice(0, 24) }
      yield { type: 'text-delta', index: 0, text: text.slice(24) }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 6, outputTokens: 6 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const text = 'REPAIRED_OK'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Cordis plugin name. */
export const name = 'tool-json-repair-backend'
/** Required LLM registry service. */
export const inject = ['llm']

/**
 * Register the deterministic provider adapter.
 * @param {import('@huiliyi37/cordis').Context} ctx - plugin context carrying the LLM service.
 */
export function apply(ctx) {
  ctx.llm.registerAdapter(['deepseek-official'], new ToolJsonRepairAdapter())
}
