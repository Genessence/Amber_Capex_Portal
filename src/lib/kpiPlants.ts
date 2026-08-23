/**
 * Plant-wise KPI derivation for the plant portfolio view.
 *
 * Pure — no React, no I/O, `now` always injected. Composes the existing `kpiUtils`/`kpiPortfolio`/
 * `kpiRisk` layer; nothing here re-derives award-basis, INR conversion, or FY-linkage logic that
 * already lives elsewhere.
 *
 * ── FY-per-plant scoping decision (the rule itself, and why, is documented on `liveFyByPlant`
 * below — every consumer of this layer resolves its FY through that one builder) ──
 *
 * `PlantKpi` is scoped Brown-Field-only for its BUDGET figures (`allocatedInr`, `committedInr`,
 * `utilisationPct`, `breachedHeads`, `overExposureCr`), and each plant is scoped to ITS OWN latest
 * Brown Field FY — never one global "latest FY per field type" the way `fyBudgetPosition` resolves
 * on its own. Reasons:
 *   1. `headPositions`/adhoc-transfer overrides are a Brown Field concept by construction
 *      (`adhocBudgetUtils.ts`'s doc comments say so explicitly) — there is no Green Field/
 *      Digitisation/IT "head" allocation to breach the same way.
 *   2. Plants publish next-FY Brown Field budgets independently (via Budget Planning), so at any
 *      moment different plants can legitimately sit on different live FYs. A single global latest
 *      FY — as `getLatestMasterFyForField` returns — would silently zero out every figure for a
 *      plant still on an earlier year the instant ANY other plant publishes a newer one. That is
 *      exactly the bug `AdminDashboard`'s over-allocation tile was built to avoid, and a per-plant
 *      row has the identical failure mode if it reused the global FY.
 *   3. Field types are never mixed (project invariant) — a plant's Green Field program lives under
 *      a completely different budget hierarchy (`greenFieldBudgetAllocations`), not `capexMaster`
 *      head allocations, so folding it into one "committed" figure would compare incomparable
 *      envelopes.
 *
 * The fulfilment-side figures (`savingsInr`, `medianTatDays`, `delayExposureInr`, `stalled`,
 * `liveRequests`) are NOT Brown-Field-only — they scope to every live request at the plant
 * regardless of field type, because negotiation savings, TAT, and ball-holding are workflow
 * properties of a request, not properties of the Brown Field budget hierarchy. A plant KPI row is
 * therefore two things stitched together on purpose: "this plant's Brown Field budget health" +
 * "this plant's overall procurement pace" — each scoped the way that concept is actually scoped
 * elsewhere in the codebase.
 */
import type {
  BrownFieldHeadBudget, CapexMasterItem, CapexRequest, FieldType, VendorInvite,
} from './types';
import type { MasterIndex } from './kpiUtils';
import {
  PARTY_SLA, SLA_DAYS, ballHolders, median, savingsForRequest,
} from './kpiUtils';
import { fyBudgetPosition, headPositions, projectTypesForPlantFy, requestFy } from './kpiPortfolio';
import { delayLiabilityExposure, tracksFor } from './kpiRisk';
import { getLatestMasterFyForField, getOrderedHeadsForScope } from './greenFieldConstants';
import { computeTat } from './tatUtils';

export interface PlantKpi {
  plant: string;
  /** Brown Field only, scoped to this plant's OWN latest Brown Field FY — see file header. */
  allocatedInr: number;
  committedInr: number;
  /** 0 when `allocatedInr` is 0 — never NaN/Infinity (delegates to `fyBudgetPosition`'s guard). */
  utilisationPct: number;
  /** Σ `savingsForRequest().negotiation`, restricted to the comparable subset — see below. */
  savingsInr: number;
  /** How many of this plant's awarded/approved requests contributed a COMPARABLE figure to `savingsInr` — disclosed so the sum is never mistaken for "every award". */
  savingsComparable: number;
  /** Median days-late (`weeksLate × 7`) across this plant's LIVE (still-running) TAT tracks. `null` when none are live. */
  medianTatDays: number | null;
  /** Live (still-accruing) delay-liability exposure — `delayLiabilityExposure(...).runningInr`, not the already-realised figure. */
  delayExposureInr: number;
  /** Live requests at this plant whose ball-holder has exceeded that party's SLA. */
  stalled: number;
  /** Brown Field heads (across every project type present) where committed(est.) exceeds effective allocation. */
  breachedHeads: number;
  /** Σ (committedCr − allocatedCr) over breached heads only. */
  overExposureCr: number;
  /** Requests at this plant that are neither `draft`, `completed`, nor `rejected`. */
  liveRequests: number;
  /**
   * This plant's live Brown Field requests that `requestFy` attributes to a DIFFERENT FY than the one
   * its budget figures are scoped to, and which `committedInr` therefore excludes.
   *
   * Why this can be non-zero: the budget scope is the plant's OWN live Brown Field FY, but an UNLINKED
   * request (no `masterItemId` on the request or any line) is attributed by `requestFy` to the
   * PORTFOLIO's live FY for its field type. Those agree for a plant on the latest year — and diverge
   * for a plant still on an earlier one, whose unlinked requests then fall outside its own scope.
   *
   * Deliberately DISCLOSED rather than absorbed: pulling those requests into the plant's committed
   * figure would pair commitments from one FY with an allocation from another, which is the same
   * mixed-basis error as blending field types. One FY on both sides of the figure, and a stated count
   * of what that costs — "an aggregate that excludes rows discloses the excluded count".
   */
  requestsOutsideScopedFy: number;
}

