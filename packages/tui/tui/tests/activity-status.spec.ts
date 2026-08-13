import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '@huiliyi37/dsh-agent'
import type { StreamChunk } from '@huiliyi37/dsh-llm'
import {
  applyActivityEvent,
  emptyActivity,
  formatActivityDuration,
  formatActivitySummary,
  toolActivityLabel,
  type ActivityEvent,
} from '../src/activity-status.ts'

const now = 1000

function toolCall(name: string, time = now): ActivityEvent {
  return { type: 'tool-call', name, time }
}

function toolResult(time = now, error?: { name: string; code: string }): ActivityEvent {
  return error === undefined
    ? { type: 'tool-result', time }
    : { type: 'tool-result', time, error }
}

function statusEvent(status: AgentStatus, time = now): ActivityEvent {
  return { type: 'agent-status', status, time }
}

function chunkEvent(chunk: StreamChunk, time = now): ActivityEvent {
  return { type: 'assistant-chunk', chunk, time }
}

describe('emptyActivity', () => {
  it('starts idle with timestamps pinned to now', () => {
    expect(emptyActivity(now)).toEqual({
      phase: 'idle',
      startedAt: now,
      lastEventAt: now,
      status: 'idle',
    })
  })
})

describe('applyActivityEvent — tool/call projection', () => {
  it('opens a tool activity with label and active status on tool-call', () => {
    const state = applyActivityEvent(emptyActivity(now), toolCall('bash'))
    expect(state.phase).toBe('tool')
    expect(state.label).toBe('Running shell')
    expect(state.status).toBe('active')
    expect(state.startedAt).toBe(now)
  })

  it('names the tool from the model-issued name when unknown', () => {
    const state = applyActivityEvent(emptyActivity(now), toolCall('delegate_task'))
    expect(state.phase).toBe('tool')
    expect(state.label).toBe('Running delegate_task')
  })
})

describe('applyActivityEvent — tool/result projection', () => {
  it('completes the activity on a clean result', () => {
    const started = applyActivityEvent(emptyActivity(now), toolCall('bash', 1000))
    const done = applyActivityEvent(started, toolResult(9000))
    expect(done.status).toBe('completed')
    expect(done.completedAt).toBe(9000)
    expect(done.lastEventAt).toBe(9000)
  })

  it('fails the activity when the result carries an error', () => {
    const started = applyActivityEvent(emptyActivity(now), toolCall('bash', 1000))
    const failed = applyActivityEvent(started, toolResult(5000, { name: 'E2BIG', code: 'E2BIG' }))
    expect(failed.status).toBe('failed')
    expect(failed.completedAt).toBe(5000)
  })
})

describe('applyActivityEvent — agent/status + assistant/chunk projection', () => {
  it('opens a waiting activity when the agent starts running', () => {
    const state = applyActivityEvent(emptyActivity(now), statusEvent('running'))
    expect(state.phase).toBe('waiting')
    expect(state.status).toBe('active')
  })

  it('clears the activity when the agent returns to idle', () => {
    const running = applyActivityEvent(emptyActivity(now), statusEvent('running'))
    const idle = applyActivityEvent(running, statusEvent('idle'))
    expect(idle.phase).toBe('idle')
    expect(idle.status).toBe('idle')
  })

  it('labels reasoning chunks as thinking', () => {
    const running = applyActivityEvent(emptyActivity(now), statusEvent('running'))
    const state = applyActivityEvent(running, chunkEvent({ type: 'reasoning-delta', text: 'think', index: 0 }))
    expect(state.phase).toBe('thinking')
  })

  it('labels text deltas as streaming', () => {
    const running = applyActivityEvent(emptyActivity(now), statusEvent('running'))
    const state = applyActivityEvent(running, chunkEvent({ type: 'text-delta', text: 'hello', index: 0 }))
    expect(state.phase).toBe('streaming')
  })

  it('activates a fresh idle activity on the first assistant chunk', () => {
    const state = applyActivityEvent(emptyActivity(now), chunkEvent({ type: 'text-delta', text: 'hi', index: 0 }))
    expect(state.status).toBe('active')
    expect(state.phase).toBe('streaming')
  })

  it('keeps a completed activity when the agent starts running again', () => {
    const started = applyActivityEvent(emptyActivity(now), toolCall('bash', 1000))
    const done = applyActivityEvent(started, toolResult(4000))
    const after = applyActivityEvent(done, statusEvent('running', 5000))
    expect(after).toEqual({ ...done, lastEventAt: 5000 })
  })
})

describe('applyActivityEvent — turn boundary', () => {
  it('clears activity at turn/end', () => {
    const started = applyActivityEvent(emptyActivity(now), toolCall('bash', 1000))
    const cleared = applyActivityEvent(started, { type: 'turn-end', time: 8000 })
    expect(cleared.phase).toBe('idle')
    expect(cleared.status).toBe('idle')
  })
})

describe('formatActivityDuration', () => {
  it('formats durations without fake precision', () => {
    expect(formatActivityDuration(0)).toBe('0s')
    expect(formatActivityDuration(59_000)).toBe('59s')
    expect(formatActivityDuration(61_000)).toBe('1m 1s')
  })
})

describe('formatActivitySummary', () => {
  it('returns undefined for an idle activity', () => {
    expect(formatActivitySummary(emptyActivity(now), now)).toBeUndefined()
  })

  it('summarises a running activity with elapsed time', () => {
    const started = applyActivityEvent(emptyActivity(1000), toolCall('bash', 1000))
    const summary = formatActivitySummary(started, 4000)
    expect(summary).toContain('Running shell')
    expect(summary).toContain('3s')
  })

  it('summarises a completed activity', () => {
    const started = applyActivityEvent(emptyActivity(1000), toolCall('bash', 1000))
    const done = applyActivityEvent(started, toolResult(4000))
    expect(formatActivitySummary(done, 4000)).toBe('Running shell completed in 3s')
  })

  it('falls back to a generic label for a running activity without one', () => {
    const active = applyActivityEvent(emptyActivity(1000), chunkEvent({ type: 'text-delta', text: 'hi', index: 0 }, 1000))
    expect(formatActivitySummary(active, 4000)).toBe('Activity · 3s')
  })

  it('summarises a failed activity', () => {
    const started = applyActivityEvent(emptyActivity(1000), toolCall('bash', 1000))
    const failed = applyActivityEvent(started, toolResult(4000, { name: 'E2BIG', code: 'E2BIG' }))
    expect(formatActivitySummary(failed, 4000)).toBe('Running shell failed in 3s')
  })

  it('falls back to now when no completion time is recorded', () => {
    const done = { ...emptyActivity(1000), status: 'completed' as const }
    expect(formatActivitySummary(done, 4000)).toBe('Activity completed in 3s')
  })
})

describe('toolActivityLabel', () => {
  it('maps known tools to human labels', () => {
    expect(toolActivityLabel('read_file')).toBe('Reading file')
    expect(toolActivityLabel('write_file')).toBe('Writing file')
    expect(toolActivityLabel('edit_file')).toBe('Editing file')
    expect(toolActivityLabel('bash')).toBe('Running shell')
    expect(toolActivityLabel('run_tests')).toBe('Running tests')
  })

  it('falls back to the raw tool name', () => {
    expect(toolActivityLabel('obscure_tool')).toBe('Running obscure_tool')
  })
})
