/**
 * error-recovery — 错误终态的分类「下一步」指引与回填告知
 * （回流 opencode-tui 807686a02，分类面适配本仓 LlmFailure 事实）。
 */
import { describe, expect, it } from 'vitest'
import { errorRecoveryGuidance, errorRefillNotice } from '../src/format/error-recovery.js'

describe('errorRecoveryGuidance', () => {
  it('认证类（401/403/AUTH）指向 /key', () => {
    expect(errorRecoveryGuidance({ message: 'bad key', code: 'AUTH', status: 401 })).toContain('/key')
    expect(errorRecoveryGuidance({ message: 'forbidden', code: 'PROVIDER', status: 403 })).toContain('/key')
  })

  it('限流/额度（402/429）建议等待或切轻量档', () => {
    const g = errorRecoveryGuidance({ message: 'rate limited', code: 'RATE', status: 429 })
    expect(g).toContain('/model')
    expect(g).toContain('429')
  })

  it('5xx 指向稍后重发/换供应商；上下文超限指向 /compact', () => {
    expect(errorRecoveryGuidance({ message: 'boom', code: 'PROVIDER', status: 503 })).toContain('供应商')
    expect(errorRecoveryGuidance({ message: 'too long', code: 'CONTEXT_WINDOW_EXCEEDED' })).toContain('/compact')
  })

  it('网络类（timeout/ECONNRESET/fetch failed）指向网络与 /doctor', () => {
    expect(errorRecoveryGuidance({ message: 'fetch failed', code: 'NETWORK' })).toContain('/doctor')
    expect(errorRecoveryGuidance({ message: 'request timeout', code: 'X' })).toContain('网络')
  })

  it('请求被拒（400/404/INVALID_REQUEST/NO_ADAPTER）指向 /model 与 baseUrl', () => {
    expect(errorRecoveryGuidance({ message: 'nope', code: 'INVALID_REQUEST', status: 404 })).toContain('/model')
    expect(errorRecoveryGuidance({ message: 'no adapter', code: 'NO_ADAPTER' })).toContain('baseUrl')
  })

  it('流异常与未知错误给兜底指引', () => {
    expect(errorRecoveryGuidance({ message: 'x', code: 'STREAM_CLOSED' })).toContain('重发')
    expect(errorRecoveryGuidance({ message: '?', code: 'UNKNOWN' })).toContain('/doctor')
  })
})

describe('errorRefillNotice', () => {
  it('告知回填语义', () => {
    expect(errorRefillNotice()).toContain('回填')
  })
})