/**
 * `plant → that plant's OWN latest FY` for one field type, built in ONE pass over `capexMaster`.
 *
 * THE per-plant FY rule for the whole `kpi*` layer. `latestMasterFyForPlantField` (below),
 * `kpiSnapshots.buildSnapshots`, `plantHeadUtilisation` and the Administration dashboard's
 * portfolio view all resolve their FY through this one builder rather than restating the rule.
 *
 * ── Why the FY is genuinely PER PLANT, and must never collapse to one global latest ──
 *
 * `capexMaster` can hold several published FYs at once: `buildMasterItemsFromProposal` APPENDS a
 * new FY's rows and never removes the prior year's. And because budget proposals are authored and
 * approved per plant (Budget Planning → plant head → admin → Global Accounts), different plants can
 * legitimately sit on different live FYs at the same moment.
 *
 * A single global "latest FY" — which is what `getLatestMasterFyForField` returns — therefore fails
 * in two directions at once:
 *   - it folds a STALE year's rows into a live figure for a plant that has already rolled over; and,
 *     worse,
 *   - it silently drops EVERY row for a plant still on an earlier year the instant any OTHER plant
 *     publishes a newer one — so an under-scoped plant reads as an under-SPENDING plant, and a
 *     breached head simply disappears from the dashboard whose whole job is to surface it.
 *
 * That is the most plausible way this dashboard could mislead an executive, which is why the rule
 * lives here once instead of being re-derived at each call site. Do not "simplify" a caller back to
 * `getLatestMasterFyForField`.
 *
 * Rows are keyed on `m.plant` verbatim — an empty plant string is kept as its own key rather than
 * skipped, so `latestMasterFyForPlantField(master, '', ft)` still answers exactly what it did when
 * it scanned the array itself.
 */
export function liveFyByPlant(
  capexMaster: CapexMasterItem[],
  fieldType: FieldType,
): Map<string, string> {
  const byPlant = new Map<string, string>();
  for (const m of capexMaster) {
    if ((m.fieldType ?? 'brown_field') !== fieldType) continue;
    const current = byPlant.get(m.plant);
    // FY strings are 'YYYY-YY', so lexicographic `>` is chronological.
    if (current == null || m.fy > current) byPlant.set(m.plant, m.fy);
  }
  return byPlant;
}

/**
 * This plant's OWN latest FY for one field type, or `null` when it has no master rows for that field
 * type at all — a lookup over `liveFyByPlant`, so there is exactly one implementation of the rule.
 *
 * Callers that need EVERY plant's FY (the Administration dashboard's portfolio view, the plant
 * comparison, `plantHeadUtilisation`) should call `liveFyByPlant` once instead of looping this per
 * plant: that turns one O(rows) pass into O(rows × plants). `kpiSnapshots.buildSnapshots` does loop
 * it, deliberately — it runs at most once a day, off any hot path, and its complexity is unchanged
 * from before this extraction (the old implementation also scanned the array once per call).
 */
export function latestMasterFyForPlantField(
  capexMaster: CapexMasterItem[],
  plant: string,
  fieldType: FieldType,
): string | null {
  return liveFyByPlant(capexMaster, fieldType).get(plant) ?? null;
}

/* ── plant × head utilisation (the comparison heatmap's data) ───────────── */

