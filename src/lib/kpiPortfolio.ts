/**
 * Portfolio-level KPI derivations: FY budget position, per-head position, and the value funnel.
 * Pure — no clock reads, no React.
 */
import type {
  BrownFieldHeadBudget, CapexMasterItem, CapexRequest, FieldType, ProjectType, VendorInvite,
} from './types';
import {
  CR, firstReachedAt, masterIndex, paidForRequest, poIssuedForRequest, requestValue,
} from './kpiUtils';
import type { MasterIndex } from './kpiUtils';
import { getLatestMasterFyForField, resolveProjectType } from './greenFieldConstants';
import { effectiveHeadAllocationCr, headsForScope, headUsedCr } from './adhocBudgetUtils';

/* ── FY attribution ───────────────────────────────────────────────────── */

/**
 * A request belongs to the FY of its linked master rows; with no link it belongs to the current
 * live FY for its OWN field type. Never mixes field types — this is what fixes the old dashboard's
 * "Green Field FY allocation vs Brown Field commitments" bug.
 */
export function requestFy(
  request: CapexRequest,
  index: MasterIndex,
  capexMaster: CapexMasterItem[],
): string {
  for (const l of request.lineItems ?? []) {
    const m = l.masterItemId ? index.get(l.masterItemId) : undefined;
    if (m) return m.fy;
  }
  if (request.masterItemId) {
    const m = index.get(request.masterItemId);
    if (m) return m.fy;
  }
  return getLatestMasterFyForField(capexMaster, request.fieldType ?? 'brown_field');
}

/* ── FY position ──────────────────────────────────────────────────────── */

export interface FyScope {
  fieldType: FieldType;
  fy: string;
  plant?: string;
  projectType?: ProjectType;
}

export interface FyPosition {
  scope: FyScope;
  allocatedInr: number;
  committedInr: number;
  awardedInr: number;
  poIssuedInr: number;
  paidInr: number;
  remainingInr: number;
  utilisationPct: number;
}

function inScope(request: CapexRequest, scope: FyScope, fy: string): boolean {
  if ((request.fieldType ?? 'brown_field') !== scope.fieldType) return false;
  if (fy !== scope.fy) return false;
  if (scope.plant && request.plant !== scope.plant) return false;
  if (scope.projectType && resolveProjectType(request) !== scope.projectType) return false;
  return true;
}

export function fyBudgetPosition(opts: {
  capexMaster: CapexMasterItem[];
  requests: CapexRequest[];
  byRequest: Map<string, VendorInvite[]>;
  scope: FyScope;
}): FyPosition {
  const { capexMaster, requests, byRequest, scope } = opts;
  const index = masterIndex(capexMaster);

  const allocatedInr =
    capexMaster
      .filter((m) => {
        if ((m.fieldType ?? 'brown_field') !== scope.fieldType) return false;
        if (m.fy !== scope.fy) return false;
        if (scope.plant && m.plant !== scope.plant) return false;
        if (scope.projectType && resolveProjectType(m) !== scope.projectType) return false;
        return true;
      })
      .reduce((s, m) => s + m.totalCost, 0) * CR;

  let committedInr = 0;
  let awardedInr = 0;
  let poIssuedInr = 0;
  let paidInr = 0;

  for (const r of requests) {
    if (r.status === 'draft' || r.status === 'rejected') continue;
    if (!inScope(r, scope, requestFy(r, index, capexMaster))) continue;
    const reqInvites = byRequest.get(r.id) ?? [];
    const v = requestValue(r, reqInvites, index);
    committedInr += v.inr;
    if (v.basis === 'awarded') awardedInr += v.inr;
    poIssuedInr += poIssuedForRequest(r, reqInvites);
    paidInr += paidForRequest(r, reqInvites);
  }

  return {
    scope,
    allocatedInr,
    committedInr,
    awardedInr,
    poIssuedInr,
    paidInr,
    remainingInr: allocatedInr - committedInr,
    utilisationPct: allocatedInr > 0 ? (committedInr / allocatedInr) * 100 : 0,
  };
}

/* ── head position (Brown Field) ──────────────────────────────────────── */

export interface HeadPosition {
  head: string;
  allocatedCr: number;
  /** Estimate basis — same source `/capex/master` uses, so the two screens never disagree. */
  committedCr: number;
  remainingCr: number;
  over: boolean;
}

/**
 * The Brown Field project types (RAC/EMS/Component/Fan) actually present for a plant + FY — i.e.
 * exactly the `projectType` scopes you must call `headPositions` once for to cover that plant's
 * whole Brown Field budget.
 *
 * Lives here, beside its only reason to exist, and is SHARED by `kpiPlants` and `kpiSnapshots`
 * rather than restated in each. It was duplicated verbatim in both for one review cycle; a
 * duplicated expression is what produced a currency bug in this codebase before, and the two copies
 * would silently disagree the moment one learned about a new project type.
 */
export function projectTypesForPlantFy(
  capexMaster: CapexMasterItem[],
  plant: string,
  fy: string,
): ProjectType[] {
  const set = new Set<ProjectType>();
  for (const m of capexMaster) {
    if ((m.fieldType ?? 'brown_field') !== 'brown_field') continue;
    if (m.plant !== plant || m.fy !== fy) continue;
    set.add(resolveProjectType(m));
  }
  return [...set];
}

/**
 * Per-head allocation vs consumption for a Brown Field plant/FY/category. Allocation respects
 * approved adhoc transfers via `effectiveHeadAllocationCr`.
 */
export function headPositions(opts: {
  capexMaster: CapexMasterItem[];
  headOverrides: BrownFieldHeadBudget[];
  usedAmountByMasterItemId: Record<string, number>;
  scope: { plant: string; fy: string; projectType: ProjectType };
}): HeadPosition[] {
  const { capexMaster, headOverrides, usedAmountByMasterItemId, scope } = opts;
  const { plant, fy, projectType } = scope;

  return headsForScope(capexMaster, plant, fy, projectType).map((head) => {
    const allocatedCr = effectiveHeadAllocationCr(capexMaster, headOverrides, plant, fy, projectType, head);
    const committedCr = headUsedCr(capexMaster, usedAmountByMasterItemId, plant, fy, projectType, head);
    return {
      head,
      allocatedCr,
      committedCr,
      remainingCr: allocatedCr - committedCr,
      over: committedCr > allocatedCr,
    };
  });
}

/* ── value funnel ─────────────────────────────────────────────────────── */

export interface ValueFunnel {
  requested: number;
  approved: number;
  awarded: number;
  poIssued: number;
  paid: number;
}

/** "Approved" = the request actually reached `sourcing` (past the plant-head gate, or Green-Field direct). */
export function valueFunnel(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  index: MasterIndex,
): ValueFunnel {
  const f: ValueFunnel = { requested: 0, approved: 0, awarded: 0, poIssued: 0, paid: 0 };
  for (const r of requests) {
    if (r.status === 'draft' || r.status === 'rejected') continue;
    const reqInvites = byRequest.get(r.id) ?? [];
    const v = requestValue(r, reqInvites, index);
    f.requested += v.inr;
    if (firstReachedAt(r, 'sourcing')) f.approved += v.inr;
    if (v.basis === 'awarded') f.awarded += v.inr;
    f.poIssued += poIssuedForRequest(r, reqInvites);
    f.paid += paidForRequest(r, reqInvites);
  }
  return f;
}
