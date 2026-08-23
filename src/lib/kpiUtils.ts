/**
 * Pure KPI derivations for the role dashboards.
 *
 * No React, no I/O, and no clock reads — `now` is always injected, which is what makes every
 * helper deterministic and directly testable. Money is INR unless a name says `Cr`.
 */
import type { CapexLineItem, CapexMasterItem, CapexRequest, CapexStatus, VendorInvite } from './types';
import { toInr } from './currencyUtils';
import { gstAmount } from './hsnGst';
import { effectiveIncoTermsStatus } from './incoTermsUtils';
import {
  awardedInvites, inrQuoteGrandTotal, isAwardBased, totalPaid,
} from './paymentUtils';
import { effectiveRfqStatus, inrRfqTotal } from './rfqUtils';
import { effectiveTechSpecStatus } from './techSpecUtils';
import { effectiveTrialStatus } from './trialUtils';

export const DAY_MS = 24 * 60 * 60 * 1000;
/** One Crore in rupees — master `totalCost` is stored in Cr. */
export const CR = 1_00_00_000;

/**
 * How long a party may hold the ball before a queue bucket is flagged as breached.
 * These are plausible placeholders, not measured SLAs — one const to change when a real
 * policy exists.
 */
export const SLA_DAYS = {
  vendorQuote: 5,
  techSpec: 3,
  plantHead: 3,
  adminApproval: 3,
  accounts: 3,
  vendorPi: 3,
  trialReview: 2,
} as const;
export type SlaKey = keyof typeof SLA_DAYS;

/** Statuses after which a request stops accruing time in stage. */
export const TERMINAL_STATUSES: CapexStatus[] = ['completed', 'rejected'];

/* ── time ─────────────────────────────────────────────────────────────── */

export function ageInDays(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now - t) / DAY_MS);
}

