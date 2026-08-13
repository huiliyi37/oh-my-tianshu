/**
 * Conservative secret redactor: the safety backstop that scrubs credential-like
 * values from telemetry content before it leaves the machine.
 *
 * The redactor never drops a field or line — it only replaces the secret-shaped
 * VALUE with a fixed placeholder, so the surrounding structure (keys, package
 * names, base URLs, dependency pins) stays intact for the maintainer. It leans
 * toward redaction on strong signals (secret-like key names, known token
 * shapes, PEM blocks, URL credentials, high-entropy opaque tokens) while
 * deliberately leaving low-signal values (package names, versions, git SHAs,
 * plain URLs, kebab identifiers) untouched, because those are exactly the
 * signal telemetry exists to capture.
 *
 * @module @deepseek-ai/dsh-telemetry/secret-redactor
 */

/** Default text substituted for a detected secret. */
export const DEFAULT_REDACTION_PLACEHOLDER = '[REDACTED]'

/** Default minimum length for the high-entropy opaque-token heuristic. */
export const DEFAULT_MIN_TOKEN_LENGTH = 24

/** Default Shannon-entropy threshold (bits/char) that marks an opaque token secret. */
export const DEFAULT_ENTROPY_THRESHOLD = 4

/** Tuning for {@link SecretRedactor}; every field defaults to a documented constant. */
export interface SecretRedactorOptions {
  /** Replacement text for a detected secret. */
  placeholder?: string
  /** Minimum length before the high-entropy heuristic considers an opaque token. */
  minTokenLength?: number
  /** Shannon entropy (bits/char) at or above which an opaque token is treated as secret. */
  entropyThreshold?: number
}

/**
 * Regexes for well-known credential shapes. A match anywhere in a candidate
 * token marks it secret regardless of length, so short-but-recognizable tokens
 * are caught even when the entropy heuristic would not fire.
 */
const KNOWN_SECRET_PATTERNS: readonly RegExp[] = [
  /sk-(?:ant-)?[A-Za-z0-9_-]{10,}/, // OpenAI / DeepSeek / Anthropic style
  /gh[pousr]_[A-Za-z0-9]{16,}/, // GitHub personal/oauth/server/refresh tokens
  /github_pat_[A-Za-z0-9_]{20,}/, // GitHub fine-grained PAT
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /AIza[0-9A-Za-z_-]{35}/, // Google API key
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
]

/**
 * Key names (normalized to lowercase, separators stripped) whose value is a
 * secret. Split by match strategy so short/ambiguous words do not over-match:
 * `author` must not trip the `auth` rule.
 */
const KEY_SUBSTRING_INDICATORS: readonly string[] = [
  'password', 'passwd', 'passphrase', 'secret', 'apikey', 'apisecret',
  'clientsecret', 'privatekey', 'secretkey', 'accesskey', 'credential',
  'connectionstring', 'sastoken', 'xapikey', 'authtoken', 'accesstoken',
  'refreshtoken', 'idtoken', 'sessiontoken', 'bearertoken',
]
const KEY_SUFFIX_INDICATORS: readonly string[] = ['token']
const KEY_EXACT_INDICATORS: readonly string[] = [
  'auth', 'authorization', 'cookie', 'bearer', 'dsn', 'signature',
]

/**
 * Whether a key name marks its value as a secret.
 * @param key - raw object key or assignment name.
 * @returns whether the value under this key must be redacted.
 */
export function keyLooksSecret(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (normalized.length === 0) return false
  if (KEY_SUBSTRING_INDICATORS.some(indicator => normalized.includes(indicator))) return true
  if (KEY_SUFFIX_INDICATORS.some(indicator => normalized.endsWith(indicator))) return true
  return KEY_EXACT_INDICATORS.includes(normalized)
}

/** Shannon entropy in bits per character. */
function shannonEntropy(value: string): number {
  const counts = new Map<string, number>()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const probability = count / value.length
    entropy -= probability * Math.log2(probability)
  }
  return entropy
}

/** Opaque-token character set (base64/base64url plus common token punctuation). */
const OPAQUE_TOKEN = /^[A-Za-z0-9+/=_.-]+$/
/** Version-like leader kept visible (dependency pins, semver). */
const VERSION_LIKE = /^v?\d+(?:\.\d+)+/

/**
 * Conservative secret detector and redactor for telemetry content.
 * Detection is a pure function of the input; construction only fixes tunables.
 */
