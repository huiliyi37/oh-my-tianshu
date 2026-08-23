import { describe, expect, it } from 'vitest'
import { formatCacheMissReason, isReportableMiss } from '../src/cache-telemetry.ts'
import type { CacheHealthWire } from '../src/cache-telemetry.ts'

describe('formatCacheMissReason', () => {
  it('maps prefix_truncation to a truncated-prefix label', () => {
    const info = formatCacheMissReason('prefix_truncation')!
    expect(info.label).toBe('截断')
    expect(info.detail).toContain('前缀截断')
  })

  it('maps prefix_drift to a drift label', () => {
    const info = formatCacheMissReason('prefix_drift')!
    expect(info.label).toBe('漂移')
    expect(info.detail).toContain('前缀漂移')
  })

  it('maps cache_eviction to an eviction label', () => {
    const info = formatCacheMissReason('cache_eviction')!
    expect(info.label).toBe('驱逐')
    expect(info.detail).toContain('驱逐')
  })

  it('returns undefined for expected-operation reasons (first_turn, normal_growth, compaction)', () => {
    expect(formatCacheMissReason('first_turn')).toBeUndefined()
    expect(formatCacheMissReason('normal_growth')).toBeUndefined()
    expect(formatCacheMissReason('compaction')).toBeUndefined()
  })

  it('returns undefined for an unknown reason', () => {
    expect(formatCacheMissReason('mystery')).toBeUndefined()
  })
})

describe('isReportableMiss', () => {
  it('reports warn/error-grade misses', () => {
    expect(isReportableMiss('prefix_truncation')).toBe(true)
    expect(isReportableMiss('prefix_drift')).toBe(true)
    expect(isReportableMiss('cache_eviction')).toBe(true)
  })

  it('does not report info-grade or unknown reasons', () => {
    expect(isReportableMiss('first_turn')).toBe(false)
    expect(isReportableMiss('normal_growth')).toBe(false)
    expect(isReportableMiss('compaction')).toBe(false)
    expect(isReportableMiss('mystery')).toBe(false)
  })
})

describe('CacheHealthWire shape', () => {
  it('accepts the projection wire shape with optional fields', () => {
    const health: CacheHealthWire = {
      hitRate: 0.97,
      recentTurnHitRate: 0.5,
      lastMissReason: 'prefix_truncation',
      drift: { systemChanged: true, toolsChanged: false, configChanged: false },
    }
    expect(health.hitRate).toBe(0.97)
    expect(health.lastMissReason).toBe('prefix_truncation')
    expect(health.drift?.systemChanged).toBe(true)
  })

  it('accepts an empty projection (no usage yet)', () => {
    const health: CacheHealthWire = {}
    expect(formatCacheMissReason(health.lastMissReason ?? '')).toBeUndefined()
    expect(isReportableMiss(health.lastMissReason ?? '')).toBe(false)
  })
})
