import { describe, expect, it, vi } from 'vitest'
import {
  DSH_TELEMETRY_ENDPOINT,
  SecretRedactor,
  TELEMETRY_SCHEMA_VERSION,
  TelemetryReporter,
  type AnonymousId,
  type ConsentDecision,
  type TelemetryPayload,
} from '@deepseek-ai/dsh-telemetry'

const ALLOW: ConsentDecision = { allowed: true, reason: 'enabled' }
const DENY: ConsentDecision = { allowed: false, reason: 'disabled' }
const anon = (value = 'anon-123'): (() => Promise<AnonymousId>) => async () => value as AnonymousId

function okResponse(): Response {
  return { ok: true } as Response
}

describe('TelemetryReporter.report', () => {
  it('skips delivery when consent is denied', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    const reporter = new TelemetryReporter({ fetch: fetchMock, anonymousId: anon() })
    reporter.report({ command: 'build', durationMs: 1, success: true }, DENY)
    await reporter.flush(50)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts a redacted envelope when consent is granted', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(okResponse()))
    const reporter = new TelemetryReporter({
      endpoint: 'https://collector.test/telemetry',
      fetch: fetchMock,
      anonymousId: anon('anon-xyz'),
      redactor: new SecretRedactor(),
      now: () => 0,
      timeoutMs: 100,
    })
    const payload: TelemetryPayload = {
      command: 'config',
      durationMs: 7,
      success: true,
      cordisYmlContent: 'apiKey: sk-abcdefghij1234567890\nname: \'@deepseek-ai/dsh-llm-deepseek\'\n',
      packageJsonContent: '{ "name": "app" }',
    }
    reporter.report(payload, ALLOW)
    await reporter.flush(50)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]!
    expect(call[0]).toBe('https://collector.test/telemetry')
    const init = call[1]!
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.schemaVersion).toBe(TELEMETRY_SCHEMA_VERSION)
    expect(body.anonymousId).toBe('anon-xyz')
    expect(body.sentAt).toBe('1970-01-01T00:00:00.000Z')
    expect(body.command).toBe('config')
    expect(body.cordisYmlContent).not.toContain('sk-abcdefghij1234567890')
    expect(body.cordisYmlContent).toContain('@deepseek-ai/dsh-llm-deepseek')
    expect(body.packageJsonContent).toContain('app')
  })

  it('posts an envelope without content fields when they are absent', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(okResponse()))
    const reporter = new TelemetryReporter({ fetch: fetchMock, anonymousId: anon(), now: () => 0, timeoutMs: 100 })
    reporter.report({ command: 'start', durationMs: 2, success: true }, ALLOW)
    await reporter.flush(50)
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<string, unknown>
    expect('cordisYmlContent' in body).toBe(false)
    expect('packageJsonContent' in body).toBe(false)
  })

  it('swallows a non-OK HTTP status', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503 } as Response))
    const reporter = new TelemetryReporter({ fetch: fetchMock, anonymousId: anon(), timeoutMs: 100 })
    reporter.report({ command: 'dev', durationMs: 3, success: true }, ALLOW)
    await expect(reporter.flush(50)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('swallows a transport failure', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('network down') })
    const reporter = new TelemetryReporter({ fetch: fetchMock, anonymousId: anon(), timeoutMs: 100 })
    reporter.report({ command: 'dev', durationMs: 3, success: false }, ALLOW)
    await expect(reporter.flush(50)).resolves.toBeUndefined()
  })

  it('swallows a non-Error transport rejection', async () => {
    const fetchMock = vi.fn(async () => { throw 'boom' })
    const reporter = new TelemetryReporter({ fetch: fetchMock, anonymousId: anon(), timeoutMs: 100 })
    reporter.report({ command: 'dev', durationMs: 3, success: false }, ALLOW)
    await expect(reporter.flush(50)).resolves.toBeUndefined()
  })

  it('swallows a failure while resolving the anonymous id, never sending', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    const reporter = new TelemetryReporter({
      fetch: fetchMock,
      anonymousId: async () => { throw new Error('config unwritable') },
      timeoutMs: 100,
    })
    reporter.report({ command: 'build', durationMs: 1, success: true }, ALLOW)
    await reporter.flush(50)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('TelemetryReporter.flush', () => {
  it('returns immediately when nothing is in flight', async () => {
    const reporter = new TelemetryReporter({ fetch: vi.fn(async () => okResponse()), anonymousId: anon() })
    await expect(reporter.flush()).resolves.toBeUndefined()
  })

  it('resolves on the timeout cap when a send never settles', async () => {
    const reporter = new TelemetryReporter({
      fetch: () => new Promise<Response>(() => {}),
      anonymousId: anon(),
      timeoutMs: 10,
    })
    reporter.report({ command: 'start', durationMs: 1, success: true }, ALLOW)
    const started = Date.now()
    await reporter.flush(15)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('TelemetryReporter defaults', () => {
  it('defaults the endpoint and transport seams without options', () => {
    const reporter = new TelemetryReporter()
    expect(reporter).toBeInstanceOf(TelemetryReporter)
    expect(DSH_TELEMETRY_ENDPOINT).toContain('.invalid')
  })
})
