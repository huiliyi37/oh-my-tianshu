import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENTROPY_THRESHOLD,
  DEFAULT_MIN_TOKEN_LENGTH,
  DEFAULT_REDACTION_PLACEHOLDER,
  SecretRedactor,
  keyLooksSecret,
} from '@deepseek-ai/dsh-telemetry'

const REDACTED = DEFAULT_REDACTION_PLACEHOLDER

describe('exported defaults', () => {
  it('expose the documented tunable defaults', () => {
    expect(DEFAULT_REDACTION_PLACEHOLDER).toBe('[REDACTED]')
    expect(DEFAULT_MIN_TOKEN_LENGTH).toBe(24)
    expect(DEFAULT_ENTROPY_THRESHOLD).toBe(4)
  })
})

describe('keyLooksSecret', () => {
  it('matches secret substrings across casings and separators', () => {
    for (const key of ['password', 'API_KEY', 'apiKey', 'clientSecret', 'x-api-key', 'privateKey', 'CREDENTIALS']) {
      expect(keyLooksSecret(key)).toBe(true)
    }
  })

  it('matches *token as a suffix but not tokenizer', () => {
    expect(keyLooksSecret('accessToken')).toBe(true)
    expect(keyLooksSecret('token')).toBe(true)
    expect(keyLooksSecret('tokenizer')).toBe(false)
  })

  it('matches short ambiguous words only as whole keys', () => {
    expect(keyLooksSecret('auth')).toBe(true)
    expect(keyLooksSecret('authorization')).toBe(true)
    expect(keyLooksSecret('cookie')).toBe(true)
    expect(keyLooksSecret('author')).toBe(false)
  })

  it('does not match ordinary config keys', () => {
    for (const key of ['name', 'version', 'model', 'baseURL', 'timeout', 'path', 'pass']) {
      expect(keyLooksSecret(key)).toBe(false)
    }
  })

  it('returns false for a key with no alphanumerics', () => {
    expect(keyLooksSecret('---')).toBe(false)
  })
})

describe('SecretRedactor.isSecretValue', () => {
  const redactor = new SecretRedactor()

  it('detects known token shapes regardless of length', () => {
    expect(redactor.isSecretValue('sk-abcdefghij1234567890')).toBe(true)
    expect(redactor.isSecretValue('sk-ant-abcdefghij1234567890')).toBe(true)
    expect(redactor.isSecretValue('ghp_abcdefghijklmnop1234')).toBe(true)
    expect(redactor.isSecretValue('github_pat_abcdefghijklmnopqrst')).toBe(true)
    expect(redactor.isSecretValue('xoxb-abcdefghij-klmno')).toBe(true)
    expect(redactor.isSecretValue('AKIA1234567890ABCDEF')).toBe(true)
    expect(redactor.isSecretValue(`AIza${'a'.repeat(35)}`)).toBe(true)
    expect(redactor.isSecretValue('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop')).toBe(true)
  })

  it('detects high-entropy opaque tokens with three character classes', () => {
    // Non-hex letters keep it off the hex-digest exemption; three classes trip the rule.
    expect(redactor.isSecretValue('zX9zX9zX9zX9zX9zX9zX9zX9')).toBe(true)
  })

  it('detects high-entropy opaque tokens by entropy even within two classes', () => {
    // 30 distinct lowercase+digit chars: entropy ~4.9, only two classes.
    const token = 'abcdefghijklmnopqrstuvwxyz0123'
    expect(token.length).toBeGreaterThanOrEqual(DEFAULT_MIN_TOKEN_LENGTH)
    expect(redactor.isSecretValue(token)).toBe(true)
  })

  it('leaves short values, non-opaque text, hex digests, and versions untouched', () => {
    expect(redactor.isSecretValue('deepseek-chat')).toBe(false) // short
    expect(redactor.isSecretValue('a token with spaces here!!')).toBe(false) // not opaque
    expect(redactor.isSecretValue('a'.repeat(40))).toBe(false) // low entropy, one class
    expect(redactor.isSecretValue('abcdef0123456789abcdef0123456789abcdef01')).toBe(false) // 40-hex git SHA
    expect(redactor.isSecretValue('1.2.3.4.5.6.7.8.9.10.11.12')).toBe(false) // version-like
    expect(redactor.isSecretValue('ZXQPZXQPZXQPZXQPZXQPZXQP')).toBe(false) // uppercase only, low entropy
  })

  it('honors a custom entropy threshold', () => {
    const strict = new SecretRedactor({ entropyThreshold: 100 })
    // Two-class token can no longer trip the entropy branch under an impossible threshold.
    expect(strict.isSecretValue('abcdefghijklmnopqrstuvwxyz0123')).toBe(false)
  })
})

