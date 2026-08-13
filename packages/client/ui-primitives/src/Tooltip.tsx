// Hover/focus label bubble (figma tooltip pill: dark plate, white text).
// TODO: interaction is a placeholder (horizontal overflow clamps, but there
// is no vertical flip on viewport collision and no arrow) — visuals and
// behavior get a proper pass later.
// The anchor is the child element itself (cloneElement, no wrapper node), so
// attaching a tooltip never changes the anchor's layout context. The bubble is
// position:fixed and coordinates come from the anchor's rect at show time, so
// it escapes ancestor overflow clipping (the sidebar rail clips its column)
// without a portal.

import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FocusEventHandler, MouseEventHandler, MutableRefObject, ReactElement, Ref } from 'react'
import css from './Tooltip.module.css'

/** Bubble placement relative to the anchor. */
export type TooltipSide = 'right' | 'bottom' | 'top'

/** Props Tooltip injects into its anchor child; the child's own handlers are chained ahead of the tooltip's. */
interface AnchorProps {
  ref?: Ref<HTMLElement> | undefined
  onMouseEnter?: MouseEventHandler | undefined
  onMouseLeave?: MouseEventHandler | undefined
  onFocus?: FocusEventHandler | undefined
  onBlur?: FocusEventHandler | undefined
}

/**
 * Attach a hover/focus tooltip to an anchor element.
 * @param props.label - bubble text.
 * @param props.side - placement relative to the anchor (default 'right').
 * @param props.delayMs - hover delay in milliseconds; keyboard focus remains immediate.
 * @param props.disabled - suppress the bubble while true; the anchor renders identically so
 * toggling never remounts it (which would cut its CSS transitions).
 * @param props.children - a single anchor element; its own ref (callback or object) is forwarded alongside the tooltip's.
 * @returns the cloned anchor plus a fixed-position bubble while hovered/focused.
 */
export function Tooltip({ label, side = 'right', delayMs = 0, disabled = false, children }: { label: string; side?: TooltipSide; delayMs?: number; disabled?: boolean; children: ReactElement<AnchorProps> }) {
  const anchor = useRef<HTMLElement | null>(null)
  // React 18 keeps the element's ref outside props; forward it so wrapping an
  // anchor in Tooltip never silently severs the owner's ref.
  const childRef = (children as ReactElement<AnchorProps> & { ref?: Ref<HTMLElement> }).ref
  const mergedRef = useCallback((el: HTMLElement | null) => {
    anchor.current = el
    if (typeof childRef === 'function') childRef(el)
    else if (childRef != null) (childRef as MutableRefObject<HTMLElement | null>).current = el
  }, [childRef])
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const bubble = useRef<HTMLSpanElement | null>(null)
  // Horizontal viewport clamp: fixed positioning knows nothing about edges, so
  // a centered bubble near the right edge would clip. Each measurement resets
  // the base position before applying a direct style offset, allowing a shorter
  // label or wider viewport to release a previous clamp without another render.
  useLayoutEffect(() => {
    if (pos === null) return
    const clamp = () => {
      const el = bubble.current
      /* v8 ignore next -- pos is set only while the bubble is mounted. */
      if (el === null) return
      const EDGE_MARGIN = 12
      el.style.left = `${pos.x}px`
      const r = el.getBoundingClientRect()
      let dx = 0
      if (r.right > window.innerWidth - EDGE_MARGIN) dx = window.innerWidth - EDGE_MARGIN - r.right
      if (r.left + dx < EDGE_MARGIN) dx = EDGE_MARGIN - r.left
      el.style.left = `${pos.x + dx}px`
    }
    clamp()
    window.addEventListener('resize', clamp)
    return () => { window.removeEventListener('resize', clamp) }
  }, [label, pos])
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hover and focus are independent triggers: the bubble hides only after
  // BOTH clear (hovering away from a focused anchor must not drop it).
  const triggers = useRef({ hover: false, focus: false })

  // Disabling mid-hover (e.g. clicking a rail control expands the sidebar)
  // must drop an already-visible bubble: no mouseleave fires.
  const cancelShow = useCallback(() => {
    if (showTimer.current === null) return
    clearTimeout(showTimer.current)
    showTimer.current = null
  }, [])
  useEffect(() => {
    if (disabled) {
      cancelShow()
      triggers.current = { hover: false, focus: false }
      setPos(null)
    }
    return cancelShow
  }, [cancelShow, disabled])

  const show = () => {
    if (disabled) return
    const el = anchor.current
    /* v8 ignore next -- the ref is attached by event time: events fire on the cloned anchor. */
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos(side === 'right'
      ? { x: r.right + 10, y: r.top + r.height / 2 }
      : side === 'top'
        ? { x: r.left + r.width / 2, y: r.top - 8 }
        : { x: r.left + r.width / 2, y: r.bottom + 8 })
  }
  const showAfterHoverDelay = () => {
    cancelShow()
    if (delayMs <= 0) {
      show()
      return
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      show()
    }, delayMs)
  }
  const hide = () => {
    cancelShow()
    if (!triggers.current.hover && !triggers.current.focus) setPos(null)
  }

  return (
    <>
      {cloneElement(children, {
        ref: mergedRef,
        onMouseEnter: (e) => { children.props.onMouseEnter?.(e); triggers.current.hover = true; showAfterHoverDelay() },
        onMouseLeave: (e) => { children.props.onMouseLeave?.(e); triggers.current.hover = false; cancelShow(); setPos(null) },
        onFocus: (e) => { children.props.onFocus?.(e); triggers.current.focus = true; cancelShow(); show() },
        onBlur: (e) => { children.props.onBlur?.(e); triggers.current.focus = false; hide() },
      })}
      {pos !== null && (
        <span ref={bubble} className={css.bubble} data-side={side} style={{ left: pos.x, top: pos.y }} role="tooltip">
          {label}
        </span>
      )}
    </>
  )
}