export class SecretRedactor {
  readonly #placeholder: string
  readonly #minTokenLength: number
  readonly #entropyThreshold: number

  /** @param options - placeholder text and heuristic thresholds. */
  constructor(options: SecretRedactorOptions = {}) {
    this.#placeholder = options.placeholder ?? DEFAULT_REDACTION_PLACEHOLDER
    this.#minTokenLength = options.minTokenLength ?? DEFAULT_MIN_TOKEN_LENGTH
    this.#entropyThreshold = options.entropyThreshold ?? DEFAULT_ENTROPY_THRESHOLD
  }

  /**
   * Whether a standalone token value looks like a secret.
   * @param value - candidate token, already trimmed of surrounding quotes.
   * @returns whether the value should be redacted on its own merits.
   */
  isSecretValue(value: string): boolean {
    if (KNOWN_SECRET_PATTERNS.some(pattern => pattern.test(value))) return true
    if (value.length < this.#minTokenLength) return false
    if (!OPAQUE_TOKEN.test(value)) return false
    // Git SHAs and integrity digests are hex and public — never a secret we hide.
    if (/^[0-9a-fA-F]+$/.test(value)) return false
    if (VERSION_LIKE.test(value)) return false
    const classes = (/[a-z]/.test(value) ? 1 : 0) + (!/[A-Z]/.test(value) ? 0 : 1) + (/[0-9]/.test(value) ? 1 : 0)
    return classes >= 3 || shannonEntropy(value) >= this.#entropyThreshold
  }

  /**
   * Deep-redact a parsed value in place-safe fashion, returning a new structure.
   * A secret-named key redacts its string value outright; every other string is
   * judged on its own shape. Non-string leaves pass through untouched.
   * @param value - parsed JSON-like value (object, array, or primitive).
   * @returns a structurally identical value with secret strings replaced.
   */
  redactValue<T>(value: T): T {
    return this.#redactNode(value, false) as T
  }

  #redactNode(value: unknown, keyIsSecret: boolean): unknown {
    if (typeof value === 'string') {
      return keyIsSecret || this.isSecretValue(value) ? this.#placeholder : value
    }
    if (Array.isArray(value)) return value.map(item => this.#redactNode(item, false))
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, this.#redactNode(child, keyLooksSecret(key))]),
      )
    }
    return value
  }

  /**
   * Redact secrets embedded in raw text (YAML, JSON, or `.env`-style content),
   * preserving every line and key while replacing only secret-shaped values.
   * @param text - raw file or message text.
   * @returns text with detected secrets replaced by the placeholder.
   */
  redactText(text: string): string {
    let output = this.#redactPemBlocks(text)
    output = this.#redactAssignments(output)
    output = this.#redactUrlCredentials(output)
    output = this.#redactBearerTokens(output)
    return this.#redactStandaloneTokens(output)
  }

  #redactPemBlocks(text: string): string {
    return text.replace(
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
      this.#placeholder,
    )
  }

  #redactAssignments(text: string): string {
    // `key: value`, `key = value`, or `"key": "value"` across YAML/JSON/.env.
    return text.replace(
      /("?)([A-Za-z0-9_.-]+)\1(\s*[:=]\s*)(["']?)([^\n\r"']+)\4/g,
      (match, keyQuote: string, key: string, separator: string, valueQuote: string, value: string) =>
        keyLooksSecret(key) && value.trim().length > 0
          ? `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${this.#placeholder}${valueQuote}`
          : match,
    )
  }

  #redactUrlCredentials(text: string): string {
    // Redact only the password in `scheme://user:password@host`, keeping host visible.
    return text.replace(
      /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s/@]+)(@)/gi,
      (_match, prefix: string, _password: string, at: string) => `${prefix}${this.#placeholder}${at}`,
    )
  }

  #redactBearerTokens(text: string): string {
    // The candidate must contain a digit: real bearer credentials are never
    // letters-only, while prose like "bearer authentication" is.
    return text.replace(
      /(bearer\s+)((?=[a-z._-]*[0-9])[a-z0-9._-]{8,})/gi,
      (_match, prefix: string) => `${prefix}${this.#placeholder}`,
    )
  }

  #redactStandaloneTokens(text: string): string {
    // `/` is excluded so package names, file paths, and URLs are never split or
    // redacted; a secret containing `/` is still scrubbed piecewise.
    return text.replace(/[A-Za-z0-9][A-Za-z0-9+=_.-]{7,}/g, token =>
      this.isSecretValue(token) ? this.#placeholder : token)
  }
}
