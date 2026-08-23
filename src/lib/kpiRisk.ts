/**
 * Fulfilment-risk KPIs: aggregate delay liability (money the company is owed under the TAT
 * clause), a vendor scorecard, and the Sourcing dashboard's whole Performance-tab aggregation
 * (`sourcingPerformance`). Pure — `now` is injected.
 */
import type { CapexRequest, Vendor, VendorInvite } from './types';
import type { MasterIndex, MedianResult } from './kpiUtils';
import {
  DAY_MS, median, medianStageDays, paidForRequest, poIssuedForRequest, requestValue, savingsForRequest,
} from './kpiUtils';
import { awardedInvites, isAwardBased } from './paymentUtils';
import { computeTat } from './tatUtils';

export interface DelayExposure {
  /** Deductions accrued on clocks that are still running — live exposure. */
  runningInr: number;
  runningCount: number;
  /** Deductions accrued on tracks whose clock has stopped. */
  realisedInr: number;
  /** Tracks past the one-week grace period. */
  pastGraceCount: number;
}

export interface Track {
  piSubmittedAt?: string;
  tatStoppedAt?: string;
  amount: number;
}

/**
 * One fulfilment "track" per award (split award) or one for the whole request (RFQ / legacy
 * single-vendor) — each track is a TAT clock. Exported so `kpiPlants.ts` can compute a per-plant
 * TAT distribution over the exact same tracks `delayLiabilityExposure` sums, instead of
 * re-deriving the award-vs-single-vendor branch a second time.
 */
export function tracksFor(
  request: CapexRequest,
  reqInvites: VendorInvite[],
  index: MasterIndex,
): Track[] {
  if (isAwardBased(reqInvites)) {
    return awardedInvites(reqInvites).map((i) => ({
      piSubmittedAt: i.piSubmittedAt,
      tatStoppedAt: i.tatStoppedAt,
      amount: i.awardAmount ?? 0,
    }));
  }
  return [{
    piSubmittedAt: request.piSubmittedAt,
    tatStoppedAt: request.tatStoppedAt,
    amount: requestValue(request, reqInvites, index).inr,
  }];
}

export function delayLiabilityExposure(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  index: MasterIndex,
  now: number,
): DelayExposure {
  const out: DelayExposure = { runningInr: 0, runningCount: 0, realisedInr: 0, pastGraceCount: 0 };
  for (const r of requests) {
    for (const t of tracksFor(r, byRequest.get(r.id) ?? [], index)) {
      if (!t.piSubmittedAt) continue;
      const tat = computeTat({
        piSubmittedAt: t.piSubmittedAt,
        vendorAmount: t.amount,
        tatStoppedAt: t.tatStoppedAt,
        now,
      });
      if (!tat.applicable) continue;
      if (tat.weeksLate > 0) out.pastGraceCount++;
      if (tat.running) {
        out.runningCount++;
        out.runningInr += tat.deductionAmount;
      } else {
        out.realisedInr += tat.deductionAmount;
      }
    }
  }
  return out;
}

export interface VendorScore {
  vendorId: string;
  vendorName: string;
  invited: number;
  quoted: number;
  responseRatePct: number;
  medianResponseDays: number | null;
  awards: number;
  awardedInr: number;
  delayAccruedInr: number;
}

export function vendorScorecard(
  vendors: Vendor[],
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  index: MasterIndex,
  now: number,
): VendorScore[] {
  const rows = new Map<string, VendorScore>();
  const responseDays = new Map<string, number[]>();

  const blank = (v: Vendor): VendorScore => ({
    vendorId: v.id, vendorName: v.vendorName, invited: 0, quoted: 0, responseRatePct: 0,
    medianResponseDays: null, awards: 0, awardedInr: 0, delayAccruedInr: 0,
  });
  for (const v of vendors) rows.set(v.id, blank(v));

  for (const r of requests) {
    const reqInvites = byRequest.get(r.id) ?? [];
    for (const inv of reqInvites) {
      const row = rows.get(inv.vendorId);
      if (!row) continue; // invite for a vendor no longer in the roster
      row.invited++;

      const firstReply = inv.rfqThread?.find((m) => m.by === 'supplier' && m.quote);
      if (firstReply || inv.rfqQuote || inv.quotes.length) row.quoted++;
      if (firstReply) {
        const days = (new Date(firstReply.at).getTime() - new Date(inv.invitedAt).getTime()) / 86_400_000;
        if (days >= 0) {
          const list = responseDays.get(inv.vendorId) ?? [];
          list.push(days);
          responseDays.set(inv.vendorId, list);
        }
      }

      if (inv.awarded) {
        row.awards++;
        row.awardedInr += inv.awardAmount ?? 0;
        const tat = computeTat({
          piSubmittedAt: inv.piSubmittedAt,
          vendorAmount: inv.awardAmount ?? 0,
          tatStoppedAt: inv.tatStoppedAt,
          now,
        });
        if (tat.applicable) row.delayAccruedInr += tat.deductionAmount;
      }
    }

    // Single-vendor fulfilment: attribute the request-level TAT to the finalized vendor.
    if (!isAwardBased(reqInvites) && r.finalVendorId && r.piSubmittedAt) {
      const row = rows.get(r.finalVendorId);
      if (row) {
        const tat = computeTat({
          piSubmittedAt: r.piSubmittedAt,
          vendorAmount: requestValue(r, reqInvites, index).inr,
          tatStoppedAt: r.tatStoppedAt,
          now,
        });
        if (tat.applicable) row.delayAccruedInr += tat.deductionAmount;
      }
    }
  }

  for (const row of rows.values()) {
    row.responseRatePct = row.invited > 0 ? Math.round((row.quoted / row.invited) * 100) : 0;
    row.medianResponseDays = median(responseDays.get(row.vendorId) ?? []);
  }

  return [...rows.values()]
    .filter((r) => r.invited > 0)
    .sort((a, b) => b.awardedInr - a.awardedInr);
}

