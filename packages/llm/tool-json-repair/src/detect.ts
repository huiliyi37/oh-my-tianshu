/**
 * Detect one tool call serialized as a whole JSON object inside model text
 * content — the DeepSeek failure shape where tool calls arrive in `content`
 * instead of the `tool_calls` wire field. Deliberately fail-closed: only a
 * text block that is EXACTLY one object with a clean non-empty string `name`
 * converts; prose, truncated JSON, arrays, and multi-object blocks stay text.
 * @module @huiliyi37/dsh-tool-json-repair/detect
 */

/** One repaired tool call: the name plus a lossless-JSON arguments string. */
export interface DetectedToolCall {
  /** Tool name taken from the JSON `name` field (already trim-checked by the caller contract). */
  name: string
  /** Serialized `arguments` value; an absent field becomes `{}`. */
  arguments: string
}

/** Detection controls; `maxBlockChars` bounds the scan, never the surrounding stream. */
export interface DetectOptions {
  /** Accept a single ```json … ``` code fence around the object. */
  allowFenced: boolean
  /** Text longer than this never converts (bounds the parse attempt). */
  maxBlockChars: number
}

/**
 * Repair invalid backslash escape sequences inside JSON string literals.
 * Ported from opencode-tui `src/api/json-escape-repair.ts` (Apache-2.0),
 * adapted only in module shape: models writing Windows paths emit raw
 * backslashes (`"F:\tmp"`) where `\t` is not a valid JSON escape, so
 * `JSON.parse` rejects the whole buffer. Doubling only the INVALID escapes
 * (`\x` → `\\x`) recovers the literal backslash without touching legitimate
 * escapes (`\n`, `\"`, `\\`, `\uXXXX`). The one known-unfixable ambiguity —
 * a path ending in a backslash right before the closing quote (`"F:\"`) —
 * is left alone, because it cannot be distinguished from a legitimate
 * escaped quote.
 * @param raw - the JSON text to scan.
 * @returns the repaired text, or null when nothing needed repair.
 */
const VALID_SINGLE_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't'])
const HEX4_RE = /^[0-9a-fA-F]{4}/

function repairInvalidJsonEscapes(raw: string): string | null {
  let out = ''
  let inString = false
  let changed = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === undefined) break
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (ch === '"') {
      inString = false
      out += ch
      continue
    }
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = raw[i + 1]
    if (next !== undefined && VALID_SINGLE_ESCAPES.has(next)) {
      out += ch + next
      i++
      continue
    }
    if (next === 'u' && HEX4_RE.test(raw.slice(i + 2, i + 6))) {
      out += ch
      continue
    }
    // Invalid escape — the model meant a literal backslash. Double it.
    out += '\\\\'
    changed = true
  }
  return changed ? out : null
}

/**
 * `JSON.parse` with an invalid-escape-repair fallback, restricted to plain
 * objects. Returns the parsed object, or null when the text is unparseable
 * even after repair (or parses to a non-object such as an array or scalar).
 * @param raw - the candidate JSON text.
 * @returns the parsed object, or null.
 */
function parseJsonObjectWithEscapeRepair(raw: string): Record<string, unknown> | null {
  for (const candidate of [raw, repairInvalidJsonEscapes(raw)]) {
    if (candidate === null) continue
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch { /* the repaired candidate is next; both failing means not JSON */ }
  }
  return null
}

/**
 * Strip one ```json / ``` fence when it wraps the whole candidate. A fence
 * with an unknown language tag, an unclosed fence, or an embedded fence
 * marker does not strip (fail-closed toward leaving the text alone).
 * @param text - the already-trimmed candidate text.
 * @returns the inner text, or undefined when the fence is not a clean wrap.
 */
function stripSingleFence(text: string): string | undefined {
  if (!text.startsWith('```')) return undefined
  const newline = text.indexOf('\n')
  const language = newline === -1 ? '' : text.slice(3, newline).trim()
  if (language !== '' && language !== 'json') return undefined
  const body = newline === -1 ? text.slice(3) : text.slice(newline + 1)
  const trimmed = body.trimEnd()
  if (!trimmed.endsWith('```')) return undefined
  const inner = trimmed.slice(0, -3)
  if (inner.includes('```')) return undefined
  return inner.trim()
}

/**
 * Detect one tool-call JSON object inside a completed text block.
 * @param text - the complete text block content.
 * @param options - {@link DetectOptions}; both fields come from validated plugin config.
 * @returns the detected call, or undefined when the block is not exactly one call object.
 */
export function detectToolCallJson(text: string, options: DetectOptions): DetectedToolCall | undefined {
  if (text.length > options.maxBlockChars) return undefined
  let candidate = text.trim()
  if (options.allowFenced) {
    const fenced = stripSingleFence(candidate)
    if (fenced !== undefined) candidate = fenced
  }
  const parsed = parseJsonObjectWithEscapeRepair(candidate)
  if (parsed === null) return undefined
  const name = parsed['name']
  // A registered tool name never carries surrounding whitespace: requiring
  // the field to be already clean keeps a stray-space name as text instead
  // of guessing a normalization the model did not write.
  if (typeof name !== 'string' || name.length === 0 || name !== name.trim()) return undefined
  const argumentsValue = 'arguments' in parsed ? parsed['arguments'] : {}
  let argumentsText: string
  try {
    argumentsText = JSON.stringify(argumentsValue)
  } catch {
    // Unreachable for JSON.parse output, but the guard keeps the contract
    // explicit: a value that cannot re-serialize never becomes a call.
    return undefined
  }
  return { name, arguments: argumentsText }
}
