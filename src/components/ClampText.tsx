'use client'

import { useId, useLayoutEffect, useRef, useState } from 'react'

/**
 * Compact labelled text that stays VISIBLE but clamped to ~2 lines, with a "Show more/less" toggle.
 * Keeps long request fields (Justification, Complete Description, Reason, Benefits/ROI) from
 * dominating the request-detail card. The "Show more" affordance appears only when the text
 * actually overflows 2 lines (measured, not guessed), so text is never silently truncated.
 */
export function ClampText({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)
  const id = useId()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // When clamped, scrollHeight > clientHeight means the 2-line clamp is hiding content.
      if (!open) setOverflows(el.scrollHeight - el.clientHeight > 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, open])

  return (
    <div className="text-xs leading-snug">
      <p ref={ref} id={id} className={open ? 'text-slate-600' : 'text-slate-600 line-clamp-2'}>
        <span className="font-bold text-slate-400 uppercase tracking-wider">{label} </span>
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          aria-label={open ? `Show less of ${label}` : `Show more of ${label}`}
          className="mt-0.5 -mx-1 px-1 py-0.5 text-[11px] font-semibold text-[#2563EB] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50 rounded"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
