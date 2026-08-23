import { describe, expect, it } from 'vitest';
import {
  METRICS, buildRequestListView, holdBreach, isMetricKey, metricHref, worstHold,
  type RequestListContext,
} from './kpiRoutes';
import { DAY_MS, invitesByRequest, masterIndex, medianStageDays, statusTally } from './kpiUtils';
import { adminQueues, stuckAtPlantHead } from './kpiQueues';
import { sourcingPerformance } from './kpiRisk';
import type { CapexRequest, CapexStatus, VendorInvite } from './types';

const NOW = new Date('2026-08-15T00:00:00.000Z').getTime();
const iso = (d: number) => new Date(NOW - d * DAY_MS).toISOString();
const IDX = masterIndex([]);
/** One `statusHistory` entry, `d` days ago. */
const h = (status: CapexStatus, d: number) => ({ status, actor: 'seed', at: iso(d) });

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', requestNo: 'CAP-2627-0001', subject: 'Chiller', category: 'M', quantity: '1',
    priority: 'medium', justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing', plant: 'jhajjar_p1',
    createdBy: 'Arjun Mehta', createdAt: iso(30), ...over,
  };
}
function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(20),
    auctionApprovalStatus: 'not_sent', ...over,
  };
}
const ctx = (requests: CapexRequest[], invites: VendorInvite[] = []): RequestListContext => ({
  requests, byRequest: invitesByRequest(invites), now: NOW,
});

/** A request that reached `sourcing` `from` days ago and `pi_requested` `to` days ago. */
const cycled = (id: string, from: number, to: number | null): CapexRequest =>
  req({
    id,
    status: to == null ? 'sourcing' : 'pi_requested',
    statusHistory: [
      { status: 'submitted', actor: 'a', at: iso(from + 2) },
      { status: 'sourcing', actor: 'a', at: iso(from) },
      ...(to == null ? [] : [{ status: 'pi_requested' as const, actor: 'a', at: iso(to) }]),
    ],
  });

describe('registry shape', () => {
  it('exposes a key, words and evidencing columns for every metric', () => {
    for (const [key, def] of Object.entries(METRICS)) {
      expect(def.key).toBe(key);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      // A cohort/ratio card with no evidencing column would be a number with no evidence again.
      expect(def.columns.length).toBeGreaterThan(0);
      expect(metricHref(def.key)).toBe(`/capex/requests?metric=${key}`);
    }
  });

  it('recognises only registered keys', () => {
    expect(isMetricKey('stuck_plant_head')).toBe(true);
    expect(isMetricKey('stuck_at_plant_head')).toBe(false);
    expect(isMetricKey('toString')).toBe(false); // prototype keys are not metrics
  });
});

/* ── the route builder, including the plant lens ───────────────────────── */

describe('metricHref', () => {
  it('is unchanged when there is no plant lens', () => {
    expect(metricHref('sourcing_cycle')).toBe('/capex/requests?metric=sourcing_cycle');
    expect(metricHref('sourcing_cycle', null)).toBe('/capex/requests?metric=sourcing_cycle');
    // An empty lens value is "no lens", not "the plant whose value is the empty string" — it must
    // never emit `&plant=`, which `buildRequestListView` would then have to report as ignored.
    expect(metricHref('sourcing_cycle', '')).toBe('/capex/requests?metric=sourcing_cycle');
  });

  it('appends the lensed plant as a narrowing param', () => {
    expect(metricHref('invite_first_quote', 'jhajjar_p1'))
      .toBe('/capex/requests?metric=invite_first_quote&plant=jhajjar_p1');
  });

  /**
   * The encoding this consolidation exists to pin down. Two copies of this rule diverged on exactly
   * this point — one used `encodeURIComponent` (space → `%20`), the other `URLSearchParams`
   * (space → `+`) — and nothing broke only because every plant value today is slugified. The
   * spelling is asserted so a future change to it is a deliberate edit and not a silent drift, and
   * the ROUND TRIP is asserted because that, not the spelling, is what makes the destination list
   * scope the way the tile did.
   */
  it('encodes a plant value that `+` and `%20` would spell differently, and round-trips it', () => {
    const plant = 'jhajjar p1';
    const href = metricHref('tech_spec_gate', plant);
    expect(href).toBe('/capex/requests?metric=tech_spec_gate&plant=jhajjar+p1');
    expect(href).not.toContain('%20');

    const [path, query, ...rest] = href.split('?');
    expect(path).toBe('/capex/requests');
    expect(rest).toHaveLength(0); // exactly one query string — never concatenated onto another
    const parsed = new URLSearchParams(query);
    expect(parsed.get('metric')).toBe('tech_spec_gate');
    // The value `useSearchParams().get('plant')` will hand `buildRequestListView`.
    expect(parsed.get('plant')).toBe(plant);
  });

  it('escapes a value that would otherwise break the query string, and round-trips it', () => {
    // `&`, `=` and `#` are the characters a hand-built `&plant=${value}` gets wrong: unescaped they
    // would split into extra params or truncate the URL at the fragment.
    const plant = 'a&b=c#d';
    const parsed = new URLSearchParams(metricHref('rejection_rate', plant).split('?')[1]);
    expect(parsed.get('plant')).toBe(plant);
    expect(parsed.get('metric')).toBe('rejection_rate');
    expect([...parsed.keys()]).toEqual(['metric', 'plant']);
  });

  it('the lensed route narrows the SAME list the unlensed one shows — tile equals destination', () => {
    // The invariant in one assertion: `?plant=` is applied by `buildRequestListView`, so the lensed
    // route's row count is exactly the unlensed route's rows filtered to that plant.
    const here = req({ id: 'a', plant: 'jhajjar_p1', status: 'rejected' });
    const there = req({ id: 'b', plant: 'ddn_4', status: 'rejected' });
    const c = ctx([here, there]);
    const paramsOf = (href: string) => {
      const p = new URLSearchParams(href.split('?')[1]);
      return { metric: p.get('metric'), plant: p.get('plant') };
    };
    const all = buildRequestListView(paramsOf(metricHref('rejection_rate')), c);
    const lensed = buildRequestListView(paramsOf(metricHref('rejection_rate', 'jhajjar_p1')), c);
    expect(all.rows).toHaveLength(2);
    expect(lensed.rows.map((r) => r.request.id)).toEqual(['a']);
    expect(lensed.denominator).toBe(1);
    expect(lensed.chips.some((c) => c.param === 'plant')).toBe(true);
  });
});

