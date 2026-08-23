'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle, ClipboardCheck, Layers, Scissors, Timer, TrendingDown, XCircle,
} from 'lucide-react'
import type {
  AdhocBudgetRequest, BrownFieldHeadBudget, BudgetProposal, CapexMasterItem,
  CapexRequest, FieldType, PlantMeta, ProjectType, VendorInvite,
} from '@/lib/types'
import { FIELD_TYPE_LABELS, CAPEX_STATUS_FLOW } from '@/lib/types'
import { PLANTS, STATUS_LABELS } from '@/lib/constants'
import { PAGE_SHELL } from '@/lib/uiTokens'
import {
  MasterIndex, PARTY_LABELS, SLA_DAYS, ballHolders, medianStageDays, statusTally,
} from '@/lib/kpiUtils'
import { adminQueues } from '@/lib/kpiQueues'
import { metricHref, type MetricKey } from '@/lib/kpiRoutes'
import { fyBudgetPosition, headPositions, valueFunnel } from '@/lib/kpiPortfolio'
import { liveFyByPlant, plantHeadUtilisation, plantKpis } from '@/lib/kpiPlants'
import { monthlyFlow, trimLeadingEmptyMonths } from '@/lib/kpiTrends'
import { measuredFrom, snapshotSeries, type KpiSnapshot } from '@/lib/kpiSnapshots'
import { delayLiabilityExposure } from '@/lib/kpiRisk'
import { getLatestMasterFyForField, resolveProjectType } from '@/lib/greenFieldConstants'
import { approverEditImpact, proposalTotalCr } from '@/lib/budgetProposalUtils'
import { awardedInvites, finalPaymentBlockedByTrial, isAwardBased } from '@/lib/paymentUtils'
import { incoTermsBlocksAward } from '@/lib/incoTermsUtils'
import { techSpecBlocksAward } from '@/lib/techSpecUtils'
import { ActionQueue } from './ActionQueue'
import { DashboardTabs } from './DashboardTabs'
import { KpiTile } from './KpiTile'
import { DashboardSection } from './Section'
import {
  ChartFrame, DashboardGrid, DashboardHeader, EmptyState, KpiGrid, PROSE,
} from './layout'
import { PlantLens } from './PlantLens'
import { PlantComparison, lateLabel, type PlantRow } from './PlantComparison'
import { FunnelChart, GroupedBarChart, MeasuredSeriesChart, TrendChart } from './charts'
import { approverEditPresentation, aria, fmtCr, fmtDays, fmtInr, fmtPct } from './format'

const FIELD_TYPES: FieldType[] = ['brown_field', 'green_field', 'digitisation', 'information_technology']

/** Months of flow history on the trend chart. */
const TREND_MONTHS = 12

/**
 * Hidden for now (2026-08-19) at the product owner's request — the measured daily stock charts are
 * off the Portfolio tab until they have enough measured days to read well. The JSX and the whole
 * `kpiSnapshots` derivation below are DELIBERATELY LEFT IN PLACE: the capture effect in
 * `CapexProvider` keeps writing a record a day, so re-enabling this is flipping the flag, not
 * rebuilding a history that cannot be reconstructed after the fact (see `kpiSnapshots.ts`).
 */