export interface PlantHeadCell {
  plant: string;
  head: string;
  /** Effective allocation (adhoc transfers applied), pooled across the plant's project types. */
  allocatedCr: number;
  /** committed (est.) — the same `usedAmountByMasterItemId` basis `/capex/master` shows. */
  committedCr: number;
  /**
   * Committed as a % of allocation, or `null` when there is NO allocation to divide by. Never
   * `Infinity`: a head with spend and no budget is not "infinitely utilised", it is unmeasurable as
   * a ratio — the caller renders it as missing and discloses the count (`unmeasurable`).
   */
  utilisationPct: number | null;
  /**
   * True when ANY (plant, FY, projectType, head) scope contributing to this cell is over its
   * effective allocation — the same `HeadPosition.over` flag `PlantKpi.breachedHeads` counts.
   *
   * Deliberately NOT recomputed from the pooled figures: a head over-committed under RAC but under
   * budget under EMS nets out to "within allocation" once pooled, and a heatmap that hides a real
   * breach because another category has slack is the failure mode this whole per-plant scoping
   * exists to prevent. So the cell can read OVER while its own pooled % is below 100 — that is the
   * safe direction, and the caller says so in the legend.
   */
  over: boolean;
}

export interface PlantHeadUtilisation {
  /** Heads present across the scoped plants, in the canonical order `/capex/master` lists them in. */
  heads: string[];
  cells: PlantHeadCell[];
  /** Cells carrying committed spend with no allocation to measure it against — see `utilisationPct`. */
  unmeasurable: number;
}

/**
 * Per-plant, per-head Brown Field utilisation — one cell per (plant, head), pooled across whichever
 * project types (RAC/EMS/Component/Fan) that plant actually funds, with **each plant scoped to its
 * own live Brown Field FY** via `liveFyByPlant`.
 *
 * Composes `projectTypesForPlantFy` + `headPositions`, i.e. exactly the pass `plantKpis` uses for
 * `breachedHeads`/`overExposureCr` and exactly the allocation/consumption basis `/capex/master`
 * renders, so the heatmap, the plant comparison row and the master page cannot disagree.
 */
export function plantHeadUtilisation(opts: {
  plants: string[];
  capexMaster: CapexMasterItem[];
  headOverrides: BrownFieldHeadBudget[];
  usedAmountByMasterItemId: Record<string, number>;
}): PlantHeadUtilisation {
  const { plants, capexMaster, headOverrides, usedAmountByMasterItemId } = opts;
  const fyByPlant = liveFyByPlant(capexMaster, 'brown_field');

  const byKey = new Map<string, PlantHeadCell>();
  const scopedRows: CapexMasterItem[] = [];

  for (const plant of plants) {
    const fy = fyByPlant.get(plant);
    if (!fy) continue; // no Brown Field budget at this plant — no FY to attribute, nothing to measure
    for (const m of capexMaster) {
      if ((m.fieldType ?? 'brown_field') !== 'brown_field') continue;
      if (m.plant === plant && m.fy === fy) scopedRows.push(m);
    }
    for (const projectType of projectTypesForPlantFy(capexMaster, plant, fy)) {
      for (const h of headPositions({
        capexMaster, headOverrides, usedAmountByMasterItemId, scope: { plant, fy, projectType },
      })) {
        const key = `${plant}|${h.head}`;
        const cell = byKey.get(key)
          ?? { plant, head: h.head, allocatedCr: 0, committedCr: 0, utilisationPct: null, over: false };
        cell.allocatedCr += h.allocatedCr;
        cell.committedCr += h.committedCr;
        cell.over = cell.over || h.over;
        byKey.set(key, cell);
      }
    }
  }

  let unmeasurable = 0;
  for (const cell of byKey.values()) {
    cell.utilisationPct = cell.allocatedCr > 0 ? (cell.committedCr / cell.allocatedCr) * 100 : null;
    if (cell.utilisationPct == null && cell.committedCr > 0) unmeasurable++;
  }

  return {
    heads: getOrderedHeadsForScope(scopedRows, 'brown_field'),
    cells: [...byKey.values()],
    unmeasurable,
  };
}

/** Median days-late across this request's LIVE (still-running) TAT tracks — see `PlantKpi.medianTatDays`. */
function liveTatDays(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  index: MasterIndex,
  now: number,
): number[] {
  const days: number[] = [];
  for (const r of requests) {
    for (const t of tracksFor(r, byRequest.get(r.id) ?? [], index)) {
      if (!t.piSubmittedAt) continue;
      const tat = computeTat({
        piSubmittedAt: t.piSubmittedAt, vendorAmount: t.amount, tatStoppedAt: t.tatStoppedAt, now,
      });
      // Live = clock still running. A track whose clock already stopped is a settled fact, not
      // current pace — matches `delayExposureInr`'s use of `runningInr` over `realisedInr` above.
      if (!tat.applicable || !tat.running) continue;
      days.push(tat.weeksLate * 7);
    }
  }
  return days;
}

