// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('Tooltip', () => {
  it('can delay pointer hover without delaying keyboard focus', () => {
    vi.useFakeTimers()
    try {
      render(
        <Tooltip label="Timing details" delayMs={500}>
          <button type="button">anchor</button>
        </Tooltip>,
      )
      const anchor = screen.getByText('anchor')
      fireEvent.mouseEnter(anchor)
      act(() => { vi.advanceTimersByTime(499) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.mouseLeave(anchor)
      act(() => { vi.advanceTimersByTime(1) })
      expect(screen.queryByRole('tooltip')).toBeNull()
      fireEvent.mouseEnter(anchor)
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByRole('tooltip').textContent).toBe('Timing details')
      fireEvent.mouseLeave(anchor)
      fireEvent.focus(anchor)
      expect(screen.getByRole('tooltip').textContent).toBe('Timing details')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the bubble to the right on hover and hides it on leave', () => {
    render(
      <Tooltip label="Open sidebar">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    const bubble = screen.getByRole('tooltip')
    expect(bubble.textContent).toBe('Open sidebar')
    expect(bubble.getAttribute('data-side')).toBe('right')
    // jsdom rects are all-zero: right placement lands at the +10 gutter, then
    // the zero-width measured rect clamps to the 12px edge margin (10 + 12).
    expect(bubble.style.left).toBe('22px')
    expect(bubble.style.top).toBe('0px')
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('supports bottom placement and the focus/blur channel', () => {
    render(
      <Tooltip label="Below" side="bottom">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    fireEvent.focus(anchor)
    const bubble = screen.getByRole('tooltip')
    expect(bubble.getAttribute('data-side')).toBe('bottom')
    // Zero-width jsdom rect at x=0 clamps to the 12px edge margin.
    expect(bubble.style.left).toBe('12px')
    expect(bubble.style.top).toBe('8px')
    fireEvent.blur(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  // jsdom's default rects are all-zero, so the clamp tests stub the measured
  // rect (anchor and bubble share the prototype stub) and derive expectations
  // from it: pos.x = anchor center, then shifted by the measured overflow.
  const rect = (left: number, right: number): DOMRect =>
    ({ left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0, toJSON: () => ({}) })

  it('clamps a bubble overflowing the right viewport edge back inside', () => {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(900, 1100))
    try {
      render(
        <Tooltip label="Wide" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      // pos.x = 1000 (anchor center); measured right edge 1100 overflows the
      // 1024 viewport's 12px safe margin (limit 1012) by 88, so the clamp
      // shifts left to 912.
      expect(screen.getByRole('tooltip').style.left).toBe('912px')
    } finally {
      spy.mockRestore()
    }
  })

  it('reclamps after label and viewport width changes', () => {
    const originalWidth = window.innerWidth
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('role') !== 'tooltip') return rect(900, 1000)
      return this.textContent === 'Wide' ? rect(900, 1100) : rect(850, 950)
    })
    try {
      const view = render(
        <Tooltip label="Wide" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      expect(screen.getByRole('tooltip').style.left).toBe('862px')

      view.rerender(
        <Tooltip label="Short" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      expect(screen.getByRole('tooltip').style.left).toBe('950px')

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
      fireEvent(window, new Event('resize'))
      expect(screen.getByRole('tooltip').style.left).toBe('888px')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
      spy.mockRestore()
    }
  })

  it('clamps a bubble past the left viewport edge back inside', () => {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(-20, 80))
    try {
      render(
        <Tooltip label="Wide" side="bottom">
          <button type="button">anchor</button>
        </Tooltip>,
      )
      fireEvent.mouseEnter(screen.getByText('anchor'))
      // pos.x = 30 (anchor center); measured left edge -20 underflows the
      // 12px safe margin by 32, so the clamp shifts right to 62.
      expect(screen.getByRole('tooltip').style.left).toBe('62px')
    } finally {
      spy.mockRestore()
    }
  })

  it('supports top placement for anchors at the viewport bottom', () => {
    render(
      <Tooltip label="Above" side="top">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByText('anchor'))
    const bubble = screen.getByRole('tooltip')
    expect(bubble.getAttribute('data-side')).toBe('top')
    // jsdom rects are all-zero: top placement lands at the -8 gutter and the
    // zero-width measured rect clamps left to the 12px edge margin.
    expect(bubble.style.left).toBe('12px')
    expect(bubble.style.top).toBe('-8px')
  })

  it('chains the anchor\'s own handlers ahead of the tooltip\'s', () => {
    const onMouseEnter = vi.fn()
    const onMouseLeave = vi.fn()
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    render(
      <Tooltip label="Chained">
        <button type="button" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onFocus={onFocus} onBlur={onBlur}>anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    fireEvent.mouseLeave(anchor)
    fireEvent.focus(anchor)
    fireEvent.blur(anchor)
    expect(onMouseEnter).toHaveBeenCalledOnce()
    expect(onMouseLeave).toHaveBeenCalledOnce()
    expect(onFocus).toHaveBeenCalledOnce()
    expect(onBlur).toHaveBeenCalledOnce()
  })

  it('suppresses the bubble while disabled without remounting the anchor', () => {
    const { rerender } = render(
      <Tooltip label="Rail" disabled>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    fireEvent.mouseEnter(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    rerender(
      <Tooltip label="Rail">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    // Same DOM node: toggling disabled never remounted the anchor.
    expect(screen.getByText('anchor')).toBe(anchor)
    fireEvent.mouseEnter(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
  })

  it('mouse leave hides the bubble immediately, even while the anchor stays focused', () => {
    render(
      <Tooltip label="Sticky">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    const anchor = screen.getByText('anchor')
    // Focused AND hovered: leaving with the mouse drops the bubble at once.
    fireEvent.focus(anchor)
    fireEvent.mouseEnter(anchor)
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
    // Re-entering shows it again; blurring while still hovered keeps it.
    fireEvent.mouseEnter(anchor)
    fireEvent.blur(anchor)
    expect(screen.getByRole('tooltip')).toBeTruthy()
    fireEvent.mouseLeave(anchor)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('forwards the anchor element to the child ref (object and callback)', () => {
    const objectRef = { current: null as HTMLButtonElement | null }
    const callbackRef = vi.fn()
    const { rerender } = render(
      <Tooltip label="Add">
        <button type="button" ref={objectRef}>anchor</button>
      </Tooltip>,
    )
    expect(objectRef.current).toBe(screen.getByText('anchor'))
    // Tooltip's own positioning still works through the merged ref.
    fireEvent.mouseEnter(screen.getByText('anchor'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    rerender(
      <Tooltip label="Add">
        <button type="button" ref={callbackRef}>anchor</button>
      </Tooltip>,
    )
    expect(callbackRef).toHaveBeenCalledWith(screen.getByText('anchor'))
  })

  it('drops an already-visible bubble when disabled flips mid-hover', () => {
    const { rerender } = render(
      <Tooltip label="Rail">
        <button type="button">anchor</button>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByText('anchor'))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    // e.g. clicking a rail control expands the sidebar: no mouseleave fires.
    rerender(
      <Tooltip label="Rail" disabled>
        <button type="button">anchor</button>
      </Tooltip>,
    )
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
