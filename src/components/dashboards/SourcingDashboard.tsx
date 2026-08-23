'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle, Clock, Gavel, HandCoins, Hourglass, Inbox, PieChart, Timer, TrendingDown, Truck,
  Users,
} from 'lucide-react'
import type { CapexRequest, PlantMeta, Vendor, VendorInvite } from '@/lib/types'
import { FIELD_TYPE_LABELS } from '@/lib/types'
import type { KpiSnapshot } from '@/lib/kpiSnapshots'
import { measuredFrom, snapshotSeries } from '@/lib/kpiSnapshots'
import { PLANTS } from '@/lib/constants'
import { CARD, PAGE_SHELL } from '@/lib/uiTokens'
import { MasterIndex, stageDaysPercentiles, type StagePercentiles } from '@/lib/kpiUtils'
import { sourcingQueues } from '@/lib/kpiQueues'
import { sourcingPerformance } from '@/lib/kpiRisk'
import { monthlyFlow, trimLeadingEmptyMonths } from '@/lib/kpiTrends'
import {
  fieldTypeMix, legPercentiles, participationByPlant, queueHeadline, sampleNote,
  sourcingFunnel, waitAging, type AgingItem,
} from '@/lib/kpiSourcing'
import { metricHref, type MetricKey } from '@/lib/kpiRoutes'
import { isAuctionActive, formatAuctionCountdown, computeAuctionBestPrice } from '@/lib/auctionUtils'
import { ActionQueue } from './ActionQueue'
import { DashboardTabs } from './DashboardTabs'
import { DashboardSection } from './Section'
import {
  ChartFrame, DashboardGrid, DashboardHeader, EmptyState, KpiGrid, PROSE,
} from './layout'
import { KpiTile } from './KpiTile'
import {
  FunnelChart, GroupedBarChart, MeasuredSeriesChart, PercentileBar, TrendChart,
} from './charts'
import { aria, fmtDays, fmtInr, fmtInrFull, fmtPct } from './format'

/** Months of flow history on the trend chart — short enough that the x labels stay legible. */
const TREND_MONTHS = 6

/**
 * Hidden for now (2026-08-19) at the product owner's request — see the identical flag in
 * `AdminDashboard`. The card's JSX and its `kpiSnapshots` series stay in place; the provider keeps
 * measuring a record a day, so re-enabling costs one boolean and loses no history.
 */
const SHOW_MEASURED_STOCK_HISTORY = false

