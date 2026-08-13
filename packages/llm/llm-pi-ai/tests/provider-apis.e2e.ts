import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import LlmService, { createUserMessage, CallId  } from '@deepseek-ai/dsh-llm'
import type { Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiReplayState } from '../src/replay.ts'
import { assemble, type AssembledResult } from './assemble.ts'

interface ProviderCase {
  provider: 'openai' | 'anthropic'
  api: 'openai-responses' | 'anthropic-messages'
  model: string
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
}

const openAIBaseURL = process.env.DSH_PI_AI_OPENAI_BASE_URL
const azureOpenAIKey = process.env.AZURE_OPENAI_API_KEY

const providerCases: ProviderCase[] = [
  {
    provider: 'openai',
    api: 'openai-responses',
    model: process.env.DSH_PI_AI_OPENAI_MODEL ?? 'gpt-5.5',
    ...azureOpenAIKey
      ? { apiKey: azureOpenAIKey, headers: { 'api-key': azureOpenAIKey, Authorization: '' } }
      : {},
    ...!openAIBaseURL ? {} : { baseURL: openAIBaseURL },
  },
  {
    provider: 'anthropic',
    api: 'anthropic-messages',
    model: process.env.DSH_PI_AI_ANTHROPIC_MODEL ?? 'claude-opus-4-8',
    ...!process.env.ANTHROPIC_API_KEY ? {} : { apiKey: process.env.ANTHROPIC_API_KEY },
  },
]

const contexts: Context[] = []

async function harness(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmService)
  await ctx.plugin(LlmPiAi, {
    providers: Object.fromEntries(providerCases.map(profile => [profile.provider, {
      ...profile.apiKey === undefined ? {} : { apiKey: profile.apiKey },
      ...profile.baseURL === undefined ? {} : { baseURL: profile.baseURL },
      ...profile.headers === undefined ? {} : { headers: profile.headers },
    }])),
  })
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function ask(text: string): Message[] {
  return [createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'test' },
  })]
}

function textOf(result: AssembledResult): string {
  return result.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function expectFinish(result: AssembledResult, expected: 'stop' | 'tool-calls'): void {
  if (result.finish.kind === 'error') {
    throw new Error(`provider request failed (${result.finish.failure.code}): ${result.finish.failure.message}`)
  }
  expect(result.finish.kind).toBe(expected)
}

function expectNativeReplay(result: AssembledResult, profile: ProviderCase): PiAiReplayState {
  const replayState = result.message.source.kind === 'model'
    ? result.message.source.replayState
    : undefined
  expect(replayState).toMatchObject({
    kind: 'pi-ai',
    version: 1,
    api: profile.api,
    provider: profile.provider,
    model: profile.model,
  })
  return replayState as PiAiReplayState
}

const lookupTool: ToolSchema = {
  name: 'lookup_code',
  description: 'Look up the word represented by a short code.',
  parameters: {
    type: 'object',
    properties: { code: { type: 'string', description: 'The code to look up.' } },
    required: ['code'],
  },
}

for (const profile of providerCases) {
  describe.skipIf(profile.apiKey === undefined)(
    `llm-pi-ai ${profile.provider} e2e (${profile.api})`,
    () => {
      it('streams text with usage and native replay metadata', async () => {
        const ctx = await harness()
        const result = await assemble(ctx, {
          provider: profile.provider,
          model: profile.model,
          messages: ask('Reply with exactly the word: pong'),
          maxTokens: 1024,
        })

        expectFinish(result, 'stop')
        expect(textOf(result).toLowerCase()).toContain('pong')
        expect(result.usage?.inputTokens).toBeGreaterThan(0)
        expect(result.usage?.outputTokens).toBeGreaterThan(0)
        expect(expectNativeReplay(result, profile).stopReason).toBe('stop')
      })

      it('round-trips a tool call with provider-native replay metadata', async () => {
        const ctx = await harness()
        const prompt = ask('Use lookup_code with code "blue". Do not answer without calling the tool.')
        const first = await assemble(ctx, {
          provider: profile.provider,
          model: profile.model,
          messages: prompt,
          tools: [lookupTool],
          maxTokens: 2048,
        })

        expectFinish(first, 'tool-calls')
        const call = first.message.content.find(block => block.type === 'tool-call')
        expect(call).toBeDefined()
        expect(call!.name).toBe('lookup_code')
        expect(JSON.parse(call!.arguments)).toMatchObject({ code: 'blue' })
        expect(expectNativeReplay(first, profile).stopReason).toBe('toolUse')

        const second = await assemble(ctx, {
          provider: profile.provider,
          model: profile.model,
          messages: [
            ...prompt,
            first.message,
            createUserMessage({
              content: [{
                type: 'tool-result',
                toolCallId: CallId(call!.id),
                content: [{ type: 'text', text: 'The code blue means ocean.' }],
              }],
              source: { kind: 'plugin', plugin: 'test' },
            }),
          ],
          tools: [lookupTool],
          maxTokens: 2048,
        })

        expectFinish(second, 'stop')
        expect(textOf(second).toLowerCase()).toContain('ocean')
        expect(expectNativeReplay(second, profile).stopReason).toBe('stop')
      })
    },
  )
}
