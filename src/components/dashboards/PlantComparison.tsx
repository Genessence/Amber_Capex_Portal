'use client'

import { useMemo, useState } from 'react'
import type { PlantHeadUtilisation, PlantKpi } from '@/lib/kpiPlants'
import { GroupedBarChart, HeatmapGrid } from './charts'
import { DashboardSection } from './Section'
import { ChartFrame, DashboardGrid, EmptyState, PROSE } from './layout'
import { fmtCr, fmtDays, fmtInr, fmtPct } from './format'

export interface PlantRow extends PlantKpi {
  /** Display name — resolved by the caller through PLANTS → customPlants → raw value. */
  label: string
  /** THIS plant's own live Brown Field FY, or null when it has no Brown Field budget at all. */
  fy: string | null
}

type SortKey =
  | 'label' | 'liveRequests' | 'allocatedInr' | 'committedInr' | 'utilisationPct'
  | 'savingsInr' | 'medianTatDays' | 'delayExposureInr' | 'stalled' | 'breachedHeads'
  | 'overExposureCr'

interface Column {
  key: SortKey
  label: string
  /** Unit or basis, printed under the header — every money column states its unit, every derived column its basis. */
  unit?: string
  numeric: boolean
  /** `null` = nothing to rank on; sorted LAST in both directions rather than as a zero. */
  sortValue: (row: PlantRow) => number | string | null
  render: (row: PlantRow) => React.ReactNode
}

/**
 * A plant with no allocation has nothing to divide by, so `utilisationPct` is 0 by
 * `fyBudgetPosition`'s guard — printing "0%" would read as "spent nothing of its budget" when the
 * truth is "has no budget recorded". Rendered as unmeasurable instead, and counted in the footnote.
 */
const hasAllocation = (row: PlantRow) => row.allocatedInr > 0

const unmeasured = (words: string) => (
  <span className="text-[11px] text-slate-400">{words}</span>
)

/**
 * Days LATE, not a duration: `fmtDays(0)` renders "<1d", which on a lateness column reads as "a
 * little bit late" when 0 means the clock is inside its grace period. Exported so the by-plant TAT
 * chart on the Portfolio tab labels the identical quantity identically.
 */
export const lateLabel = (days: number): string => (days > 0 ? fmtDays(days) : 'on time')