/* ── predicate metrics ─────────────────────────────────────────────────── */

describe('stuck_plant_head', () => {
  const stuck = req({ id: 'r1', status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'a', at: iso(9) }] });
  const fresh = req({ id: 'r2', status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'a', at: iso(1) }] });
  const other = req({ id: 'r3', status: 'sourcing' });
  const requests = [stuck, fresh, other];

  it('lists exactly the rows the Administration tile counts', () => {
    const tile = adminQueues(requests, new Map(), [], [], NOW).mine.find(b => b.key === 'stuckPlantHead')!;
    const view = buildRequestListView({ metric: 'stuck_plant_head' }, ctx(requests));
    expect(tile.count).toBe(1);
    expect(view.rows).toHaveLength(tile.count);
    expect(view.rows[0].request.id).toBe('r1');
  });

  it('does NOT list the pending-but-inside-SLA request the status filter would show', () => {
    const byStatus = buildRequestListView({ filter: 'pending_head_approval' }, ctx(requests));
    const byMetric = buildRequestListView({ metric: 'stuck_plant_head' }, ctx(requests));
    expect(byStatus.rows).toHaveLength(2);
    expect(byMetric.rows).toHaveLength(1);
  });

  it('evidences the wait and marks the breach in words, not only colour', () => {
    const view = buildRequestListView({ metric: 'stuck_plant_head' }, ctx(requests));
    const w = view.rows[0].evidence.waiting!;
    expect(w.party).toBe('plant_head');
    expect(Math.round(w.days!)).toBe(9);
    expect(w.breachedSla).toBe('plantHead');
    expect(w.breachWords).toContain('3d');
  });

  it('names the threshold in the chip words', () => {
    const view = buildRequestListView({ metric: 'stuck_plant_head' }, ctx(requests));
    expect(view.chips[0]).toMatchObject({ param: 'metric', value: 'stuck_plant_head' });
    expect(view.chips[0].words).toContain('3d');
  });

  it('discloses the pending requests it excludes', () => {
    const view = buildRequestListView({ metric: 'stuck_plant_head' }, ctx(requests));
    expect(view.notes.join(' ')).toContain('1 other request(s) are with the plant head but still inside it');
  });
});

describe('my_requests', () => {
  it('lists every request in scope and restates the completed/rejected split', () => {
    const requests = [req({ id: 'r1', status: 'completed' }), req({ id: 'r2', status: 'rejected' }), req({ id: 'r3', status: 'draft' })];
    const view = buildRequestListView({ metric: 'my_requests' }, ctx(requests));
    expect(view.rows).toHaveLength(requests.length);
    expect(view.notes[0]).toBe('3 requests · 1 completed · 1 rejected.');
  });
});

/* ── cohort metrics ────────────────────────────────────────────────────── */

