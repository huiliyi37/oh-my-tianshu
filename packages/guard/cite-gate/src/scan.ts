// Pure citation scanning for the cite-gate guard — no ctx, no side effects.
// Everything here is unit-testable without booting a harness.
//
// Design constraint (2026-09-01, from benchmark calibration): closed-book
// agents fabricate authoritative-looking citations — upgrade-card IDs that do
// not exist (e.g. "apply lifecycle replacement"), legacy error codes that
// were renamed in alpha.2, and file paths the session never actually read.
// The scanner turns exactly those three shapes into findings.

import type { AssistantMessage } from '@huiliyi37/dsh-session'

export interface Vocabulary {
  schemaVersion: number
  cardIds: string[]
  recipeIds: string[]
  legacyCodes: string[]
  namespacedCodes: string[]
}

export type Finding =
  | { kind: 'unknown-card'; id: string }
  | { kind: 'legacy-code'; code: string }
  | { kind: 'unknown-namespaced-code'; code: string }
  | { kind: 'unread-path'; path: string }

export interface ScanOptions {
  cardCheck: boolean
  legacyCodeCheck: boolean
  namespacedCodeCheck: boolean
  pathCheck: boolean
}

export const CARD_ID_RE = /\bDSH-\d+\.\d+\.\d+-[A-Z]\d+-\d{2,3}\b/g
const LEGACY_CODE_RE = /\b(session-not-found|agent-busy|agent-preset-not-found|agent-preset-locked|bad-request|cancelled|internal)\b/g
const NAMESPACED_CODE_RE = /\b(gateway|session|agent-preset|llm|typert)\/[a-z][a-z0-9-]*\b/g
// A citation-shaped path: relative or rooted path with at least one slash,
// ending in a source/config extension. URLs and node_modules are noise.
const PATH_TOKEN_RE = /(?:^|[^\w@./-])([\w@./~-]+\/[\w./-]+\.(?:md|ts|tsx|js|mjs|cjs|json|ya?ml|toml))\b/g
const PATH_NOISE_RE = /^(?:https?:|^\/\/|node_modules\/|\/usr\/|\/private\/|\/var\/|\/tmp\/|\/proc\/)/

/** Join all text blocks of an assembled assistant message into one string. */
export function extractAssistantText(message: AssistantMessage): string {
  let out = ''
  for (const block of message.content) {
    if (block.type === 'text') out += block.text
  }
  return out
}

/** Normalize a path token: strip leading ./ and trailing punctuation. */
export function normalizePath(raw: string): string {
  let path = raw.trim().replace(/^['"`]|['"`,;:)\]）]$/g, '')
  while (path.startsWith('./')) path = path.slice(2)
  return path.replaceAll('\\', '/')
}

/**
 * Scan one assistant message for citation findings.
 * `seen` holds every path the session read or wrote (normalized).
 * Findings are deduplicated by kind + payload.
 */
export function scanText(text: string, vocab: Vocabulary, seen: ReadonlySet<string>, opts: ScanOptions): Finding[] {
  const findings: Finding[] = []
  const keys = new Set<string>()

  const push = (finding: Finding): void => {
    const key = finding.kind === 'unread-path' ? `${finding.kind}:${finding.path}` : `${finding.kind}:${'id' in finding ? finding.id : finding.code}`
    if (!keys.has(key)) {
      keys.add(key)
      findings.push(finding)
    }
  }

  if (opts.cardCheck) {
    const known = new Set(vocab.cardIds)
    for (const m of text.matchAll(CARD_ID_RE)) {
      if (!known.has(m[0])) push({ kind: 'unknown-card', id: m[0] })
    }
  }

  if (opts.legacyCodeCheck) {
    const legacy = new Set(vocab.legacyCodes)
    for (const m of text.matchAll(LEGACY_CODE_RE)) {
      if (legacy.has(m[0])) push({ kind: 'legacy-code', code: m[0] })
    }
  }

  if (opts.namespacedCodeCheck) {
    const known = new Set(vocab.namespacedCodes)
    for (const m of text.matchAll(NAMESPACED_CODE_RE)) {
      if (!known.has(m[0])) push({ kind: 'unknown-namespaced-code', code: m[0] })
    }
  }

  if (opts.pathCheck) {
    for (const m of text.matchAll(PATH_TOKEN_RE)) {
      const raw = m[1]
      if (!raw) continue
      const path = normalizePath(raw)
      if (!path || path.includes('://') || PATH_NOISE_RE.test(path)) continue
      if (seen.has(path) || seen.has(path.split('/').pop() ?? path)) continue
      push({ kind: 'unread-path', path })
    }
  }

  return findings
}

/** Extract file paths from a tool call's raw arguments (lossless JSON). */
export function extractToolPaths(args: unknown): string[] {
  if (typeof args !== 'object' || args === null) return []
  const record = args as Record<string, unknown>
  const out: string[] = []
  for (const key of ['path', 'file_path', 'filePath', 'paths', 'files']) {
    const value = record[key]
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string') out.push(item)
    }
  }
  return out
}

/** One model-facing reminder line per finding. Chinese, matching the host's advisory voice. */
export function renderReminder(finding: Finding): string {
  switch (finding.kind) {
    case 'unknown-card':
      return `【cite-gate】你的回答引用了卡片 ${finding.id}，但它不在已知的 DSH 升级卡片清单里（清单来自 dsh-plugin-upgrade-skill 的版本卡片与 rollup）。幻觉卡是最常见的假引用——请核对 references/README.md 的走廊索引，确认真实卡片 ID，或把该断言显式标注为「待确认」。`
    case 'legacy-code':
      return `【cite-gate】你的回答使用了 0.1.1 时代的错误码 \`${finding.code}\`。alpha.2 的错误码已加命名空间（如 \`cancelled\` → \`gateway/cancelled\`、\`session-not-found\` → \`session/not-found\`，见 DSH-0.1.2-A2-02）。按老码分支会在新宿主上永不命中——请改用命名空间错误码，或标注「待确认」。`
    case 'unknown-namespaced-code':
      return `【cite-gate】你引用了错误码 \`${finding.code}\`，它不在已知的 alpha.2 错误码清单里。请核对 DSH-0.1.2-A2-02 的码表，或标注「待确认」。`
    case 'unread-path':
      return `【cite-gate】你的回答引用了路径 \`${finding.path}\`，但本会话没有实际读取或写入过这个文件。引用未经核验的路径是幻觉的常见形状——请先 read 该文件再下结论，或把该引用标注为「待确认」。`
  }
}

/** Short summary for the injected message source field. */
export function renderSummary(finding: Finding): string {
  switch (finding.kind) {
    case 'unknown-card': return `未知卡片 ID ${finding.id}`
    case 'legacy-code': return `旧错误码 ${finding.code}`
    case 'unknown-namespaced-code': return `未知错误码 ${finding.code}`
    case 'unread-path': return `未读取路径 ${finding.path}`
  }
}
