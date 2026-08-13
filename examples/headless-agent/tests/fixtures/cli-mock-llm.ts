import type { Context } from '@huiliyi37/cordis'
import { SUBAGENT_TASK_PREFIX } from '@huiliyi37/dsh-agent-router'
import {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@huiliyi37/dsh-llm'

const HIGH = ReasoningEffortId('high')
const OFF = ReasoningEffortId('off')

/** Keyless headless-agent adapter: one real bash call followed by a final answer. */
class CliMockAdapter extends LlmAdapter {
  /** 连败模式跨轮计数（agent-router e2e：持续失败触发 prediction escalate）。 */
  private failCount = 0

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: OFF, name: 'Off' },
          { id: HIGH, name: 'High' },
        ],
        defaultEffort: HIGH,
      },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (process.env.DSH_CLI_MOCK_FAILURE === '1') {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'CLI mock provider failed' } } }
      return
    }
    const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    // 连败模式（agent-router e2e）：FAIL_ROUNDS=8 轮持续调失败 bash（含 tool-result
    // 存在时），触发 prediction escalate；达阈值后回正常回复终止循环。
    const FAIL_ROUNDS = 8
    if (process.env.DSH_CLI_MOCK_FAIL_LOOP === '1' && this.failCount < FAIL_ROUNDS) {
      this.failCount++
      const args = JSON.stringify({ command: 'exit 1', description: 'Deliberately failing tool call.' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId(`cli-fail-${this.failCount}`), name: 'bash', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(`cli-fail-${this.failCount}`), name: 'bash', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    // 子代理模式：任务消息含【子代理任务 → 成功一次 bash + 回复（真实 turn 验证用）。
    // 判断须在 toolResult === undefined 检查之前——子代理首轮 followup 注入任务
    // 文本时无 tool-result，若落到底部默认分支会走 CLI_TOOL_ROUND_TRIP，导致
    // SUBAGENT_ROUND_TRIP 分支不可达（agent-router e2e 断言依赖此分支）。
    const taskText = options.messages
      .flatMap(m => m.content)
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
    if (taskText.includes(SUBAGENT_TASK_PREFIX)) {
      if (toolResult !== undefined && toolResult.content.some(b => b.type === 'text' && b.text.includes('ROUND_TRIP'))) {
        const reply = 'SUBAGENT DONE'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: reply }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
        yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const args = JSON.stringify({ command: 'printf SUBAGENT_ROUND_TRIP', description: 'Subagent tool round trip.' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('cli-subagent-call'), name: 'bash', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('cli-subagent-call'), name: 'bash', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (toolResult === undefined) {
      // 编辑模式（evidence-gate e2e）：首轮调 str_replace_editor create 触发 L1 门；
      // 拦截后 mock 不再重试（tool-result 已存在 → 走回复分支），防死循环。
      if (process.env.DSH_CLI_MOCK_EDIT === '1') {
        const args = JSON.stringify({ command: 'create', path: 'src/placeholder.ts', file_text: 'old content' })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: CallId('cli-edit-call'), name: 'str_replace_editor', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('cli-edit-call'), name: 'str_replace_editor', arguments: args } }
        yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      const args = JSON.stringify({ command: 'printf CLI_TOOL_ROUND_TRIP', description: 'Prove the CLI tool round trip.' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('cli-smoke-call'), name: 'bash', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('cli-smoke-call'), name: 'bash', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const toolText = toolResult.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const reply = `CLI tool round trip complete: ${toolText.trim()}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'cli-mock-llm'
export const inject = ['llm']

/** Register the keyless `cli-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock'], new CliMockAdapter())
  ctx.on('agent/request', async ({ step }, next) => {
    const config = await next()
    return step === 2 ? { ...config, reasoningEffort: OFF } : config
  })
}