describe('sourcing_cycle', () => {
  const requests = [cycled('r1', 20, 14), cycled('r2', 20, 10), cycled('r3', 8, null)];

  it('lists exactly the sample the median was computed over, with the same figures', () => {
    const kpi = medianStageDays(requests, 'sourcing', 'pi_requested');
    const view = buildRequestListView({ metric: 'sourcing_cycle' }, ctx(requests));
    expect(view.sampled).toBe(kpi.sampled);
    expect(view.stillOpen).toBe(kpi.stillOpen);
    expect(view.medianDays).toBe(kpi.medianDays);
    expect(view.rows).toHaveLength(kpi.sampled);
    expect(view.rows.map(r => r.request.id)).toEqual(['r1', 'r2']);
  });

  it('agrees with the Sourcing tile it is linked from', () => {
    const perf = sourcingPerformance(requests, new Map(), IDX, NOW, []);
    const view = buildRequestListView({ metric: 'sourcing_cycle' }, ctx(requests));
    expect(view.medianDays).toBe(perf.cycle.medianDays);
    expect(view.sampled).toBe(perf.cycle.sampled);
    expect(view.stillOpen).toBe(perf.cycle.stillOpen);
  });

  it('shows each row its measured duration', () => {
    const view = buildRequestListView({ metric: 'sourcing_cycle' }, ctx(requests));
    expect(Math.round(view.rows[0].evidence.duration!.days)).toBe(6);
    expect(view.rows[0].evidence.duration!.note).toBe('sourcing → PI requested');
  });

  it('states the still-open rows in words instead of hiding the survivorship bias', () => {
    const view = buildRequestListView({ metric: 'sourcing_cycle' }, ctx(requests));
    expect(view.notes.join(' ')).toContain('Excluded from the median: 1 request that reached sourcing with no recorded PI request');
    expect(view.notes.join(' ')).toContain('Not listed below');
  });

  it('says so explicitly when nothing is excluded', () => {
    const view = buildRequestListView({ metric: 'sourcing_cycle' }, ctx([cycled('r1', 20, 14)]));
    expect(view.notes.join(' ')).toContain('nothing is excluded from the median');
  });
});

describe('per-invite cycle-time legs', () => {
  const requests = [req({ id: 'r1' }), req({ id: 'r2' })];
  const invites = [
    // r1: two vendors replied (4d and 6d), one is still silent.
    invite({ id: 'i1', requestId: 'r1', vendorId: 'v1', invitedAt: iso(20), rfqThread: [
      { id: 'm1', by: 'supplier', senderName: 'A', action: 'proposed', at: iso(16), quote: { price: 1 } },
      { id: 'm2', by: 'sourcing', senderName: 'S', action: 'approved', at: iso(12) },
    ] }),
    invite({ id: 'i2', requestId: 'r1', vendorId: 'v2', invitedAt: iso(20), rfqThread: [
      { id: 'm3', by: 'supplier', senderName: 'B', action: 'proposed', at: iso(14), quote: { price: 2 } },
    ] }),
    invite({ id: 'i3', requestId: 'r1', vendorId: 'v3', invitedAt: iso(20) }),
    // r2: one vendor replied after 2d, and its tech spec took 3d.
    invite({ id: 'i4', requestId: 'r2', vendorId: 'v1', invitedAt: iso(10), rfqThread: [
      { id: 'm4', by: 'supplier', senderName: 'A', action: 'proposed', at: iso(8), quote: { price: 3 } },
    ], techSpec: { id: 'ts1', status: 'approved', documents: [], thread: [], sentAt: iso(7), decidedAt: iso(4) } }),
  ];
  const c = ctx(requests, invites);
  const perf = sourcingPerformance(requests, invitesByRequest(invites), IDX, NOW, []);

  it('invite_first_quote median equals the tile, over invites not requests', () => {
    const view = buildRequestListView({ metric: 'invite_first_quote' }, c);
    expect(view.medianDays).toBe(perf.firstQuote);
    expect(view.sampled).toBe(3);   // i1, i2, i4
    expect(view.stillOpen).toBe(1); // i3 — invited, never replied
    expect(view.rows).toHaveLength(2);
    expect(view.notes.join(' ')).toContain('Excluded from the median: 1 vendor invite that started this leg with no recorded finish');
  });

  it('shows a per-request median when several vendors contributed', () => {
    const view = buildRequestListView({ metric: 'invite_first_quote' }, c);
    const r1 = view.rows.find(r => r.request.id === 'r1')!;
    expect(Math.round(r1.evidence.duration!.days)).toBe(5); // median of 4d and 6d
    expect(r1.evidence.duration!.note).toBe('median of 2 vendor invites');
  });

  it('first_quote_agreed median equals the tile and discloses the unsettled ones', () => {
    const view = buildRequestListView({ metric: 'first_quote_agreed' }, c);
    expect(view.medianDays).toBe(perf.negotiationTime);
    expect(view.sampled).toBe(1);   // i1 only
    expect(view.stillOpen).toBe(2); // i2, i4 quoted but never agreed
    expect(view.rows.map(r => r.request.id)).toEqual(['r1']);
  });

  it('tech_spec_gate median equals the tile', () => {
    const view = buildRequestListView({ metric: 'tech_spec_gate' }, c);
    expect(view.medianDays).toBe(perf.techSpecTime);
    expect(view.sampled).toBe(1);
    expect(view.stillOpen).toBe(0);
    expect(view.rows.map(r => r.request.id)).toEqual(['r2']);
  });
});

