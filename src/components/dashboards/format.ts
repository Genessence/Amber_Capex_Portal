/** Shared dashboard formatters. Compact for tile values, full for captions. */

import type { Tone } from './KpiTile'

/**
 * `fmtDays` / `fmtPct` now live in `@/lib/format` and are re-exported here so every existing
 * `from './format'` import keeps working. They moved because the pure KPI layer needs them too
 * (`kpiRoutes.ts` words the filtered list's disclosures with them) and two copies meant a tile and
 * its own explanatory note could round differently.
 */
export { fmtDays, fmtPct } from '@/lib/format'

const CR = 1_00_00_000

export function fmtInr(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= CR) return `${sign}₹${(abs / CR).toFixed(2)}Cr`
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(1)}L`
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`
}

export function fmtInrFull(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`
}

export function fmtCr(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  return `${sign}₹${abs.toFixed(2)} Cr`
}

/**
 * Compose a tile's accessible name from its visible parts.
 *
 * `aria-label` on the tile's <Link> REPLACES the accessible name, so every visible line (value,
 * sub, caption) has to be restated here or a screen reader loses it.
 */
export const aria = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join('. ')

/**
 * How to render `approverEditImpact().trimCr` on a tile.
 *
 * A NEGATIVE trim is approvers RAISING the ask, not cutting it — the label, the value sign and the
 * tone all have to flip together or the tile reads backwards. Shared by the Administration and
 * Maintenance dashboards, which render the same derived quantity, so the two cannot disagree.
 */
export function approverEditPresentation(trimCr: number): {
  label: string
  value: string
  tone: Tone
  caption: string
} {
  const increased = trimCr < 0
  return {
    label: increased ? 'Increased by approvers' : 'Trimmed by approvers',
    value: fmtCr(Math.abs(trimCr)),
    tone: trimCr > 0 ? 'warn' : 'neutral',
    caption: increased
      ? 'approvers raised the ask while sending it forward'
      : trimCr > 0
        ? 'edits made while sending forward'
        : 'no approver edits yet',
  }
}
