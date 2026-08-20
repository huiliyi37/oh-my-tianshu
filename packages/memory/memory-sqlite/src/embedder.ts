/**
 * dsh-memory-sqlite 的 embedder seam：可选嵌入 provider（阶段二c）。
 *
 * seam 直接复用 `@huiliyi37/dsh-semantic-index` 的 `EmbeddingProvider`
 * 抽象（`id` 稳定戳记 + `embed(texts)` 批量取向量）：store 保存时写入
 * 向量与戳记，检索时以戳记判定模型是否更换——不符即惰性重嵌（见
 * store.ts 的 search）。缺省不配置任何 embedder（零额外调用的缺省）。
 *
 * 本模块只携带命名 provider 的装配代码：`http` 是 OpenAI 兼容的
 * embeddings 端点（POST `{model, input}` → `{data: [{embedding}]}`）。
 * 部署方也可以经插件 apply 的第三参数注入任意实现（优先于 Config）。
 *
 * @module @huiliyi37/dsh-memory-sqlite/embedder
 */

import type { EmbeddingProvider } from '@huiliyi37/dsh-semantic-index'

/** `http` 命名 provider 的装配参数（插件 Config 解析后的显式值）。 */
export interface HttpEmbedderOptions {
  /** OpenAI 兼容 embeddings 端点的完整 URL。 */
  url: string
  /** 模型名（并入 embedder 戳记；换模型 = 戳记不符 = 惰性重嵌）。 */
  model: string
  /** 可选 bearer key。 */
  apiKey?: string | undefined
  /** 端到端请求超时毫秒。 */
  timeoutMs: number
}

/** OpenAI 兼容 embeddings 端点的应答形状（wire 边界校验用）。 */
interface EmbeddingsResponse {
  data?: Array<{ embedding?: unknown }>
}

/** 校验并取出一条向量（wire 边界：非数组/含非有限数 = fail loud）。 */
function readVector(value: unknown, index: number, url: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`memory-sqlite: embeddings endpoint "${url}" returned an invalid vector at index ${index}`)
  }
  return (value as unknown[]).map((component) => {
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw new Error(`memory-sqlite: embeddings endpoint "${url}" returned an invalid vector at index ${index}`)
    }
    return component
  })
}

/**
 * 装配 OpenAI 兼容 HTTP embedder。
 * @param options - 端点、模型、可选凭据与超时。
 * @returns id 为 `http:<model>` 的 EmbeddingProvider（戳记随模型变化）。
 */
export function createHttpEmbedder(options: HttpEmbedderOptions): EmbeddingProvider {
  return {
    id: `http:${options.model}`,
    isAvailable: () => true,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return []
      const response = await fetch(options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey === undefined || options.apiKey === ''
            ? {}
            : { authorization: `Bearer ${options.apiKey}` }),
        },
        body: JSON.stringify({ model: options.model, input: texts }),
        signal: AbortSignal.timeout(options.timeoutMs),
      })
      if (!response.ok) {
        throw new Error(`memory-sqlite: embeddings endpoint "${options.url}" answered HTTP ${response.status}`)
      }
      // wire 边界校验：应答形状不符 fail loud，不把坏数据写进库。
      const payload = await response.json() as EmbeddingsResponse
      if (!Array.isArray(payload.data) || payload.data.length !== texts.length) {
        throw new Error(
          `memory-sqlite: embeddings endpoint "${options.url}" returned ${payload.data?.length ?? 'no'}`
          + ` vector(s) for ${texts.length} text(s)`,
        )
      }
      return payload.data.map((item, index) => readVector(item.embedding, index, options.url))
    },
  }
}