/* ── ratio metrics ─────────────────────────────────────────────────────── */

describe('vendor_participation', () => {
  const requests = [req({ id: 'r1' }), req({ id: 'r2' }), req({ id: 'r3' })];
  const invites = [
    invite({ id: 'i1', requestId: 'r1', vendorId: 'v1', rfqQuote: { price: 100 } }),
    invite({ id: 'i2', requestId: 'r1', vendorId: 'v2' }),
    invite({ id: 'i3', requestId: 'r2', vendorId: 'v1', openingQuote: { id: 'q1', price: 90, deliveryDays: 30, validUntil: iso(-30), submittedAt: iso(3) } }),
    // r3 has no invites at all — not part of the denominator, so not listed.
  ];

  it('lands on the denominator with the numerator marked per row', () => {
    const c = ctx(requests, invites);
    const perf = sourcingPerformance(requests, invitesByRequest(invites), IDX, NOW, []);
    const view = buildRequestListView({ metric: 'vendor_participation' }, c);
    expect(view.numerator).toBe(perf.quoted);
    expect(view.denominator).toBe(perf.invited);
    expect(view.rows).toHaveLength(2);
    expect(view.rows[0].evidence.participation).toEqual({ quoted: 1, invited: 2 });
    expect(view.rows[1].evidence.participation).toEqual({ quoted: 1, invited: 1 });
    expect(view.notes[0]).toContain('2 of 3 invited vendors quoted (67%)');
  });
});

describe('rejection_rate', () => {
  const requests = [req({ id: 'r1', status: 'rejected' }), req({ id: 'r2' }), req({ id: 'r3' }), req({ id: 'r4' })];

  it('lands on the denominator with the rejected rows marked', () => {
    const view = buildRequestListView({ metric: 'rejection_rate' }, ctx(requests));
    // Compared against `statusTally` — the helper the Administration tile's own figure comes from —
    // not against a third copy of the formula written here, which could only prove the registry
    // agrees with itself.
    const tally = statusTally(requests);
    expect(view.rows).toHaveLength(requests.length);
    expect(view.numerator).toBe(tally.rejected);
    expect(view.denominator).toBe(tally.total);
    expect(view.numerator! / view.denominator! * 100).toBe(tally.rejectionRatePct);
    expect(view.rows[0].evidence.outcome).toEqual({ inNumerator: true, label: 'Rejected' });
    expect(view.rows[1].evidence.outcome!.inNumerator).toBe(false);
    expect(view.notes[0]).toBe('1 of 4 requests rejected (25%).');
  });
});

/* ── composability + precedence ────────────────────────────────────────── */

describe('composability', () => {
  const requests = [
    req({ id: 'r1', plant: 'jhajjar_p1', status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'a', at: iso(9) }] }),
    req({ id: 'r2', plant: 'pune', status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'a', at: iso(9) }] }),
  ];

  it('ANDs a metric with a plant', () => {
    const view = buildRequestListView({ metric: 'stuck_plant_head', plant: 'pune' }, ctx(requests));
    expect(view.rows.map(r => r.request.id)).toEqual(['r2']);
    expect(view.chips.map(c => c.param)).toEqual(['metric', 'plant']);
  });

  it('recomputes a cohort disclosure over the narrowed universe, not the whole set', () => {
    const set = [cycled('r1', 20, 14), cycled('r2', 8, null)];
    set[1] = { ...set[1], plant: 'pune' };
    const all = buildRequestListView({ metric: 'sourcing_cycle' }, ctx(set));
    const scoped = buildRequestListView({ metric: 'sourcing_cycle', plant: 'jhajjar_p1' }, ctx(set));
    expect(all.stillOpen).toBe(1);
    // The still-open row is in another plant, so the plant-scoped view must not claim it.
    expect(scoped.stillOpen).toBe(0);
  });

  it('ANDs a vendor', () => {
    const invites = [invite({ id: 'i1', requestId: 'r1', vendorId: 'v9' })];
    const view = buildRequestListView({ vendor: 'v9' }, ctx(requests, invites));
    expect(view.rows.map(r => r.request.id)).toEqual(['r1']);
    expect(buildRequestListView({ vendor: 'nobody' }, ctx(requests, invites)).rows).toHaveLength(0);
  });

  it('overdue=1 keeps only requests whose current hold has breached its party SLA', () => {
    const inside = req({ id: 'r3', status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'a', at: iso(1) }] });
    const view = buildRequestListView({ overdue: '1' }, ctx([...requests, inside]));
    expect(view.rows.map(r => r.request.id)).toEqual(['r1', 'r2']);
    expect(view.chips[0].words).toBe('Past its SLA only');
  });

  it('uses the caller-injected display names in the chip words', () => {
    const view = buildRequestListView(
      { filter: 'rejected', plant: 'pune', vendor: 'v9' },
      { ...ctx(requests), labels: { status: () => 'Rejected', plant: () => 'Pune', vendor: () => 'Acme' } },
    );
    expect(view.chips.map(c => c.words)).toEqual(['Status: Rejected', 'Plant: Pune', 'Vendor: Acme']);
  });

  it('combining a metric with a contradicting status yields an empty, honestly-chipped list', () => {
    const view = buildRequestListView({ metric: 'stuck_plant_head', filter: 'completed' }, ctx(requests));
    expect(view.rows).toHaveLength(0);
    expect(view.chips).toHaveLength(2);
  });
});

