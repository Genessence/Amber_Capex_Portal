/**
 * Sourcing-cockpit KPI derivations: the plant lens, the sourcing funnel, wait aging, and the
 * per-invite percentile legs the Performance tab renders.
 *
 * Pure — no React, no I/O, `now` always injected.
 *
 * ── Composition, not reinvention ──
 *
 * Everything here composes the existing `kpi*` layer rather than restating a rule:
 *
 * - `inviteLegSample` / `inviteHasQuote` (`kpiRisk.ts`) — the leg inclusion rule and the
 *   "did this vendor put a price on the table" predicate. `legPercentiles` below is
 *   `sourcingPerformance`'s median counterpart over the SAME samples, so a p50 can never
 *   disagree with the median the same leg reports elsewhere.
 * - `percentile` / `agingBuckets` / `TERMINAL_STATUSES` (`kpiUtils.ts`) — the percentile
 *   convention and the aging-bucket boundaries. This file contains NO day threshold of its own.
 * - `worstHold` / `holdBreach` (`kpiRoutes.ts`) — the same "who is holding this, and has that
 *   breached" resolution the filtered request list evidences its rows with. A second copy of either
 *   is what makes a tile and its destination drift apart. Metric ROUTES (including the plant lens)
 *   are built by `kpiRoutes.metricHref(key, plant)`; this file used to carry a second copy of that
 *   too, and the two drifted — see that function's comment.
 * - `ownsFulfillmentTrack` (`paymentUtils.ts`) — award detection across BOTH award shapes
 *   (`invite.awarded` for a split award, `request.finalVendorId` for the single-vendor track).
 */
import type { CapexRequest, FieldType, VendorInvite } from './types';
import { FIELD_TYPE_LABELS } from './types';
import type { AgingBucket, StagePercentiles } from './kpiUtils';
import { PARTY_LABELS, TERMINAL_STATUSES, agingBuckets, percentile } from './kpiUtils';
import { itemBreached, type QueueBucket } from './kpiQueues';
import { inviteHasQuote, inviteLegSample, type LegKey } from './kpiRisk';
import { holdBreach, worstHold } from './kpiRoutes';
import { ownsFulfillmentTrack } from './paymentUtils';
import { effectiveRfqStatus } from './rfqUtils';

/* ── percentile legs ──────────────────────────────────────────────────── */

/**
 * p50 / p90 for one per-invite cycle-time leg, over the same samples `sourcingPerformance` medians.
 *
 * Returns `StagePercentiles` (the shape `PercentileBar` is duck-typed to) so `sampled` and
 * `stillOpen` travel WITH the percentiles: a percentile computed over finished legs only, printed
 * without how many are still running, reads fastest exactly when the most work is stuck.
 */
export function legPercentiles(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  leg: LegKey,
): StagePercentiles {
  const days: number[] = [];
  let stillOpen = 0;
  for (const r of requests) {
    for (const inv of byRequest.get(r.id) ?? []) {
      const s = inviteLegSample(inv, leg);
      if (s.state === 'sampled') days.push(s.days);
      else if (s.state === 'open') stillOpen++;
    }
  }
  return { p50: percentile(days, 50), p90: percentile(days, 90), sampled: days.length, stillOpen };
}

/**
 * Sample sizes at or below this are called out in words next to the figure — a p50 over two
 * finished legs is an anecdote, not a process metric.
 */
export const SMALL_SAMPLE_MAX = 3;

/** Words for a thin sample, or `null` when there is nothing to qualify. */
export function sampleNote(sampled: number): string | null {
  if (sampled <= 0) return null;
  return sampled <= SMALL_SAMPLE_MAX ? `small sample (${sampled}) — read as an anecdote` : null;
}

/* ── funnel ───────────────────────────────────────────────────────────── */

export interface SourcingFunnelCounts {
  /** Vendor invites created. */
  invited: number;
  /** Invites that put a price on the table (`inviteHasQuote`). */
  quoted: number;
  /**
   * Invites whose commercial position actually settled: an RFQ quotation reached `approved`, OR the
   * invite was awarded out of an auction (the auction IS the negotiation and leaves no RFQ approval
   * stamp).
   */
  negotiated: number;
  /** Invites that own a fulfilment track — either award shape (`ownsFulfillmentTrack`). */
  awarded: number;
}

/**
 * invited → quoted → negotiated → awarded, counted in VENDOR INVITES (the unit sourcing actually
 * works in — one request can invite five vendors and award two).
 *
 * The stages are NOT forced to descend. An awarded invite carrying no quotation at all (possible on
 * legacy data) makes `negotiated` exceed `quoted`, and `FunnelChart` renders that as "grew by N"
 * rather than a fabricated conversion — an honest anomaly beats a monotonic lie.
 */
export function sourcingFunnel(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
): SourcingFunnelCounts {
  const out: SourcingFunnelCounts = { invited: 0, quoted: 0, negotiated: 0, awarded: 0 };
  for (const r of requests) {
    for (const inv of byRequest.get(r.id) ?? []) {
      out.invited++;
      if (inviteHasQuote(inv)) out.quoted++;
      const owns = ownsFulfillmentTrack(r, inv);
      if (owns) out.awarded++;
      if (owns || effectiveRfqStatus(inv) === 'approved') out.negotiated++;
    }
  }
  return out;
}

