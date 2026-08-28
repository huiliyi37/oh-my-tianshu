/** Model-facing discovery of LLM routes available to child Agents. */

import type { Context } from '@huiliyi37/cordis'
import type { Agent } from '@huiliyi37/dsh-agent'
import type { LlmProviderInfo, LlmService } from '@huiliyi37/dsh-llm'
import { defineTool } from '@huiliyi37/dsh-tools'
import type { ModelSelectionPolicy } from './model-selection.ts'

interface ListSubagentModelsRequest {
  readonly provider?: string
  readonly model?: string
}

/** Resolve one registered provider with a model-correctable diagnostic. */
function registeredProvider(
  llm: LlmService,
  policy: ModelSelectionPolicy,
  providerId: string,
): LlmProviderInfo {
  const providers = llm.listProviders()
  const provider = providers.find(candidate => candidate.id === providerId)
  if (provider !== undefined) return provider
  const available = providers
    .filter(candidate => policy.routes.some(route => route.provider === candidate.id))
    .map(candidate => candidate.id)
    .join(', ') || '(none)'
  throw new Error(`LLM provider "${providerId}" is not registered; available providers: ${available}`)
}

/** Render one advertised or resolved model. */
function modelLine(provider: string, model: { id: string; name: string; description?: string }): string {
  return `${provider}/${model.id} — ${model.name}${model.description === undefined ? '' : `: ${model.description}`}`
}

/** Read the requested provider, advertised models, or exact-model efforts. */
async function listSubagentModels(
  ctx: Context,
  policy: ModelSelectionPolicy,
  request: ListSubagentModelsRequest,
  signal: AbortSignal,
): Promise<string> {
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throw new Error('cannot discover child LLM routes because the `llm` service is unavailable')
  }
  if (request.model !== undefined && request.provider === undefined) {
    throw new Error('`model` requires `provider`')
  }
  if (request.provider === undefined) {
    const providers = llm.listProviders()
      .filter(provider => policy.routes.some(route => route.provider === provider.id))
    return providers.length === 0
      ? '(no LLM providers)'
      : providers.map(provider => `${provider.id} — ${provider.name}`).join('\n')
  }
  if (request.provider.length === 0) throw new Error('`provider` must be non-empty')
  const allowedRoutes = policy.routes.filter(route => route.provider === request.provider)
  if (allowedRoutes.length === 0) {
    throw new Error(`LLM provider "${request.provider}" is not allowed for this Session`)
  }
  const provider = registeredProvider(llm, policy, request.provider)
  if (request.model === undefined) {
    const models = (await llm.listModels(provider.id))
      .filter(model => allowedRoutes.some(route => route.model === model.id))
    return models.length === 0
      ? `(no advertised models for ${provider.id})`
      : models.map(model => modelLine(provider.id, model)).join('\n')
  }
  if (request.model.length === 0) throw new Error('`model` must be non-empty')
  if (!allowedRoutes.some(route => route.model === request.model)) {
    throw new Error(`child LLM route "${provider.id}/${request.model}" is not allowed for this Session`)
  }
  const model = await llm.resolveModelInfo(provider.id, request.model, signal)
  const efforts = model.reasoning?.efforts.map(effort => (
    `${effort.id}${model.reasoning?.defaultEffort === effort.id ? ' (default)' : ''} — ${effort.name}`
    + (effort.description === undefined ? '' : `: ${effort.description}`)
  )).join('\n') || '(no advertised reasoning efforts)'
  return `${modelLine(provider.id, model)}\nReasoning efforts:\n${efforts}`
}

/**
 * Register `list_subagent_models` in the calling scope. The definition is
 * fixed (no catalog data in the prompt prefix); results intersect the live
 * adapter directory with the calling Session's recorded route policy.
 * @param ctx - context receiving the tool.
 * @param resolvePolicy - per-calling-Agent policy resolver (本仓部署级单实例
 *   没有 per-Agent 静态策略，见阶段 4 浪级 Note 的 B-β 差异).
 */
export function registerListSubagentModels(
  ctx: Context,
  resolvePolicy: (agent: Agent) => ModelSelectionPolicy | undefined,
): void {
  ctx.tools.register(defineTool({
    name: 'list_subagent_models',
    description: 'List the LLM routes available for subagent delegation. No arguments lists '
      + 'authorized providers. With `provider`, lists that provider\'s advertised models within '
      + 'this Session\'s authorization. With `provider` and `model`, shows the exact route\'s '
      + 'reasoning efforts and default.',
    parameters: {
      provider: {
        type: 'string',
        description: 'Registered LLM provider id.',
      },
      model: {
        type: 'string',
        description: 'Exact model id owned by `provider`.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          output: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.output }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        throw new Error('list_subagent_models requires a calling agent (exec.agent was undefined)')
      }
      const policy = resolvePolicy(parent)
      if (policy === undefined) {
        throw new Error('child model selection is disabled for this tool instance')
      }
      const request = args as ListSubagentModelsRequest
      return { output: await listSubagentModels(ctx, policy, request, exec.signal) }
    },
  }))
}