describe('visible fallback', () => {
  const requests = [req({ id: 'r1' }), req({ id: 'r2' })];

  it('renders the unfiltered list and reports an unknown metric key', () => {
    const view = buildRequestListView({ metric: 'stuck_at_plant_head' }, ctx(requests));
    expect(view.rows).toHaveLength(2);
    expect(view.metric).toBeNull();
    expect(view.columns).toEqual([]);
    expect(view.ignored).toEqual([
      { param: 'metric', value: 'stuck_at_plant_head', reason: 'not a known metric' },
    ]);
    // No chip may claim a filter that was not applied.
    expect(view.chips).toHaveLength(0);
  });

  it('reports an unknown status instead of silently listing nothing', () => {
    const view = buildRequestListView({ filter: 'not_a_status' }, ctx(requests));
    expect(view.rows).toHaveLength(2);
    expect(view.ignored[0]).toMatchObject({ param: 'filter', value: 'not_a_status' });
  });

  it('reports a malformed overdue value', () => {
    const view = buildRequestListView({ overdue: 'yes' }, ctx(requests));
    expect(view.rows).toHaveLength(2);
    expect(view.ignored[0]).toMatchObject({ param: 'overdue', value: 'yes' });
  });

  it('still applies the params it CAN alongside the one it cannot', () => {
    const view = buildRequestListView({ metric: 'nope', plant: 'jhajjar_p1' }, ctx(requests));
    expect(view.rows).toHaveLength(2);
    expect(view.chips.map(c => c.param)).toEqual(['plant']);
    expect(view.ignored).toHaveLength(1);
  });

  it('treats empty and whitespace params as absent', () => {
    const view = buildRequestListView({ metric: '  ', filter: '', plant: undefined, overdue: null }, ctx(requests));
    expect(view.rows).toHaveLength(2);
    expect(view.ignored).toHaveLength(0);
    expect(view.chips).toHaveLength(0);
  });
});