/* ── sourcing performance (Performance-tab aggregation) ─────────────────── */

/**
 * The three cycle-time legs measured per VENDOR INVITE (not per request):
 * invite → first quotation, first quotation → agreed, tech spec sent → decided.
 */
export type LegKey = 'firstQuote' | 'negotiation' | 'techSpec';

export const LEG_LABELS: Record<LegKey, string> = {
  firstQuote: 'invited → first quotation',
  negotiation: 'first quotation → agreed',
  techSpec: 'spec sent → decided',
};

/**
 * Whether ONE invite contributes to a leg's median, and with what duration. Same four states, and
 * the same reasons for them, as `stageDaySample` in `kpiUtils.ts`:
 * `not_started` (the leg never began — invisible to the metric), `open` (began, never finished —
 * disclosed as still-open, excluded from the median), `sampled`, `dropped` (negative duration).
 *
 * Exported so a filtered LIST of a leg's cohort (`kpiRoutes.ts`) is built from the very same
 * predicate `sourcingPerformance` medians — the list can never drift from the tile.
 */
export type LegSample =
  | { state: 'not_started' }
  | { state: 'open' }
  | { state: 'sampled'; days: number }
  | { state: 'dropped'; days: number };

export function inviteLegSample(invite: VendorInvite, leg: LegKey): LegSample {
  const first = invite.rfqThread?.find((m) => m.by === 'supplier' && m.quote);
  const settled = invite.rfqThread?.find((m) => m.action === 'approved');
  const [start, end] =
    leg === 'firstQuote' ? [invite.invitedAt, first?.at]
      : leg === 'negotiation' ? [first?.at, settled?.at]
        : [invite.techSpec?.sentAt, invite.techSpec?.decidedAt];

  if (!start) return { state: 'not_started' };
  if (!end) return { state: 'open' };
  const days = (new Date(end).getTime() - new Date(start).getTime()) / DAY_MS;
  return days >= 0 ? { state: 'sampled', days } : { state: 'dropped', days };
}

/**
 * Did this vendor actually put a price on the table? The numerator of "vendor participation".
 * `openingQuote` counts because `seedAuctionFromRfq` parks a seeded opening bid there, out of
 * `quotes[]`. Exported so the participation ROUTE marks the same invites this counts.
 */
export function inviteHasQuote(invite: VendorInvite): boolean {
  return !!invite.rfqQuote || invite.quotes.length > 0 || !!invite.openingQuote;
}

/** Top-vendor / top-3 share of total awarded spend — "how dependent are we on one vendor". */
export interface SpendConcentration {
  totalAwardedInr: number;
  topVendorName: string | null;
  topVendorSharePct: number | null;
  top3SharePct: number | null;
}

function spendConcentration(scorecard: VendorScore[]): SpendConcentration {
  const total = scorecard.reduce((s, v) => s + v.awardedInr, 0);
  if (total <= 0) {
    return { totalAwardedInr: 0, topVendorName: null, topVendorSharePct: null, top3SharePct: null };
  }
  // `vendorScorecard` already sorts by `awardedInr` desc, but re-sort defensively rather than
  // depend on that ordering holding forever.
  const sorted = [...scorecard].sort((a, b) => b.awardedInr - a.awardedInr);
  const top3 = sorted.slice(0, 3).reduce((s, v) => s + v.awardedInr, 0);
  return {
    totalAwardedInr: total,
    topVendorName: sorted[0].vendorName,
    topVendorSharePct: (sorted[0].awardedInr / total) * 100,
    top3SharePct: (top3 / total) * 100,
  };
}

