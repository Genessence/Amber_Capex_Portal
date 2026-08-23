import { describe, expect, it } from 'vitest';
import {
  fieldTypeMix, legPercentiles, participationByPlant, queueHeadline, sampleNote,
  sourcingFunnel, waitAging,
} from './kpiSourcing';
import { buildBucket, itemBreached, type QueueItem } from './kpiQueues';
import { SLA_DAYS, agingBuckets, invitesByRequest, median, percentile } from './kpiUtils';
import { FIELD_TYPE_LABELS } from './types';
import type { CapexRequest, RfqPriceMessage, RfqQuote, VendorInvite } from './types';

// Noon UTC keeps every fixture safely inside its intended calendar day whatever the runner's TZ.
const NOW = new Date('2026-08-17T12:00:00.000Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', subject: 'Chiller', category: 'Machinery', quantity: '1', priority: 'medium',
    justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing', plant: 'jhajjar_p1',
    createdBy: 'Arjun Mehta', createdAt: iso(30),
    statusHistory: [{ status: 'sourcing', actor: 'A', at: iso(30) }],
    ...over,
  };
}

function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't1', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(30),
    auctionApprovalStatus: 'not_sent', ...over,
  };
}

const quote = (price: number): RfqQuote => ({ price, currency: 'INR' });

function thread(parts: Partial<RfqPriceMessage>[]): RfqPriceMessage[] {
  return parts.map((p, i) => ({
    id: `m${i}`, by: 'supplier', senderName: 'V', action: 'proposed', at: iso(10), ...p,
  }));
}

const index = (requests: CapexRequest[], invites: VendorInvite[]) =>
  [requests, invitesByRequest(invites)] as const;

// NOTE: the plant-scoped metric route used to be `kpiSourcing.scopedMetricHref` and is now
// `kpiRoutes.metricHref(key, plant)` — the one home for it. Its tests moved to `kpiRoutes.test.ts`.

/* ── percentile legs ────────────────────────────────────────────────────── */

describe('legPercentiles', () => {
  it('samples finished legs, counts started-but-unfinished ones as still open', () => {
    // 3 finished first-quote legs (2, 4 and 10 days) + 1 invite that never replied.
    const invites = [
      invite({ id: 'a', invitedAt: iso(20), rfqThread: thread([{ at: iso(18), quote: quote(10) }]) }),
      invite({ id: 'b', invitedAt: iso(20), rfqThread: thread([{ at: iso(16), quote: quote(10) }]) }),
      invite({ id: 'c', invitedAt: iso(20), rfqThread: thread([{ at: iso(10), quote: quote(10) }]) }),
      invite({ id: 'd', invitedAt: iso(20) }),
    ];
    const [requests, byRequest] = index([req()], invites);
    const p = legPercentiles(requests, byRequest, 'firstQuote');

    expect(p.sampled).toBe(3);
    expect(p.stillOpen).toBe(1);
    expect(p.p50).toBeCloseTo(4, 6);
    // p90 of [2,4,10] under the shared linear-interpolation convention.
    expect(p.p90).toBeCloseTo(percentile([2, 4, 10], 90)!, 6);
    // p50 must agree with the median the same leg reports elsewhere.
    expect(p.p50).toBeCloseTo(median([2, 4, 10])!, 6);
  });

  it('reports an empty sample without fabricating markers', () => {
    const [requests, byRequest] = index([req()], [invite({ invitedAt: iso(5) })]);
    expect(legPercentiles(requests, byRequest, 'firstQuote'))
      .toEqual({ p50: null, p90: null, sampled: 0, stillOpen: 1 });
  });

  it('measures the negotiation and tech-spec legs off their own stamps', () => {
    const invites = [invite({
      invitedAt: iso(20),
      rfqThread: thread([
        { at: iso(18), quote: quote(10) },
        { at: iso(12), action: 'approved', by: 'sourcing' },
      ]),
      techSpec: { id: 's1', status: 'approved', documents: [], thread: [], sentAt: iso(9), decidedAt: iso(6) },
    })];
    const [requests, byRequest] = index([req()], invites);

    expect(legPercentiles(requests, byRequest, 'negotiation').p50).toBeCloseTo(6, 6);
    expect(legPercentiles(requests, byRequest, 'techSpec').p50).toBeCloseTo(3, 6);
  });
});