describe('scope containment', () => {
  /*
   * The page hands in an already role/plant-scoped array; nothing here may widen it.
   *
   * The out-of-scope requests below are built to MATCH every metric predicate — one stuck at the
   * plant head past SLA, one with a full sourcing→PI history plus a quoting invite, one rejected —
   * and their invites are put into `byRequest`, exactly as production does (`page.tsx` builds the
   * map over ALL invites, not the scoped subset). So each assertion below is a real candidate the
   * registry has to refuse, not a row that was never in the running. Counts are hand-computed per
   * combo, so a leak shows up as a count mismatch even where an id check would pass.
   */
  const mine = [
    req({ id: 'm1', plant: 'jhajjar_p1', status: 'pending_head_approval', statusHistory: [h('pending_head_approval', 9)] }),
    req({ id: 'm2', plant: 'jhajjar_p1', status: 'pi_requested', statusHistory: [h('sourcing', 20), h('pi_requested', 14)] }),
  ];
  const others = [
    req({ id: 'o1', plant: 'pune', createdBy: 'Someone Else', status: 'pending_head_approval', statusHistory: [h('pending_head_approval', 9)] }),
    req({ id: 'o2', plant: 'pune', createdBy: 'Someone Else', status: 'pi_requested', statusHistory: [h('sourcing', 20), h('pi_requested', 10)] }),
    req({ id: 'o3', plant: 'pune', createdBy: 'Someone Else', status: 'rejected', statusHistory: [h('rejected', 5)] }),
  ];
  const quotingInvite = (id: string, requestId: string): VendorInvite => invite({
    id, requestId, vendorId: 'v1', invitedAt: iso(20), rfqQuote: { price: 10 }, rfqThread: [
      { id: `${id}-a`, by: 'supplier', senderName: 'A', action: 'proposed', at: iso(16), quote: { price: 10 } },
      { id: `${id}-b`, by: 'sourcing', senderName: 'S', action: 'approved', at: iso(12) },
    ],
  });
  // byRequest deliberately spans BOTH sets, like production.
  const byRequest = invitesByRequest([quotingInvite('mi1', 'm2'), quotingInvite('oi1', 'o2')]);
  const scoped: RequestListContext = { requests: mine, byRequest, now: NOW };
  const outIds = new Set(others.map(o => o.id));

  const combos: { params: Record<string, string>; rows: number; why: string }[] = [
    { params: {}, rows: 2, why: 'no params' },
    { params: { metric: 'my_requests' }, rows: 2, why: 'every status in scope' },
    { params: { metric: 'stuck_plant_head' }, rows: 1, why: 'm1 only — o1 is equally stuck but out of scope' },
    { params: { metric: 'sourcing_cycle' }, rows: 1, why: 'm2 only — o2 has the same history' },
    { params: { metric: 'rejection_rate' }, rows: 2, why: 'denominator is the scope, and o3 is not in it' },
    { params: { metric: 'vendor_participation' }, rows: 1, why: 'm2 only — oi1 must not be counted' },
    { params: { metric: 'invite_first_quote' }, rows: 1, why: 'm2 only' },
    { params: { metric: 'first_quote_agreed' }, rows: 1, why: 'm2 only' },
    { params: { metric: 'tech_spec_gate' }, rows: 0, why: 'no spec was sent on either side' },
    { params: { vendor: 'v1' }, rows: 1, why: 'v1 quoted on both m2 and o2' },
    { params: { overdue: '1' }, rows: 2, why: 'm1 plant head 9d, m2 vendor 14d' },
    { params: { filter: 'rejected' }, rows: 0, why: 'only o3 is rejected' },
    { params: { plant: 'pune' }, rows: 0, why: 'the role bound wins over the param' },
    { params: { metric: 'bogus' }, rows: 2, why: 'fallback stays inside scope' },
    {
      params: { metric: 'my_requests', plant: 'pune', vendor: 'v1', filter: 'pending_head_approval', overdue: '1' },
      rows: 0, why: 'all five combined',
    },
  ];

  it.each(combos)('$why — keeps exactly $rows row(s), none out of scope', ({ params, rows }) => {
    const view = buildRequestListView(params, scoped);
    expect(view.rows).toHaveLength(rows);
    for (const row of view.rows) {
      expect(outIds.has(row.request.id)).toBe(false);
      expect(mine).toContain(row.request);
    }
  });

  it('never counts an out-of-scope invite in a ratio', () => {
    const view = buildRequestListView({ metric: 'vendor_participation' }, scoped);
    // 1 of 1, NOT 2 of 2 — oi1 hangs off an out-of-scope request in the same `byRequest` map.
    expect(view.numerator).toBe(1);
    expect(view.denominator).toBe(1);
  });

  it('never counts an out-of-scope request in a cohort sample or its still-open disclosure', () => {
    const view = buildRequestListView({ metric: 'sourcing_cycle' }, scoped);
    expect(view.sampled).toBe(1);
    expect(view.stillOpen).toBe(0);
    const legs = buildRequestListView({ metric: 'invite_first_quote' }, scoped);
    expect(legs.sampled).toBe(1);
    expect(legs.stillOpen).toBe(0);
  });

  it('never counts an out-of-scope rejection in the rate', () => {
    const view = buildRequestListView({ metric: 'rejection_rate' }, scoped);
    expect(view.numerator).toBe(0);
    expect(view.denominator).toBe(2);
  });
});

describe('SLA boundary (exclusive — a request exactly ON the threshold is NOT breached)', () => {
  /*
   * `SLA_DAYS.plantHead` is 3. Breach is `> limit`, matching `buildBucket` (`kpiQueues.ts`), so a
   * request at exactly 3.0d is INSIDE the SLA. Note this is the opposite convention from the
   * documented aging buckets (`agingBuckets` puts a boundary value in the OLDER bucket), which is
   * why it is pinned here: an editor "aligning the conventions" would otherwise move the tile and
   * the list together with no test objecting.
   */
  const onBoundary = req({ id: 'edge', status: 'pending_head_approval', statusHistory: [h('pending_head_approval', 3)] });
  const justPast = req({ id: 'past', status: 'pending_head_approval', statusHistory: [h('pending_head_approval', 3.5)] });

  it('excludes it from stuckAtPlantHead (the tile) and from ?metric=stuck_plant_head (the list)', () => {
    expect(stuckAtPlantHead([onBoundary], NOW)).toEqual([]);
    expect(buildRequestListView({ metric: 'stuck_plant_head' }, ctx([onBoundary])).rows).toHaveLength(0);
  });

  it('excludes it from overdue=1', () => {
    expect(buildRequestListView({ overdue: '1' }, ctx([onBoundary])).rows).toHaveLength(0);
  });

  it('holdBreach is null at exactly the threshold and set just past it', () => {
    expect(holdBreach({ party: 'plant_head', since: iso(3), days: 3 })).toBeNull();
    expect(holdBreach({ party: 'plant_head', since: iso(3.5), days: 3.5 })).toBe('plantHead');
  });

  it('includes a request just past the threshold, on both surfaces', () => {
    expect(stuckAtPlantHead([justPast], NOW).map(r => r.id)).toEqual(['past']);
    const view = buildRequestListView({ metric: 'stuck_plant_head' }, ctx([justPast]));
    expect(view.rows.map(r => r.request.id)).toEqual(['past']);
    expect(view.rows[0].evidence.waiting?.breachedSla).toBe('plantHead');
  });

  it('the tile and the list agree on the boundary case', () => {
    const both = [onBoundary, justPast];
    const tile = adminQueues(both, new Map(), [], [], NOW).mine.find(b => b.key === 'stuckPlantHead')!;
    expect(buildRequestListView({ metric: 'stuck_plant_head' }, ctx(both)).rows).toHaveLength(tile.count);
    expect(tile.count).toBe(1);
  });
});