/* ── wait aging ───────────────────────────────────────────────────────── */

export interface AgingItem {
  requestId: string;
  requestNo: string;
  subject: string;
  /** Display name of whoever is holding it (`PARTY_LABELS`, resolved by `worstHold`'s party). */
  partyLabel: string;
  /** `null` when nobody holds it — undatable, so it is excluded from every bucket. */
  days: number | null;
  /** Past that party's `SLA_DAYS` threshold. */
  breached: boolean;
  /** The `agingBuckets` label this item fell in, or `null` when `days` is `null`. */
  bucket: string | null;
}

export interface WaitAging {
  /** 0-3 / 3-7 / 7-14 / 14+, in age order — straight from `agingBuckets`. */
  buckets: AgingBucket[];
  /** One entry per live request considered, oldest first. */
  items: AgingItem[];
  /** Live requests considered — `items.length`. */
  population: number;
  /** Items with a datable wait. **`Σ buckets[].count === dated` by construction.** */
  dated: number;
  /** Items with nobody holding them — excluded from the buckets, never counted as 0 days. */
  undated: number;
}

/**
 * Which `agingBuckets` bucket one age falls in.
 *
 * Deliberately implemented by asking `agingBuckets` itself about a single-element array rather than
 * comparing against its `max` bounds here: the exclusive-upper-bound rule ("an age of exactly 7
 * belongs to 7-14") then has exactly ONE implementation, and a per-item label can never disagree
 * with the bucket counts rendered beside it.
 */
function bucketLabelFor(age: number): string | null {
  return agingBuckets([age]).find((b) => b.count === 1)?.label ?? null;
}

const isLive = (r: CapexRequest) => r.status !== 'draft' && !TERMINAL_STATUSES.includes(r.status);

/**
 * How long each LIVE request has been sitting with whoever currently holds it, bucketed by age.
 *
 * The population is stated on the returned object rather than left implicit: `population` is every
 * live request (not draft, not completed, not rejected), `dated` is the subset with an actual holder,
 * and the buckets sum to `dated` — a request nobody holds is reported as `undated`, never folded into
 * the youngest bucket as a fabricated zero.
 *
 * The wait itself comes from `worstHold`/`holdBreach` — the same resolution `/capex/requests`
 * evidences its "Waiting" column with, so a row's age here and there is the same number.
 */
export function waitAging(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  now: number,
): WaitAging {
  const items: AgingItem[] = [];
  for (const r of requests) {
    if (!isLive(r)) continue;
    const hold = worstHold(r, byRequest.get(r.id) ?? [], now);
    const days = hold.party === 'none' ? null : hold.days;
    const breachedSla = holdBreach(hold);
    items.push({
      requestId: r.id,
      requestNo: r.requestNo ?? r.id.slice(0, 8),
      subject: r.subject,
      partyLabel: PARTY_LABELS[hold.party],
      days,
      breached: days != null && breachedSla != null,
      bucket: days == null ? null : bucketLabelFor(days),
    });
  }
  items.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

  const dated = items.filter((i) => i.days != null).length;
  return {
    buckets: agingBuckets(items.map((i) => i.days)),
    items,
    population: items.length,
    dated,
    undated: items.length - dated,
  };
}

/* ── plant participation ──────────────────────────────────────────────── */

export interface PlantParticipation {
  plant: string;
  requests: number;
  invited: number;
  quoted: number;
  awarded: number;
}

/**
 * Vendor participation per plant — invited vs quoted vs awarded invites, for the comparison bars.
 *
 * Requests with no plant on the record are grouped under `''`; the caller resolves the display name
 * (and must not print a raw plant key). Sorted by invites desc, then plant asc, so the busiest plant
 * leads and the order is stable across renders.
 */
export function participationByPlant(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
): PlantParticipation[] {
  const rows = new Map<string, PlantParticipation>();
  for (const r of requests) {
    const key = r.plant ?? '';
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { plant: key, requests: 0, invited: 0, quoted: 0, awarded: 0 }));
    row.requests++;
    for (const inv of byRequest.get(r.id) ?? []) {
      row.invited++;
      if (inviteHasQuote(inv)) row.quoted++;
      if (ownsFulfillmentTrack(r, inv)) row.awarded++;
    }
  }
  return [...rows.values()].sort((a, b) => b.invited - a.invited || a.plant.localeCompare(b.plant));
}

/* ── field-type mix (which measured stock series to show) ─────────────── */

export interface FieldTypeMix {
  /** The field type most of these requests belong to. `brown_field` when there are none. */
  dominant: FieldType;
  /** Requests in `dominant`. */
  requests: number;
  /** Requests in some OTHER field type — disclosed, because they are not in that series. */
  others: number;
}

