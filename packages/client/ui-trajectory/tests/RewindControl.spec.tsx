// @vitest-environment jsdom
/**
 * RewindControl component tests (P2④ stage 2): checkpoint selection, scope
 * switching, execution with the host-bound callback, result and error
 * reporting, busy latch, and the empty state.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RewindControl, type RewindCheckpoint } from '../src/client/RewindControl.tsx'

const CHECKPOINTS: readonly RewindCheckpoint[] = [
  { seq: 3, text: 'first prompt' },
  { seq: 9, text: 'second prompt with a fairly long tail that should collapse into an ellipsis beyond the limit' },
]

const onRewind = vi.fn<(atSeq: number, mode: 'convo' | 'code' | 'both') => Promise<{ filesChanged: number; filesSkipped?: number; truncatedTo?: number }>>(
  async () => ({ filesChanged: 1, filesSkipped: 0, truncatedTo: 9 }),
)

afterEach(cleanup)

function renderControl(checkpoints: readonly RewindCheckpoint[] = CHECKPOINTS) {
  return render(<RewindControl checkpoints={checkpoints} onRewind={onRewind} />)
}

describe('RewindControl', () => {
  it('opens the panel from the toolbar button and lists checkpoints with snippets', () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: '⟲ Rewind' }))
    const items = screen.getAllByRole('option')
    expect(items.length).toBe(2)
    expect(items[0]?.textContent).toContain('#3')
    expect(items[0]?.textContent).toContain('first prompt')
    // long snippet collapses with an ellipsis
    expect(items[1]?.textContent).toContain('…')
  })

  it('reports the empty state when there are no checkpoints', () => {
    renderControl([])
    fireEvent.click(screen.getByRole('button', { name: '⟲ Rewind' }))
    expect(screen.getByText(/No user checkpoints yet/)).toBeTruthy()
  })

  it('executes with the selected checkpoint and scope, then reports the result', async () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: '⟲ Rewind' }))
    fireEvent.click(screen.getAllByRole('option')[1] ?? document.body)
    // scope defaults to both; switch to code for the call assertion
    fireEvent.click(screen.getByRole('radio', { name: 'Code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rewind' }))
    await screen.findByRole('status')
    expect(onRewind).toHaveBeenCalledWith(9, 'code')
    expect(screen.getByRole('status').textContent).toContain('1 file(s) restored')
    expect(screen.getByRole('status').textContent).toContain('conversation truncated to seq 9')
  })

  it('keeps the execute button disabled until a checkpoint is selected', () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: '⟲ Rewind' }))
    const execute = screen.getByRole('button', { name: 'Rewind' })
    expect((execute as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getAllByRole('option')[0] ?? document.body)
    expect((execute as HTMLButtonElement).disabled).toBe(false)
  })

  it('surfaces the host error text on rejection', async () => {
    onRewind.mockRejectedValueOnce(new Error('session.rewind failed: rewind-file-history-unavailable: file rewind unavailable'))
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: '⟲ Rewind' }))
    fireEvent.click(screen.getAllByRole('option')[0] ?? document.body)
    fireEvent.click(screen.getByRole('button', { name: 'Rewind' }))
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('rewind-file-history-unavailable')
  })

  it('closing and reopening the panel resets the outcome line', async () => {
    renderControl()
    const toggle = screen.getByRole('button', { name: '⟲ Rewind' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getAllByRole('option')[0] ?? document.body)
    fireEvent.click(screen.getByRole('button', { name: 'Rewind' }))
    await screen.findByRole('status')
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.queryByRole('status')).toBeNull()
    cleanup()
  })
})
