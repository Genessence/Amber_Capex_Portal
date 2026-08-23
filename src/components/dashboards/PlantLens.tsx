'use client'

import { Building2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PROSE } from './layout'

export interface PlantOption { value: string; label: string }

/**
 * The plant filter for the executive view. Presentational: the URL (`?plant=`) is owned by the
 * dashboard, which is also what makes a filtered view shareable.
 *
 * "All plants" is both the default and the first option, and a Clear control appears once a plant is
 * chosen — so returning to the whole portfolio is always ONE action, from either affordance.
 *
 * A TOOLBAR ROW, not a card (2026-08). This was a full-bleed `CARD` wrapping a label, a `<select>`
 * and one sentence — roughly 1340px of card for ~400px of control, with the right two-thirds empty,
 * sitting inside the scrolling panel so it left the screen exactly when a reader needed to know what
 * the figures were scoped to. It now renders as a single bordered row in `DashboardTabs`' toolbar
 * slot, directly under the tab bar and outside the scroll container.
 */
export function PlantLens({
  options, active, onChange, scopeNote,
}: {
  options: PlantOption[]
  active: string | null
  onChange: (plant: string | null) => void
  /** What the current selection means for the figures below — stated, never implied. */
  scopeNote: string
}) {
  return (
    <div className="flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-1.5">
      <Building2 aria-hidden="true" className="w-4 h-4 text-slate-400 shrink-0" />
      <label htmlFor="plant-lens" className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
        Plant lens
      </label>
      <select
        id="plant-lens"
        value={active ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-h-[44px] rounded-lg border border-border bg-background px-3 py-2 text-[13px] font-semibold text-slate-800
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
      >
        <option value="">All plants</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {active && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-semibold text-slate-600
            hover:text-slate-900 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
        >
          <X aria-hidden="true" className="w-3.5 h-3.5" />
          All plants
        </button>
      )}
      <p className={cn('text-[11px] text-slate-500 basis-full sm:basis-auto sm:flex-1 sm:min-w-[16rem]', PROSE)}>
        {scopeNote}
      </p>
    </div>
  )
}
