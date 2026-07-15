"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import AdCreativeMedia from "@/components/dashboard/ad-creative-media"

const HOVER_INTENT_MS = 150
const POPOVER_WIDTH = 280
const VIEWPORT_PAD = 8
const GAP = 12

type Props = {
  adId: string
  /** Hint from performance data, shown in the placeholder states. */
  isVideoHint?: boolean
  children: React.ReactNode
}

/**
 * Wraps an ad label and shows the ad's creative (full-res image / autoplaying
 * video via /api/ad-preview) in a floating card after a short hover intent.
 *
 * - Content only mounts while open, so a table of hundreds of ads fires no
 *   preview fetches until a row is actually hovered.
 * - The card is keyed by adId and non-interactive (pointer-events-none), so
 *   moving quickly between rows can never show one ad's creative on another.
 * - Rendered through a portal so the table's overflow container can't clip it.
 */
export default function AdHoverPreview({ adId, isVideoHint, children }: Props) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const show = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setOpen(true), HOVER_INTENT_MS)
  }, [])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setOpen(false)
    setPos(null)
  }, [])

  useEffect(() => () => hide(), [hide])
  // A scroll leaves the popover floating over the wrong row — just close it.
  useEffect(() => {
    if (!open) return
    window.addEventListener("scroll", hide, true)
    return () => window.removeEventListener("scroll", hide, true)
  }, [open, hide])

  // Position next to the anchor, clamped inside the viewport. Re-runs when
  // the media loads (card height changes) via a ResizeObserver.
  const reposition = useCallback(() => {
    const anchor = anchorRef.current
    const pop = popoverRef.current
    if (!anchor || !pop) return
    const a = anchor.getBoundingClientRect()
    const h = pop.offsetHeight || 200

    let left = a.right + GAP
    if (left + POPOVER_WIDTH > window.innerWidth - VIEWPORT_PAD) {
      left = a.left - GAP - POPOVER_WIDTH
    }
    left = Math.max(VIEWPORT_PAD, Math.min(left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_PAD))

    let top = a.top + a.height / 2 - h / 2
    top = Math.max(VIEWPORT_PAD, Math.min(top, window.innerHeight - h - VIEWPORT_PAD))

    setPos({ top, left })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    reposition()
    const pop = popoverRef.current
    if (!pop || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(reposition)
    ro.observe(pop)
    return () => ro.disconnect()
  }, [open, adId, reposition])

  return (
    <div ref={anchorRef} onMouseEnter={show} onMouseLeave={hide} className="max-w-full">
      {children}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            key={adId}
            ref={popoverRef}
            data-ad-preview={adId}
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width: POPOVER_WIDTH,
              visibility: pos ? "visible" : "hidden",
            }}
            className="pointer-events-none z-50 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl"
          >
            <AdCreativeMedia adId={adId} isVideoHint={isVideoHint} aspectClass="aspect-[4/5]" />
          </div>,
          document.body
        )}
    </div>
  )
}