export function oldestAgeDays(isos: (string | undefined)[], now: number): number | null {
  const ages = isos.map((i) => ageInDays(i, now)).filter((n): n is number => n != null);
  return ages.length ? Math.max(...ages) : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/* ── stage timing (from statusHistory) ────────────────────────────────── */

export type StatusHistoryEntry = { status: CapexStatus; actor: string; at: string };

/**
 * `addRequest` has seeded a first history entry since capexContext.tsx:956-962, but legacy
 * records may predate it — synthesise one from the request itself so callers never branch.
 */
export function statusHistoryOf(request: CapexRequest): StatusHistoryEntry[] {
  const h = request.statusHistory;
  if (h && h.length) return h;
  return [{ status: request.status, actor: request.createdBy, at: request.createdAt }];
}

export interface StageDuration {
  status: CapexStatus;
  from: string;
  ms: number;
  /** Still accruing — the request is sitting in this stage right now. */
  open: boolean;
}

export function stageDurations(request: CapexRequest, now: number): StageDuration[] {
  const h = statusHistoryOf(request);
  return h.map((entry, i) => {
    const start = new Date(entry.at).getTime();
    const next = h[i + 1];
    const terminal = TERMINAL_STATUSES.includes(entry.status);
    // A terminal final stage does not accrue time — the workflow ended there.
    const end = next ? new Date(next.at).getTime() : terminal ? start : now;
    return {
      status: entry.status,
      from: entry.at,
      ms: Math.max(0, end - start),
      open: !next && !terminal,
    };
  });
}

export function firstReachedAt(request: CapexRequest, status: CapexStatus): string | undefined {
  return statusHistoryOf(request).find((e) => e.status === status)?.at;
}

export interface MedianResult {
  medianDays: number | null;
  /** Requests that actually reached the end status and were medianed. */
  sampled: number;
  /** Requests that started but never reached it — disclosed, never silently dropped. */
  stillOpen: number;
}

/**
 * Whether ONE request contributes to a `from → to` stage median, and with what duration.
 *
 * This is the single inclusion rule behind `medianStageDays` / `stageDaysPercentiles` — and it is
 * exported so a filtered LIST of the cohort (`kpiRoutes.ts`) can be built from the very same
 * predicate the median is computed from. A list whose membership test drifts from the median's
 * would reintroduce exactly the tile-vs-list contradiction those routes exist to remove.
 *
 * - `not_reached` — never reached `from`; invisible to the metric entirely.
 * - `open`        — reached `from`, never `to`; counted in `stillOpen`, excluded from the median.
 * - `sampled`     — reached both, non-negative duration; the median's sample.
 * - `dropped`     — reached both but the duration is negative (clock skew / bad data); excluded
 *                   from BOTH the sample and `stillOpen`, matching the behaviour this was
 *                   extracted from.
 */
export type StageSample =
  | { state: 'not_reached' }
  | { state: 'open' }
  | { state: 'sampled'; days: number }
  | { state: 'dropped'; days: number };

export function stageDaySample(
  request: CapexRequest,
  from: CapexStatus,
  to: CapexStatus,
): StageSample {
  const a = firstReachedAt(request, from);
  if (!a) return { state: 'not_reached' };
  const b = firstReachedAt(request, to);
  if (!b) return { state: 'open' };
  const days = (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS;
  return days >= 0 ? { state: 'sampled', days } : { state: 'dropped', days };
}

/**
 * Shared traversal for `medianStageDays` and `stageDaysPercentiles` — both need the exact same
 * inclusion rule, which lives in `stageDaySample` above.
 */
function stageDaySamples(
  requests: CapexRequest[],
  from: CapexStatus,
  to: CapexStatus,
): { days: number[]; stillOpen: number } {
  const days: number[] = [];
  let stillOpen = 0;
  for (const r of requests) {
    const s = stageDaySample(r, from, to);
    if (s.state === 'sampled') days.push(s.days);
    else if (s.state === 'open') stillOpen++;
  }
  return { days, stillOpen };
}

export function medianStageDays(
  requests: CapexRequest[],
  from: CapexStatus,
  to: CapexStatus,
): MedianResult {
  const { days, stillOpen } = stageDaySamples(requests, from, to);
  return { medianDays: median(days), sampled: days.length, stillOpen };
}

/**
 * Linear-interpolation percentile — sorts ascending, then interpolates between the two closest
 * ranks at index `(p/100) * (n-1)` (the convention `numpy.percentile`'s default and Excel's
 * `PERCENTILE.INC` both use). Chosen specifically because it makes `percentile(v, 50)` agree with
 * `median(v)` on every input, odd- or even-length — see the regression test pinning that.
 */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return s[lo];
  const frac = rank - lo;
  return s[lo] + (s[hi] - s[lo]) * frac;
}

export interface StagePercentiles {
  p50: number | null;
  p90: number | null;
  /** Requests that actually reached the end status and were sampled. */
  sampled: number;
  /** Requests that started but never reached it — a percentile over survivors only, presented
   *  without this count, is a survivorship lie, so it is reported here exactly as `medianStageDays`
   *  reports it. */
  stillOpen: number;
}

/**
 * `medianStageDays`' percentile counterpart — same inclusion rule (same shared traversal), same
 * `stillOpen` disclosure. Use this instead of `medianStageDays` when a single median would hide a
 * long tail a p90 needs to surface.
 */
export function stageDaysPercentiles(
  requests: CapexRequest[],
  from: CapexStatus,
  to: CapexStatus,
): StagePercentiles {
  const { days, stillOpen } = stageDaySamples(requests, from, to);
  return { p50: percentile(days, 50), p90: percentile(days, 90), sampled: days.length, stillOpen };
}

export interface AgingBucket {
  label: string;
  /** Exclusive upper bound in days, or `null` for the open-ended last bucket. */
  max: number | null;
  count: number;
}

const AGING_BUCKET_DEFS: { label: string; max: number | null }[] = [
  { label: '0-3', max: 3 },
  { label: '3-7', max: 7 },
  { label: '7-14', max: 14 },
  { label: '14+', max: null },
];

/**
 * Buckets ages into 0-3 / 3-7 / 7-14 / 14+ days. Each bucket's upper bound is EXCLUSIVE — an age
 * of exactly 3 falls into "3-7", and exactly 7 falls into "7-14" (the boundary belongs to the
 * OLDER bucket, the usual aging-report convention: a value only "graduates" once it has fully
 * completed the younger bucket's span). `null` ages (undatable items) are silently excluded, same
 * as `buildBucket` in `kpiQueues.ts`.
 */
export function agingBuckets(ageDays: (number | null)[]): AgingBucket[] {
  const counts = AGING_BUCKET_DEFS.map(() => 0);
  for (const age of ageDays) {
    if (age == null) continue;
    let idx = AGING_BUCKET_DEFS.length - 1; // 14+ (open-ended, no `max` to compare against)
    for (let i = 0; i < AGING_BUCKET_DEFS.length; i++) {
      const { max } = AGING_BUCKET_DEFS[i];
      if (max != null && age < max) { idx = i; break; }
    }
    counts[idx]++;
  }
  return AGING_BUCKET_DEFS.map((d, i) => ({ ...d, count: counts[i] }));
}

/* ── status tallies ───────────────────────────────────────────────────── */

export interface StatusTally {
  total: number;
  completed: number;
  rejected: number;
  /** `rejected / total` as a percentage; `0` on an empty set, never `NaN`. */
  rejectionRatePct: number;
}

/**
 * The completed / rejected split of a set of requests, and the rejection rate over it.
 *
 * One home for the denominator. The Buyer "My requests" tile, the Administration "Rejection rate"
 * tile and the `my_requests` / `rejection_rate` list routes all describe the same population, and
 * whoever next changes what counts (excluding drafts, say) must move every surface at once — the
 * failure mode is a tile and its own destination list disagreeing about the population.
 */
export function statusTally(requests: CapexRequest[]): StatusTally {
  let completed = 0;
  let rejected = 0;
  for (const r of requests) {
    if (r.status === 'completed') completed++;
    else if (r.status === 'rejected') rejected++;
  }
  return {
    total: requests.length,
    completed,
    rejected,
    rejectionRatePct: requests.length ? (rejected / requests.length) * 100 : 0,
  };
}

/* ── indexing ─────────────────────────────────────────────────────────── */

/**
 * Group invites once per render instead of filtering the whole array per request.
 * Every value/savings/ball-holder helper takes the already-scoped `VendorInvite[]`.
 */
export function invitesByRequest(invites: VendorInvite[]): Map<string, VendorInvite[]> {
  const m = new Map<string, VendorInvite[]>();
  for (const i of invites) {
    const list = m.get(i.requestId);
    if (list) list.push(i);
    else m.set(i.requestId, [i]);
  }
  return m;
}

/* ── value ────────────────────────────────────────────────────────────── */

export type MasterIndex = Map<string, CapexMasterItem>;

export function masterIndex(capexMaster: CapexMasterItem[]): MasterIndex {
  return new Map(capexMaster.map((m) => [m.id, m]));
}

/** Σ linked master allocation in INR (`totalCost` is Cr). */
export function allocatedForRequest(request: CapexRequest, index: MasterIndex): number {
  const lines = request.lineItems ?? [];
  if (lines.length) {
    return lines.reduce(
      (s, l) => s + (l.masterItemId ? (index.get(l.masterItemId)?.totalCost ?? 0) * CR : 0),
      0,
    );
  }
  return request.masterItemId ? (index.get(request.masterItemId)?.totalCost ?? 0) * CR : 0;
}

/**
 * Where a request's headline number came from. Always rendered next to the figure — a number
 * whose provenance is invisible is worse than no number.
 */
export type ValueBasis = 'awarded' | 'approved' | 'quoted' | 'estimated' | 'allocated' | 'none';

export interface RequestValue {
  inr: number;
  basis: ValueBasis;
}

export const VALUE_BASIS_LABELS: Record<ValueBasis, string> = {
  awarded: 'awarded',
  approved: 'approved quotation',
  quoted: 'lowest live quote',
  estimated: 'estimated',
  allocated: 'allocated budget',
  none: 'no value yet',
};

/**
 * The canonical "what does this request cost / will it cost", on an INR basis.
 * One fallback chain, used by every money KPI on every dashboard.
 */
export function requestValue(
  request: CapexRequest,
  reqInvites: VendorInvite[],
  index: MasterIndex,
): RequestValue {
  if (isAwardBased(reqInvites)) {
    const inr = awardedInvites(reqInvites).reduce((s, i) => s + (i.awardAmount ?? 0), 0);
    return { inr, basis: 'awarded' };
  }

  if (request.finalVendorId) {
    const inv = reqInvites.find((i) => i.vendorId === request.finalVendorId);
    if (inv?.rfqQuote) return { inr: inrRfqTotal(inv.rfqQuote, request.lineItems), basis: 'awarded' };
  }

  const approved = reqInvites.find((i) => i.rfqQuote && effectiveRfqStatus(i) === 'approved');
  if (approved?.rfqQuote) {
    return { inr: inrRfqTotal(approved.rfqQuote, request.lineItems), basis: 'approved' };
  }

  const offers: number[] = [];
  for (const i of reqInvites) {
    if (i.rfqQuote) offers.push(inrRfqTotal(i.rfqQuote, request.lineItems));
    const q = i.quotes[i.quotes.length - 1] ?? i.openingQuote;
    if (q) offers.push(inrQuoteGrandTotal(q));
  }
  if (offers.length) return { inr: Math.min(...offers), basis: 'quoted' };

  if (request.budget != null && request.budget > 0) return { inr: request.budget, basis: 'estimated' };

  const alloc = allocatedForRequest(request, index);
  if (alloc > 0) return { inr: alloc, basis: 'allocated' };

  return { inr: 0, basis: 'none' };
}

/** Σ paid milestones — per award when award-based, else request-level. */
export function paidForRequest(request: CapexRequest, reqInvites: VendorInvite[]): number {
  if (isAwardBased(reqInvites)) {
    return awardedInvites(reqInvites).reduce((s, i) => s + totalPaid(i.paymentMilestones ?? []), 0);
  }
  return totalPaid(request.paymentMilestones ?? []);
}

/** Σ PO value that has actually been issued to a vendor. */
export function poIssuedForRequest(request: CapexRequest, reqInvites: VendorInvite[]): number {
  if (isAwardBased(reqInvites)) {
    return awardedInvites(reqInvites).reduce(
      (s, i) => s + (i.purchaseOrder?.issuedAt ? i.purchaseOrder.amount : 0),
      0,
    );
  }
  const po = request.purchaseOrder;
  return po?.issuedAt ? po.amount : 0;
}

/* ── savings ──────────────────────────────────────────────────────────── */

function firstSupplierRfqQuote(invite: VendorInvite) {
  return invite.rfqThread?.find((m) => m.by === 'supplier' && m.quote)?.quote;
}

/**
 * Σ (unit × qty) + item-wise GST for a SUBSET of line items, converted to INR.
 *
 * This is exactly the basis `buildAwardGroups` uses for `awardAmount`, which is what makes a
 * split-award comparison like-for-like. Freight / packing / service are deliberately excluded
 * from both sides: they are whole-quote charges that cannot be attributed to a subset of lines.
 */
export function offerForItems(
  linePrices: Record<string, number> | undefined,
  itemIds: string[],
  lineItems: CapexLineItem[],
  currency?: string,
): number {
  const byId = new Map(lineItems.map((l) => [l.id, l]));
  let total = 0;
  for (const id of itemIds) {
    const item = byId.get(id);
    if (!item) continue;
    const unit = linePrices?.[id] ?? 0;
    const qty = parseFloat(item.quantity) || 1;
    const net = unit * qty;
    total += net + gstAmount(net, item.hsnCode);
  }
  return toInr(total, currency);
}

export interface RequestSavings {
  /** First offer → final, like-for-like. */
  negotiation: number;
  /** Allocation (or estimate) → final. */
  budget: number;
  negotiationComparable: boolean;
  budgetComparable: boolean;
}

/**
 * Savings for a request, or `null` when nothing has been awarded or approved yet — a live
 * quote is not a saving, and counting it as one would inflate every aggregate on the page.
 */
export function savingsForRequest(
  request: CapexRequest,
  reqInvites: VendorInvite[],
  index: MasterIndex,
): RequestSavings | null {
  const value = requestValue(request, reqInvites, index);
  if (value.basis !== 'awarded' && value.basis !== 'approved') return null;

  const lines = request.lineItems ?? [];
  let negotiation = 0;
  let negotiationComparable = true;

  if (isAwardBased(reqInvites)) {
    for (const inv of awardedInvites(reqInvites)) {
      const ids = inv.awardedItemIds ?? [];
      const first = firstSupplierRfqQuote(inv);
      // Auction ranks reset on start: the seeded opening bid lives on `openingQuote`, never in
      // `quotes[]` (which `submitQuote` overwrites in place with the current bid).
      const openingPrices = first?.linePrices ?? inv.openingQuote?.itemPrices;
      const currency = first?.currency ?? inv.openingQuote?.currency;
      if (!openingPrices || !ids.length) {
        negotiationComparable = false;
        continue;
      }
      negotiation += offerForItems(openingPrices, ids, lines, currency) - (inv.awardAmount ?? 0);
    }
  } else {
    const inv = request.finalVendorId
      ? reqInvites.find((i) => i.vendorId === request.finalVendorId)
      : reqInvites.find((i) => i.rfqQuote && effectiveRfqStatus(i) === 'approved');
    const first = inv ? firstSupplierRfqQuote(inv) : undefined;
    if (first) negotiation = inrRfqTotal(first, lines) - value.inr;
    else negotiationComparable = false;
  }

  const baseline = allocatedForRequest(request, index) || (request.budget ?? 0);
  const budgetComparable = baseline > 0;

  return {
    negotiation: Math.round(negotiation),
    budget: budgetComparable ? Math.round(baseline - value.inr) : 0,
    negotiationComparable,
    budgetComparable,
  };
}

/* ── ball holder ──────────────────────────────────────────────────────── */

export type Party =
  | 'buyer' | 'sourcing' | 'plant_head' | 'vendor'
  | 'technical' | 'plant_accounts' | 'global_accounts' | 'none';

export const PARTY_LABELS: Record<Party, string> = {
  buyer: 'Requester',
  sourcing: 'Sourcing',
  plant_head: 'Plant Head',
  vendor: 'Vendor',
  technical: 'Technical Team',
  plant_accounts: 'Plant Accounts',
  global_accounts: 'Global Accounts (Satish)',
  none: '—',
};

/** Which SLA a wait against each party is measured against. */
export const PARTY_SLA: Partial<Record<Party, SlaKey>> = {
  plant_head: 'plantHead',
  vendor: 'vendorQuote',
  technical: 'techSpec',
  plant_accounts: 'accounts',
  global_accounts: 'accounts',
};

export interface BallHold {
  party: Party;
  since: string;
  days: number;
  /** Set when the hold belongs to one award / one vendor rather than the whole request. */
  inviteId?: string;
}

function lastStatusAt(request: CapexRequest): string {
  const h = statusHistoryOf(request);
  return h[h.length - 1].at;
}

function hold(party: Party, since: string, now: number, inviteId?: string): BallHold {
  return { party, since, days: ageInDays(since, now) ?? 0, inviteId };
}

function awardHold(request: CapexRequest, inv: VendorInvite, now: number): BallHold {
  const at = lastStatusAt(request);
  switch (inv.awardStatus ?? 'awarded') {
    case 'completed':
      return hold('none', at, now, inv.id);
    // Awarded but the PI has not been requested — sourcing still has to click Request PI.
    case 'awarded':
      return hold('sourcing', at, now, inv.id);
    case 'pi_requested':
      return hold('vendor', at, now, inv.id);
    case 'pi_submitted':
      return hold('plant_accounts', inv.piSubmittedAt ?? at, now, inv.id);
    case 'accounts_processing':
      return hold('global_accounts', inv.piSubmittedAt ?? at, now, inv.id);
    default: {
      const trial = effectiveTrialStatus(inv);
      if (trial === 'pending_upload') return hold('vendor', inv.advancePaidAt ?? at, now, inv.id);
      if (trial === 'pending_review') {
        return hold('sourcing', inv.trialSubmission?.uploadedAt ?? at, now, inv.id);
      }
      return hold('plant_accounts', inv.purchaseOrder?.issuedAt ?? at, now, inv.id);
    }
  }
}

/**
 * Who is blocking this request right now, and since when. One entry per award for award-based
 * requests (each award is its own fulfilment track), otherwise a single entry.
 */
export function ballHolders(
  request: CapexRequest,
  reqInvites: VendorInvite[],
  now: number,
): BallHold[] {
  if (isAwardBased(reqInvites)) {
    return awardedInvites(reqInvites).map((inv) => awardHold(request, inv, now));
  }

  const at = lastStatusAt(request);
  switch (request.status) {
    case 'draft':
      return [hold('buyer', request.createdAt, now)];
    case 'submitted':
    case 'pending_head_approval':
      return [hold('plant_head', at, now)];
    case 'completed':
    case 'rejected':
      return [hold('none', at, now)];
    case 'pi_requested':
      return [hold('vendor', at, now)];
    case 'pi_submitted':
      return [hold('plant_accounts', request.piSubmittedAt ?? at, now)];
    case 'accounts_processing':
      return [hold('global_accounts', request.piSubmittedAt ?? at, now)];
    case 'payment_in_progress': {
      const trial = effectiveTrialStatus(request);
      if (trial === 'pending_upload') return [hold('vendor', request.advancePaidAt ?? at, now)];
      if (trial === 'pending_review') {
        return [hold('sourcing', request.trialSubmission?.uploadedAt ?? at, now)];
      }
      return [hold('plant_accounts', request.purchaseOrder?.issuedAt ?? at, now)];
    }
    default: {
      // Pre-award: sourcing / negotiation / the legacy sourcing_approved + buyer_approved states.
      const mine = reqInvites.find(
        (i) =>
          (i.rfqQuote && effectiveRfqStatus(i) === 'pending_sourcing') ||
          effectiveIncoTermsStatus(i) === 'pending_sourcing' ||
          effectiveTechSpecStatus(i) === 'needs_revision',
      );
      if (mine) return [hold('sourcing', at, now, mine.id)];

      const vendor = reqInvites.find((i) => {
        const s = effectiveRfqStatus(i);
        return s === 'awaiting_quote' || s === 'pending_vendor';
      });
      if (vendor) return [hold('vendor', vendor.invitedAt, now, vendor.id)];

      const tech = reqInvites.find((i) => effectiveTechSpecStatus(i) === 'pending_technical');
      if (tech) return [hold('technical', tech.techSpec?.sentAt ?? at, now, tech.id)];

      return [hold('sourcing', at, now)];
    }
  }
}
