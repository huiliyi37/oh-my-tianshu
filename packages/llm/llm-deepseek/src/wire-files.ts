/**
 * Wire-level Files upgrade: post-serialization transform that swaps inline
 * base64 `image_url` parts for DeepSeek Files API `{ type: 'file' }` parts.
 *
 * 分叉适配（回流自上游 d29855f97c 统一管线的分叉原生形态）：本仓历史里图片以
 * dataUrl 随消息持久化，因此采用序列化后的请求置换，而不是上游「attachment
 * 引用 + 请求版本预解析」的两段式——历史模型零改动即获得「同一图片仅上传
 * 一次、后续回合引用 file_id」的核心收益。任一部分上传失败该 part 原样保留
 * （回退语义对应上游 1b389798dc），从不阻塞对话本身。
 *
 * @module @huiliyi37/dsh-llm-deepseek/wire-files
 */

import { createHash } from 'node:crypto'
import { AttachmentId, ImageVariantId } from '@huiliyi37/dsh-attachment'
import type { ImageMediaType, RequestImageAttachment } from '@huiliyi37/dsh-attachment'
import { MAX_CHAT_IMAGE_BYTES, DeepSeekFileStore } from './file-store.ts'
import type { DeepSeekFileConnection, DeepSeekFilePolicy } from './file-store.ts'
import type { WireContentPart, WireRequest } from './types.ts'

/** Files API accepts these image media types; anything else stays inline. */
const UPLOADABLE_MEDIA: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp'])

const DATA_URL = /^(data:(image\/(?:png|jpeg|webp));base64,)([A-Za-z0-9+/=]+)$/u

/** Behavior knobs resolved once per adapter from the flat config keys. */
export interface WireFilesUpgradeOptions {
  store?: DeepSeekFileStore
  policy: DeepSeekFilePolicy
  minInlineBytes: number
}

let shared: DeepSeekFileStore | undefined

/**
 * Process-wide store singleton: inflight upload dedupe spans requests while
 * the durable index makes it cross-process as well.
 * @returns the shared orchestrator instance.
 */
export function sharedWireFileStore(): DeepSeekFileStore {
  shared ??= new DeepSeekFileStore()
  return shared
}

/** Default whole-upgrade timeout (ms). */
export const DEFAULT_FILES_API_TIMEOUT_MS = 60_000
/** Default uploaded-image lifetime (seconds). */
export const DEFAULT_FILES_API_EXPIRES_AFTER_SECONDS = 604_800
/** Default re-upload margin (seconds). */
export const DEFAULT_FILES_API_REFRESH_MARGIN_SECONDS = 3_600
/** Default quota-recovery cleanup batch. */
export const DEFAULT_FILES_API_QUOTA_CLEANUP_BATCH = 100
/** Default inline-floor byte size under which parts stay inline. */
export const DEFAULT_FILES_API_MIN_INLINE_BYTES = 65_536

/** Per-request connection snapshot; the API key never enters the wire transform. */
export interface WireFilesUpgradeCall {
  baseURL: string
  apiKey: string
  signal?: AbortSignal
}

function decodeDataUrl(url: string): { mediaType: ImageMediaType; data: Uint8Array } | undefined {
  const m = DATA_URL.exec(url)
  if (m === null || m[2] === undefined || m[3] === undefined) return undefined
  const mediaType = m[2] as ImageMediaType
  const raw = atob(m[3])
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return { mediaType, data: bytes }
}

/**
 * Replace every eligible inline image part with its Files API file reference.
 * Deterministic content addressing means the same bytes upload only once per
 * endpoint+key namespace; the durable index carries expiry bookkeeping.
 * Per-part failures leave that part inline (best-effort semantics).
 * @param request - the serialized wire request, mutated in place.
 * @param store - the shared upload orchestrator.
 * @param policy - expiry/refresh/quota policy for this deployment.
 * @param connection - endpoint and key snapshot for one request cycle.
 * @param minInlineBytes - parts under this byte size stay inline.
 */
export interface WireFilesUpgradeDeps {
  store: DeepSeekFileStore
  policy: DeepSeekFilePolicy
  minInlineBytes: number
  /** Per-part upload failure observer; absence keeps failures silent (inline fallback). */
  onPartError?: (error: unknown) => void
}

export async function upgradeWireImages(
  request: WireRequest,
  deps: WireFilesUpgradeDeps,
  connection: DeepSeekFileConnection,
  signal?: AbortSignal,
): Promise<void> {
  const { store, policy, minInlineBytes, onPartError } = deps
  signal?.throwIfAborted()
  for (const message of request.messages) {
    if (message.role !== 'user') continue
    const user = message
    if (!Array.isArray(user.content)) continue
    for (let i = 0; i < user.content.length; i++) {
      const part: WireContentPart | undefined = user.content[i]
      if (part === undefined || part.type !== 'image_url') continue
      const decoded = decodeDataUrl(part.image_url.url)
      if (decoded === undefined || !UPLOADABLE_MEDIA.has(decoded.mediaType)) continue
      if (decoded.data.byteLength < minInlineBytes) continue
      if (decoded.data.byteLength > MAX_CHAT_IMAGE_BYTES) continue
      try {
        user.content[i] = await toFilePart(decoded.data, decoded.mediaType, store, policy, connection, signal)
      } catch (error: unknown) {
        if (!(signal?.aborted ?? false)) onPartError?.(error)
        else throw error

        // 上传失败即保留 inline part：Files 是优化不是正确性依赖。
      }
    }
  }
}

async function toFilePart(
  data: Uint8Array,
  mediaType: ImageMediaType,
  store: DeepSeekFileStore,
  policy: DeepSeekFilePolicy,
  connection: DeepSeekFileConnection,
  signal?: AbortSignal,
): Promise<WireContentPart> {
  const hex = createHash('sha256').update(data).digest('hex')
  const version: RequestImageAttachment = {
    variantId: ImageVariantId(`sha256-${hex}-wire-v1`),
    attachment: {
      attachmentId: AttachmentId(`sha256:${hex}`),
      mediaType,
      bytes: data.byteLength,
      width: 0,
      height: 0,
    },
    data,
    mediaType,
    bytes: data.byteLength,
    width: 0,
    height: 0,
    depth: 'uchar',
    space: 'srgb',
    hasAlpha: false,
  }
  const resolved = await store.ensureUploaded(version, connection, policy, signal)
  return { type: 'file', file_id: resolved.record.fileId }
}
