'use client'

import { useId, useState } from 'react'
import { Info } from 'lucide-react'

import { CARD } from '@/lib/uiTokens'
import { cn } from '@/lib/utils'
import { PROSE } from './layout'

/**
 * A dashboard band or card whose title is a REAL heading. THE heading primitive for the dashboards.
 *
 * The dashboards' original section titles were `<p class="text-[10px] uppercase …">` — visually a
 * heading, structurally invisible, so a screen-reader user could not navigate the page by heading
 * at all. This renders an actual `<h2>`/`<h3>` and wires `aria-labelledby` from the `<section>` to
 * it so the region is announced by name.
 *
 * `level` is explicit rather than inferred so the document outline stays in order (page `<h1>` →
 * band `<h2>` → card `<h3>`) no matter how the sections are composed or reordered.
 *
 * ── ONE heading system (2026-08) ──
 *
 * Three treatments used to coexist: uppercase-inside-a-card ("PORTFOLIO POSITION — ALL PLANTS"),
 * sentence-case bold bands ("Act on this first"), and numbered bands ("③ Outcomes"). A reader had
 * no way to tell which of the three outranked the others, because visually they did not agree with
 * the outline underneath them. There is now one treatment, and hierarchy is carried by size, weight
 * and colour alone:
 *
 * - **`level={2}`** — a band that groups cards. Sentence case, `text-[13px]`, near-black.
 * - **`level={3}`** — a single card's own title. Sentence case, `text-[12px]`, slate-800.
 *
 * Uppercase micro-labels still exist on this screen, deliberately: KPI tile labels and table column
 * headers. Those are DATA labels, not headings, and reading as a different class of thing is the
 * point.
 *
 * The caption placement follows the level, and that is the whole rule: a band's caption is a terse
 * scope note that sits inline beside the title; a card's caption is explanatory prose and sits under
 * it. Both are capped at a readable measure (`PROSE`) — the basis notes on this screen are long by
 * design and were previously running the full 1340px width of the page.
 */
/**
 * The ⓘ toggle that hides a section's basis/provenance line until it is asked for.
 *
 * These captions are the honesty layer of this dashboard — which FY a figure is on, what the median
 * excludes, why a plant is unmeasurable — so they are NEVER deleted, only folded away. The text
 * stays in the DOM's reach via `aria-controls` and is one click from view, and the button's
 * `aria-label` names the section so a screen-reader user knows which caption they are opening.
 */
export function InfoButton({
  open, onToggle, controls, subject,
}: {
  open: boolean
  onToggle: () => void
  controls: string
  /** The section's own title, so the control is not just "more info" repeated 20 times a page. */
  subject: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${open ? 'Hide' : 'Show'} details for ${subject}`}
      className={cn(
        'shrink-0 rounded-full p-0.5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
        open ? 'text-[#2563EB] bg-blue-50' : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100',
      )}
    >
      <Info aria-hidden="true" className="w-3.5 h-3.5" />
    </button>
  )
}

export function DashboardSection({
  title,
  level = 3,
  caption,
  aside,
  card = false,
  id,
  className,
  bodyClassName,
  children,
}: {
  title: string
  /** 2 = a band that groups cards; 3 = a single card's own title. */
  level?: 2 | 3
  /** Basis / provenance / scope line. Inline beside the title on a band, under it on a card. */
  caption?: string
  /** Right-aligned control or note on the heading row (a sort hint, a legend, a link). */
  aside?: React.ReactNode
  card?: boolean
  id?: string
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  const headingId = `${(id ?? title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-heading`
  // The caption is FOLDED, not dropped (2026-08-21): the dashboards were dense with basis lines that
  // are essential when read and noise when scanned, so each hides behind an ⓘ and opens in place.
  const [openCaption, setOpenCaption] = useState(false)
  const captionId = `${useId()}-caption`

  if (level === 2) {
    return (
      <section id={id} aria-labelledby={headingId} className={cn(card ? CARD : undefined, className)}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-2">
          <h2 id={headingId} className="text-[13px] font-bold tracking-tight text-slate-900">
            {title}
          </h2>
          {caption && (
            <InfoButton
              open={openCaption} onToggle={() => setOpenCaption(v => !v)}
              controls={captionId} subject={title}
            />
          )}
          {aside && <div className="ml-auto shrink-0">{aside}</div>}
        </div>
        {caption && openCaption && (
          <p id={captionId} role="note" className={cn('text-xs text-slate-500 mb-2', PROSE)}>{caption}</p>
        )}
        <div className={bodyClassName}>{children}</div>
      </section>
    )
  }

  return (
    <section id={id} aria-labelledby={headingId} className={cn(card ? CARD : undefined, className)}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex items-center gap-1.5">
          <h3 id={headingId} className="text-[12px] font-bold tracking-tight text-slate-800">
            {title}
          </h3>
          {caption && (
            <InfoButton
              open={openCaption} onToggle={() => setOpenCaption(v => !v)}
              controls={captionId} subject={title}
            />
          )}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {caption && openCaption && (
        <p id={captionId} role="note" className={cn('text-[11px] text-slate-500 -mt-1 mb-2', PROSE)}>
          {caption}
        </p>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}