const NON_LIVE_STATUSES = new Set(['draft', 'completed', 'rejected']);

export function plantKpis(opts: {
  plants: string[];
  capexMaster: CapexMasterItem[];
  requests: CapexRequest[];
  byRequest: Map<string, VendorInvite[]>;
  index: MasterIndex;
  headOverrides: BrownFieldHeadBudget[];
  usedAmountByMasterItemId: Record<string, number>;
  now: number;
}): PlantKpi[] {
  const {
    plants, capexMaster, requests, byRequest, index, headOverrides, usedAmountByMasterItemId, now,
  } = opts;

  // One pass for every plant's own live Brown Field FY, not one pass per plant — see
  // `latestMasterFyForPlantField`'s note on why this is not the single-plant helper in a loop.
  const fyByPlant = liveFyByPlant(capexMaster, 'brown_field');
  // A plant with NO Brown Field master row has no FY of its own to scope to. It can still carry
  // Brown Field REQUESTS, and those requests — being unlinked — are attributed by `requestFy` to
  // `getLatestMasterFyForField`, so that is the only FY under which they can be found. Scoping such a
  // plant to `''` (as this did) produced a scope nothing could ever match: its committed spend read
  // ₹0 while the same requests were counted in the portfolio roll-up, so the per-plant rows did not
  // add up to the portfolio figure. Allocated stays 0 either way — the plant genuinely has no budget,
  // which callers must render as unmeasurable rather than as 0% utilised.
  const fallbackFy = getLatestMasterFyForField(capexMaster, 'brown_field');

  return plants.map((plant) => {
    const fy = fyByPlant.get(plant) ?? fallbackFy;

    const position = fyBudgetPosition({
      capexMaster, requests, byRequest,
      scope: { fieldType: 'brown_field', fy, plant },
    });

    let breachedHeads = 0;
    let overExposureCr = 0;
    for (const projectType of projectTypesForPlantFy(capexMaster, plant, fy)) {
      for (const h of headPositions({
        capexMaster, headOverrides, usedAmountByMasterItemId, scope: { plant, fy, projectType },
      })) {
        if (!h.over) continue;
        breachedHeads++;
        overExposureCr += h.committedCr - h.allocatedCr;
      }
    }

    // Fulfilment-side figures: every live request at this plant, any field type — see file header.
    const plantRequests = requests.filter((r) => r.plant === plant);

    let savingsInr = 0;
    let savingsComparable = 0;
    for (const r of plantRequests) {
      const s = savingsForRequest(r, byRequest.get(r.id) ?? [], index);
      if (!s || !s.negotiationComparable) continue;
      savingsInr += s.negotiation;
      savingsComparable++;
    }

    // See `requestsOutsideScopedFy`. Mirrors `fyBudgetPosition`'s own exclusions (draft/rejected) and
    // its field-type filter, so this counts exactly the rows that figure dropped for FY reasons.
    let requestsOutsideScopedFy = 0;
    for (const r of plantRequests) {
      if (r.status === 'draft' || r.status === 'rejected') continue;
      if ((r.fieldType ?? 'brown_field') !== 'brown_field') continue;
      if (requestFy(r, index, capexMaster) !== fy) requestsOutsideScopedFy++;
    }

    let liveRequests = 0;
    let stalled = 0;
    for (const r of plantRequests) {
      if (NON_LIVE_STATUSES.has(r.status)) continue;
      liveRequests++;
      const breached = ballHolders(r, byRequest.get(r.id) ?? [], now).some((h) => {
        const slaKey = PARTY_SLA[h.party];
        return slaKey != null && h.days > SLA_DAYS[slaKey];
      });
      if (breached) stalled++;
    }

    return {
      plant,
      allocatedInr: position.allocatedInr,
      committedInr: position.committedInr,
      utilisationPct: position.utilisationPct,
      savingsInr: Math.round(savingsInr),
      savingsComparable,
      medianTatDays: median(liveTatDays(plantRequests, byRequest, index, now)),
      delayExposureInr: delayLiabilityExposure(plantRequests, byRequest, index, now).runningInr,
      stalled,
      breachedHeads,
      overExposureCr,
      liveRequests,
      requestsOutsideScopedFy,
    };
  });
}