const COLUMNS: Column[] = [
  {
    key: 'label',
    label: 'Plant',
    numeric: false,
    sortValue: (r) => r.label,
    render: (r) => (
      <span className="font-semibold text-slate-800">
        {r.label}
        <span className="block text-[10px] font-normal text-slate-400">
          {r.fy ? `Brown Field FY ${r.fy}` : 'no Brown Field budget'}
        </span>
      </span>
    ),
  },
  {
    key: 'liveRequests',
    label: 'Live requests',
    unit: 'all field types',
    numeric: true,
    sortValue: (r) => r.liveRequests,
    render: (r) => (
      <span className="tabular-nums text-slate-700">
        {r.liveRequests}
        {r.stalled > 0 && (
          <span className="block text-[10px] font-medium text-red-600">{r.stalled} past SLA</span>
        )}
      </span>
    ),
  },
  {
    key: 'allocatedInr',
    label: 'Allocated',
    unit: '₹ · Brown Field, own FY',
    numeric: true,
    sortValue: (r) => (hasAllocation(r) ? r.allocatedInr : null),
    render: (r) => (hasAllocation(r)
      ? <span className="tabular-nums text-slate-700">{fmtInr(r.allocatedInr)}</span>
      : unmeasured('none recorded')),
  },
  {
    key: 'committedInr',
    // `PlantKpi.committedInr` is Σ `requestValue().inr` — NOT `usedAmountByMasterItemId`, which is the
    // per-line consumption basis /capex/master renders and which drives the head columns further right.
    // The two coincide only while nothing is quoted or awarded, so the unit names the real one.
    label: 'Committed',
    unit: '₹ · each request’s own value',
    numeric: true,
    sortValue: (r) => r.committedInr,
    render: (r) => (
      <span className="tabular-nums text-slate-700">
        {fmtInr(r.committedInr)}
        {r.requestsOutsideScopedFy > 0 && (
          <span className="block text-[10px] font-normal text-amber-700">
            {r.requestsOutsideScopedFy} request(s) on another FY, not counted
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'utilisationPct',
    label: 'Utilised',
    unit: 'committed ÷ allocated',
    numeric: true,
    sortValue: (r) => (hasAllocation(r) ? r.utilisationPct : null),
    render: (r) => {
      if (!hasAllocation(r)) return unmeasured('no allocation')
      const over = r.utilisationPct > 100
      return (
        <span className={`tabular-nums font-semibold ${over ? 'text-red-700' : 'text-slate-700'}`}>
          {fmtPct(r.utilisationPct)}
          {over && <span className="block text-[10px] font-medium">over allocation</span>}
        </span>
      )
    },
  },
  {
    key: 'savingsInr',
    label: 'Savings',
    unit: '₹ · negotiation, comparable only',
    numeric: true,
    // Not comparable = not rankable. Sorting it as 0 would place a plant we cannot measure
    // alongside a plant that genuinely saved nothing.
    sortValue: (r) => (r.savingsComparable > 0 ? r.savingsInr : null),
    render: (r) => (r.savingsComparable > 0
      ? (
        <span className={`tabular-nums font-semibold ${r.savingsInr > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
          {fmtInr(r.savingsInr)}
          <span className="block text-[10px] font-normal text-slate-400">
            {r.savingsComparable} comparable request(s)
          </span>
        </span>
      )
      : unmeasured('not comparable')),
  },
  {
    key: 'medianTatDays',
    label: 'Median TAT',
    unit: 'days late · live clocks',
    numeric: true,
    sortValue: (r) => r.medianTatDays,
    render: (r) => (r.medianTatDays == null
      ? unmeasured('no live clock')
      : (
        <span className={`tabular-nums ${r.medianTatDays > 0 ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>
          {lateLabel(r.medianTatDays)}
          {r.medianTatDays > 0 && <span className="block text-[10px] font-medium">behind schedule</span>}
        </span>
      )),
  },
  {
    key: 'delayExposureInr',
    label: 'Delay exposure',
    unit: '₹ · still accruing',
    numeric: true,
    sortValue: (r) => r.delayExposureInr,
    render: (r) => (r.delayExposureInr > 0
      ? <span className="tabular-nums font-semibold text-red-700">{fmtInr(r.delayExposureInr)}</span>
      : <span className="tabular-nums text-slate-400">—</span>),
  },
  {
    key: 'stalled',
    label: 'Stalled',
    unit: 'past that party’s SLA',
    numeric: true,
    sortValue: (r) => r.stalled,
    render: (r) => (
      <span className={`tabular-nums ${r.stalled > 0 ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>
        {r.stalled > 0 ? r.stalled : '—'}
      </span>
    ),
  },
  {
    key: 'breachedHeads',
    label: 'Breached heads',
    unit: 'committed > allocation',
    numeric: true,
    sortValue: (r) => r.breachedHeads,
    render: (r) => (
      <span className={`tabular-nums ${r.breachedHeads > 0 ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>
        {r.breachedHeads > 0 ? r.breachedHeads : '—'}
      </span>
    ),
  },
  {
    key: 'overExposureCr',
    label: 'Over-allocation',
    unit: '₹ Cr over, breached heads only',
    numeric: true,
    sortValue: (r) => r.overExposureCr,
    render: (r) => (r.overExposureCr > 0
      ? (
        <span className="tabular-nums font-semibold text-red-700">
          {fmtCr(r.overExposureCr)}
          <span className="block text-[10px] font-medium">needs an adhoc transfer</span>
        </span>
      )
      : <span className="tabular-nums text-slate-400">—</span>),
  },
]

/**
 * Unique display strings for the heatmap's row headers. `HeatmapGrid` uses the row string as both
 * its React key and its `<th>`, so two plants sharing a label would silently collapse into one row —
 * disambiguated with the raw plant value rather than losing a plant.
 */
function uniqueRowLabels(rows: PlantRow[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.label, (counts.get(r.label) ?? 0) + 1)
  const out = new Map<string, string>()
  for (const r of rows) out.set(r.plant, (counts.get(r.label) ?? 0) > 1 ? `${r.label} (${r.plant})` : r.label)
  return out
}

export function PlantComparison({
  rows, heatmap, activePlant,
}: {
  rows: PlantRow[]
  heatmap: PlantHeadUtilisation
  /** The plant selected on the Portfolio tab — marked here for continuity, never filtered out. */
  activePlant: string | null
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'allocatedInr', dir: 'desc',
  })

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key) ?? COLUMNS[0]
    return [...rows].sort((a, b) => {
      const av = col.sortValue(a)
      const bv = col.sortValue(b)
      // Unmeasurable values sort last in BOTH directions — they are not small, they are absent.
      if (av == null && bv == null) return a.label.localeCompare(b.label)
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'string' || typeof bv === 'string'
        ? String(av).localeCompare(String(bv))
        : av - bv
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sort])

  const onSort = (col: Column) => {
    setSort((prev) => prev.key === col.key
      ? { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key: col.key, dir: col.numeric ? 'desc' : 'asc' })
  }

  // Charts keep one stable order (largest budget first) so a table sort never silently reorders the
  // bars a reader has just been comparing.
  const byBudget = useMemo(
    () => [...rows].sort((a, b) => b.allocatedInr - a.allocatedInr || a.label.localeCompare(b.label)),
    [rows],
  )

  const rowLabels = useMemo(() => uniqueRowLabels(byBudget), [byBudget])
  const heatRows = useMemo(() => {
    const withCells = new Set(heatmap.cells.map((c) => c.plant))
    return byBudget.filter((r) => withCells.has(r.plant)).map((r) => rowLabels.get(r.plant) as string)
  }, [byBudget, heatmap.cells, rowLabels])
  const heatCells = useMemo(
    () => heatmap.cells.map((c) => ({
      row: rowLabels.get(c.plant) ?? c.plant,
      col: c.head,
      value: c.utilisationPct,
      over: c.over,
    })),
    [heatmap.cells, rowLabels],
  )

  const noAllocation = rows.filter((r) => !hasAllocation(r)).length
  const outsideFy = rows.reduce((sum, r) => sum + r.requestsOutsideScopedFy, 0)

  const marked = (row: PlantRow) => (row.plant === activePlant ? 'selected on Portfolio' : undefined)

  if (!rows.length) {
    return (
      <DashboardSection title="Plant comparison — Brown Field budget, all-field-type delivery" level={2} card>
        <EmptyState>No plant has a budget or a request yet, so there is nothing to compare.</EmptyState>
      </DashboardSection>
    )
  }

  return (
    <>
      {/* The budget bars and the head heatmap answer the same question at two grains, so they sit
          side by side. Full-bleed, the bars rendered ~1120px long and 8px tall — a rule, not a bar. */}
      <DashboardGrid cols={2}>
      <DashboardSection
        title="Brown Field budget position by plant"
        level={2}
        caption="Brown Field allocation vs committed (est.), each plant on its OWN live FY. A plant is flagged OVER when any of its budget heads is over its effective allocation."
        card
      >
        <ChartFrame size="md">
          <GroupedBarChart
            groups={byBudget.map((r) => ({
              label: r.label,
              sub: [
                // Same words the table's Plant cell uses — "no FY" alone reads as a data glitch,
                // when the fact is that this plant has no Brown Field budget to have an FY for.
                r.fy ? `FY ${r.fy}` : 'no Brown Field budget',
                r.breachedHeads > 0 ? `${r.breachedHeads} head(s) over` : null,
                marked(r),
              ].filter(Boolean).join(' · '),
              values: { allocated: r.allocatedInr, committed: r.committedInr },
              over: r.breachedHeads > 0,
            }))}
            measures={[
              { key: 'allocated', label: 'Allocated', color: '#94A3B8' },
              { key: 'committed', label: 'Committed', color: '#2563EB' },
            ]}
            formatValue={fmtInr}
            // The red here means one budget HEAD is over its allocation, not that the plant's bar is
            // over anything — `GroupedBarChart` defaults to the generic "Over", which under a budget
            // chart reads as the wrong claim. The caption above uses the same words.
            overLabel="Over allocation"
            ariaLabel="Allocated versus committed budget per plant, in rupees"
            emptyText="No plant budget published yet."
          />
        </ChartFrame>
      </DashboardSection>

      <DashboardSection
        title="Brown Field head utilisation, plant by plant"
        level={2}
        caption={[
          'Committed (est.) as a % of the effective head allocation — the same basis /capex/master shows, each plant on its own live FY.',
          'A cell pools every project type that plant funds, and reads OVER when ANY of them breaches, so a breach can never be hidden by slack elsewhere.',
          heatmap.unmeasurable > 0
            ? `${heatmap.unmeasurable} head(s) carry committed spend with no allocation to divide by — shown as “—”, and counted in the Over-allocation column below.`
            : null,
        ].filter(Boolean).join(' ')}
        card
      >
        <HeatmapGrid
          rows={heatRows}
          cols={heatmap.heads}
          cells={heatCells}
          rowLabel="Plant"
          colLabel="Budget head"
          formatValue={(n) => fmtPct(n)}
          legendLabel="Utilisation"
          // Lower-case: `HeatmapGrid` prints it mid-sentence in the summary ("N cells flagged …") as
          // well as in the legend. Restores the wording this grid carried before `overLabel` existed.
          overLabel="over allocation"
          emptyText="No Brown Field head budget published yet."
        />
      </DashboardSection>
      </DashboardGrid>

      <DashboardSection
        title="Plant comparison — Brown Field budget, all-field-type delivery"
        level={2}
        caption="Sortable. Budget columns are Brown Field only (heads are a Brown Field concept); request, savings, TAT and delay columns cover every field type at that plant."
        card
      >
        {/* Eleven columns, each with a label AND a load-bearing basis caption. Compressed to fit
            1340px they crushed into a wall of wrapped words ("BREACHED / HEADS", "OVER- / ALLOCATION"),
            so the table now asks for the width it needs and SCROLLS inside this wrapper instead —
            the captions are the part that must not be cut. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] text-sm">
            <thead>
              <tr className="border-b-2 border-border bg-slate-50/60 text-left align-bottom">
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={c.numeric ? 'text-right' : 'text-left'}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(c)}
                        className={`w-full min-h-[44px] px-3 py-3 flex flex-col gap-1 ${c.numeric ? 'items-end text-right' : 'items-start text-left'}
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563EB] rounded`}
                      >
                        <span className={`text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${active ? 'text-slate-800' : 'text-slate-400'}`}>
                          {c.label}
                          <span aria-hidden="true" className="ml-1">
                            {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </span>
                        {c.unit && (
                          <span className="text-[9px] font-normal normal-case leading-snug text-slate-400">
                            {c.unit}
                          </span>
                        )}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((r) => (
                <tr
                  key={r.plant}
                  className={r.plant === activePlant ? 'bg-[#EBF0FB]/70' : 'hover:bg-[#EBF0FB]/60'}
                >
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.numeric ? 'text-right' : 'text-left'}`}>
                      {c.render(r)}
                      {c.key === 'label' && r.plant === activePlant && (
                        <span className="ml-2 text-[9px] font-bold uppercase tracking-wide text-[#1D4ED8]">
                          selected on Portfolio
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className={`mt-3 space-y-1 text-[11px] text-slate-500 ${PROSE}`}>
          <li>
            <strong className="font-semibold text-slate-600">Savings.</strong> Only awards whose first
            quotation and final price are comparable like-for-like count. Where none are, the cell reads
            “not comparable” rather than ₹0 — the two are different facts, and printing zero would rank a
            plant we cannot measure below one that genuinely saved nothing.
          </li>
          <li>
            <strong className="font-semibold text-slate-600">Committed.</strong> Each request&rsquo;s own
            value — awarded price where awarded, else the agreed or best quote, else the estimate — summed.
            An estimate basis, not a settled figure, and <em>not</em> the per-line consumption
            /capex/master shows: that basis (<code>usedAmountByMasterItemId</code>) drives the Breached
            heads and Over-allocation columns and the heatmap above, so those two &ldquo;committed&rdquo;
            figures are different quantities and need not agree.
          </li>
          {noAllocation > 0 && (
            <li>
              <strong className="font-semibold text-slate-600">No allocation.</strong> {noAllocation} plant(s)
              have no Brown Field budget recorded, so Allocated and Utilised are unmeasurable rather than 0.
            </li>
          )}
          {outsideFy > 0 && (
            <li>
              <strong className="font-semibold text-slate-600">Another FY.</strong> {outsideFy} live Brown
              Field request(s) sit on a different FY from the plant whose budget they are shown beside — an
              unlinked request is attributed to the portfolio&rsquo;s live FY, which differs for a plant still
              on an earlier year. They are excluded from Committed rather than counted against an allocation
              from another year, and are marked on the plants they belong to.
            </li>
          )}
        </ul>
      </DashboardSection>
    </>
  )
}