describe('SecretRedactor.redactValue', () => {
  const redactor = new SecretRedactor()

  it('redacts secret-keyed strings and secret-shaped strings, keeping structure', () => {
    const result = redactor.redactValue({
      apiKey: 'short-not-shaped',
      name: 'my-package',
      token: 'sk-abcdefghij1234567890',
      count: 3,
      enabled: true,
      missing: null,
      nested: { password: 'p', note: 'plain text value' },
      list: ['harmless', 'sk-abcdefghij1234567890'],
    })
    expect(result).toEqual({
      apiKey: REDACTED, // redacted by key even though the value is not secret-shaped
      name: 'my-package',
      token: REDACTED,
      count: 3,
      enabled: true,
      missing: null,
      nested: { password: REDACTED, note: 'plain text value' },
      list: ['harmless', REDACTED],
    })
  })

  it('redacts a top-level secret string and passes through primitives', () => {
    expect(redactor.redactValue('sk-abcdefghij1234567890')).toBe(REDACTED)
    expect(redactor.redactValue('plain')).toBe('plain')
    expect(redactor.redactValue(42)).toBe(42)
    expect(redactor.redactValue(null)).toBeNull()
  })
})

describe('SecretRedactor.redactText', () => {
  const redactor = new SecretRedactor()

  it('redacts PEM private key blocks', () => {
    const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\ndef==\n-----END RSA PRIVATE KEY-----'
    expect(redactor.redactText(text)).toBe(REDACTED)
  })

  it('redacts secret-keyed assignments across YAML, JSON, and .env', () => {
    expect(redactor.redactText('password: hunter2')).toBe(`password: ${REDACTED}`)
    expect(redactor.redactText('apiKey: "sk-abcdefghij1234567890"')).toBe(`apiKey: "${REDACTED}"`)
    expect(redactor.redactText('"token": "abcdefgh"')).toBe(`"token": "${REDACTED}"`)
    expect(redactor.redactText('API_KEY=sk-abcdefghij1234567890')).toBe(`API_KEY=${REDACTED}`)
  })

  it('keeps non-secret assignments and whitespace-only secret values intact', () => {
    expect(redactor.redactText('model: deepseek-chat')).toBe('model: deepseek-chat')
    expect(redactor.redactText('password:   \n')).toBe('password:   \n')
  })

  it('redacts only the password in URL credentials, keeping the host', () => {
    expect(redactor.redactText('url: https://user:s3cretPass@api.deepseek.com/v1'))
      .toBe(`url: https://user:${REDACTED}@api.deepseek.com/v1`)
  })

  it('redacts bearer tokens embedded in free text', () => {
    expect(redactor.redactText('sending Bearer abcdefgh12345678 now'))
      .toBe(`sending Bearer ${REDACTED} now`)
  })

  it('keeps letters-only prose after the word bearer intact', () => {
    expect(redactor.redactText('uses bearer authentication for requests'))
      .toBe('uses bearer authentication for requests')
    expect(redactor.redactText('"description": "bearer token-helper middleware"'))
      .toBe('"description": "bearer token-helper middleware"')
  })

  it('redacts standalone secret-shaped tokens while keeping package names and paths', () => {
    expect(redactor.redactText('key sk-abcdefghij1234567890 end'))
      .toBe(`key ${REDACTED} end`)
    expect(redactor.redactText('name: @deepseek-ai/dsh-telemetry')).toBe('name: @deepseek-ai/dsh-telemetry')
    expect(redactor.redactText('path: ./plugins/local-plugin/src/index.ts'))
      .toBe('path: ./plugins/local-plugin/src/index.ts')
  })

  it('is idempotent on already-redacted text', () => {
    const once = redactor.redactText('password: hunter2')
    expect(redactor.redactText(once)).toBe(once)
  })
})