describe('empty sample — an honest zero, never a fabricated figure', () => {
  const COHORTS = ['sourcing_cycle', 'invite_first_quote', 'first_quote_agreed', 'tech_spec_gate'] as const;

  it.each(COHORTS)('%s over no requests reports no median rather than a number', key => {
    const view = buildRequestListView({ metric: key }, ctx([]));
    expect(view.rows).toHaveLength(0);
    expect(view.sampled).toBe(0);
    expect(view.stillOpen).toBe(0);
    expect(view.medianDays).toBeNull();
    const notes = view.notes.join(' ');
    expect(notes).toContain('Median —');
    expect(notes).not.toMatch(/NaN|undefined|null/);
  });

  it.each(COHORTS)('%s over requests with no measurable work says so', key => {
    // Requests exist, but none has reached the leg — the list must not read as "filter found none".
    const view = buildRequestListView({ metric: key }, ctx([req({ id: 'r1', status: 'draft' })]));
    expect(view.rows).toHaveLength(0);
    expect(view.medianDays).toBeNull();
    expect(view.notes.join(' ')).toContain('Median —');
  });

  it('vendor_participation with no invites reports 0 of 0 without a NaN percentage', () => {
    const view = buildRequestListView({ metric: 'vendor_participation' }, ctx([req({ id: 'r1' })]));
    expect(view.rows).toHaveLength(0);
    expect(view.numerator).toBe(0);
    expect(view.denominator).toBe(0);
    expect(view.notes.join(' ')).not.toMatch(/NaN|%/);
  });

  it('rejection_rate over an empty scope reports 0 of 0 without a NaN percentage', () => {
    const view = buildRequestListView({ metric: 'rejection_rate' }, ctx([]));
    expect(view.numerator).toBe(0);
    expect(view.denominator).toBe(0);
    expect(view.notes.join(' ')).not.toMatch(/NaN|%/);
  });

  it('my_requests over an empty scope still states the split', () => {
    const view = buildRequestListView({ metric: 'my_requests' }, ctx([]));
    expect(view.notes[0]).toBe('0 requests · 0 completed · 0 rejected.');
  });
});