export function SourcingDashboard({
  requests, byRequest, index, now, vendors, customPlants, snapshots,
}: {
  requests: CapexRequest[]
  byRequest: Map<string, VendorInvite[]>
  index: MasterIndex
  now: number
  vendors: Vendor[]
  /** Plants created at runtime — part of the label chain, never printed as a raw key. */
  customPlants: PlantMeta[]
  /** MEASURED daily snapshots (`kpiSnapshots.ts`). Never backfilled; the chart states its horizon. */
  snapshots: KpiSnapshot[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  /* ── plant lens ────────────────────────────────────────────────────────
     A LENS, not a permission boundary: `sourcing_member` is a global role, so this only ever
     narrows what is already in scope. Reflected in `?plant=` with `router.replace`, matching the
     `?view=` tab behaviour (no history entry per click). */

  const plantLabel = useCallback(
    (value: string) =>
      PLANTS.find(p => p.value === value)?.label
      ?? customPlants.find(p => p.value === value)?.label
      ?? value,
    [customPlants],
  )

  // Every plant this app knows about, so a hand-typed `?plant=` for a real plant with zero assigned
  // requests still APPLIES (and renders honest empty states) instead of being silently ignored.
  const knownPlants = useMemo(() => {
    const set = new Set<string>()
    for (const p of PLANTS) set.add(p.value)
    for (const p of customPlants) set.add(p.value)
    for (const r of requests) if (r.plant) set.add(r.plant)
    return set
  }, [customPlants, requests])

  const rawPlant = params.get('plant')?.trim() || null
  const plant = rawPlant && knownPlants.has(rawPlant) ? rawPlant : null
  // A param that could NOT be applied is stated, never dropped in silence (same rule as
  // `kpiRoutes.buildRequestListView`'s `ignored`).
  const ignoredPlant = rawPlant && !plant ? rawPlant : null

  const setPlant = useCallback((value: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set('plant', value)
    else next.delete('plant')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [params, pathname, router])

  const plantChips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of requests) {
      if (!r.plant) continue
      counts.set(r.plant, (counts.get(r.plant) ?? 0) + 1)
    }
    // The active plant always gets a chip even at zero requests, so the filter stays reversible.
    if (plant && !counts.has(plant)) counts.set(plant, 0)
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: plantLabel(value) }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }, [requests, plant, plantLabel])

  const scoped = useMemo(
    () => (plant ? requests.filter(r => r.plant === plant) : requests),
    [requests, plant],
  )
  // `CapexRequest.plant` is optional, so the chip counts can sum to LESS than the "All plants" count.
  // Disclosed in words rather than given its own chip: a `?plant=<sentinel>` chip would scope the
  // dashboard to `plant == null` while `/capex/requests` filtered `r.plant === '<sentinel>'` and
  // returned nothing — a tile↔list contradiction worse than the gap it closed.
  //
  // The sentence is about what "All plants" contains, so it is only TRUE while "All plants" is what
  // is on screen. With a plant selected, those requests are out of scope entirely and the sentence
  // asserted a shortfall in a total the reader was no longer looking at.
  const noPlantRequests = useMemo(() => requests.filter(r => !r.plant).length, [requests])
  const showNoPlantNote = !plant && noPlantRequests > 0
  const scopeWords = plant ? plantLabel(plant) : 'All plants'

  /* ── derivations (all over the PLANT-SCOPED set) ─────────────────────── */

  const bands = useMemo(() => sourcingQueues(scoped, byRequest, now), [scoped, byRequest, now])
  const mineHead = useMemo(() => queueHeadline(bands.mine), [bands.mine])
  const waitHead = useMemo(() => queueHeadline(bands.waiting), [bands.waiting])

  // The whole Performance tab's aggregation is a pure lib call (`src/lib/kpiRisk.ts`) so every
  // figure here is independently unit-tested — nothing is derived inline in the component.
  const perf = useMemo(
    () => sourcingPerformance(scoped, byRequest, index, now, vendors),
    [scoped, byRequest, index, now, vendors],
  )

  const cyclePct = useMemo(
    () => stageDaysPercentiles(scoped, 'sourcing', 'pi_requested'),
    [scoped],
  )
  const legs = useMemo(() => ({
    firstQuote: legPercentiles(scoped, byRequest, 'firstQuote'),
    negotiation: legPercentiles(scoped, byRequest, 'negotiation'),
    techSpec: legPercentiles(scoped, byRequest, 'techSpec'),
  }), [scoped, byRequest])
  // One shared rail across the three PER-INVITE legs only — they are the like-for-like set. The
  // sourcing cycle is measured per REQUEST (weeks, not days); sharing its rail pinned a 1-day leg's
  // p50 and p90 to ~2% of the track, on top of each other, destroying the comparability the shared
  // rail exists for. `PercentileBar` pads its own domain when no `max` is passed, so that card scales
  // itself.
  const legMax = Math.max(
    legs.firstQuote.p90 ?? 0, legs.negotiation.p90 ?? 0, legs.techSpec.p90 ?? 0, 1,
  )

  const aging = useMemo(() => waitAging(scoped, byRequest, now), [scoped, byRequest, now])
  const funnel = useMemo(() => sourcingFunnel(scoped, byRequest), [scoped, byRequest])
  const participation = useMemo(() => participationByPlant(scoped, byRequest), [scoped, byRequest])
  const flow = useMemo(
    // Trimmed of the leading dead months so the line spans the plot — see `trimLeadingEmptyMonths`.
    () => trimLeadingEmptyMonths(monthlyFlow(scoped, byRequest, index, { now, months: TREND_MONTHS })),
    [scoped, byRequest, index, now],
  )

  // The snapshot store is scoped per FIELD TYPE while a sourcing desk can span all four, so the
  // series follows the desk's dominant field type and the caption names it (and what it omits).
  const mix = useMemo(() => fieldTypeMix(scoped), [scoped])
  const snapshotScope = useMemo(
    () => ({ fieldType: mix.dominant, plant }),
    [mix.dominant, plant],
  )
  const committedSeries = useMemo(
    () => snapshotSeries(snapshots, snapshotScope, 'committedInr'),
    [snapshots, snapshotScope],
  )
  const paidSeries = useMemo(
    () => snapshotSeries(snapshots, snapshotScope, 'paidInr'),
    [snapshots, snapshotScope],
  )
  const snapshotFrom = useMemo(
    () => measuredFrom(snapshots, snapshotScope),
    [snapshots, snapshotScope],
  )
  // The two WORKFLOW stock series. They were added to the snapshot store AFTER the money ones, so
  // their horizon is their own — `measuredFrom(..., metric)` reports the first day THAT metric was
  // measured, never the store's oldest day, and `snapshotSeries` leaves the earlier (money-only)
  // records out as gaps instead of drawing them as zero.
  const openLoadSeries = useMemo(
    () => snapshotSeries(snapshots, snapshotScope, 'openSourcingRequests'),
    [snapshots, snapshotScope],
  )
  const pendingQuotesSeries = useMemo(
    () => snapshotSeries(snapshots, snapshotScope, 'pendingQuoteInvites'),
    [snapshots, snapshotScope],
  )
  const openLoadFrom = useMemo(
    () => measuredFrom(snapshots, snapshotScope, 'openSourcingRequests'),
    [snapshots, snapshotScope],
  )
  const pendingQuotesFrom = useMemo(
    () => measuredFrom(snapshots, snapshotScope, 'pendingQuoteInvites'),
    [snapshots, snapshotScope],
  )

  // NOTE: `isAuctionActive` / `formatAuctionCountdown` (auctionUtils) read the wall clock themselves
  // rather than the injected `now`, so this tile and its countdown run on a marginally different clock
  // from every other figure here. Pre-existing utils, out of this stage's scope to re-plumb; flagged
  // so nobody reads it as a per-second-consistent figure.
  const liveAuctions = scoped.filter(r => isAuctionActive(r.auctionConfig))
  const nextAuctionEnd = liveAuctions
    .map(r => r.auctionConfig?.endsAt)
    .filter((e): e is string => !!e)
    .sort()[0]

  /* ── copy hoisted so visible text and aria-labels can never drift ────── */

  const negSub = fmtInrFull(perf.negotiation)
  const negCaption = [
    perf.negNotComparable > 0
      ? `${perf.negNotComparable} award(s) not comparable · split awards exclude freight/packing/service`
      : 'first quotation → final, like-for-like',
    perf.negotiationPctOfFirstOffer != null ? `${fmtPct(perf.negotiationPctOfFirstOffer)} of first offer` : undefined,
  ].filter(Boolean).join(' · ')

  // Budget savings in the red is a governance signal, not just a red bar — say so in words.
  const budDanger = perf.budget < 0
  const budCaption = budDanger
    ? `over allocation${perf.budNotComparable > 0 ? ` · ${perf.budNotComparable} with no allocation` : ''}`
    : (perf.budNotComparable > 0 ? `${perf.budNotComparable} with no allocation` : undefined)

  const auctionSub = perf.auctionPct != null ? `median ${fmtPct(perf.auctionPct)} below opening` : 'no closed auctions'
  const delaySub = `${perf.exposure.pastGraceCount} past grace · ${fmtInr(perf.exposure.realisedInr)} realised`

  const participationSub = `${perf.quoted} quoted of ${perf.invited} invited`
    + (perf.vendorsPerAward != null ? ` · ${perf.vendorsPerAward.toFixed(1)} vendors per award` : '')

  const singleQuoteSub = `of ${perf.awardCount} award(s)`
  // `perf.awardCount` counts SPLIT awards only (`isAwardBased`), while the funnel's Awarded counts
  // either award shape. Both bases are captioned rather than one being "fixed" in isolation — same
  // rule as the documented two-cheapest-vendors basis clash in CLAUDE.md.
  const singleQuoteCaption = 'decided against one quoting vendor · split awards only'

  const commitmentsSub = `${fmtInr(perf.poIssued)} PO issued · ${fmtInr(perf.paid)} paid`
  // The figure is plant-scoped; the accounts queue it links to is not, so say so rather than
  // handing a scoped number to an unscoped list without a word.
  const commitmentsCaption = plant ? 'outstanding · the accounts queue is not plant-filtered' : 'outstanding'

  const concentrationValue = perf.concentration.topVendorSharePct != null
    ? fmtPct(perf.concentration.topVendorSharePct) : '—'
  const concentrationSub = perf.concentration.top3SharePct != null
    ? `top 3 vendors: ${fmtPct(perf.concentration.top3SharePct)} combined`
    : 'no awarded spend yet'
  const concentrationCaption = perf.concentration.topVendorName
    ? `top vendor: ${perf.concentration.topVendorName}` : undefined

  const mineSub = mineHead.items > 0
    ? `oldest ${fmtDays(mineHead.oldestDays)}${mineHead.top ? ` · biggest: ${mineHead.top.label} (${mineHead.top.count})` : ''}`
    : 'nothing is blocked on you'
  const waitSub = waitHead.items > 0
    ? `oldest ${fmtDays(waitHead.oldestDays)}${waitHead.top ? ` · most with ${waitHead.top.label} (${waitHead.top.count})` : ''}`
    : 'nothing is in someone else’s court'
  // ── The threshold tile measures only PART of the band, and says so ──
  // `SLA_DAYS` has no `sourcing` entry, so 5 of the 8 ① buckets (new requests to pick up, quotations
  // to review, INCO terms to settle, ready to award, auction ended-not-awarded) carry no `slaKey` and
  // can never breach anything. Counting only breaches therefore renders 0 while a month-old quotation
  // sits on the desk — and `tone='good'` would paint that emerald "all clear". So: the label says
  // "where set", the sub states the coverage, the caption names the uncounted population WITH its
  // oldest age (the figure that would have raised the alarm), and the tone is never `good` unless
  // every live queue in scope actually has a threshold to measure against.
  const breachedItems = mineHead.breachedItems + waitHead.breachedItems
  const unmeasurableItems = mineHead.unmeasurableItems + waitHead.unmeasurableItems
  const unmeasurableOldest = [mineHead.unmeasurableOldestDays, waitHead.unmeasurableOldestDays]
    .filter((d): d is number => d != null)
    .reduce<number | null>((a, b) => (a == null || b > a ? b : a), null)
  const measuredQueues = mineHead.measuredBuckets + waitHead.measuredBuckets
  const liveQueues = measuredQueues + mineHead.unmeasurableBuckets + waitHead.unmeasurableBuckets
  const breachedSub = `${mineHead.breachedItems} on you · ${waitHead.breachedItems} with others`
    + (liveQueues > 0 ? ` · measured over ${measuredQueues} of ${liveQueues} live queues` : '')
  const thresholdCaption = unmeasurableItems > 0
    ? `${unmeasurableItems} item(s) sit in queues with NO threshold defined`
      + `${unmeasurableOldest != null ? ` (oldest ${fmtDays(unmeasurableOldest)})` : ''}`
      + ' and are not counted here — see Aging, which measures every wait'
    : 'every live queue in scope has a threshold · thresholds are placeholders, not a measured SLA policy'
  const thresholdTone: 'danger' | 'neutral' | 'good' =
    breachedItems > 0 ? 'danger' : unmeasurableItems > 0 ? 'neutral' : 'good'
  const auctionWatchSub = liveAuctions.length > 0 && nextAuctionEnd
    ? `next closes in ${formatAuctionCountdown(nextAuctionEnd)}`
    : 'none live right now'

  const oldestBucket = aging.buckets[aging.buckets.length - 1]
  const oldestItems = aging.items.filter(i => i.bucket === oldestBucket?.label)
  const undatedItems = aging.items.filter(i => i.days == null)
  const agingWords = aging.population === 0
    ? `No live requests in ${scopeWords} — everything here is draft, completed or rejected.`
    : aging.dated === 0
      ? `No live request in ${scopeWords} currently has anyone holding it, so there is nothing to age.`
      : oldestBucket && oldestBucket.count > 0
      ? `${oldestBucket.count} of ${aging.dated} live request(s) have been waiting ${oldestBucket.label.replace('+', '')} days or more`
        + ` — the oldest is ${oldestItems[0]?.requestNo} at ${fmtDays(oldestItems[0]?.days ?? null)} with ${oldestItems[0]?.partyLabel}.`
      : `Nothing has been waiting 14 days or more — the oldest live wait is ${fmtDays(aging.items[0]?.days ?? null)}.`

  return (
    <div className={`${PAGE_SHELL} space-y-4`}>
      <DashboardHeader
        title="Sourcing Cockpit"
        description={`${scopeWords} · what is blocked on you, who you are waiting on, and what your negotiations delivered.`}
      >
        <div role="group" aria-label="Filter the dashboard by plant" className="flex flex-wrap gap-1.5">
          <PlantChip label="All plants" count={requests.length} active={!plant} onClick={() => setPlant(null)} />
          {plantChips.map(p => (
            <PlantChip
              key={p.value} label={p.label} count={p.count}
              active={plant === p.value} onClick={() => setPlant(p.value)}
            />
          ))}
        </div>
        {showNoPlantNote && (
          <p className={`text-[11px] text-slate-500 ${PROSE}`}>
            {noPlantRequests} request(s) have no plant on the record — inside “All plants”, but in no plant
            chip, so no plant lens can isolate them.
          </p>
        )}
        {ignoredPlant && (
          <p role="status" className={`text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 ${PROSE}`}>
            The plant filter “{ignoredPlant}” was ignored — no such plant. Showing all plants.
          </p>
        )}
      </DashboardHeader>

      <DashboardTabs
        tabs={[{ key: 'desk', label: 'Desk' }, { key: 'performance', label: 'Performance' }]}
        /* Hero band — the few numbers that decide what to do next, before any detail. It sits in the
           toolbar slot: directly UNDER the tab bar (it used to float above it, reading as detached
           from the tabs) and outside the scrolling panel, so it stays visible on both tabs. */
        toolbar={() => (
          <DashboardSection
            level={2}
            title="Act on this first"
            caption={`${scopeWords} · headline only — the detail is in the bands below`}
          >
            <KpiGrid>
              <KpiTile
                label="On your desk" value={String(mineHead.items)} icon={Inbox}
                tone={mineHead.breachedItems > 0 ? 'warn' : mineHead.items > 0 ? 'neutral' : 'good'}
                sub={mineSub}
                caption={mineHead.breachedItems > 0
                  ? `${mineHead.breachedItems} past its threshold`
                  : mineHead.unmeasurableItems > 0
                    ? `no threshold is defined for ${mineHead.unmeasurableItems} of these`
                    : undefined}
              />
              <KpiTile
                label="Past threshold (where set)" value={String(breachedItems)} icon={AlertTriangle}
                tone={thresholdTone}
                sub={breachedSub}
                caption={thresholdCaption}
              />
              <KpiTile
                label="Waiting on others" value={String(waitHead.items)} icon={Hourglass}
                sub={waitSub}
              />
              <KpiTile
                label="Live auctions" value={String(liveAuctions.length)} icon={Gavel}
                tone={liveAuctions.length > 0 ? 'warn' : 'neutral'}
                sub={auctionWatchSub}
              />
            </KpiGrid>
          </DashboardSection>
        )}
      >
        {active => active === 'desk' ? (
          <>
            {/* The two queues are the same kind of thing read against each other, so they sit side
                by side rather than stacked full-bleed one above the other. */}
            <DashboardGrid cols={2}>
              <DashboardSection
                level={2}
                title="Your turn"
                caption={`blocked on you, by step · ${mineHead.items} item(s) · thresholds from SLA_DAYS (placeholders)`}
                card
              >
                <ActionQueue
                  title="Blocked on you, by step" variant="mine" buckets={bands.mine}
                  emptyText="Nothing is blocked on you right now." showTitle={false} bare
                />
              </DashboardSection>

              <DashboardSection
                level={2}
                title="Waiting on others"
                caption={`chase list, by who holds it · ${waitHead.items} item(s) in someone else’s court`}
                card
              >
                <ActionQueue
                  title="Chase list, by who holds it" variant="waiting" buckets={bands.waiting}
                  emptyText="Nothing is in someone else's court." showTitle={false} bare
                />
              </DashboardSection>
            </DashboardGrid>

            {liveAuctions.length > 0 && (
              <DashboardSection
                level={2}
                title="Auction watch" caption="live bidding — closes on the clock"
                card
              >
                <ul className="divide-y divide-border">
                  {liveAuctions.map(r => {
                    const reqInvites = byRequest.get(r.id) ?? []
                    const best = computeAuctionBestPrice(reqInvites, r.lineItems, r.auctionConfig)
                    return (
                      <li key={r.id}>
                        <Link
                          href={`/capex/${r.id}`}
                          className="flex items-center gap-3 px-3 py-2 min-h-[44px] text-[13px] hover:bg-[#EBF0FB]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563EB]"
                        >
                          <span className="font-semibold text-primary shrink-0">
                            {r.requestNo ?? r.id.slice(0, 8)}
                          </span>
                          <span className="flex-1 min-w-0 truncate text-slate-600">{r.subject}</span>
                          <span className="text-slate-500 shrink-0">{reqInvites.length} bidders</span>
                          <span className="font-semibold text-emerald-700 shrink-0">
                            {best != null ? fmtInr(best) : '—'}
                          </span>
                          <span className="text-slate-500 tabular-nums shrink-0">
                            {r.auctionConfig ? formatAuctionCountdown(r.auctionConfig.endsAt) : '—'}
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </DashboardSection>
            )}

            <DashboardSection
              level={2}
              title="Aging"
              caption={`how long live work has been sitting · ${aging.population} live request(s) in ${scopeWords}, by how long the current holder has had them`}
              card
            >
              <p className={`text-[11px] text-slate-500 mb-3 ${PROSE}`}>
                Buckets are 0-3 / 3-7 / 7-14 / 14+ days, upper bound exclusive (a wait of exactly 7 days
                is in 7-14). {aging.dated} of {aging.population} live request(s) have someone holding them
                and are bucketed below
                {aging.undated > 0
                  ? `; ${aging.undated} ${aging.undated === 1 ? 'has' : 'have'} nobody holding`
                    + ` ${aging.undated === 1 ? 'it' : 'them'} and ${aging.undated === 1 ? 'is' : 'are'}`
                    + ' excluded rather than counted as 0 days — listed below.'
                  : '.'}
              </p>
              {/* All-zero buckets would render four empty rails; say nothing is live instead. */}
              {aging.dated === 0 ? (
                <EmptyState>Nothing to age in {scopeWords}.</EmptyState>
              ) : (
                <ChartFrame size="md" minWidth={300}>
                  <GroupedBarChart
                    groups={aging.buckets.map((b, i) => ({
                      label: `${b.label} days`,
                      sub: i === aging.buckets.length - 1
                        ? 'oldest bucket — the one that matters' : undefined,
                      values: { count: b.count },
                      // The oldest bucket now DOES get the red treatment. It used to be left off
                      // because `GroupedBarChart` hardcoded "over allocation" into its legend and
                      // aria-label — a budget noun over aging data — and a wrong label is worse than
                      // a missing colour. With `overLabel` the chart says what this red actually
                      // means, so the colour, the badge, the legend and the aria all agree with the
                      // red callout below, which still names, counts and lists the rows.
                      over: i === aging.buckets.length - 1 && b.count > 0,
                    }))}
                    measures={[{ key: 'count', label: 'Live requests', color: '#2563EB' }]}
                    overLabel="Oldest bucket"
                    ariaLabel="Live requests by wait age"
                    emptyText="No live requests in this scope."
                  />
                </ChartFrame>
              )}

              <div
                className={`mt-3 rounded-lg border px-3 py-2 ${
                  oldestItems.length > 0 ? 'border-red-200 bg-red-50' : 'border-border bg-slate-50'
                }`}
              >
                <p className={`text-xs font-semibold ${PROSE} ${oldestItems.length > 0 ? 'text-red-800' : 'text-slate-600'}`}>
                  {agingWords}
                </p>
                {oldestItems.length > 0 && (
                  <>
                    <ul className="mt-1.5 divide-y divide-red-100">
                      {oldestItems.slice(0, 5).map(item => (
                        <AgingRow key={item.requestId} item={item} tone="late" />
                      ))}
                    </ul>
                    {oldestItems.length > 5 && (
                      <p className="text-[11px] text-red-800 mt-1">
                        Showing the 5 oldest of {oldestItems.length}.
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* An excluded row is only actionable if it can be found: name it, don't just count it.
                  A live request with no holder is normally award-based with every award complete —
                  i.e. one that should probably be closed — so it is an anomaly worth surfacing, and it
                  appears in NO bucket list above. Amber, not red: it is not late, it is unaccounted. */}
              {undatedItems.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className={`text-xs font-semibold text-amber-900 ${PROSE}`}>
                    {undatedItems.length === 1
                      ? '1 live request has nobody holding it'
                      : `${undatedItems.length} live requests have nobody holding them`}
                    {' '}— excluded from every bucket above rather than counted as a 0-day wait:
                  </p>
                  <ul className="mt-1.5 divide-y divide-amber-100">
                    {undatedItems.slice(0, 5).map(item => (
                      <AgingRow key={item.requestId} item={item} tone="undated" />
                    ))}
                  </ul>
                  {undatedItems.length > 5 && (
                    <p className="text-[11px] text-amber-900 mt-1">
                      Showing 5 of {undatedItems.length}.
                    </p>
                  )}
                </div>
              )}
            </DashboardSection>
          </>
        ) : (
          <>
            <DashboardSection
              level={2}
              title="Outcomes" caption={`negotiated result across ${scopeWords}`}
              bodyClassName="space-y-4"
            >
              <KpiGrid>
                <KpiTile
                  label="Negotiation savings" value={fmtInr(perf.negotiation)} icon={TrendingDown}
                  tone={perf.negotiation > 0 ? 'good' : 'neutral'}
                  sub={negSub}
                  caption={negCaption}
                />
                <KpiTile
                  label="Budget savings" value={fmtInr(perf.budget)} icon={HandCoins}
                  tone={perf.budget >= 0 ? 'good' : 'danger'}
                  sub="allocation → awarded"
                  caption={budCaption}
                />
                <KpiTile
                  label="Auction effectiveness" value={fmtInr(perf.auctionSaved)} icon={Gavel}
                  tone={perf.auctionSaved > 0 ? 'good' : 'neutral'}
                  sub={auctionSub}
                />
                <KpiTile
                  label="Delay liability" value={fmtInr(perf.exposure.runningInr)} icon={AlertTriangle}
                  tone={perf.exposure.runningInr > 0 ? 'danger' : 'neutral'}
                  sub={delaySub}
                />
              </KpiGrid>

              {/* Four across: participation, single-quote awards, commitments, concentration. */}
              <KpiGrid>
                <KpiTile
                  label="Vendor participation"
                  value={perf.invited > 0 ? fmtPct((perf.quoted / perf.invited) * 100) : '—'}
                  icon={Users}
                  sub={participationSub}
                  href={metricHref('vendor_participation', plant)}
                  ariaLabel={aria(
                    `Vendor participation: ${perf.invited > 0 ? fmtPct((perf.quoted / perf.invited) * 100) : 'no vendors invited yet'}`,
                    participationSub,
                  )}
                />
                <KpiTile
                  label="Single-quote awards" value={String(perf.singleQuoteAwards)} icon={AlertTriangle}
                  tone={perf.singleQuoteAwards > 0 ? 'warn' : 'good'}
                  sub={singleQuoteSub}
                  caption={singleQuoteCaption}
                />
                <KpiTile
                  label="Commitments" value={fmtInr(perf.outstanding)} icon={Truck}
                  sub={commitmentsSub}
                  caption={commitmentsCaption}
                  href="/accounts/queue"
                  ariaLabel={aria(`Commitments outstanding: ${fmtInr(perf.outstanding)}`, commitmentsSub, commitmentsCaption)}
                />
                <KpiTile
                  label="Spend concentration" value={concentrationValue} icon={PieChart}
                  sub={concentrationSub}
                  caption={concentrationCaption}
                />
              </KpiGrid>
            </DashboardSection>

            <DashboardSection
              level={2}
              title="Cycle time, leg by leg"
              caption="duration percentiles · p50 and p90 over finished work only — the still-open count is what stops that from reading fast"
              bodyClassName="space-y-3"
            >
              <p className={`text-[11px] text-slate-500 ${PROSE}`}>
                The three per-invite legs share one rail so their markers are comparable; the
                per-request cycle above is a different unit (whole requests, not single legs) and scales
                on its own.
              </p>
              {/* Four cards on the OUTER grid, not four columns inside one padded card — the track
                  rule in `layout.tsx`. Inside a card these sat 17px off the chart grid below them. */}
              <DashboardGrid cols={2}>
                <PercentileCard
                  label="Sourcing cycle time" basis="sourcing → PI requested, per request"
                  pct={cyclePct} metric="sourcing_cycle" plant={plant} icon={Timer}
                />
                <PercentileCard
                  label="Invite → first quote" basis="per vendor invite"
                  pct={legs.firstQuote} max={legMax} metric="invite_first_quote" plant={plant} icon={Clock}
                />
                <PercentileCard
                  label="First quote → agreed" basis="per vendor invite"
                  pct={legs.negotiation} max={legMax} metric="first_quote_agreed" plant={plant} icon={Clock}
                />
                <PercentileCard
                  label="Tech-spec gate" basis="spec sent → decided, per vendor invite"
                  pct={legs.techSpec} max={legMax} metric="tech_spec_gate" plant={plant} icon={Clock}
                />
              </DashboardGrid>
            </DashboardSection>

            <DashboardSection
              level={2}
              title="Charts"
              caption={`flow, funnel, coverage and measured stock — all scoped to ${scopeWords}`}
              bodyClassName="space-y-4"
            >
              <DashboardGrid cols={2}>
                <ChartCard
                  title="Flow through sourcing"
                  caption={`Requests raised, awarded (first reached PI requested) and completed per month — ${flow.length} of the last ${TREND_MONTHS} months, months before the first activity are not drawn. Value awarded is on its own right-hand axis.`}
                >
                  <TrendChart
                    height={200}
                    series={[
                      { key: 'raised', label: 'Raised', color: '#2563EB', points: flow.map(p => ({ x: p.month, y: p.raised })) },
                      { key: 'awarded', label: 'Awarded', color: '#7C3AED', points: flow.map(p => ({ x: p.month, y: p.awarded })) },
                      { key: 'completed', label: 'Completed', color: '#059669', points: flow.map(p => ({ x: p.month, y: p.completed })) },
                      {
                        key: 'value', label: 'Value awarded', color: '#0891B2', axis: 'right', area: true,
                        formatValue: fmtInr, points: flow.map(p => ({ x: p.month, y: p.valueAwardedInr })),
                      },
                    ]}
                    ariaLabel="Monthly sourcing flow"
                    emptyText="No requests in this scope yet."
                  />
                </ChartCard>

                <ChartCard
                  title="Sourcing funnel"
                  caption="Counted in VENDOR INVITES, not requests: one request can invite five vendors and award two. Negotiated = an RFQ quotation reached approved, or the invite won an auction. Awarded counts EITHER award shape — a split award or a single finalized vendor — so it can exceed the “of N award(s)” figure on the Single-quote tile above, which counts split awards only."
                >
                  <FunnelChart
                    stages={[
                      { key: 'invited', label: 'Invited', value: funnel.invited },
                      { key: 'quoted', label: 'Quoted', value: funnel.quoted },
                      { key: 'negotiated', label: 'Negotiated', value: funnel.negotiated },
                      { key: 'awarded', label: 'Awarded', value: funnel.awarded },
                    ]}
                    ariaLabel="Sourcing funnel by vendor invite"
                    emptyText="No vendors invited in this scope yet."
                  />
                </ChartCard>

                <ChartCard
                  title="Quote coverage by plant"
                  caption="Vendor invites, how many quoted, and how many won, per plant in the current scope. A plant where nobody quoted is named in words below its bars."
                >
                  <GroupedBarChart
                    groups={participation.map(p => ({
                      label: p.plant ? plantLabel(p.plant) : 'No plant on the record',
                      sub: p.invited === 0
                        ? `${p.requests} request(s) · no vendor invited yet`
                        : p.quoted === 0
                          ? `${p.requests} request(s) · no vendor quoted yet`
                          : `${p.requests} request(s)`,
                      values: { invited: p.invited, quoted: p.quoted, awarded: p.awarded },
                    }))}
                    measures={[
                      { key: 'invited', label: 'Invited', color: '#64748B' },
                      { key: 'quoted', label: 'Quoted', color: '#2563EB' },
                      { key: 'awarded', label: 'Awarded', color: '#059669' },
                    ]}
                    ariaLabel="Vendor invites, quotes and awards per plant"
                    emptyText="No requests in this scope yet."
                  />
                </ChartCard>

                {SHOW_MEASURED_STOCK_HISTORY && (
                <ChartCard
                  title="Measured stock history"
                  caption={`${FIELD_TYPE_LABELS[mix.dominant]} budget commitment and payment for ${scopeWords}`
                    + `, measured once per day the portal is opened — never backfilled, and a gap is a real`
                    + ` unmeasured day, not a zero. PORTFOLIO-WIDE: every request`
                    + `${plant ? ` at ${scopeWords}` : ' across all plants'}, not only the ${mix.requests} assigned to you`
                    + (mix.others > 0 ? `; ${mix.others} of your request(s) are in another field type and are NOT in this series` : '')
                    + `. Open sourcing load and pending quotations are measured on the same daily pass, but`
                    + ` started later than the money series, so each states its OWN start date and the days`
                    + ` before it are gaps, not zeros.`}
                >
                  <div className="space-y-4">
                    <div>
                      <p className="text-[11px] font-semibold text-slate-600 mb-1">Committed (est.)</p>
                      <MeasuredSeriesChart
                        measured={committedSeries} measuredFrom={snapshotFrom} formatValue={fmtInr}
                        height={150} ariaLabel={`Measured ${FIELD_TYPE_LABELS[mix.dominant]} commitment`}
                        emptyText="Not measured yet for this scope — a point is written once a day the portal is opened."
                      />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-600 mb-1">Paid</p>
                      <MeasuredSeriesChart
                        measured={paidSeries} measuredFrom={snapshotFrom} formatValue={fmtInr}
                        height={150} ariaLabel={`Measured ${FIELD_TYPE_LABELS[mix.dominant]} payments`}
                        emptyText="Not measured yet for this scope — a point is written once a day the portal is opened."
                      />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-600 mb-1">
                        Open sourcing load
                        <span className="ml-1.5 font-normal text-slate-400">
                          requests at sourcing / negotiation, counted the same day
                        </span>
                      </p>
                      <MeasuredSeriesChart
                        measured={openLoadSeries} measuredFrom={openLoadFrom}
                        formatValue={n => String(Math.round(n))}
                        height={150} ariaLabel={`Measured open ${FIELD_TYPE_LABELS[mix.dominant]} sourcing load`}
                        emptyText="Not measured yet — this metric started being captured after the money series above."
                      />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-600 mb-1">
                        Vendor invites still awaiting a quotation
                        <span className="ml-1.5 font-normal text-slate-400">
                          on those open requests only
                        </span>
                      </p>
                      <MeasuredSeriesChart
                        measured={pendingQuotesSeries} measuredFrom={pendingQuotesFrom}
                        formatValue={n => String(Math.round(n))}
                        height={150} ariaLabel="Measured vendor invites still awaiting a quotation"
                        emptyText="Not measured yet — this metric started being captured after the money series above."
                      />
                    </div>
                  </div>
                </ChartCard>
                )}
              </DashboardGrid>
            </DashboardSection>

            <DashboardSection
              level={2}
              title="Vendor scorecard" caption="detail, vendor by vendor"
              card
            >
              {perf.scorecard.length === 0 ? (
                <EmptyState>No vendors have been invited in {scopeWords}.</EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <th scope="col" className="px-3 py-2">Vendor</th>
                        <th scope="col" className="px-3 py-2 text-right">Invited</th>
                        <th scope="col" className="px-3 py-2 text-right">Response</th>
                        <th scope="col" className="px-3 py-2 text-right">Median reply</th>
                        <th scope="col" className="px-3 py-2 text-right">Awards</th>
                        <th scope="col" className="px-3 py-2 text-right">Awarded value</th>
                        <th scope="col" className="px-3 py-2 text-right">Share</th>
                        <th scope="col" className="px-3 py-2 text-right">Delay accrued</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {perf.scorecard.map(v => (
                        <tr key={v.vendorId} className="hover:bg-[#EBF0FB]/60">
                          <td className="px-3 py-2 font-semibold text-slate-800">{v.vendorName}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{v.invited}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtPct(v.responseRatePct)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtDays(v.medianResponseDays)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{v.awards}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{fmtInr(v.awardedInr)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                            {perf.concentration.totalAwardedInr > 0
                              ? fmtPct((v.awardedInr / perf.concentration.totalAwardedInr) * 100)
                              : '—'}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${v.delayAccruedInr > 0 ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>
                            {v.delayAccruedInr > 0 ? fmtInr(v.delayAccruedInr) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DashboardSection>
          </>
        )}
      </DashboardTabs>
    </div>
  )
}

/* ── local presentation pieces ─────────────────────────────────────────── */

function PlantChip({
  label, count, active, onClick,
}: {
  label: string; count: number; active: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[44px] px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] ${
        active
          ? 'border-[#2563EB] bg-[#EBF0FB] text-[#1D4ED8]'
          : 'border-border bg-card text-slate-600 hover:border-slate-300'
      }`}
    >
      {label}
      <span className={`ml-1.5 tabular-nums font-bold ${active ? 'text-[#1D4ED8]' : 'text-slate-400'}`}>
        {count}
      </span>
    </button>
  )
}

/**
 * NOTE: the band heading that used to live here is now `DashboardSection level={2}` (see
 * `./Section.tsx`). Two components did this one job — this one and `DashboardSection` — written
 * concurrently for the two dashboards; they are merged so the heading level and the
 * `aria-labelledby` wiring can only ever be defined once. The card title this component used to
 * render by hand (a fourth heading treatment: uppercase, `<h3>`, slate-400) is now the same
 * primitive at `level={3}`, so a chart card and a band cannot drift apart again.
 */

/** Every chart scrolls inside its own frame so a narrow content column never scrolls the page. */
function ChartCard({
  title, caption, children,
}: {
  title: string; caption?: string; children: React.ReactNode
}) {
  return (
    <DashboardSection title={title} level={3} caption={caption} card>
      <ChartFrame size="lg">{children}</ChartFrame>
    </DashboardSection>
  )
}

/**
 * One duration leg: p50 AND p90 on one rail, with `sampled` / `stillOpen` always visible
 * (`PercentileBar` renders them unconditionally — a percentile over finished work only, printed
 * without how much is still running, reads fastest exactly when the most work is stuck).
 *
 * The link is stage 4's cohort route for this metric, with the plant lens threaded through, so the
 * destination is the SAMPLE the number was measured over — scoped the same way the figure is.
 */
function PercentileCard({
  label, basis, pct, max, metric, plant, icon: Icon,
}: {
  label: string
  basis: string
  pct: StagePercentiles
  /** Shared rail max. Omit to let `PercentileBar` pad its own domain — see the legs/cycle note above. */
  max?: number
  metric: MetricKey
  plant: string | null
  icon: LucideIcon
}) {
  const note = sampleNote(pct.sampled)
  const headline = pct.p50 == null
    ? 'no completions yet'
    : `p50 ${fmtDays(pct.p50)} · p90 ${fmtDays(pct.p90)}`
  const linkText = pct.sampled === 0
    ? `See why nothing is measured yet (${pct.stillOpen} still open)`
    : `See the ${pct.sampled} measured sample${pct.sampled === 1 ? '' : 's'}`
  // WCAG 2.5.3 (Label in Name): the accessible name must CONTAIN the visible label, or a speech-input
  // user cannot activate the link by saying what they see — and a screen-reader user tabbing by links
  // hears a statistic with no hint that it goes anywhere. So the visible text leads, and the figures
  // follow as context.
  const ariaLabel = aria(
    linkText,
    `${label}: ${headline}`,
    `${pct.sampled} sampled, ${pct.stillOpen} still open and not counted`,
    basis,
    note || undefined,
  )

  return (
    <div className={`${CARD} space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 truncate">{label}</h3>
          <p className="text-lg font-black tracking-tight text-slate-900 tabular-nums leading-tight">
            {pct.p50 == null ? '—' : fmtDays(pct.p50)}
            {/* Slate, NOT amber: `PercentileBar`'s p90 marker is #334155 and its own comment records
                that amber was rejected because this design system reads amber as `warn`. A long tail
                is a tail, not a breach, and the headline must match the marker beneath it. */}
            <span className="ml-2 text-sm font-bold text-slate-700">
              {pct.p90 == null ? '' : `p90 ${fmtDays(pct.p90)}`}
            </span>
          </p>
          <p className="text-[10px] text-slate-400 italic">{basis}</p>
        </div>
        <Icon aria-hidden="true" className="w-4 h-4 text-slate-300 shrink-0" />
      </div>

      <PercentileBar
        p50={pct.p50} p90={pct.p90} sampled={pct.sampled} stillOpen={pct.stillOpen}
        max={max} formatValue={n => fmtDays(n)} ariaLabel={`${label} percentiles`}
      />

      {note && <p className="text-[11px] font-semibold text-amber-700">{note}</p>}

      <Link
        href={metricHref(metric, plant)}
        aria-label={ariaLabel}
        className="inline-flex items-center min-h-[44px] text-[12px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded"
      >
        {linkText} →
      </Link>
    </div>
  )
}

function AgingRow({ item, tone }: { item: AgingItem; tone: 'late' | 'undated' }) {
  return (
    <li>
      <Link
        href={`/capex/${item.requestId}`}
        className="flex items-center gap-2 px-1 py-2 min-h-[44px] text-[12px] hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563EB]"
      >
        <span className="font-semibold text-primary shrink-0">{item.requestNo}</span>
        <span className="flex-1 min-w-0 truncate text-slate-700">{item.subject}</span>
        <span className="text-slate-500 shrink-0">
          {tone === 'undated' ? 'nobody holding it' : `with ${item.partyLabel}`}
        </span>
        <span className={`font-bold tabular-nums shrink-0 ${tone === 'undated' ? 'text-amber-900' : 'text-red-700'}`}>
          {tone === 'undated' ? 'no wait to measure' : fmtDays(item.days)}
        </span>
        {item.breached && (
          <span className="text-[10px] font-bold text-red-700 border border-red-200 rounded-full px-1.5 shrink-0">
            past threshold
          </span>
        )}
      </Link>
    </li>
  )
}