describe('sampleNote', () => {
  it('qualifies a thin sample and stays silent on a real one', () => {
    expect(sampleNote(0)).toBeNull();
    expect(sampleNote(1)).toContain('small sample (1)');
    expect(sampleNote(3)).toContain('small sample (3)');
    expect(sampleNote(4)).toBeNull();
  });
});

/* ── funnel ─────────────────────────────────────────────────────────────── */

describe('sourcingFunnel', () => {
  it('counts vendor invites through invited → quoted → negotiated → awarded', () => {
    const invites = [
      invite({ id: 'a' }),                                            // invited only
      invite({ id: 'b', rfqQuote: quote(100) }),                       // quoted
      invite({ id: 'c', rfqQuote: quote(90), rfqStatus: 'approved' }), // quoted + negotiated
      invite({                                                        // quoted + negotiated + awarded
        id: 'd', vendorId: 'v4', rfqQuote: quote(80), rfqStatus: 'approved',
        awarded: true, awardAmount: 80,
      }),
    ];
    const [requests, byRequest] = index([req()], invites);
    expect(sourcingFunnel(requests, byRequest))
      .toEqual({ invited: 4, quoted: 3, negotiated: 2, awarded: 1 });
  });

  it('counts an awarded auction bid as negotiated even with no RFQ approval stamp', () => {
    const invites = [invite({ id: 'a', openingQuote: { id: 'q', price: 50, currency: 'INR', submittedAt: iso(3), deliveryDays: 30, validUntil: iso(-30) }, awarded: true })];
    const [requests, byRequest] = index([req()], invites);
    expect(sourcingFunnel(requests, byRequest))
      .toEqual({ invited: 1, quoted: 1, negotiated: 1, awarded: 1 });
  });

  it('counts the single-vendor track (finalVendorId) as awarded, not just split awards', () => {
    const invites = [
      invite({ id: 'a', vendorId: 'v1', rfqQuote: quote(70), rfqStatus: 'approved' }),
      invite({ id: 'b', vendorId: 'v2', rfqQuote: quote(90) }),
    ];
    const [requests, byRequest] = index([req({ finalVendorId: 'v1' })], invites);
    expect(sourcingFunnel(requests, byRequest))
      .toEqual({ invited: 2, quoted: 2, negotiated: 1, awarded: 1 });
  });

  it('lets negotiated exceed quoted rather than clamping the anomaly away', () => {
    // Awarded with no quotation anywhere on the invite — legacy shape.
    const invites = [invite({ id: 'a', awarded: true })];
    const [requests, byRequest] = index([req()], invites);
    const f = sourcingFunnel(requests, byRequest);
    expect(f.quoted).toBe(0);
    expect(f.negotiated).toBe(1);
  });
});

/* ── wait aging ─────────────────────────────────────────────────────────── */

