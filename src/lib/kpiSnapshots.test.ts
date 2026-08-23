import { describe, expect, it } from 'vitest';
import {
  buildSnapshots, measuredFrom, mergeSnapshots, snapshotDateKey, snapshotSeries,
  MIXED_FY, SNAPSHOT_RETENTION_DAYS,
  type KpiSnapshot,
} from './kpiSnapshots';
import { CR } from './kpiUtils';
import { PLANTS } from './constants';
import type { CapexMasterItem, CapexRequest, FieldType, VendorInvite } from './types';

/**
 * Local-noon anchor: every date key in this file is produced by LOCAL getters, so anchoring at
 * midday keeps `NOW` and `NOW ± n days` on the intended calendar date in any timezone the suite
 * runs in. A UTC-midnight anchor would flip the date west of Greenwich and silently shift every
 * boundary assertion below.
 */
const NOW = new Date(2026, 7, 15, 12, 0, 0).getTime(); // 2026-08-15, local

/** 'YYYY-MM-DD' `daysAgo` days before NOW, by LOCAL calendar arithmetic (DST-safe). */
function iso(daysAgo: number): string {
  const d = new Date(NOW);
  const shifted = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo);
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${shifted.getFullYear()}-${m}-${day}`;
}

const TODAY = iso(0);

function snap(over: Partial<KpiSnapshot> = {}): KpiSnapshot {
  return {
    date: TODAY, fieldType: 'brown_field', plant: 'jhajjar_p1', fy: '2026-27',
    allocatedInr: 0, committedInr: 0, awardedInr: 0, paidInr: 0,
    overExposureCr: 0, breachedHeads: 0,
    // Present by default so a fixture that DELETES one is modelling real legacy data (a record
    // written before the workflow counts existed), not just an object that never had the key.
    openSourcingRequests: 0, pendingQuoteInvites: 0,
    ...over,
  };
}

function master(over: Partial<CapexMasterItem> = {}): CapexMasterItem {
  return {
    id: 'm1', plant: 'jhajjar_p1', head: 'Machinery', department: 'Prod',
    subParticulars: 'Chiller', rate: 0, totalCost: 2, fy: '2026-27',
    fieldType: 'brown_field', projectType: 'rac',
    ...over,
  };
}

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', subject: 'Chiller', category: 'Machinery', quantity: '1',
    priority: 'medium', justification: '',
    techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing',
    createdBy: 'Arjun Mehta', createdAt: new Date(NOW).toISOString(),
    fieldType: 'brown_field', projectType: 'rac', plant: 'jhajjar_p1',
    ...over,
  };
}

const NO_INVITES: VendorInvite[] = [];

function inv(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't1', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: new Date(NOW).toISOString(),
    auctionApprovalStatus: 'not_sent',
    ...over,
  };
}

function build(opts: {
  capexMaster: CapexMasterItem[];
  requests?: CapexRequest[];
  invites?: VendorInvite[];
  usedAmountByMasterItemId?: Record<string, number>;
}) {
  return buildSnapshots({
    capexMaster: opts.capexMaster,
    requests: opts.requests ?? [],
    invites: opts.invites ?? NO_INVITES,
    headOverrides: [],
    usedAmountByMasterItemId: opts.usedAmountByMasterItemId ?? {},
    now: NOW,
  });
}

const find = (rows: KpiSnapshot[], fieldType: FieldType, plant: string | null) =>
  rows.find((r) => r.fieldType === fieldType && r.plant === plant);

/* ── date key ─────────────────────────────────────────────────────────── */

describe('snapshotDateKey', () => {
  it('uses LOCAL calendar components, not UTC', () => {
    // 23:30 local on the 15th: a UTC-based key would read the 15th or 16th depending on offset.
    // Pinning against the local getters is what guarantees a snapshot lands on the day the user
    // saw, matching kpiTrends' local-time bucketing convention.
    const late = new Date(2026, 7, 15, 23, 30).getTime();
    expect(snapshotDateKey(late)).toBe('2026-08-15');
  });

  it('zero-pads month and day', () => {
    expect(snapshotDateKey(new Date(2026, 0, 3, 12).getTime())).toBe('2026-01-03');
  });
});

/* ── buildSnapshots ───────────────────────────────────────────────────── */

describe('buildSnapshots', () => {
  it('measures allocation and commitment for a plant scope and stamps today', () => {
    // `committedInr` must come through `requestValue`'s one fallback chain — here the `estimated`
    // basis (`request.budget`), NOT the master allocation. If this file ever inlined its own money
    // rule, this would read 2 Cr (the allocation) instead of the ₹50 L estimate.
    const rows = build({
      capexMaster: [master({ id: 'm1', totalCost: 2 })],
      requests: [req({
        budget: 5_000_000,
        lineItems: [{ id: 'l1', description: 'Chiller', category: 'Machinery', quantity: '1', masterItemId: 'm1', budget: 5_000_000 }],
      })],
    });
    const bf = find(rows, 'brown_field', 'jhajjar_p1')!;
    expect(bf.date).toBe(TODAY);
    expect(bf.allocatedInr).toBe(2 * CR);
    expect(bf.committedInr).toBe(5_000_000);
    expect(bf.fy).toBe('2026-27');
  });

  it('emits no record for a field type with no master rows at all', () => {
    // Guards the "absence means not measured" contract: inventing an all-zero Green Field row for a
    // Brown-Field-only portfolio would put a measured zero where there is nothing to measure.
    const rows = build({ capexMaster: [master()] });
    expect(rows.some((r) => r.fieldType === 'green_field')).toBe(false);
    expect(rows.some((r) => r.fieldType === 'brown_field')).toBe(true);
  });

  it('DOES emit a zero record for a scope that has budget rows but nothing spent', () => {
    // The opposite half of the same contract: a funded plant with no requests was measured, and the
    // answer was zero. Dropping it would be indistinguishable from an unopened week.
    const rows = build({ capexMaster: [master({ totalCost: 3 })] });
    const bf = find(rows, 'brown_field', 'jhajjar_p1')!;
    expect(bf.committedInr).toBe(0);
    expect(bf.allocatedInr).toBe(3 * CR);
  });

  it('scopes each plant to ITS OWN latest FY, so a plant on an earlier FY still gets a record', () => {
    // The regression this codebase already fixed once: a single global "latest FY per field type"
    // silently zeroes every plant still on the older year the moment any other plant publishes.
    const rows = build({
      capexMaster: [
        master({ id: 'mA', plant: 'jhajjar_p1', fy: '2027-28', totalCost: 4 }),
        master({ id: 'mB', plant: 'supa', fy: '2026-27', totalCost: 7 }),
      ],
    });
    const p1 = find(rows, 'brown_field', 'jhajjar_p1')!;
    const supa = find(rows, 'brown_field', 'supa')!;
    expect(p1.fy).toBe('2027-28');
    expect(p1.allocatedInr).toBe(4 * CR);
    expect(supa.fy).toBe('2026-27');
    expect(supa.allocatedInr).toBe(7 * CR); // NOT zero — the whole point
  });

  it('labels a divergent roll-up FY as "mixed" and sums the per-plant figures', () => {
    const rows = build({
      capexMaster: [
        master({ id: 'mA', plant: 'jhajjar_p1', fy: '2027-28', totalCost: 4 }),
        master({ id: 'mB', plant: 'supa', fy: '2026-27', totalCost: 7 }),
      ],
    });
    const roll = find(rows, 'brown_field', null)!;
    expect(roll.fy).toBe(MIXED_FY);
    expect(roll.allocatedInr).toBe(11 * CR); // 4 + 7 — no plant dropped by a global FY
  });

  it('keeps the shared FY on the roll-up when every plant is on the same year', () => {
    const rows = build({
      capexMaster: [
        master({ id: 'mA', plant: 'jhajjar_p1', fy: '2026-27', totalCost: 1 }),
        master({ id: 'mB', plant: 'supa', fy: '2026-27', totalCost: 2 }),
      ],
    });
    expect(find(rows, 'brown_field', null)!.fy).toBe('2026-27');
  });

  it('never mixes field types in one scope', () => {
    const rows = build({
      capexMaster: [
        master({ id: 'mB', fieldType: 'brown_field', totalCost: 2 }),
        master({ id: 'mG', fieldType: 'green_field', totalCost: 9 }),
      ],
    });
    expect(find(rows, 'brown_field', 'jhajjar_p1')!.allocatedInr).toBe(2 * CR);
    expect(find(rows, 'green_field', 'jhajjar_p1')!.allocatedInr).toBe(9 * CR);
  });

  it('counts breached heads and over-exposure for Brown Field', () => {
    const rows = build({
      capexMaster: [master({ id: 'm1', head: 'Machinery', totalCost: 1 })],
      usedAmountByMasterItemId: { m1: 1.5 * CR }, // 1.5 Cr committed against a 1 Cr head
    });
    const bf = find(rows, 'brown_field', 'jhajjar_p1')!;
    expect(bf.breachedHeads).toBe(1);
    expect(bf.overExposureCr).toBeCloseTo(0.5, 4);
  });

  it('leaves head figures at zero for non-Brown-Field scopes (heads are a Brown Field concept)', () => {
    // The fixture MUST put a breached Brown Field head on the SAME plant + SAME FY as the Green Field
    // row. `projectTypesForPlantFy` and `headsForScope` both scope by plant + fy and filter to Brown
    // Field rows — they never look at the field type being measured — so without the
    // `if (fieldType === 'brown_field')` guard in `buildSnapshots` the green_field scope resolves
    // THIS plant's brown-field heads and reports breachedHeads: 1 / overExposureCr: 0.5 as Green
    // Field exposure. A Green-Field-only fixture cannot catch that: the loop yields nothing either
    // way, and the test passes with the guard deleted.
    const rows = build({
      capexMaster: [
        master({ id: 'mB', fieldType: 'brown_field', head: 'Machinery', totalCost: 1, fy: '2026-27' }),
        master({ id: 'mG', fieldType: 'green_field', head: 'Utilities', totalCost: 1, fy: '2026-27' }),
      ],
      usedAmountByMasterItemId: { mB: 1.5 * CR, mG: 5 * CR },
    });
    const gf = find(rows, 'green_field', 'jhajjar_p1')!;
    expect(gf.breachedHeads).toBe(0);
    expect(gf.overExposureCr).toBe(0);
    // Same plant, same FY — the breach is real, it just belongs to the Brown Field scope.
    const bf = find(rows, 'brown_field', 'jhajjar_p1')!;
    expect(bf.breachedHeads).toBe(1);
    expect(bf.overExposureCr).toBeCloseTo(0.5, 4);
  });

  it('records awardedInr and paidInr as themselves, never as poIssuedInr', () => {
    // `FyPosition` exposes awardedInr / poIssuedInr / paidInr adjacently, and a snapshot is a
    // PERMANENT record that can never be recomputed — so wiring `awardedInr: position.poIssuedInr`
    // would bake a wrong figure into history forever. Three deliberately distinct amounts pin each
    // field to its own source: awarded ₹70 L, PO issued ₹60 L, paid ₹25 L.
    const invites: VendorInvite[] = [{
      id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't1', status: 'approved',
      quotes: [], negotiationThread: [], invitedAt: new Date(NOW).toISOString(),
      auctionApprovalStatus: 'approved',
      awarded: true, awardAmount: 7_000_000, awardedItemIds: ['l1'],
      purchaseOrder: {
        id: 'po1', poNumber: 'PO-1', vendorId: 'v1', amount: 6_000_000,
        createdAt: new Date(NOW).toISOString(), createdBy: 'Satish',
        issuedAt: new Date(NOW).toISOString(),
      },
      paymentMilestones: [
        { id: 'p1', label: 'Advance', percent: 40, amount: 2_500_000, status: 'paid' },
        { id: 'p2', label: 'Final', percent: 60, amount: 4_500_000, status: 'pending', isFinal: true },
      ],
    }];
    const rows = build({
      capexMaster: [master({ id: 'm1', totalCost: 2 })],
      requests: [req({ id: 'r1', status: 'payment_in_progress' })],
      invites,
    });
    const bf = find(rows, 'brown_field', 'jhajjar_p1')!;
    expect(bf.awardedInr).toBe(7_000_000);
    expect(bf.paidInr).toBe(2_500_000);
    // The swap this guards against, spelled out: neither field may read the PO-issued amount.
    expect(bf.awardedInr).not.toBe(6_000_000);
    expect(bf.paidInr).not.toBe(6_000_000);
    // …nor each other's.
    expect(bf.awardedInr).not.toBe(bf.paidInr);
    expect(bf.committedInr).toBe(7_000_000); // requestValue's 'awarded' basis
  });

  /* ── workflow stock: open sourcing load + pending quotations ─────────── */

  it('counts the open sourcing load and the invites still awaiting a quotation', () => {
    const rows = build({
      capexMaster: [master({ id: 'm1', totalCost: 2 })],
      requests: [req({ id: 'r1', status: 'sourcing' }), req({ id: 'r2', status: 'negotiation' })],
      invites: [
        inv({ id: 'i1', requestId: 'r1' }),                                    // no price yet
        inv({ id: 'i2', requestId: 'r1', quotes: [{ id: 'q1', price: 5, deliveryDays: 30, validUntil: '', submittedAt: '' }] }),
        inv({ id: 'i3', requestId: 'r2' }),                                    // no price yet
      ],
    });
    const bf = find(rows, 'brown_field', 'jhajjar_p1')!;
    expect(bf.openSourcingRequests).toBe(2);
    expect(bf.pendingQuoteInvites).toBe(2);
  });

  it('treats a seeded auction opening bid as quoted, via the SHARED inviteHasQuote predicate', () => {
    // `seedAuctionFromRfq` parks the opening bid on `openingQuote`, NOT in `quotes[]`. A local
    // "has this vendor priced anything" test written here would read that invite as still pending
    // and permanently overstate the backlog — which is exactly why this composes `kpiRisk`.
    const rows = build({
      capexMaster: [master({ id: 'm1', totalCost: 2 })],
      requests: [req({ id: 'r1', status: 'sourcing' })],
      invites: [inv({
        id: 'i1', requestId: 'r1',
        openingQuote: { id: 'q0', price: 9, deliveryDays: 30, validUntil: '', submittedAt: '' },
      })],
    });
    expect(find(rows, 'brown_field', 'jhajjar_p1')!.pendingQuoteInvites).toBe(0);
  });

  it('counts only requests still ON the sourcing desk — not draft, not awarded, not terminal', () => {
    // The un-quoted invites below are the point: a vendor who never replied to a request that is
    // already at PI / completed / rejected is NOT a pending quotation, and counting them would make
    // the backlog grow forever instead of draining.
    const rows = build({
      capexMaster: [master({ id: 'm1', totalCost: 2 })],
      requests: [
        req({ id: 'rDraft', status: 'draft' }),
        req({ id: 'rPi', status: 'pi_requested' }),
        req({ id: 'rDone', status: 'completed' }),
        req({ id: 'rRej', status: 'rejected' }),
        req({ id: 'rOpen', status: 'sourcing' }),
      ],
      invites: [
        inv({ id: 'i1', requestId: 'rDraft' }), inv({ id: 'i2', requestId: 'rPi' }),
        inv({ id: 'i3', requestId: 'rDone' }), inv({ id: 'i4', requestId: 'rRej' }),
        inv({ id: 'i5', requestId: 'rOpen' }),
      ],
    });
    const bf = find(rows, 'brown_field', 'jhajjar_p1')!;
    expect(bf.openSourcingRequests).toBe(1);
    expect(bf.pendingQuoteInvites).toBe(1);
  });

  it('counts the legacy pre-PI statuses too, so an escalated RFQ is not invisible', () => {
    // `sourcing_approved` / `buyer_approved` are retired states that in-flight requests still sit
    // in (CLAUDE.md, "Escalated-RFQ award unstick"). They are on the sourcing desk; omitting them
    // would under-report exactly the requests most likely to be stuck.
    const rows = build({
      capexMaster: [master({ id: 'm1', totalCost: 2 })],
      requests: [
        req({ id: 'r1', status: 'sourcing_approved' }),
        req({ id: 'r2', status: 'buyer_approved' }),
      ],
    });
    expect(find(rows, 'brown_field', 'jhajjar_p1')!.openSourcingRequests).toBe(2);
  });

  it('isolates the workflow counts per plant and per field type, and sums them on the roll-up', () => {
    const rows = build({
      capexMaster: [
        master({ id: 'mA', plant: 'jhajjar_p1', totalCost: 1 }),
        master({ id: 'mB', plant: 'supa', totalCost: 1 }),
        master({ id: 'mG', plant: 'jhajjar_p1', fieldType: 'green_field', totalCost: 1 }),
      ],
      requests: [
        req({ id: 'r1', plant: 'jhajjar_p1' }),
        req({ id: 'r2', plant: 'supa' }),
        req({ id: 'r3', plant: 'supa' }),
        req({ id: 'r4', plant: 'jhajjar_p1', fieldType: 'green_field' }),
      ],
    });
    expect(find(rows, 'brown_field', 'jhajjar_p1')!.openSourcingRequests).toBe(1);
    expect(find(rows, 'brown_field', 'supa')!.openSourcingRequests).toBe(2);
    expect(find(rows, 'green_field', 'jhajjar_p1')!.openSourcingRequests).toBe(1);
    expect(find(rows, 'brown_field', null)!.openSourcingRequests).toBe(3);
    expect(find(rows, 'green_field', null)!.openSourcingRequests).toBe(1);
  });

  it('scopes the workflow counts to the record\'s own FY, exactly like its money figures', () => {
    // Stated consequence, not an accident: this plant's live FY is 2027-28, and a request still
    // linked to a 2026-27 budget line is attributed to 2026-27 by the SHARED `requestFy` rule — so
    // it is out of this record's scope, the same way its value is absent from `committedInr`.
    const rows = build({
      capexMaster: [
        master({ id: 'mOld', plant: 'jhajjar_p1', fy: '2026-27', totalCost: 1 }),
        master({ id: 'mNew', plant: 'jhajjar_p1', fy: '2027-28', totalCost: 1 }),
      ],
      requests: [req({
        id: 'r1', status: 'sourcing', budget: 100,
        lineItems: [{ id: 'l1', description: 'x', category: 'Machinery', quantity: '1', masterItemId: 'mOld', budget: 100 }],
      })],
    });
    const bf = find(rows, 'brown_field', 'jhajjar_p1')!;
    expect(bf.fy).toBe('2027-28');
    expect(bf.openSourcingRequests).toBe(0);
    expect(bf.committedInr).toBe(0); // the money figure agrees — one record, one scope
  });

  it('stores INR as integers so the payload carries no float tails', () => {
    const rows = build({
      capexMaster: [master({ id: 'm1', totalCost: 0.123456789 })],
    });
    const bf = find(rows, 'brown_field', 'jhajjar_p1')!;
    expect(Number.isInteger(bf.allocatedInr)).toBe(true);
  });
});

/* ── mergeSnapshots ───────────────────────────────────────────────────── */

describe('mergeSnapshots', () => {
  it('REPLACES a same-day, same-scope record instead of duplicating it', () => {
    const stored = [snap({ committedInr: 100 })];
    const merged = mergeSnapshots(stored, [snap({ committedInr: 250 })], NOW);
    expect(merged).toHaveLength(1);
    expect(merged[0].committedInr).toBe(250);
  });

  it('keeps same-day records for DIFFERENT scopes side by side', () => {
    // Proves the replacement key is (date, fieldType, plant) and not date alone — collapsing on
    // date would silently reduce a whole portfolio to one plant per day.
    const merged = mergeSnapshots(
      [],
      [
        snap({ plant: 'jhajjar_p1' }),
        snap({ plant: 'supa' }),
        snap({ plant: null }),
        snap({ fieldType: 'green_field', plant: 'jhajjar_p1' }),
      ],
      NOW,
    );
    expect(merged).toHaveLength(4);
  });

  it('keeps a different day for the same scope (history accumulates)', () => {
    const merged = mergeSnapshots([snap({ date: iso(1) })], [snap({ date: TODAY })], NOW);
    expect(merged.map((s) => s.date)).toEqual([iso(1), TODAY]);
  });

  it('drops a record OLDER than the retention window and keeps the boundary day', () => {
    // Boundary pinned: the window is SNAPSHOT_RETENTION_DAYS calendar days INCLUDING today, so
    // `RETENTION - 1` days ago is the oldest kept and exactly `RETENTION` days ago is dropped.
    const merged = mergeSnapshots(
      [
        snap({ date: iso(SNAPSHOT_RETENTION_DAYS) }),      // outside — dropped
        snap({ date: iso(SNAPSHOT_RETENTION_DAYS - 1) }),  // oldest kept
      ],
      [],
      NOW,
    );
    expect(merged.map((s) => s.date)).toEqual([iso(SNAPSHOT_RETENTION_DAYS - 1)]);
  });

  it('prunes on merge even when nothing new is captured', () => {
    const merged = mergeSnapshots([snap({ date: iso(400) })], [], NOW);
    expect(merged).toEqual([]);
  });

  it('drops a FUTURE-dated record so a skewed clock cannot write tomorrow', () => {
    // `buildSnapshots` only ever writes TODAY's key, so a point written while the device clock was
    // set ahead would never be replaced by a later run — it would sit in the series permanently,
    // reading as a measurement of a day that has not happened yet.
    const merged = mergeSnapshots(
      [snap({ date: iso(-1), committedInr: 999 }), snap({ date: iso(-30) }), snap({ date: TODAY })],
      [],
      NOW,
    );
    expect(merged.map((s) => s.date)).toEqual([TODAY]);
  });

  it('keeps today itself — the upper bound is inclusive', () => {
    expect(mergeSnapshots([], [snap({ date: TODAY })], NOW).map((s) => s.date)).toEqual([TODAY]);
  });

  it('returns records oldest-first', () => {
    const merged = mergeSnapshots(
      [snap({ date: iso(2) }), snap({ date: iso(9) }), snap({ date: iso(5) })],
      [],
      NOW,
    );
    expect(merged.map((s) => s.date)).toEqual([iso(9), iso(5), iso(2)]);
  });
});

/* ── snapshotSeries ───────────────────────────────────────────────────── */

describe('snapshotSeries', () => {
  const scope = { fieldType: 'brown_field' as FieldType, plant: 'jhajjar_p1' };

  it('leaves an unmeasured day as a GAP, not a zero', () => {
    // The honesty rule: a week nobody opened the app has no measurement. Zero-filling would draw a
    // cliff to zero that never happened.
    const stored = [
      snap({ date: iso(3), committedInr: 300 }),
      snap({ date: iso(1), committedInr: 100 }),
    ];
    const series = snapshotSeries(stored, scope, 'committedInr');
    expect(series).toEqual([
      { date: iso(3), value: 300 },
      { date: iso(1), value: 100 },
    ]);
    expect(series.some((p) => p.date === iso(2))).toBe(false);
  });

  it('does not confuse a measured zero with a gap', () => {
    const stored = [snap({ date: iso(2), committedInr: 0 }), snap({ date: iso(1), committedInr: 5 })];
    expect(snapshotSeries(stored, scope, 'committedInr')).toEqual([
      { date: iso(2), value: 0 },
      { date: iso(1), value: 5 },
    ]);
  });

  it('returns oldest-first even from unsorted input', () => {
    const stored = [snap({ date: iso(1), paidInr: 1 }), snap({ date: iso(4), paidInr: 4 })];
    expect(snapshotSeries(stored, scope, 'paidInr').map((p) => p.date)).toEqual([iso(4), iso(1)]);
  });

  it('isolates the scope — another plant and another field type never leak in', () => {
    const stored = [
      snap({ date: iso(1), committedInr: 10 }),
      snap({ date: iso(1), plant: 'supa', committedInr: 999 }),
      snap({ date: iso(1), fieldType: 'green_field', committedInr: 777 }),
      snap({ date: iso(1), plant: null, committedInr: 1009 }),
    ];
    expect(snapshotSeries(stored, scope, 'committedInr')).toEqual([{ date: iso(1), value: 10 }]);
  });

  it('reads the all-plants roll-up via plant: null', () => {
    const stored = [
      snap({ date: iso(1), plant: null, committedInr: 1009 }),
      snap({ date: iso(1), plant: 'supa', committedInr: 999 }),
    ];
    expect(snapshotSeries(stored, { fieldType: 'brown_field', plant: null }, 'committedInr'))
      .toEqual([{ date: iso(1), value: 1009 }]);
  });

  it('returns an empty series for a scope that was never measured', () => {
    expect(snapshotSeries([snap()], { fieldType: 'information_technology', plant: 'supa' }, 'paidInr'))
      .toEqual([]);
  });

  it('treats a record written BEFORE a metric existed as a gap, never as a measured zero', () => {
    // Every record already in a user's localStorage predates the workflow counts. Reading a missing
    // field as 0 would draw a confident flat line along the bottom for the whole of the store's
    // history and then jump — a fabricated "nothing was open" for days that measured only money.
    const legacy = snap({ date: iso(3), committedInr: 300 });
    delete legacy.openSourcingRequests;
    const stored = [legacy, snap({ date: iso(1), openSourcingRequests: 4 })];
    expect(snapshotSeries(stored, scope, 'openSourcingRequests')).toEqual([{ date: iso(1), value: 4 }]);
    // The same two records still give a full money series — the gap is per METRIC, not per day.
    expect(snapshotSeries(stored, scope, 'committedInr')).toHaveLength(2);
  });

  it('still returns a measured zero for the new metrics — 0 open is a measurement', () => {
    expect(snapshotSeries([snap({ date: iso(1), openSourcingRequests: 0 })], scope, 'openSourcingRequests'))
      .toEqual([{ date: iso(1), value: 0 }]);
  });
});

/* ── measuredFrom ─────────────────────────────────────────────────────── */

describe('measuredFrom', () => {
  it('returns the earliest measured date', () => {
    expect(measuredFrom([snap({ date: iso(2) }), snap({ date: iso(30) }), snap({ date: iso(9) })]))
      .toBe(iso(30));
  });

  it('returns null on an empty store, so a chart can omit the label rather than invent one', () => {
    expect(measuredFrom([])).toBeNull();
  });

  it('scoped: reports the SCOPE\'s own start, not the store\'s', () => {
    // A plant whose budget was published last week must not claim to have been measured since the
    // store's oldest day — that is the backfill lie this whole layer refuses.
    const stored = [
      snap({ date: iso(90), plant: 'jhajjar_p1' }),
      snap({ date: iso(3), plant: 'supa' }),
    ];
    expect(measuredFrom(stored)).toBe(iso(90));
    expect(measuredFrom(stored, { fieldType: 'brown_field', plant: 'supa' })).toBe(iso(3));
  });

  it('scoped: null when that scope has nothing, even though the store is non-empty', () => {
    expect(measuredFrom([snap()], { fieldType: 'green_field', plant: 'supa' })).toBeNull();
  });

  it('metric-scoped: reports the first day THAT metric was measured, not the store\'s oldest day', () => {
    // A metric added after the store shipped has a shorter horizon than the store. Labelling its
    // chart "measured from" the store's oldest date would over-claim by exactly the period the
    // series is missing — the caption would contradict the line beside it.
    const legacy = snap({ date: iso(90) });
    delete legacy.openSourcingRequests;
    const stored = [legacy, snap({ date: iso(4), openSourcingRequests: 2 })];
    const scope = { fieldType: 'brown_field' as FieldType, plant: 'jhajjar_p1' };
    expect(measuredFrom(stored, scope)).toBe(iso(90));
    expect(measuredFrom(stored, scope, 'openSourcingRequests')).toBe(iso(4));
  });

  it('metric-scoped: null when no record carries that metric at all', () => {
    const legacy = snap({ date: iso(9) });
    delete legacy.pendingQuoteInvites;
    expect(measuredFrom([legacy], undefined, 'pendingQuoteInvites')).toBeNull();
  });
});

/* ── size discipline ──────────────────────────────────────────────────── */

describe('payload size', () => {
  /**
   * Worst case for THIS portal: every seeded plant funded under all four field types, one record per
   * (plant + all-plants roll-up) per field type per day, for a full retention window, with
   * deliberately wide values (10-digit INR, 4-dp Crore, 2-digit head counts) and the longest real
   * plant + field-type identifiers.
   *
   * Baseline measured from the ACTUAL serialised array (not the widest record × count — dates and
   * shorter plant names pull the average down):
   *
   *   9 seeded plants × 4 field types × (9 + 1 roll-up) × 90 days
   *     = 3,600 records = 1,006,921 chars ≈ 0.960 MiB, at 279.7 chars/record
   *
   * ── The widening, and its reversal, with the numbers ──
   *
   * This ceiling was 1,700,000 over a 1,631,521-char baseline, with the standing instruction "if
   * this fails, cut SNAPSHOT_RETENTION_DAYS — do not widen the ceiling". Adding the two WORKFLOW
   * counts (`openSourcingRequests`, `pendingQuoteInvites`) costs **+53 chars per record**, blew
   * straight through it, and the ceiling was raised to 2,100,000 instead — putting the 180-day
   * worst case at 2,013,841 chars ≈ 1.92 MiB, ~38% of the ~5 MB `localStorage` quota.
   *
   * That has been REVERSED (2026-08). `SNAPSHOT_RETENTION_DAYS` is now 90 and this ceiling is back
   * at its original 1,700,000 — the workflow counts are paid for out of the horizon, not out of the
   * quota, which is what the original instruction said to do. `SNAPSHOT_RETENTION_DAYS` carries the
   * reasoning: snapshots are derived and re-measurable, `requests`/`invites` in the same payload are
   * not, so the derived series yields. Nothing was lost doing it now — no stored snapshot was more
   * than ~2 weeks old.
   *
   * ── The two growth canaries, re-measured at 90 days ──
   *
   *   - a tenth plant           → 3,960 records = 1,109,161 chars (280.1 chars/record)
   *   - one narrow added field  → 3,600 records = 1,089,721 chars (302.7 chars/record, e.g.
   *     utilisationPct)
   *
   * At 180 days both tripped a ceiling sitting ~4% above the baseline. At 90 days BOTH sit well
   * under 1,700,000, so the absolute ceiling — deliberately kept at its original value rather than
   * re-tightened around the new baseline — no longer catches either. State that plainly rather than
   * leave a comment claiming a guard that is not there:
   *
   *   - The ADDED-FIELD canary is preserved by `CEILING_BYTES_PER_RECORD` below, which is the growth
   *     that is a CODE change and the one that scales with every future scope.
   *   - The TENTH-PLANT growth is deliberately NOT asserted any more. It does not make records
   *     fatter, and at 90 days it lands at 1.06 MiB (~21% of quota) — inside budget, so failing CI
   *     on it would be a false alarm. `CEILING_BYTES` is what catches it if scope growth ever does
   *     become dangerous.
   *
   * Perspective, stated rather than buried: 0.96 MiB is ~19% of the ~5 MB `localStorage` quota that
   * `fileStore.ts`'s IndexedDB offload exists to protect — and this is the SEEDED WORST CASE (every
   * plant funded under all four field types, every day measured for three months). A realistic
   * single-plant, single-field-type portal writes 2 records/day ≈ 48 KB at full retention.
   *
   * Note the scope count is NOT bounded by `PLANTS`: `buildSnapshots` enumerates plants from
   * `capexMaster`, and `createGreenFieldPlant`/`addCustomPlant` create plants at runtime. 40
   * scopes/day is today's SEEDED ceiling, not an invariant.
   */
  const CEILING_BYTES = 1_700_000;
  /**
   * Per-record ceiling: 279.7 measured, +4% headroom. This is the canary the absolute ceiling stopped
   * providing when retention was cut — it fails on a WIDER RECORD (a new field: 302.7 chars/record)
   * while staying indifferent to more scopes, which is the split the comment above describes. Cutting
   * retention again would not paper over a fatter record, which is the point.
   */
  const CEILING_BYTES_PER_RECORD = 291;
  /**
   * Floor, expressed PER RECORD rather than as an absolute — it must catch a record silently
   * shrinking to a stub while staying compatible with the remedy the ceiling comment prescribes.
   * An absolute floor would have failed the moment retention was cut to 90 days, i.e. it would have
   * punished the documented fix that has now actually been applied.
   */
  const FLOOR_BYTES_PER_RECORD = 200;

  it('stays under the stated ceiling at full retention across every scope', () => {
    const fieldTypes: FieldType[] = ['brown_field', 'green_field', 'digitisation', 'information_technology'];
    const plants: (string | null)[] = [...PLANTS.map((p) => p.value), null];
    const rows: KpiSnapshot[] = [];
    for (let d = 0; d < SNAPSHOT_RETENTION_DAYS; d++) {
      for (const fieldType of fieldTypes) {
        for (const plant of plants) {
          // EVERY field `buildSnapshots` writes must appear here, including the optional ones — an
          // optional field left out of this fixture makes the guard silently measure a record
          // shape that is never actually persisted, which is how the workflow counts first slipped
          // past this test entirely.
          rows.push({
            date: iso(d), fieldType, plant, fy: '2026-27',
            allocatedInr: 9_999_999_999, committedInr: 9_999_999_999,
            awardedInr: 9_999_999_999, paidInr: 9_999_999_999,
            overExposureCr: 9999.9999, breachedHeads: 99,
            openSourcingRequests: 999, pendingQuoteInvites: 999,
          });
        }
      }
    }
    expect(rows).toHaveLength(SNAPSHOT_RETENTION_DAYS * fieldTypes.length * (PLANTS.length + 1));
    const bytes = JSON.stringify(rows).length;
    expect(bytes).toBeGreaterThan(rows.length * FLOOR_BYTES_PER_RECORD);
    expect(bytes).toBeLessThan(CEILING_BYTES);
    expect(bytes / rows.length).toBeLessThan(CEILING_BYTES_PER_RECORD);
  });

  it('a built record carries EXACTLY the fields the ceiling fixture measures', () => {
    // The guard on the guard. The ceiling above is only meaningful if its hand-built fixture has
    // the same shape as a real capture; an optional field added to `buildSnapshots` and forgotten
    // here would make the size test pass while the real payload grew unmeasured.
    const rows = build({ capexMaster: [master()] });
    expect(Object.keys(rows[0]).sort()).toEqual([
      'allocatedInr', 'awardedInr', 'breachedHeads', 'committedInr', 'date', 'fieldType', 'fy',
      'openSourcingRequests', 'overExposureCr', 'paidInr', 'pendingQuoteInvites', 'plant',
    ]);
  });

  it('a real single-day capture is a handful of records, never one per request', () => {
    // Pins the granularity contract: 40 requests must not make the daily payload 40× bigger.
    const requests = Array.from({ length: 40 }, (_, i) => req({ id: `r${i}` }));
    const rows = build({ capexMaster: [master({ totalCost: 5 })], requests });
    expect(rows).toHaveLength(2); // one plant record + one roll-up
  });
});