describe('fallback notice — states the failure and what is actually on screen, separately', () => {
  const requests = [
    req({ id: 'r1', status: 'pi_requested', statusHistory: [h('sourcing', 20), h('pi_requested', 14)] }),
    req({ id: 'r2', status: 'pi_requested', statusHistory: [h('sourcing', 20), h('pi_requested', 10)] }),
    req({ id: 'r3', status: 'sourcing', statusHistory: [h('sourcing', 8)] }),
  ];

  it('state 1 — nothing ignored: no notice at all', () => {
    expect(buildRequestListView({ metric: 'sourcing_cycle' }, ctx(requests)).notice).toBeNull();
    expect(buildRequestListView({}, ctx(requests)).notice).toBeNull();
  });

  it('state 2 — one ignored, a metric still applied: NEVER claims the list is unfiltered', () => {
    const view = buildRequestListView({ metric: 'sourcing_cycle', overdue: 'yes' }, ctx(requests));
    // The list IS cohort-filtered: 2 of 3 rows.
    expect(view.rows).toHaveLength(2);
    expect(view.notice).not.toBeNull();
    expect(view.notice!.listIsUnfiltered).toBe(false);
    expect(view.notice!.headline).toBe('One filter in this link could not be applied');
    expect(view.notice!.showing).toContain('still applied');
    expect(view.notice!.showing).toContain('IS filtered');
    expect(view.notice!.showing).not.toMatch(/unfiltered/i);
    // …and it never contradicts the chip sitting above it.
    expect(view.chips.map(c => c.param)).toEqual(['metric']);
  });

  it('state 2b — the applied filter can be a plain param, not only a metric', () => {
    const view = buildRequestListView({ filter: 'sourcing', metric: 'nope' }, ctx(requests));
    expect(view.rows).toHaveLength(1);
    expect(view.notice!.listIsUnfiltered).toBe(false);
    expect(view.notice!.showing).toContain('The 1 filter shown above is still applied');
  });

  it('state 3 — everything ignored: the list genuinely is unfiltered, and says so', () => {
    const view = buildRequestListView({ metric: 'nope' }, ctx(requests));
    expect(view.rows).toHaveLength(3);
    expect(view.notice!.listIsUnfiltered).toBe(true);
    expect(view.notice!.showing).toContain('every request in your scope');
    expect(view.chips).toHaveLength(0);
  });

  it('state 4 — nothing recognised at all: plural headline, every param listed with its reason', () => {
    const view = buildRequestListView(
      { metric: 'nope', filter: 'not_a_status', overdue: 'yes' },
      ctx(requests),
    );
    expect(view.rows).toHaveLength(3);
    expect(view.notice!.headline).toBe('3 filters in this link could not be applied');
    expect(view.notice!.listIsUnfiltered).toBe(true);
    expect(view.notice!.items.map(i => i.param)).toEqual(['filter', 'overdue', 'metric']);
    // Each reason reads as a sentence after "param=value — …".
    expect(view.notice!.items.map(i => i.reason)).toEqual([
      'not a known request status',
      'not a valid value: the only accepted value is overdue=1',
      'not a known metric',
    ]);
  });

  it('listIsUnfiltered is exactly "no chips" — the two can never disagree', () => {
    for (const params of [
      { metric: 'nope' },
      { metric: 'nope', plant: 'jhajjar_p1' },
      { metric: 'sourcing_cycle', overdue: 'yes' },
      { filter: 'not_a_status', overdue: '1' },
    ]) {
      const view = buildRequestListView(params, ctx(requests));
      expect(view.notice!.listIsUnfiltered).toBe(view.chips.length === 0);
    }
  });
});

describe('stale plant / vendor values', () => {
  const requests = [req({ id: 'r1', plant: 'jhajjar_p1' })];
  const invites = [invite({ id: 'i1', requestId: 'r1', vendorId: 'v1' })];
  const known = { plants: ['jhajjar_p1', 'pune'], vendors: ['v1'] };

  it('reports a plant that is not on record instead of filtering to zero rows', () => {
    const view = buildRequestListView({ plant: 'atlantis' }, { ...ctx(requests, invites), known });
    expect(view.rows).toHaveLength(1);
    expect(view.chips).toHaveLength(0);
    expect(view.ignored[0]).toMatchObject({ param: 'plant', value: 'atlantis', reason: 'not a plant on record' });
  });

  it('reports a vendor that is not on the roster', () => {
    const view = buildRequestListView({ vendor: 'v404' }, { ...ctx(requests, invites), known });
    expect(view.ignored[0]).toMatchObject({ param: 'vendor', reason: 'not a vendor on the roster' });
    expect(view.rows).toHaveLength(1);
  });

  it('still applies a KNOWN plant that simply matches nothing in scope — an empty list is honest there', () => {
    const view = buildRequestListView({ plant: 'pune' }, { ...ctx(requests, invites), known });
    expect(view.rows).toHaveLength(0);
    expect(view.ignored).toHaveLength(0);
    expect(view.chips.map(c => c.param)).toEqual(['plant']);
  });

  it('applies both params unchecked when no roster is supplied', () => {
    const view = buildRequestListView({ plant: 'atlantis' }, ctx(requests, invites));
    expect(view.rows).toHaveLength(0);
    expect(view.ignored).toHaveLength(0);
  });
});

describe('chip words stay true outside the role they were minted for', () => {
  it('my_requests names the SCOPE, not "my" — the URL can be hand-shared to another role', () => {
    const view = buildRequestListView({ metric: 'my_requests' }, ctx([req({ id: 'r1' })]));
    expect(view.chips[0].words).not.toMatch(/my/i);
    expect(view.chips[0].words).toContain('your scope');
  });
});

describe('hold helpers', () => {
  it('worstHold picks the longest-running hold', () => {
    const r = req({ id: 'r1', status: 'pi_requested' });
    const invites = [
      invite({ id: 'i1', awarded: true, awardStatus: 'pi_requested' }),
      invite({ id: 'i2', awarded: true, awardStatus: 'completed' }),
    ];
    const hold = worstHold(r, invites, NOW);
    expect(hold.party).toBe('vendor');
  });

  it('holdBreach reads SLA_DAYS through PARTY_SLA, and is null for a party with no SLA', () => {
    expect(holdBreach({ party: 'plant_head', since: iso(9), days: 9 })).toBe('plantHead');
    expect(holdBreach({ party: 'plant_head', since: iso(1), days: 1 })).toBeNull();
    expect(holdBreach({ party: 'buyer', since: iso(90), days: 90 })).toBeNull();
  });
});