describe('waitAging', () => {
  it('buckets every live request and the buckets sum to the dated population', () => {
    // Ages come from the ball holder: a `pending_head_approval` request waits since its last
    // status stamp, so the fixture controls the age through statusHistory.
    const mk = (id: string, daysWaiting: number) => req({
      id, requestNo: `CAP-${id}`, status: 'pending_head_approval',
      statusHistory: [
        { status: 'submitted', actor: 'A', at: iso(daysWaiting + 1) },
        { status: 'pending_head_approval', actor: 'A', at: iso(daysWaiting) },
      ],
    });
    const requests = [mk('a', 1), mk('b', 5), mk('c', 7), mk('d', 20), mk('e', 21)];
    const aging = waitAging(requests, new Map(), NOW);

    expect(aging.population).toBe(5);
    expect(aging.dated).toBe(5);
    expect(aging.undated).toBe(0);
    expect(aging.buckets.reduce((s, b) => s + b.count, 0)).toBe(aging.dated);
    expect(aging.buckets.map(b => [b.label, b.count])).toEqual([
      ['0-3', 1], ['3-7', 1], ['7-14', 1], ['14+', 2],
    ]);
    // Boundary: exactly 7 days belongs to the OLDER bucket — one rule, `agingBuckets`'.
    expect(aging.items.find(i => i.requestNo === 'CAP-c')?.bucket).toBe('7-14');
    // Oldest first, and the holder is named (never a raw party key).
    expect(aging.items[0].requestNo).toBe('CAP-e');
    expect(aging.items[0].partyLabel).toBe('Plant Head');
    expect(aging.items[0].breached).toBe(true);
    expect(aging.items.find(i => i.requestNo === 'CAP-a')?.breached).toBe(false);
  });

  it('excludes draft, completed and rejected requests from the population', () => {
    const requests = [
      req({ id: 'a', status: 'draft' }),
      req({ id: 'b', status: 'completed' }),
      req({ id: 'c', status: 'rejected' }),
      req({ id: 'd', status: 'sourcing' }),
    ];
    const aging = waitAging(requests, new Map(), NOW);
    expect(aging.population).toBe(1);
    expect(aging.items[0].requestId).toBe('d');
  });

  it('reports a live request nobody holds as undated instead of a zero-day wait', () => {
    // Award-based and every award completed → `ballHolders` returns party 'none', while the request
    // itself is still live.
    const invites = [invite({ id: 'a', awarded: true, awardStatus: 'completed' })];
    const [requests, byRequest] = index([req({ status: 'pi_requested' })], invites);
    const aging = waitAging(requests, byRequest, NOW);

    expect(aging.population).toBe(1);
    expect(aging.dated).toBe(0);
    expect(aging.undated).toBe(1);
    expect(aging.items[0].days).toBeNull();
    expect(aging.items[0].bucket).toBeNull();
    expect(aging.buckets.reduce((s, b) => s + b.count, 0)).toBe(0);
  });

  it('assigns each item the same bucket agingBuckets would count it in', () => {
    const requests = [0.5, 3, 6.9, 7, 13.9, 14, 40].map((d, i) => req({
      id: `r${i}`, status: 'pending_head_approval',
      statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(d) }],
    }));
    const aging = waitAging(requests, new Map(), NOW);
    const fromItems = new Map<string, number>();
    for (const it of aging.items) {
      if (it.bucket) fromItems.set(it.bucket, (fromItems.get(it.bucket) ?? 0) + 1);
    }
    for (const b of agingBuckets(aging.items.map(i => i.days))) {
      expect(fromItems.get(b.label) ?? 0).toBe(b.count);
    }
  });
});

/* ── plant participation ────────────────────────────────────────────────── */

describe('participationByPlant', () => {
  it('groups invited / quoted / awarded per plant, busiest first', () => {
    const requests = [
      req({ id: 'r1', plant: 'jhajjar_p1' }),
      req({ id: 'r2', plant: 'ddn_4' }),
      req({ id: 'r3', plant: 'jhajjar_p1' }),
    ];
    const invites = [
      invite({ id: 'a', requestId: 'r1', rfqQuote: quote(10) }),
      invite({ id: 'b', requestId: 'r1', vendorId: 'v2' }),
      invite({ id: 'c', requestId: 'r3', vendorId: 'v3', rfqQuote: quote(20), awarded: true, awardAmount: 20 }),
      invite({ id: 'd', requestId: 'r2', vendorId: 'v4' }),
    ];
    expect(participationByPlant(requests, invitesByRequest(invites))).toEqual([
      { plant: 'jhajjar_p1', requests: 2, invited: 3, quoted: 2, awarded: 1 },
      { plant: 'ddn_4', requests: 1, invited: 1, quoted: 0, awarded: 0 },
    ]);
  });

  it('keys a request with no plant under the empty string rather than dropping it', () => {
    const rows = participationByPlant([req({ plant: undefined })], new Map());
    expect(rows).toEqual([{ plant: '', requests: 1, invited: 0, quoted: 0, awarded: 0 }]);
  });
});