export interface SourcingPerformance {
  negotiation: number;
  budget: number;
  negNotComparable: number;
  budNotComparable: number;
  /**
   * Negotiation savings as a % of the reconstructed first-offer total. Restricted to the SAME
   * fully-comparable subset that both the numerator and denominator are drawn from — a split
   * award with only some legs comparable is excluded from BOTH (its request-level
   * `negotiationComparable` flag is false even though part of its `negotiation` figure is real),
   * so this ratio never mixes a comparable numerator against a denominator missing that
   * contribution. `null` when nothing is comparable yet.
   */
  negotiationPctOfFirstOffer: number | null;
  auctionSaved: number;
  auctionPct: number | null;
  invited: number;
  quoted: number;
  singleQuoteAwards: number;
  awardCount: number;
  /** Mean vendors invited per award decided. `null` before any award exists. */
  vendorsPerAward: number | null;
  poIssued: number;
  paid: number;
  outstanding: number;
  cycle: MedianResult;
  firstQuote: number | null;
  negotiationTime: number | null;
  techSpecTime: number | null;
  exposure: DelayExposure;
  scorecard: VendorScore[];
  concentration: SpendConcentration;
}

/**
 * The Sourcing dashboard's whole Performance tab in one pure call — negotiation/budget savings,
 * auction effectiveness, participation, cycle-time legs, delay exposure, vendor scorecard, and
 * spend concentration. Previously computed inline in the component's `useMemo`, unreachable by
 * the lib test suite; moved here so every figure on that tab is independently testable, per the
 * plan's "pure derivation layer, consumed by presentational components" architecture.
 */
export function sourcingPerformance(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  index: MasterIndex,
  now: number,
  vendors: Vendor[],
): SourcingPerformance {
  let negotiation = 0, budget = 0, negNotComparable = 0, budNotComparable = 0;
  // Numerator/denominator for "% of first offer" — see the field doc above for why both are
  // restricted to the fully-comparable subset only.
  let negotiationComparableSum = 0;
  let firstOfferSum = 0;
  let auctionSaved = 0;
  const auctionPcts: number[] = [];
  let invited = 0, quoted = 0, singleQuoteAwards = 0, awardCount = 0;
  let poIssued = 0, paid = 0;
  const firstQuoteDays: number[] = [];
  const negotiationDays: number[] = [];
  const techSpecDays: number[] = [];

  for (const r of requests) {
    const reqInvites = byRequest.get(r.id) ?? [];
    const value = requestValue(r, reqInvites, index);
    const s = savingsForRequest(r, reqInvites, index);
    if (s) {
      negotiation += s.negotiation;
      budget += s.budget;
      if (!s.negotiationComparable) {
        negNotComparable++;
      } else {
        negotiationComparableSum += s.negotiation;
        firstOfferSum += s.negotiation + value.inr;
      }
      if (!s.budgetComparable) budNotComparable++;
    }

    const opening = r.auctionConfig?.openingBestPrice;
    if (opening && opening > 0 && value.basis === 'awarded' && value.inr > 0) {
      auctionSaved += opening - value.inr;
      auctionPcts.push(((opening - value.inr) / opening) * 100);
    }

    poIssued += poIssuedForRequest(r, reqInvites);
    paid += paidForRequest(r, reqInvites);

    const withQuote = reqInvites.filter(inviteHasQuote);
    invited += reqInvites.length;
    quoted += withQuote.length;

    if (isAwardBased(reqInvites)) {
      const awards = awardedInvites(reqInvites);
      awardCount += awards.length;
      if (withQuote.length === 1) singleQuoteAwards += awards.length;
    }

    // One shared predicate per leg (`inviteLegSample`), so the Performance tile and the filtered
    // list route behind it are computed from the same sample — never two lookalike traversals.
    for (const inv of reqInvites) {
      const s1 = inviteLegSample(inv, 'firstQuote');
      if (s1.state === 'sampled') firstQuoteDays.push(s1.days);
      const s2 = inviteLegSample(inv, 'negotiation');
      if (s2.state === 'sampled') negotiationDays.push(s2.days);
      const s3 = inviteLegSample(inv, 'techSpec');
      if (s3.state === 'sampled') techSpecDays.push(s3.days);
    }
  }

  const scorecard = vendorScorecard(vendors, requests, byRequest, index, now);

  return {
    negotiation, budget, negNotComparable, budNotComparable,
    negotiationPctOfFirstOffer: firstOfferSum > 0 ? (negotiationComparableSum / firstOfferSum) * 100 : null,
    auctionSaved, auctionPct: median(auctionPcts),
    invited, quoted, singleQuoteAwards, awardCount,
    vendorsPerAward: awardCount > 0 ? invited / awardCount : null,
    poIssued, paid, outstanding: Math.max(0, poIssued - paid),
    cycle: medianStageDays(requests, 'sourcing', 'pi_requested'),
    firstQuote: median(firstQuoteDays),
    negotiationTime: median(negotiationDays),
    techSpecTime: median(techSpecDays),
    exposure: delayLiabilityExposure(requests, byRequest, index, now),
    scorecard,
    concentration: spendConcentration(scorecard),
  };
}