/**
 * Which field type a sourcing desk is mostly working in.
 *
 * The measured snapshot store (`kpiSnapshots.ts`) is scoped per field type, while a sourcing
 * member's queue can span all four. Rather than silently pick one, this names the dominant field
 * type AND counts what it leaves out, so the chart can say which budget it is drawing and how many
 * of the desk's requests are outside it. Ties break on `FIELD_TYPE_ORDER` (a stable, declared order)
 * rather than on object-key iteration order.
 */
export function fieldTypeMix(requests: CapexRequest[]): FieldTypeMix {
  const counts = new Map<FieldType, number>();
  for (const r of requests) {
    const ft = r.fieldType ?? 'brown_field';
    counts.set(ft, (counts.get(ft) ?? 0) + 1);
  }
  let dominant: FieldType = 'brown_field';
  let best = -1;
  for (const ft of FIELD_TYPE_ORDER) {
    const n = counts.get(ft) ?? 0;
    if (n > best) { best = n; dominant = ft; }
  }
  const inDominant = counts.get(dominant) ?? 0;
  return { dominant, requests: inDominant, others: requests.length - inDominant };
}

/**
 * Tie-break order for `fieldTypeMix`, DERIVED from `FIELD_TYPE_LABELS`' declaration order (Brown
 * Field first, the CAPEX default) rather than restated as a second private list. The labels record is
 * the canonical enumeration of field types, so reordering it reorders this — which is the intended
 * coupling. A test pins the first entry, so a reorder that changes the tie-break fails loudly here.
 */
const FIELD_TYPE_ORDER = Object.keys(FIELD_TYPE_LABELS) as FieldType[];

/* ── queue headline (the hero band) ───────────────────────────────────── */

export interface QueueHeadline {
  /** Σ items across every bucket — what the band actually contains. */
  items: number;
  oldestDays: number | null;
  /** Buckets flagged breached by `buildBucket` (their OLDEST item is past the SLA). */
  breachedBuckets: number;
  /**
   * Individual items past their own bucket's SLA. This is the actionable number: a breached bucket
   * says "something in here is late", this says how many things.
   *
   * **It is a measure over PART of the band** — see `unmeasurableItems`. Never present it as "nothing
   * is late" without that number beside it.
   */
  breachedItems: number;
  /** Items sitting in buckets that DO carry a threshold — the population `breachedItems` measures. */
  measuredItems: number;
  /**
   * Items in buckets with **no threshold defined at all** (`QueueBucket.slaKey` absent). Most of the
   * sourcing band is like this: `SLA_DAYS` has no `sourcing` entry, so "Quotations to review",
   * "INCO terms to settle", "Ready to award", "New requests to pick up" and "Auction ended, not
   * awarded" can never breach anything. These items are INVISIBLE to `breachedItems`, which is why a
   * hero tile that shows only that number must never read as an all-clear: a month-old quotation
   * lands here, not in the breach count.
   */
  unmeasurableItems: number;
  /** Oldest age among `unmeasurableItems` — the figure that would have raised the alarm. */
  unmeasurableOldestDays: number | null;
  /** Non-empty buckets that carry a threshold / that do not — the coverage of the measure, in queues. */
  measuredBuckets: number;
  unmeasurableBuckets: number;
  /** The largest non-empty bucket, for a "biggest pile" line. */
  top: { label: string; count: number } | null;
}

/**
 * One-line summary of a whole queue band, for the hero tiles above the tabs. Reads the buckets
 * `sourcingQueues` already produced — the hero and the band below it are the same numbers at two
 * levels of detail, never two derivations.
 *
 * The breach comparison itself is `itemBreached` from `kpiQueues.ts`, the same function `buildBucket`
 * applies at bucket level, so the hero band and the bucket badge under it cannot disagree about the
 * `age === limit` boundary.
 */
export function queueHeadline(buckets: QueueBucket[]): QueueHeadline {
  let items = 0;
  let breachedItems = 0;
  let breachedBuckets = 0;
  let measuredItems = 0;
  let unmeasurableItems = 0;
  let measuredBuckets = 0;
  let unmeasurableBuckets = 0;
  let unmeasurableOldestDays: number | null = null;
  let oldestDays: number | null = null;
  let top: { label: string; count: number } | null = null;

  for (const b of buckets) {
    items += b.count;
    if (b.breached) breachedBuckets++;
    if (b.oldestDays != null && (oldestDays == null || b.oldestDays > oldestDays)) {
      oldestDays = b.oldestDays;
    }

    if (b.slaKey) {
      measuredItems += b.count;
      if (b.count > 0) measuredBuckets++;
      breachedItems += b.items.filter((i) => itemBreached(i.ageDays, b.slaKey)).length;
    } else {
      unmeasurableItems += b.count;
      if (b.count > 0) unmeasurableBuckets++;
      if (b.oldestDays != null
        && (unmeasurableOldestDays == null || b.oldestDays > unmeasurableOldestDays)) {
        unmeasurableOldestDays = b.oldestDays;
      }
    }

    if (b.count > 0 && (top == null || b.count > top.count)) top = { label: b.label, count: b.count };
  }

  return {
    items, oldestDays, breachedBuckets, breachedItems,
    measuredItems, unmeasurableItems, unmeasurableOldestDays,
    measuredBuckets, unmeasurableBuckets, top,
  };
}