/* ── field-type mix ─────────────────────────────────────────────────────── */

describe('fieldTypeMix', () => {
  it('names the dominant field type and counts what it leaves out', () => {
    const rows = [
      req({ id: 'a', fieldType: 'green_field' }),
      req({ id: 'b', fieldType: 'green_field' }),
      req({ id: 'c', fieldType: 'green_field' }),
      req({ id: 'd', fieldType: 'brown_field' }),
      req({ id: 'e', fieldType: 'digitisation' }),
    ];
    expect(fieldTypeMix(rows)).toEqual({ dominant: 'green_field', requests: 3, others: 2 });
  });

  it('treats a missing fieldType as brown_field, the app-wide default', () => {
    expect(fieldTypeMix([req({ fieldType: undefined })]))
      .toEqual({ dominant: 'brown_field', requests: 1, others: 0 });
  });

  it('breaks a tie on the declared order, not object-key order', () => {
    const rows = [req({ id: 'a', fieldType: 'information_technology' }), req({ id: 'b', fieldType: 'brown_field' })];
    expect(fieldTypeMix(rows).dominant).toBe('brown_field');
  });

  it('defaults to brown_field with no requests at all', () => {
    expect(fieldTypeMix([])).toEqual({ dominant: 'brown_field', requests: 0, others: 0 });
  });

  // The tie-break order is DERIVED from FIELD_TYPE_LABELS rather than restated, so a reorder of that
  // record silently changes which field type wins a tie. Pin it here so the reorder fails loudly.
  it('takes its tie-break order from FIELD_TYPE_LABELS, which still leads with brown_field', () => {
    expect(Object.keys(FIELD_TYPE_LABELS)[0]).toBe('brown_field');
  });
});

/* ── queue headline ─────────────────────────────────────────────────────── */

