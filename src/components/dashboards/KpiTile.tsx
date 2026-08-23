'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { CARD_TIGHT } from '@/lib/uiTokens'
import { cn } from '@/lib/utils'
import { InfoButton } from './Section'

/** Grayscale + blue chrome; emerald for value gained, red for value lost or an SLA breach. */
export type Tone = 'neutral' | 'good' | 'warn' | 'danger'

const ACCENT: Record<Tone, string> = {
  neutral: '#64748B',
  good: '#059669',
  warn: '#D97706',
  danger: '#DC2626',
}

const VALUE_CLASS: Record<Tone, string> = {
  neutral: 'text-slate-900',
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  danger: 'text-red-700',
}

export interface KpiTileProps {
  label: string
  value: string
  /** Secondary line under the value — counts, comparisons. */
  sub?: string
  /** Provenance / basis line, e.g. "awarded" or "excl. freight". */
  caption?: string
  tone?: Tone
  /** Optional: a headline figure (`size="lg"`) carries no icon chip — the figure IS the signal. */
  icon?: LucideIcon
  /**
   * `lg` is the portfolio headline treatment — louder type so a band of four figures outranks the
   * tiles beneath it. Everything else about the tile is identical, which is the point: the two rows
   * land on the same grid tracks and share the same internal zones.
   */
  size?: 'md' | 'lg'
  href?: string
  ariaLabel?: string
}

/**
 * One KPI tile, with a FIXED internal structure — four zones, in this order, always:
 *
 *   ① label + icon   ② value   ③ sub   ④ caption
 *
 * The structure is fixed because a row of tiles is read across, not down. Captions differ wildly in
 * length (three italic lines on "Past threshold (where set)", none at all on "Waiting on others"),
 * and left to flow that made every row ragged: values sat at different heights and the short tiles
 * carried the tall one's dead space at the bottom.
 *
 * Two rules do the whole job:
 *
 * - **The label row has a fixed height** (`min-h-[28px]`, the icon chip's own height) and clamps at
 *   two lines, so a wrapping label can never push its value below its neighbours'. Every value in a
 *   row starts at the same y.
 * - **The caption is bottom-aligned** (`mt-auto`). Whatever slack a tile has lands in ONE gap above
 *   the caption instead of a hole at the bottom, and the captions across a row form a single band.
 *
 * The caption clamps to three lines with the full text kept in the DOM (and on `title`), so nothing
 * is deleted from the accessibility tree — these sentences are load-bearing disclosures, and every
 * linked tile restates them in its `aria-label` besides.
 */
export function KpiTile({
  label, value, sub, caption, tone = 'neutral', icon: Icon, size = 'md', href, ariaLabel,
}: KpiTileProps) {
  const accent = ACCENT[tone]
  // The caption is FOLDED behind an ⓘ (2026-08-21) — see `DashboardSection`. A tile row of italic
  // footnotes is the densest text on the page and is read once, not every scan.
  const [openCaption, setOpenCaption] = useState(false)
  const captionId = `${useId()}-caption`
  const body = (
    <>
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ background: accent }} />

      {/* ① Fixed-height label row — the reason every value in a row shares a baseline. */}
      <div className="flex items-start justify-between gap-2 min-h-[28px]">
        <p
          className="text-[10px] font-bold uppercase tracking-wide leading-tight text-slate-400 line-clamp-2"
          title={label}
        >
          {label}
        </p>
        {caption && (
          // `relative z-10`: on a linked tile the `<Link>` is a transparent overlay across the whole
          // card, so without this the toggle would be unclickable — the click would navigate instead.
          <span className="relative z-10 shrink-0 pt-px">
            <InfoButton
              open={openCaption} onToggle={() => setOpenCaption(v => !v)}
              controls={captionId} subject={label}
            />
          </span>
        )}
        {Icon && (
          <div className="rounded-lg p-1.5 shrink-0" style={{ background: `${accent}18` }}>
            <Icon aria-hidden="true" className="w-4 h-4" style={{ color: accent }} />
          </div>
        )}
      </div>

      {/* ② Value — one type size across every tile, so the row scans as a row. */}
      <p
        className={cn(
          'mt-1.5 font-black tracking-tight leading-none tabular-nums',
          size === 'lg' ? 'text-2xl lg:text-3xl' : 'text-2xl',
          VALUE_CLASS[tone],
        )}
      >
        {value}
      </p>

      {/* ③ Sub */}
      {sub && <p className="mt-1 text-xs leading-snug text-slate-500">{sub}</p>}

      {/* ④ Caption — folded behind the ⓘ above; opens in place at the bottom of the tile. */}
      {caption && openCaption && (
        <p
          id={captionId}
          role="note"
          className="relative z-10 mt-auto pt-1.5 text-[10px] leading-[1.35] text-slate-400 italic"
        >
          {caption}
        </p>
      )}
    </>
  )

  const className = cn(
    CARD_TIGHT,
    'flex flex-col h-full relative overflow-hidden min-h-[92px]',
    href && 'transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
  )

  if (!href) return <div className={className}>{body}</div>
  // A "stretched link": the anchor covers the card so the whole tile is still one click target, but
  // it is a SIBLING of the content rather than its parent — which is what lets the ⓘ toggle live
  // inside the tile without nesting a <button> in an <a> (invalid, and unclickable in practice).
  return (
    <div className={cn(className, 'group')}>
      <Link
        href={href}
        aria-label={ariaLabel ?? `${label}: ${value}`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
      />
      {body}
    </div>
  )
}