const SHOW_MEASURED_STOCK_HISTORY = false

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'YYYY-MM' → 'Aug 26'. Pure string work — no clock read, no locale dependency. */
function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y.slice(2)}`
}

/**
 * The four portfolio headline figures are `KpiTile size="lg"` — louder type than the tiles below
 * (that hierarchy was the point of the old local `HeroFigure`), but the SAME component, so they sit
 * on the same grid tracks and share the same internal zones. They used to be four columns of an
 * inner grid inside one padded card, which put them 17px off the tile row directly beneath them.
 * See the track rule in `layout.tsx`.
 */

export function AdminDashboard({
  requests, byRequest, index, now, capexMaster,
  budgetProposals, adhocBudgetRequests, brownFieldHeadAllocations, usedAmountByMasterItemId,
  customPlants, snapshots,
}: {
  requests: CapexRequest[]
  byRequest: Map<string, VendorInvite[]>
  index: MasterIndex
  now: number
  capexMaster: CapexMasterItem[]
  budgetProposals: BudgetProposal[]
  adhocBudgetRequests: AdhocBudgetRequest[]
  brownFieldHeadAllocations: BrownFieldHeadBudget[]
  usedAmountByMasterItemId: Record<string, number>
  /** Runtime-created plants — plant labels resolve PLANTS → customPlants → raw value. */
  customPlants: PlantMeta[]
  /** MEASURED daily stock-metric history. Never reconstructed — see `kpiSnapshots.ts`. */
  snapshots: KpiSnapshot[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  /* ── plant lens ─────────────────────────────────────────────────────── */

  const plantLabel = useMemo(() => {
    const labels = new Map<string, string>()
    for (const p of PLANTS) labels.set(p.value, p.label)
    for (const p of customPlants) if (!labels.has(p.value)) labels.set(p.value, p.label)
    // Raw plant keys (`jhajjar_p1`) are never shown to a user. The last resort for a plant that
    // exists only on old data (today: `pune`, which is in neither list) humanises its own key rather
    // than inventing a name — derived from the value, never fabricated.
    return (value: string) => labels.get(value)
      ?? value.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase())
  }, [customPlants])

  /** Plants that have either a budget or a request — the only ones there is anything to show for. */
  const plantOptions = useMemo(() => {
    const values = new Set<string>()
    for (const m of capexMaster) if (m.plant) values.add(m.plant)
    for (const r of requests) if (r.plant) values.add(r.plant)
    return [...values]
      .map(value => ({ value, label: plantLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [capexMaster, requests, plantLabel])

  const requestedPlant = params.get('plant')
  const activePlant = requestedPlant && plantOptions.some(p => p.value === requestedPlant)
    ? requestedPlant
    : null
  // A `?plant=` we cannot honour is disclosed, never silently dropped — otherwise a stale link shows
  // the whole portfolio while claiming to be one plant's view.
  const unknownPlantParam = requestedPlant && !activePlant ? requestedPlant : null

  const setPlant = (value: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set('plant', value)
    else next.delete('plant')
    const qs = next.toString()
    // `replace`, not `push` — same reasoning as the tab switch: a filter change is not a navigation
    // step a reader wants to walk back through.
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const scopeName = activePlant ? plantLabel(activePlant) : 'all plants'

  /* ── scoped inputs ──────────────────────────────────────────────────── */

  const scopedRequests = useMemo(
    () => (activePlant ? requests.filter(r => r.plant === activePlant) : requests),
    [requests, activePlant],
  )
  const scopedProposals = useMemo(
    () => (activePlant ? budgetProposals.filter(p => p.plant === activePlant) : budgetProposals),
    [budgetProposals, activePlant],
  )

  /* ── approver desk (deliberately portfolio-wide — see the note on the tab) ── */

  const bands = useMemo(
    () => adminQueues(requests, byRequest, budgetProposals, adhocBudgetRequests, now),
    [requests, byRequest, budgetProposals, adhocBudgetRequests, now],
  )

  /* ── portfolio (plant-scoped) ───────────────────────────────────────── */

  const portfolio = useMemo(() => {
    // THE per-plant FY rule, from `kpiPlants.liveFyByPlant` — the only implementation of the rule in
    // the codebase. Four passes over `capexMaster`, one per field type, where the removed inline
    // builder made one keyed on both: the shared helper takes a single field type, and one function
    // that cannot drift beats one pass at this data size. Its doc comment carries the full reasoning: plants
    // publish next-FY budgets independently, so a single global "latest FY" would either fold a stale
    // year into a live figure or silently drop every row for a plant still on an earlier year.
    const fyByFieldPlant = new Map<FieldType, Map<string, string>>()
    for (const fieldType of FIELD_TYPES) fyByFieldPlant.set(fieldType, liveFyByPlant(capexMaster, fieldType))

    const positions = FIELD_TYPES.map(fieldType => {
      // With a plant selected, the FY is THAT plant's own live year, so the single-global-FY blind
      // spot below simply does not arise for a filtered view.
      //
      // The fallback matters and is not laziness: a plant can carry REQUESTS for a field type it has
      // no published budget for (today's data is exactly that — Brown Field requests at three plants
      // with no Brown Field master row anywhere). Those requests are unlinked, so `requestFy`
      // attributes them to `getLatestMasterFyForField` — the same value used here — and scoping the
      // plant view to "no FY" instead would silently drop committed spend that the all-plants view
      // shows, so the two views would not add up.
      const fy = (activePlant ? fyByFieldPlant.get(fieldType)?.get(activePlant) : undefined)
        ?? getLatestMasterFyForField(capexMaster, fieldType)
      if (!fy) return null
      return fyBudgetPosition({
        capexMaster, requests: scopedRequests, byRequest,
        scope: { fieldType, fy, plant: activePlant ?? undefined },
      })
    })
      .filter((p): p is NonNullable<typeof p> => p != null)
      .filter(p => p.allocatedInr > 0 || p.committedInr > 0)

    // Spec §10 rule 6 — an aggregate that excludes rows discloses the excluded count.
    // In ALL-PLANTS mode `fyBudgetPosition` scopes each row to ONE global latest FY per field type,
    // so a plant still on an earlier FY contributes nothing to its Allocated or Committed. Counted as
    // DISTINCT plants across all rendered field-type rows — a plant behind on two field types is one
    // missing plant to a reader, not two. Zero when a single plant is selected (its own FY is used).
    const excludedPlantSet = new Set<string>()
    if (!activePlant) {
      for (const p of positions) {
        for (const [plant, fy] of fyByFieldPlant.get(p.scope.fieldType) ?? []) {
          if (fy < p.scope.fy) excludedPlantSet.add(plant)
        }
      }
    }

    const liveFyBrown = fyByFieldPlant.get('brown_field') ?? new Map<string, string>()

    // Over-allocation is a Brown Field concern (that is where adhoc transfers apply), and is the one
    // figure scoped to each plant's OWN live Brown Field FY even in the all-plants roll-up — this is
    // the tile whose entire job is surfacing over-budget plants, so it must never omit one.
    const brownScopes = new Set<string>()
    for (const m of capexMaster) {
      if ((m.fieldType ?? 'brown_field') !== 'brown_field') continue
      if (activePlant && m.plant !== activePlant) continue
      if (m.fy !== liveFyBrown.get(m.plant)) continue
      brownScopes.add(`${m.plant}|${m.fy}|${resolveProjectType(m)}`)
    }
    let overExposureCr = 0
    let breachedHeads = 0
    for (const key of brownScopes) {
      const [plant, fy, projectType] = key.split('|')
      for (const h of headPositions({
        capexMaster, headOverrides: brownFieldHeadAllocations, usedAmountByMasterItemId,
        scope: { plant, fy, projectType: projectType as ProjectType },
      })) {
        if (!h.over) continue
        breachedHeads++
        overExposureCr += h.committedCr - h.allocatedCr
      }
    }

    const editImpact = approverEditImpact(scopedProposals)

    // Governance flags — every one derivable, none inferred.
    let singleQuoteAwards = 0
    let incoOpenAwards = 0
    let techSpecMissing = 0
    let paidWithTrialOpen = 0
    for (const r of scopedRequests) {
      const reqInvites = byRequest.get(r.id) ?? []
      const withQuote = reqInvites.filter(i => i.rfqQuote || i.quotes.length || i.openingQuote)
      if (isAwardBased(reqInvites)) {
        for (const a of awardedInvites(reqInvites)) {
          if (withQuote.length === 1) singleQuoteAwards++
          if (incoTermsBlocksAward(a)) incoOpenAwards++
          if (techSpecBlocksAward(a)) techSpecMissing++
          const paidFinal = (a.paymentMilestones ?? []).some(m => m.isFinal && m.status === 'paid')
          if (paidFinal && finalPaymentBlockedByTrial(a)) paidWithTrialOpen++
        }
        continue
      }
      // Legacy single-vendor RFQ award: `requestProformaInvoice` stamps `finalVendorId` on the
      // REQUEST rather than `awarded` on the invite (capexContext.tsx:1853), so its trial and
      // milestones live request-level too — mirrors `paidForRequest`'s non-award branch. Without
      // this these awards could never be flagged, and a compliance count that can only read low
      // is worse than none.
      if (!r.finalVendorId) continue
      const inv = reqInvites.find(i => i.vendorId === r.finalVendorId)
      if (!inv) continue
      if (withQuote.length === 1) singleQuoteAwards++
      if (incoTermsBlocksAward(inv)) incoOpenAwards++
      if (techSpecBlocksAward(inv)) techSpecMissing++
      const paidFinal = (r.paymentMilestones ?? []).some(m => m.isFinal && m.status === 'paid')
      if (paidFinal && finalPaymentBlockedByTrial(r)) paidWithTrialOpen++
    }

    const stalled = [...scopedRequests]
      .filter(r => r.status !== 'completed' && r.status !== 'rejected' && r.status !== 'draft')
      .map(r => {
        const holds = ballHolders(r, byRequest.get(r.id) ?? [], now)
        return { r, hold: holds.reduce((a, b) => (b.days > a.days ? b : a), holds[0]) }
      })
      .sort((a, b) => b.hold.days - a.hold.days)
      .slice(0, 10)

    // -2 drops BOTH the trailing `rejected` (never a "next" stage) and the nonsense
    // `completed → rejected` pair its inclusion produced, while keeping `payment_in_progress → completed`.
    const stageMedians = CAPEX_STATUS_FLOW.slice(0, -2)
      .map((from, i) => ({ from, to: CAPEX_STATUS_FLOW[i + 1], ...medianStageDays(scopedRequests, from, CAPEX_STATUS_FLOW[i + 1]) }))
      .filter(s => s.medianDays != null)

    // An aggregate across field types has no single `ValueBasis` to caption (the documented
    // carve-out) — the FY basis is captioned on the band instead.
    const totals = positions.reduce(
      (acc, p) => ({
        allocatedInr: acc.allocatedInr + p.allocatedInr,
        committedInr: acc.committedInr + p.committedInr,
        awardedInr: acc.awardedInr + p.awardedInr,
        paidInr: acc.paidInr + p.paidInr,
      }),
      { allocatedInr: 0, committedInr: 0, awardedInr: 0, paidInr: 0 },
    )

    return {
      positions, overExposureCr, breachedHeads, totals,
      excludedPlants: excludedPlantSet.size,
      editTrimCr: editImpact.trimCr, resubmits: editImpact.resubmits,
      singleQuoteAwards, incoOpenAwards, techSpecMissing, paidWithTrialOpen, stalled, stageMedians,
      funnel: valueFunnel(scopedRequests, byRequest, index),
      exposure: delayLiabilityExposure(scopedRequests, byRequest, index, now),
      // `statusTally` is the single home for this denominator — the `rejection_rate` metric route and
      // the Buyer tile read the same function, so the tile and the list it lands on can never
      // disagree about the population. It also returns 0%, not NaN, on an empty set.
      tally: statusTally(scopedRequests),
      // Trimmed of the leading dead months so the line spans the plot — see `trimLeadingEmptyMonths`.
      flow: trimLeadingEmptyMonths(monthlyFlow(scopedRequests, byRequest, index, { now, months: TREND_MONTHS })),
    }
  }, [
    capexMaster, scopedRequests, byRequest, index, now,
    scopedProposals, brownFieldHeadAllocations, usedAmountByMasterItemId, activePlant,
  ])

  /* ── plant comparison (always every plant — a comparison of one is not a comparison) ── */

  const comparison = useMemo(() => {
    const plants = plantOptions.map(p => p.value)
    const fyByPlant = liveFyByPlant(capexMaster, 'brown_field')
    const rows: PlantRow[] = plantKpis({
      plants, capexMaster, requests, byRequest, index,
      headOverrides: brownFieldHeadAllocations, usedAmountByMasterItemId, now,
    }).map(k => ({ ...k, label: plantLabel(k.plant), fy: fyByPlant.get(k.plant) ?? null }))
    return {
      rows,
      heatmap: plantHeadUtilisation({
        plants, capexMaster, headOverrides: brownFieldHeadAllocations, usedAmountByMasterItemId,
      }),
    }
  }, [
    plantOptions, capexMaster, requests, byRequest, index,
    brownFieldHeadAllocations, usedAmountByMasterItemId, now, plantLabel,
  ])

  /* ── measured stock series (plant-scoped: the roll-up when no plant is selected) ── */

  const snapshotScope = useMemo(
    () => ({ fieldType: 'brown_field' as FieldType, plant: activePlant }),
    [activePlant],
  )
  const committedSeries = useMemo(
    () => snapshotSeries(snapshots, snapshotScope, 'committedInr'),
    [snapshots, snapshotScope],
  )
  const exposureSeries = useMemo(
    () => snapshotSeries(snapshots, snapshotScope, 'overExposureCr'),
    [snapshots, snapshotScope],
  )
  const snapshotStart = useMemo(() => measuredFrom(snapshots, snapshotScope), [snapshots, snapshotScope])

  /* ── copy (hoisted so visible text and aria-labels can never drift) ──── */

  const pendingAdminCr = budgetProposals
    .filter(p => p.status === 'pending_admin')
    .reduce((s, p) => s + proposalTotalCr(p), 0)

  const proposalsBucket = bands.mine.find(b => b.key === 'proposals')
  const adhocBucket = bands.mine.find(b => b.key === 'adhoc')
  const accountsLinkBucket = bands.mine.find(b => b.key === 'accountsLink')
  const stuckPlantHeadBucket = bands.mine.find(b => b.key === 'stuckPlantHead')
  const stuckPlantHeadCount = stuckPlantHeadBucket?.count ?? 0

  const proposalsSub = proposalsBucket?.breached
    ? `${fmtCr(pendingAdminCr)} · past SLA`
    : fmtCr(pendingAdminCr)
  const adhocSub = fmtCr(adhocBucket?.amountCr ?? 0)
  const accountsLinkSub = 'share or chase the sign-off link'
  const stuckPlantHeadSub = `older than the ${fmtDays(SLA_DAYS.plantHead)} threshold`

  const overExposureSub = `${portfolio.breachedHeads} head(s) over`
  /**
   * This figure is the lensed plant's, so its destination carries the lens: `/capex/adhoc-budget`
   * now reads `?plant=` and opens on that plant (it used to open on its own picker's default, which
   * made a one-plant tile land on another plant's transfer form).
   *
   * Only for a plant that page can actually select — its roster is `PLANTS ∪ customPlants that are
   * NOT Green Field plants` (adhoc transfers are Brown Field head→head). A plant outside it would be
   * disclosed as ignored there, so the link stays unscoped and the caption keeps saying so. Same
   * reasoning as `lensedMetricHref`; built with `URLSearchParams` for the same encoding as
   * `kpiRoutes.metricHref`.
   */
  const adhocAcceptsPlant = activePlant != null && (
    PLANTS.some(p => p.value === activePlant)
    || customPlants.some(p => p.value === activePlant && !p.greenFieldPlant)
  )
  const adhocHref = activePlant && adhocAcceptsPlant
    ? `/capex/adhoc-budget?${new URLSearchParams({ plant: activePlant }).toString()}`
    : '/capex/adhoc-budget'
  const overExposureCaption = activePlant
    ? `${scopeName} · committed (est.) vs effective head allocation — ${adhocAcceptsPlant
      ? 'the transfers page opens on this plant'
      : 'transfers page opens on its own plant picker'}`
    : 'committed (est.) vs effective head allocation'
  // Same helper the Maintenance dashboard uses, so the two surfaces cannot label the same
  // derived quantity differently (a negative trim is approvers RAISING the ask).
  const edit = approverEditPresentation(portfolio.editTrimCr)
  const editImpactSub = `${portfolio.resubmits} resubmission(s)`
  const delaySub = `${portfolio.exposure.pastGraceCount} past grace`
  // Numerator AND denominator in words, both from the same `statusTally` the destination list uses.
  const rejectionSub = `${portfolio.tally.rejected} of ${portfolio.tally.total} request(s)`

  /**
   * Utilisation is PER BUDGET ENVELOPE and is never blended across field types.
   *
   * Summing money across field types is fine — rupees add. A RATIO of those sums is not: each field
   * type is a separate allocation envelope, so `Σcommitted ÷ Σallocated` can divide one field type's
   * commitment by another field type's budget. That is exactly what this line used to do: on today's
   * data it printed "43% of allocation" from Brown Field committed (₹1.80Cr) over Green Field
   * allocation (₹4.21Cr), contradicting the FY table rendered directly beneath it (Green Field 0%
   * utilised, Brown Field "no allocation published") and re-introducing the defect `CLAUDE.md`'s
   * FY-attribution invariant records as already fixed once: "the old dashboard compared a Green Field
   * FY allocation against Brown Field commitments".
   *
   * So a percentage is shown ONLY when exactly one envelope is in scope to compute it over. With
   * several, the hero states the position in words and defers to the FY table, which already carries a
   * per-field-type Utilised column — one honest number per envelope beats one blended wrong one.
   */
  const envelopes = portfolio.positions.map(p => ({
    label: FIELD_TYPE_LABELS[p.scope.fieldType],
    utilisationPct: p.allocatedInr > 0 ? p.utilisationPct : null,
    /** Committed spend with no allocation behind it — the risk a blended ratio hides completely. */
    unfunded: p.committedInr > 0 && p.allocatedInr <= 0,
    over: p.allocatedInr > 0 && p.committedInr > p.allocatedInr,
  }))
  const unfundedEnvelopes = envelopes.filter(e => e.unfunded)
  const overEnvelopes = envelopes.filter(e => e.over)
  const soleEnvelope = envelopes.length === 1 ? envelopes[0] : null

  const allocatedSub = portfolio.positions.length
    ? `${portfolio.positions.filter(p => p.allocatedInr > 0).length} of ${portfolio.positions.length} field type(s) funded`
    : 'no budget published yet'
  const committedSub = soleEnvelope
    ? (soleEnvelope.utilisationPct != null
      ? `${fmtPct(soleEnvelope.utilisationPct)} of the ${soleEnvelope.label} allocation`
      : `no ${soleEnvelope.label} allocation to measure against`)
    : envelopes.length === 0
      ? 'nothing committed yet'
      : `across ${envelopes.length} separate budget envelopes`
  const committedCaption = unfundedEnvelopes.length
    ? `${unfundedEnvelopes.map(e => e.label).join(', ')} committed with no allocation published`
    : overEnvelopes.length
      ? `${overEnvelopes.map(e => e.label).join(', ')} over its allocation`
      : soleEnvelope
        ? undefined
        : 'utilisation is per field type — see the table below'
  const committedTone = unfundedEnvelopes.length > 0 || overEnvelopes.length > 0 ? 'danger' : 'neutral'

  const fyBasis = activePlant
    ? `${scopeName}’s own live FY per field type`
    : 'each field type’s own live FY'

  /**
   * Stage 4's honest routes carry the whole predicate a tile counts. When the tile is ALSO plant
   * scoped, the destination must be too or the list contradicts the number — `?plant=` is a
   * narrowing param `buildRequestListView` already applies before the metric selects its cohort.
   *
   * The URL itself is built by `kpiRoutes.metricHref(key, plant)` — the ONE home for that rule. This
   * used to append `&plant=` by hand here, a second copy that drifted from `kpiSourcing`'s copy
   * (`%20` vs `+`) inside a single review window. What is left here is the local decision this
   * dashboard alone has to make: WHETHER to offer a lensed link at all.
   *
   * The param is only threaded for a plant `/capex/requests` will actually accept. That page builds its
   * roster from `PLANTS ∪ customPlants ∪ the plants present on its (role-scoped) requests`, so a plant
   * known ONLY from `capexMaster` — `pune` today, which is in neither seeded list — would be reported
   * as "not a plant on record", ignored, and the list would widen to everything while the tile spoke
   * for one plant. In that case the tile keeps its own scope but does not offer a link that cannot
   * honour it: a dead-end destination is the defect stage 4 removed, in a new costume.
   */
  const plantAcceptedByRequestList = activePlant != null && (
    PLANTS.some(p => p.value === activePlant)
    || customPlants.some(p => p.value === activePlant)
    || requests.some(r => r.plant === activePlant)
  )
  const lensedMetricHref = (key: MetricKey): string | undefined => {
    if (!activePlant) return metricHref(key)
    if (!plantAcceptedByRequestList) return undefined
    return metricHref(key, activePlant)
  }

  const trendHasData = portfolio.flow.some(p => p.raised || p.awarded || p.completed || p.valueAwardedInr)

  // The two by-plant charts on this tab are CROSS-plant by nature: filtering them to one plant would
  // leave a single bar with nothing to compare it against. They therefore stay portfolio-wide even
  // when the lens is set, and mark the selected plant instead — stated in the lens's own scope note
  // and again in each chart's caption, so no figure on this tab is ambiguous about its scope.
  const byBudget = useMemo(
    () => [...comparison.rows].sort((a, b) => b.allocatedInr - a.allocatedInr || a.label.localeCompare(b.label)),
    [comparison.rows],
  )
  const savingsRows = byBudget.filter(r => r.savingsComparable > 0)
  const tatRows = byBudget.filter(r => r.medianTatDays != null)
  const markPlant = (r: PlantRow) => (r.plant === activePlant ? 'selected in the lens' : null)

  // The measured cards are Brown Field (heads, and therefore over-allocation, are a Brown Field
  // concept). `buildSnapshots` only emits a record for a scope that HAS master rows, so with no
  // Brown Field budget published these series can never fill — say that, instead of leaving a reader
  // to wonder whether measurement is broken.
  const hasBrownBudget = capexMaster.some(m =>
    (m.fieldType ?? 'brown_field') === 'brown_field' && (!activePlant || m.plant === activePlant))
  const measuredEmptyText = hasBrownBudget
    ? 'Not measured yet — the first daily snapshot is taken when the portal is opened.'
    : `No Brown Field budget is published for ${scopeName}, so there is nothing to measure yet.`

  return (
    <div className={`${PAGE_SHELL} space-y-4`}>
      <DashboardHeader
        title="Administration"
        description="Approvals waiting on you, and the CAPEX portfolio end to end."
      >
        {unknownPlantParam && (
          // Above the tabs, not inside the lens: the lens renders only on the Portfolio tab, so a link
          // like `?view=plants&plant=bogus` disclosed nothing at all.
          <p className={`text-[11px] font-medium text-red-700 ${PROSE}`}>
            The link asked for plant &ldquo;{unknownPlantParam}&rdquo;, which has no budget or request
            here — showing all plants instead, not a filtered view.
          </p>
        )}
      </DashboardHeader>

      <DashboardTabs
        tabs={[
          { key: 'desk', label: 'My Desk' },
          { key: 'portfolio', label: 'Portfolio' },
          { key: 'plants', label: 'Plants' },
        ]}
        /* The lens scopes the Portfolio tab only, so it renders only there — but it renders in the
           toolbar slot under the tab bar rather than as a full-bleed card inside the panel, where it
           scrolled away from the very figures it scopes. */
        toolbar={active => active === 'portfolio' ? (
          <PlantLens
            options={plantOptions}
            active={activePlant}
            onChange={setPlant}
            scopeNote={activePlant
              ? `Every figure on this tab is scoped to ${scopeName}, except the two by-plant charts, which compare all plants and mark this one.`
              : 'Showing the whole portfolio. Pick a plant to scope every figure on this tab.'}
          />
        ) : null}
      >
        {active => active === 'desk' ? (
          <>
            {activePlant && (
              <p className={`text-[11px] text-slate-500 ${PROSE}`}>
                The plant lens ({scopeName}) scopes the Portfolio view. Your approval queue below is
                portfolio-wide — approvals are not filtered by plant.
              </p>
            )}
            <DashboardSection title="Waiting on you" level={2}>
              <KpiGrid>
                <KpiTile
                  label="Proposals to decide"
                  value={String(proposalsBucket?.count ?? 0)}
                  sub={proposalsSub} icon={ClipboardCheck}
                  tone={proposalsBucket?.breached ? 'danger' : 'neutral'}
                  href="/capex/budget-approvals"
                  ariaLabel={aria(`Proposals to decide: ${proposalsBucket?.count ?? 0}`, proposalsSub)}
                />
                <KpiTile
                  label="Adhoc transfers"
                  value={String(adhocBucket?.count ?? 0)}
                  sub={adhocSub}
                  icon={Layers} href="/capex/adhoc-budget"
                  ariaLabel={aria(`Adhoc transfers to decide: ${adhocBucket?.count ?? 0}`, adhocSub)}
                />
                <KpiTile
                  label="Awaiting accounts link"
                  value={String(accountsLinkBucket?.count ?? 0)}
                  sub={accountsLinkSub} icon={Timer}
                  href="/capex/budget-approvals"
                  ariaLabel={aria(`Awaiting Global Accounts sign-off: ${accountsLinkBucket?.count ?? 0}`, accountsLinkSub)}
                />
                <KpiTile
                  label="Stuck at plant head"
                  value={String(stuckPlantHeadCount)}
                  sub={stuckPlantHeadSub} icon={AlertTriangle}
                  tone={stuckPlantHeadCount > 0 ? 'warn' : 'good'}
                  // The tile counts only the breached ones, so the route carries the age threshold
                  // too — `?filter=pending_head_approval` listed rows this number excludes.
                  href={metricHref('stuck_plant_head')}
                  ariaLabel={aria(
                    `Requests stuck at the plant head: ${stuckPlantHeadCount}`,
                    stuckPlantHeadCount > 0 ? stuckPlantHeadSub : 'none past the threshold',
                  )}
                />
              </KpiGrid>
            </DashboardSection>

            {/* Two queues of the same kind, read against each other — side by side, and each with
                ONE label: the band heading is the card's title, not a second copy of it. */}
            <DashboardGrid cols={2}>
              <DashboardSection title="Your approvals" level={2} card>
                <ActionQueue
                  title="Your approvals" variant="mine" buckets={bands.mine}
                  emptyText="No approvals are waiting on you." showTitle={false} bare
                />
              </DashboardSection>

              <DashboardSection title="Elsewhere in the chain" level={2} card>
                <ActionQueue
                  title="Waiting on others" variant="waiting" buckets={bands.waiting}
                  emptyText="Nothing in flight." showTitle={false} bare
                />
              </DashboardSection>
            </DashboardGrid>
          </>
        ) : active === 'plants' ? (
          <PlantComparison
            rows={comparison.rows}
            heatmap={comparison.heatmap}
            activePlant={activePlant}
          />
        ) : (
          <>
            <DashboardSection
              title={`Portfolio position — ${scopeName}`}
              level={2}
              // Provenance stated exactly: `fyBudgetPosition.committedInr` is Σ `requestValue().inr`,
              // NOT `usedAmountByMasterItemId` (which is Σ line-item budget per master row, and is what
              // /capex/master renders and what the head-level figures on the Plants tab use).
              caption={`${fyBasis}. Committed is each request’s own value — awarded price where awarded, else the agreed or best quote, else the estimate — summed. It is an estimate basis, not a settled one, and not the per-line consumption /capex/master shows.`}
            >
              <KpiGrid>
                <KpiTile
                  size="lg"
                  label="Allocated"
                  value={portfolio.totals.allocatedInr > 0 ? fmtInr(portfolio.totals.allocatedInr) : '—'}
                  sub={allocatedSub}
                />
                <KpiTile
                  size="lg"
                  label="Committed (est.)"
                  value={fmtInr(portfolio.totals.committedInr)}
                  sub={committedSub}
                  tone={committedTone}
                  caption={committedCaption}
                />
                <KpiTile
                  size="lg"
                  label="Awarded"
                  value={fmtInr(portfolio.totals.awardedInr)}
                  sub="vendor selected, price agreed"
                />
                <KpiTile
                  size="lg"
                  label="Paid"
                  value={fmtInr(portfolio.totals.paidInr)}
                  sub="milestones marked paid"
                />
              </KpiGrid>
            </DashboardSection>

            <DashboardSection title="Risk and governance" level={2}>
              <KpiGrid>
                <KpiTile
                  label="Over-allocation exposure" value={fmtCr(portfolio.overExposureCr)} icon={AlertTriangle}
                  tone={portfolio.breachedHeads > 0 ? 'danger' : 'good'}
                  sub={overExposureSub}
                  caption={overExposureCaption}
                  href={adhocHref}
                  ariaLabel={aria(
                    `Over-allocation exposure: ${fmtCr(portfolio.overExposureCr)}`,
                    overExposureSub, overExposureCaption,
                  )}
                />
                <KpiTile
                  label={edit.label} value={edit.value} icon={Scissors}
                  tone={edit.tone}
                  sub={editImpactSub}
                  caption={edit.caption}
                  ariaLabel={aria(`${edit.label}: ${edit.value}`, editImpactSub, edit.caption)}
                />
                <KpiTile
                  label="Delay liability" value={fmtInr(portfolio.exposure.runningInr)} icon={TrendingDown}
                  tone={portfolio.exposure.runningInr > 0 ? 'danger' : 'neutral'}
                  sub={delaySub}
                  ariaLabel={aria(
                    `Delay liability: ${fmtInr(portfolio.exposure.runningInr)}`,
                    portfolio.exposure.runningInr > 0 ? `${delaySub} — accruing on open TAT clocks` : delaySub,
                  )}
                />
                <KpiTile
                  label="Rejection rate" value={fmtPct(portfolio.tally.rejectionRatePct)} icon={XCircle}
                  sub={rejectionSub}
                  // A ratio lands on its DENOMINATOR with the numerator marked, so both halves of
                  // the fraction stay visible — `?filter=rejected` showed the numerator alone.
                  href={lensedMetricHref('rejection_rate')}
                  ariaLabel={aria(`Rejection rate: ${fmtPct(portfolio.tally.rejectionRatePct)}`, rejectionSub)}
                />
              </KpiGrid>
            </DashboardSection>

            <DashboardSection
              title="FY budget position, by field type"
              // A peer band, not a sub-card: document order on this tab is h2 → h2 → h3 → h2 without
              // this, which files the FY table under the preceding band for anyone navigating by heading.
              level={2}
              caption={activePlant
                ? `${scopeName} — each field type on this plant’s own live FY where it has published one, otherwise the portfolio’s live FY for that field type, which is how an unlinked request is attributed.`
                : undefined}
              card
            >
              {portfolio.positions.length === 0 ? (
                <EmptyState>
                  {activePlant
                    ? `No budget is published for ${scopeName} yet.`
                    : 'No budget has been published yet. Approve a proposal to establish the live FY.'}
                </EmptyState>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <th scope="col" className="px-3 py-2">Field type</th>
                        <th scope="col" className="px-3 py-2">FY</th>
                        <th scope="col" className="px-3 py-2 text-right">Allocated</th>
                        <th scope="col" className="px-3 py-2 text-right">Committed</th>
                        <th scope="col" className="px-3 py-2 text-right">Awarded</th>
                        <th scope="col" className="px-3 py-2 text-right">Paid</th>
                        <th scope="col" className="px-3 py-2 text-right">Remaining</th>
                        <th scope="col" className="px-3 py-2 text-right">Utilised</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {portfolio.positions.map(p => {
                        // `fyBudgetPosition` guards its division and returns 0% for a zero allocation.
                        // Printing "0%" over real committed spend would read as "barely touched its
                        // budget" when the truth is "has no budget recorded to measure against" — and
                        // "Remaining" is meaningless without an allocation, so both say so instead.
                        const noAllocation = p.allocatedInr <= 0
                        return (
                          <tr key={p.scope.fieldType} className="hover:bg-[#EBF0FB]/60">
                            <td className="px-3 py-2 font-semibold text-slate-800">
                              {FIELD_TYPE_LABELS[p.scope.fieldType]}
                              {noAllocation && (
                                <span className="block text-[10px] font-normal text-amber-700">
                                  no allocation published
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-500">{p.scope.fy}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {noAllocation ? <span className="text-slate-400">none</span> : fmtInr(p.allocatedInr)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtInr(p.committedInr)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtInr(p.awardedInr)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtInr(p.paidInr)}</td>
                            <td className={`px-3 py-2 text-right tabular-nums font-semibold ${noAllocation ? 'text-slate-400' : p.remainingInr >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {noAllocation ? '—' : fmtInr(p.remainingInr)}
                            </td>
                            <td className={`px-3 py-2 text-right tabular-nums ${noAllocation ? 'text-slate-400' : p.utilisationPct > 90 ? 'text-red-700 font-semibold' : 'text-slate-600'}`}>
                              {noAllocation ? '—' : fmtPct(p.utilisationPct)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {portfolio.excludedPlants > 0 && (
                    <p className={`text-[11px] text-slate-500 mt-2 ${PROSE}`}>
                      Scoped to each field type&rsquo;s current live FY — {portfolio.excludedPlants} plant(s)
                      still on an earlier FY are not counted above. Pick that plant in the lens above, or
                      open the Plants tab, to see it on its own FY.
                    </p>
                  )}
                </div>
              )}
            </DashboardSection>

            <DashboardSection title="Trends" level={2} bodyClassName="space-y-4">
              <DashboardSection
                title="Requests raised, awarded and completed"
                caption={`${portfolio.flow.length} of the last ${TREND_MONTHS} months · ${scopeName} — months before the first activity are not drawn. Counts on the left axis, value awarded on the right. Awarded value counts a request only once its basis is genuinely awarded.`}
                card
              >
                {trendHasData ? (
                  // `w-full h-auto` over a 640-wide viewBox means the SVG grows taller as the column
                  // widens — unbounded, it renders ~600px tall on a 2000px screen and swallows the
                  // page. Capped by `ChartFrame`, which keeps the scroll wrapper for narrow columns.
                  <ChartFrame size="full">
                    <TrendChart
                      series={[
                        {
                          key: 'raised', label: 'Raised', color: '#2563EB',
                          points: portfolio.flow.map(p => ({ x: monthLabel(p.month), y: p.raised })),
                        },
                        {
                          key: 'awarded', label: 'Awarded', color: '#7C3AED',
                          points: portfolio.flow.map(p => ({ x: monthLabel(p.month), y: p.awarded })),
                        },
                        {
                          key: 'completed', label: 'Completed', color: '#059669',
                          points: portfolio.flow.map(p => ({ x: monthLabel(p.month), y: p.completed })),
                        },
                        {
                          key: 'value', label: 'Value awarded', color: '#0891B2',
                          axis: 'right', area: true, formatValue: fmtInr,
                          points: portfolio.flow.map(p => ({ x: monthLabel(p.month), y: p.valueAwardedInr })),
                        },
                      ]}
                      ariaLabel={`Requests raised, awarded and completed per month for ${scopeName}`}
                    />
                  </ChartFrame>
                ) : (
                  <EmptyState>
                    Nothing was raised, awarded or completed in the last {TREND_MONTHS} months
                    {activePlant ? ` at ${scopeName}` : ''}.
                  </EmptyState>
                )}
              </DashboardSection>

              <DashboardGrid cols={2}>
                <DashboardSection
                  title="Value funnel"
                  caption={`${scopeName} · each stage as a % of the one above it.`}
                  card
                >
                  <FunnelChart
                    stages={portfolio.funnel.requested === 0 ? [] : [
                      { key: 'requested', label: 'Requested', value: portfolio.funnel.requested },
                      { key: 'approved', label: 'Approved (reached sourcing)', value: portfolio.funnel.approved },
                      { key: 'awarded', label: 'Awarded', value: portfolio.funnel.awarded },
                      { key: 'poIssued', label: 'PO issued', value: portfolio.funnel.poIssued },
                      { key: 'paid', label: 'Paid', value: portfolio.funnel.paid },
                    ]}
                    formatValue={fmtInr}
                    ariaLabel={`Value funnel for ${scopeName}`}
                    emptyText="Nothing has moved through the pipeline yet."
                  />
                </DashboardSection>

                <DashboardSection
                  title="Median days per stage"
                  caption={`${scopeName} · measured from status history; only stages with a completed transition appear.`}
                  card
                >
                  {portfolio.stageMedians.length === 0 ? (
                    <EmptyState>Not enough completed transitions yet.</EmptyState>
                  ) : (
                    <ul className="space-y-2">
                      {portfolio.stageMedians.map(s => (
                        <li key={`${s.from}-${s.to}`} className="flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="text-slate-700 min-w-0 truncate">
                            {STATUS_LABELS[s.from] ?? s.from} → {STATUS_LABELS[s.to] ?? s.to}
                            <span className="ml-1.5 text-[10px] text-slate-400">{s.sampled} sampled</span>
                          </span>
                          <span className="font-bold tabular-nums text-slate-800 shrink-0">
                            {fmtDays(s.medianDays)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </DashboardSection>
              </DashboardGrid>

              {SHOW_MEASURED_STOCK_HISTORY && (
              <DashboardGrid cols={2}>
                <DashboardSection
                  title="Committed value — measured daily"
                  caption={`Brown Field, ${scopeName}. A stock figure has no history on the record, so it is MEASURED forward from the date shown and never reconstructed; unmeasured days are breaks, not zeros.`}
                  card
                >
                  <ChartFrame size="md">
                    <MeasuredSeriesChart
                      measured={committedSeries}
                      measuredFrom={snapshotStart}
                      formatValue={fmtInr}
                      ariaLabel={`Committed Brown Field value measured daily for ${scopeName}`}
                      emptyText={measuredEmptyText}
                    />
                  </ChartFrame>
                </DashboardSection>

                <DashboardSection
                  title="Over-allocation exposure — measured daily"
                  caption={`Brown Field heads over their effective allocation, ${scopeName}. Same measured-only rule as the chart beside it.`}
                  card
                >
                  <ChartFrame size="md">
                    <MeasuredSeriesChart
                      measured={exposureSeries}
                      measuredFrom={snapshotStart}
                      formatValue={fmtCr}
                      ariaLabel={`Brown Field over-allocation exposure measured daily for ${scopeName}`}
                      emptyText={measuredEmptyText}
                    />
                  </ChartFrame>
                </DashboardSection>
              </DashboardGrid>
              )}
            </DashboardSection>

            <DashboardSection
              title="Plant lens — savings and delivery"
              level={2}
              caption="Both charts compare ALL plants regardless of the lens, because a comparison of one plant is not a comparison; the selected plant is marked instead."
            >
              <DashboardGrid cols={2}>
              <DashboardSection
                title="Negotiation savings by plant"
                caption={savingsRows.length === 0
                  ? 'First quotation → final award, like-for-like.'
                  : `First quotation → final award, like-for-like.${comparison.rows.length - savingsRows.length > 0
                    ? ` ${comparison.rows.length - savingsRows.length} plant(s) with no comparable request are not shown — a plant we cannot measure must not be drawn as one that saved nothing.`
                    : ''}`}
                card
              >
                <ChartFrame size="md">
                  <GroupedBarChart
                    groups={savingsRows.map(r => ({
                      label: r.label,
                      sub: [`${r.savingsComparable} comparable request(s)`, markPlant(r)].filter(Boolean).join(' · '),
                      values: { savings: r.savingsInr },
                    }))}
                    measures={[{ key: 'savings', label: 'Savings', color: '#059669' }]}
                    formatValue={fmtInr}
                    ariaLabel="Negotiation savings per plant, in rupees"
                    emptyText="No comparable award at any plant yet."
                  />
                </ChartFrame>
              </DashboardSection>

              <DashboardSection
                title="Delivery TAT by plant"
                caption={`Median days late on LIVE TAT clocks — a settled track is history, not current pace.${comparison.rows.length - tatRows.length > 0
                  ? ` ${comparison.rows.length - tatRows.length} plant(s) have no clock running and are not shown.`
                  : ''}`}
                card
              >
                <ChartFrame size="md">
                  <GroupedBarChart
                    groups={tatRows.map(r => ({
                      label: r.label,
                      sub: [
                        r.delayExposureInr > 0 ? `${fmtInr(r.delayExposureInr)} accruing` : null,
                        markPlant(r),
                      ].filter(Boolean).join(' · '),
                      values: { late: r.medianTatDays ?? 0 },
                      // Deliberately no `over`: GroupedBarChart's legend explains a red bar as "over
                      // allocation", which is the wrong noun for lateness (it has no `overLabel`
                      // prop). Lateness is carried in words — the value label and the sub line.
                    }))}
                    measures={[{ key: 'late', label: 'Days late', color: '#D97706' }]}
                    formatValue={lateLabel}
                    ariaLabel="Median days late per plant on live TAT clocks"
                    emptyText="No TAT clock is running at any plant."
                  />
                </ChartFrame>
              </DashboardSection>
              </DashboardGrid>
            </DashboardSection>

            <DashboardSection title="Detail" level={2}>
              <DashboardGrid cols={2}>
              <DashboardSection
                title="Governance flags"
                caption={`${scopeName} · every flag derived from the record, none inferred.`}
                card
              >
                <ul className="space-y-1.5 text-[13px]">
                  {([
                    ['Awards decided on a single quote', portfolio.singleQuoteAwards],
                    ['Awards with INCO terms unsettled', portfolio.incoOpenAwards],
                    ['Awards without technical sign-off', portfolio.techSpecMissing],
                    ['Final payment released with a trial open', portfolio.paidWithTrialOpen],
                  ] as const).map(([label, n]) => (
                    <li key={label} className="flex items-center justify-between gap-3 py-1">
                      <span className="text-slate-700">
                        {label}
                        {n > 0 && <span className="ml-1.5 text-[11px] text-red-600 font-medium">— needs attention</span>}
                      </span>
                      <span className={`font-bold tabular-nums ${n > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{n}</span>
                    </li>
                  ))}
                </ul>
              </DashboardSection>

              <DashboardSection
                title="Longest-waiting live requests"
                caption={`${scopeName} · whoever has held it longest, and for how long.`}
                card
              >
                {portfolio.stalled.length === 0 ? (
                  <EmptyState>Nothing is in flight.</EmptyState>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <th scope="col" className="px-3 py-2">Request</th>
                          <th scope="col" className="px-3 py-2">Plant</th>
                          <th scope="col" className="px-3 py-2">With</th>
                          <th scope="col" className="px-3 py-2 text-right">Waiting</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {portfolio.stalled.map(({ r, hold }) => (
                          <tr key={r.id} className="hover:bg-[#EBF0FB]/60">
                            <td className="px-3 py-2">
                              <Link href={`/capex/${r.id}`} className="font-semibold text-primary hover:underline">
                                {r.requestNo ?? r.id.slice(0, 8)}
                              </Link>
                              <span className="ml-2 text-slate-600">{r.subject}</span>
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {r.plant ? plantLabel(r.plant) : '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{PARTY_LABELS[hold.party]}</td>
                            <td className={`px-3 py-2 text-right tabular-nums font-semibold ${hold.days > 7 ? 'text-red-700' : 'text-slate-600'}`}>
                              {fmtDays(hold.days)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </DashboardSection>
              </DashboardGrid>
            </DashboardSection>
          </>
        )}
      </DashboardTabs>
    </div>
  )
}