describe('queueHeadline', () => {
  const item = (id: string, ageDays: number | null): QueueItem =>
    ({ id, label: id, href: `/capex/${id}`, ageDays });

  it('sums items, names the biggest pile, and counts breached ITEMS not just buckets', () => {
    // plantHead SLA is 3 days: two of these three are past it.
    const buckets = [
      buildBucket({ key: 'a', label: 'Quotations to review', items: [item('1', 1), item('2', 2), item('3', 9)] }),
      buildBucket({ key: 'b', label: 'Tech spec to send', items: [item('4', 5), item('5', 4), item('6', 1)], slaKey: 'plantHead' }),
    ];
    const h = queueHeadline(buckets);

    expect(h.items).toBe(6);
    expect(h.oldestDays).toBe(9);
    expect(h.breachedBuckets).toBe(1);
    expect(h.breachedItems).toBe(2);
    expect(h.top).toEqual({ label: 'Quotations to review', count: 3 });
  });

  it('does NOT count an age exactly equal to the limit as breached', () => {
    // The exclusive convention lives in `itemBreached` (kpiQueues) — the same function `buildBucket`
    // applies at bucket level. Pinned at both levels so the hero band and the bucket badge beside it
    // can never disagree about the boundary.
    const limit = SLA_DAYS.plantHead;
    const bucket = buildBucket({
      key: 'a', label: 'On the line', slaKey: 'plantHead',
      items: [item('1', limit), item('2', limit + 0.001)],
    });
    const h = queueHeadline([bucket]);

    expect(itemBreached(limit, 'plantHead')).toBe(false);
    expect(itemBreached(limit + 0.001, 'plantHead')).toBe(true);
    expect(h.breachedItems).toBe(1);
    expect(bucket.breached).toBe(true); // its OLDEST item is past the limit
  });

  it('never scores an undatable item as breached, but still counts it as measured', () => {
    const h = queueHeadline([buildBucket({
      key: 'a', label: 'Tech spec to send', slaKey: 'techSpec',
      items: [item('1', null), item('2', null)],
    })]);
    expect(h.items).toBe(2);
    expect(h.measuredItems).toBe(2);
    expect(h.breachedItems).toBe(0);
    expect(h.unmeasurableItems).toBe(0);
    expect(itemBreached(null, 'techSpec')).toBe(false);
  });

  // The Major finding: items in buckets with NO threshold are invisible to `breachedItems`, so the
  // hero tile must be able to say how many it cannot see, and how old the oldest of them is.
  it('reports the items it CANNOT measure, with their oldest age, over a mixed bucket set', () => {
    const buckets = [
      // No slaKey — `SLA_DAYS` has no `sourcing` entry, so nothing in here can ever breach.
      buildBucket({ key: 'q', label: 'Quotations to review', items: [item('1', 30), item('2', 2)] }),
      buildBucket({ key: 'p', label: 'New requests to pick up', items: [item('3', 9)] }),
      buildBucket({ key: 'e', label: 'Ready to award', items: [] }),
      // Threshold-carrying, nothing late.
      buildBucket({ key: 't', label: 'Tech spec to send', slaKey: 'techSpec', items: [item('4', 1)] }),
    ];
    const h = queueHeadline(buckets);

    expect(h.items).toBe(4);
    expect(h.breachedItems).toBe(0);          // the tile's own number: genuinely 0…
    expect(h.unmeasurableItems).toBe(3);      // …over only 1 of the 4 items
    expect(h.unmeasurableOldestDays).toBe(30); // the figure that must reach the screen
    expect(h.measuredItems).toBe(1);
    expect(h.measuredBuckets).toBe(1);
    expect(h.unmeasurableBuckets).toBe(2);    // empty buckets are not "queues with work in them"
    expect(h.oldestDays).toBe(30);
  });

  it('is empty-safe and never invents an oldest age or a top bucket', () => {
    const empty = {
      items: 0, oldestDays: null, breachedBuckets: 0, breachedItems: 0,
      measuredItems: 0, unmeasurableItems: 0, unmeasurableOldestDays: null,
      measuredBuckets: 0, unmeasurableBuckets: 0, top: null,
    };
    expect(queueHeadline([buildBucket({ key: 'a', label: 'Empty', items: [] })])).toEqual(empty);
    expect(queueHeadline([])).toEqual(empty);
  });
});

/* ── the empty scope the plant lens produces ────────────────────────────── */

describe('an empty scope (a known plant with no requests)', () => {
  it('reports zeros without inventing a bucket, a stage or a plant row', () => {
    expect(waitAging([], new Map(), NOW)).toEqual({
      buckets: agingBuckets([]),
      items: [],
      population: 0,
      dated: 0,
      undated: 0,
    });
    // Still four labelled buckets, all zero — the shape the chart needs, with no fabricated counts.
    expect(waitAging([], new Map(), NOW).buckets.map(b => b.count)).toEqual([0, 0, 0, 0]);
    expect(sourcingFunnel([], new Map()))
      .toEqual({ invited: 0, quoted: 0, negotiated: 0, awarded: 0 });
    expect(participationByPlant([], new Map())).toEqual([]);
    expect(legPercentiles([], new Map(), 'firstQuote'))
      .toEqual({ p50: null, p90: null, sampled: 0, stillOpen: 0 });
  });

  it('scopes to nothing when a request exists at a DIFFERENT plant (the lens filter itself)', () => {
    // The lens filters in the component; this pins the pure half — a scoped-out array yields nothing.
    const scoped: CapexRequest[] = [];
    expect(waitAging(scoped, new Map(), NOW).population).toBe(0);
    expect(participationByPlant(scoped, new Map())).toEqual([]);
  });
});
