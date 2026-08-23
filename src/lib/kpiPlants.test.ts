import { describe, expect, it } from 'vitest';
import {
  latestMasterFyForPlantField, liveFyByPlant, plantHeadUtilisation, plantKpis,
} from './kpiPlants';
import { masterIndex, invitesByRequest, DAY_MS } from './kpiUtils';
import { toInr } from './currencyUtils';
import type { CapexMasterItem, CapexRequest, CapexLineItem, VendorInvite } from './types';

const NOW = new Date('2026-08-15T00:00:00.000Z').getTime();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();
const CR = 1_00_00_000;

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', subject: 'S', category: 'M', quantity: '1', priority: 'medium',
    justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing',
    createdBy: 'Arjun Mehta', createdAt: iso(10), ...over,
  };
}

function master(over: Partial<CapexMasterItem> = {}): CapexMasterItem {
  return {
    id: 'm1', plant: 'jhajjar_p1', head: 'Machinery', department: 'Prod',
    subParticulars: 'Chiller', rate: 0, totalCost: 2, fy: '2026-27',
    fieldType: 'brown_field', projectType: 'rac', ...over,
  };
}

function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't1', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(6), auctionApprovalStatus: 'not_sent',
    ...over,
  };
}

const line = (id: string): CapexLineItem => ({ id, description: id, category: 'M', quantity: '1' });

describe('liveFyByPlant', () => {
  it('gives each plant its OWN latest FY, never one global latest', () => {
    const capexMaster = [
      master({ id: 'a1', plant: 'plantA', fy: '2025-26' }),
      master({ id: 'a2', plant: 'plantA', fy: '2024-25' }),
      master({ id: 'b1', plant: 'plantB', fy: '2026-27' }),
      master({ id: 'c1', plant: 'plantC', fy: '2023-24' }),
    ];
    const map = liveFyByPlant(capexMaster, 'brown_field');

    expect(map.get('plantA')).toBe('2025-26'); // its own latest, not plantB's 2026-27
    expect(map.get('plantB')).toBe('2026-27');
    expect(map.get('plantC')).toBe('2023-24');
    expect(map.size).toBe(3);
  });

  it('excludes rows of another field type, and keeps the FY of the field type asked for', () => {
    // plantA's Green Field year is NEWER than its Brown Field year — a builder that ignored
    // fieldType would report 2027-28 as plantA's live BROWN Field FY and zero out its whole
    // Brown Field budget (no 2027-28 brown rows exist).
    const capexMaster = [
      master({ id: 'a1', plant: 'plantA', fy: '2025-26', fieldType: 'brown_field' }),
      master({ id: 'a2', plant: 'plantA', fy: '2027-28', fieldType: 'green_field' }),
      master({ id: 'd1', plant: 'plantD', fy: '2026-27', fieldType: 'digitisation' }),
    ];

    expect(liveFyByPlant(capexMaster, 'brown_field').get('plantA')).toBe('2025-26');
    expect(liveFyByPlant(capexMaster, 'brown_field').has('plantD')).toBe(false);
    expect(liveFyByPlant(capexMaster, 'green_field').get('plantA')).toBe('2027-28');
    expect(liveFyByPlant(capexMaster, 'digitisation').get('plantD')).toBe('2026-27');
  });

  it('treats a missing fieldType as brown_field, matching the rest of the layer', () => {
    const legacy = { ...master({ id: 'l1', plant: 'plantL', fy: '2026-27' }) };
    delete (legacy as { fieldType?: unknown }).fieldType;

    expect(liveFyByPlant([legacy], 'brown_field').get('plantL')).toBe('2026-27');
    expect(liveFyByPlant([legacy], 'green_field').size).toBe(0);
  });

  it('returns an empty map for an empty master', () => {
    expect(liveFyByPlant([], 'brown_field').size).toBe(0);
  });

  it('is the single implementation behind latestMasterFyForPlantField', () => {
    const capexMaster = [
      master({ id: 'a1', plant: 'plantA', fy: '2025-26' }),
      master({ id: 'b1', plant: 'plantB', fy: '2026-27' }),
    ];
    const map = liveFyByPlant(capexMaster, 'brown_field');

    for (const plant of ['plantA', 'plantB', 'unknown_plant']) {
      expect(latestMasterFyForPlantField(capexMaster, plant, 'brown_field'))
        .toBe(map.get(plant) ?? null);
    }
    expect(latestMasterFyForPlantField(capexMaster, 'unknown_plant', 'brown_field')).toBeNull();
  });
});

describe('plantHeadUtilisation', () => {
  it('scopes each plant to its OWN live FY and pools project types per head', () => {
    const capexMaster = [
      // plantA is still on 2025-26; a global "latest FY" (2026-27, from plantB) would drop it.
      master({ id: 'a1', plant: 'plantA', fy: '2025-26', head: 'Machinery', totalCost: 2 }),
      // Same head, a second project type at the same plant/FY — pooled into one cell.
      master({ id: 'a2', plant: 'plantA', fy: '2025-26', head: 'Machinery', projectType: 'ems', totalCost: 3 }),
      // A stale year at the same plant must not contribute.
      master({ id: 'a0', plant: 'plantA', fy: '2024-25', head: 'Machinery', totalCost: 9 }),
      master({ id: 'b1', plant: 'plantB', fy: '2026-27', head: 'Automation', totalCost: 4 }),
    ];

    const { cells, heads } = plantHeadUtilisation({
      plants: ['plantA', 'plantB'],
      capexMaster, headOverrides: [],
      usedAmountByMasterItemId: { a1: 1 * CR, a2: 1.5 * CR, b1: 1 * CR },
    });

    const a = cells.find(c => c.plant === 'plantA' && c.head === 'Machinery')!;
    expect(a.allocatedCr).toBeCloseTo(5); // 2 (rac) + 3 (ems), NOT the 2024-25 row's 9
    expect(a.committedCr).toBeCloseTo(2.5);
    expect(a.utilisationPct).toBeCloseTo(50);
    expect(a.over).toBe(false);

    const b = cells.find(c => c.plant === 'plantB' && c.head === 'Automation')!;
    expect(b.allocatedCr).toBeCloseTo(4);
    expect(b.utilisationPct).toBeCloseTo(25);

    expect(cells).toHaveLength(2);
    // Canonical Brown Field head order, the same order /capex/master lists heads in.
    expect(heads).toEqual(['Automation', 'Machinery']);
  });

  it('flags a cell OVER when any one project-type scope breaches, even if the pooled % is under 100', () => {
    const capexMaster = [
      master({ id: 'r1', plant: 'plantH', fy: '2026-27', head: 'Machinery', projectType: 'rac', totalCost: 1 }),
      master({ id: 'e1', plant: 'plantH', fy: '2026-27', head: 'Machinery', projectType: 'ems', totalCost: 4 }),
    ];
    const { cells } = plantHeadUtilisation({
      plants: ['plantH'],
      capexMaster, headOverrides: [],
      // RAC is over (1.5 of 1); EMS has slack (0 of 4). Pooled: 1.5 of 5 = 30%.
      usedAmountByMasterItemId: { r1: 1.5 * CR },
    });

    const cell = cells[0];
    expect(cell.utilisationPct).toBeCloseTo(30);
    expect(cell.over).toBe(true); // the RAC breach survives pooling
  });

  it('reports a head with spend but no allocation as unmeasurable, never Infinity', () => {
    const capexMaster = [
      master({ id: 'z1', plant: 'plantZ', fy: '2026-27', head: 'General', totalCost: 0 }),
    ];
    const { cells, unmeasurable } = plantHeadUtilisation({
      plants: ['plantZ'],
      capexMaster, headOverrides: [],
      usedAmountByMasterItemId: { z1: 0.75 * CR },
    });

    expect(cells[0].utilisationPct).toBeNull();
    expect(cells[0].committedCr).toBeCloseTo(0.75);
    expect(cells[0].over).toBe(true);
    expect(unmeasurable).toBe(1);
  });

  it('honours an approved adhoc transfer via the effective head allocation', () => {
    const capexMaster = [
      master({ id: 'm1', plant: 'plantT', fy: '2026-27', head: 'Machinery', totalCost: 1 }),
    ];
    const { cells } = plantHeadUtilisation({
      plants: ['plantT'],
      capexMaster,
      headOverrides: [{
        plant: 'plantT', fy: '2026-27', projectType: 'rac',
        division: 'Other Brown Field', head: 'Machinery', budgetCr: 4,
      }],
      usedAmountByMasterItemId: { m1: 2 * CR },
    });

    expect(cells[0].allocatedCr).toBeCloseTo(4); // the override, not the 1 Cr line sum
    expect(cells[0].utilisationPct).toBeCloseTo(50);
    expect(cells[0].over).toBe(false);
  });

  it('reproduces /capex/master’s own head arithmetic, figure for figure', () => {
    // The master page computes each Brown Field head (page.tsx `headSummary`, the brown branch) as:
    //   allocatedCr = getBrownFieldHeadBudgetCr(override) ?? Σ totalCost of the head's scope rows
    //   usedINR     = Σ usedAmountByMasterItemId[row.id]
    //   over        = usedINR > allocatedCr × 1 Cr
    // Restated literally below and asserted against `plantHeadUtilisation` / `plantKpis`, so the
    // dashboard and the master screen can never drift on the figure an approver acts on.
    const rows = [
      master({ id: 'm1', plant: 'plantM', fy: '2026-27', head: 'Machinery', totalCost: 2 }),
      master({ id: 'm2', plant: 'plantM', fy: '2026-27', head: 'Machinery', totalCost: 3 }),
      master({ id: 'a1', plant: 'plantM', fy: '2026-27', head: 'Automation', totalCost: 1 }),
    ];
    const used = { m1: 1.25 * CR, m2: 2 * CR, a1: 1.4 * CR };
    const overrides = [{
      plant: 'plantM', fy: '2026-27', projectType: 'rac' as const,
      division: 'Other Brown Field', head: 'Machinery', budgetCr: 6,
    }];

    // ── the master page's arithmetic, restated ──
    const masterPage = ['Machinery', 'Automation'].map((head) => {
      const headRows = rows.filter(r => r.head === head);
      const override = overrides.find(o => o.head === head)?.budgetCr ?? null;
      const allocatedCr = override ?? headRows.reduce((s, r) => s + r.totalCost, 0);
      const usedINR = headRows.reduce((s, r) => s + (used[r.id as keyof typeof used] ?? 0), 0);
      return { head, allocatedCr, usedCr: usedINR / CR, over: usedINR > allocatedCr * CR };
    });
    expect(masterPage).toEqual([
      { head: 'Machinery', allocatedCr: 6, usedCr: 3.25, over: false }, // override 6 Cr beats the 5 Cr line sum
      { head: 'Automation', allocatedCr: 1, usedCr: 1.4, over: true },  // 1.4 Cr committed on a 1 Cr head
    ]);

    // ── the dashboard's, over the same inputs ──
    const { cells } = plantHeadUtilisation({
      plants: ['plantM'], capexMaster: rows, headOverrides: overrides, usedAmountByMasterItemId: used,
    });
    for (const expected of masterPage) {
      const cell = cells.find(c => c.head === expected.head)!;
      expect(cell.allocatedCr).toBeCloseTo(expected.allocatedCr);
      expect(cell.committedCr).toBeCloseTo(expected.usedCr);
      expect(cell.over).toBe(expected.over);
      expect(cell.utilisationPct).toBeCloseTo((expected.usedCr / expected.allocatedCr) * 100);
    }

    const [row] = plantKpis({
      plants: ['plantM'], capexMaster: rows, requests: [], byRequest: new Map(),
      index: masterIndex(rows), headOverrides: overrides, usedAmountByMasterItemId: used, now: NOW,
    });
    expect(row.breachedHeads).toBe(masterPage.filter(h => h.over).length);
    expect(row.overExposureCr).toBeCloseTo(
      masterPage.filter(h => h.over).reduce((s, h) => s + (h.usedCr - h.allocatedCr), 0),
    );
    expect(row.overExposureCr).toBeCloseTo(0.4); // Automation: 1.4 − 1.0 Cr
  });

  it('emits no cells for a plant with no Brown Field budget at all', () => {
    const { cells, heads, unmeasurable } = plantHeadUtilisation({
      plants: ['plantNone'],
      capexMaster: [], headOverrides: [], usedAmountByMasterItemId: {},
    });
    expect(cells).toEqual([]);
    expect(heads).toEqual([]);
    expect(unmeasurable).toBe(0);
  });
});

describe('plantKpis — allocation / utilisation', () => {
  it('reports 0 utilisation, not NaN or Infinity, for a plant with zero allocation', () => {
    const [p] = plantKpis({
      plants: ['no_budget_plant'],
      capexMaster: [], requests: [], byRequest: new Map(), index: masterIndex([]),
      headOverrides: [], usedAmountByMasterItemId: {}, now: NOW,
    });
    expect(p.allocatedInr).toBe(0);
    expect(p.committedInr).toBe(0);
    expect(p.utilisationPct).toBe(0);
    expect(Number.isFinite(p.utilisationPct)).toBe(true);
  });

  it('scopes two plants to their OWN latest Brown Field FY, dropping neither', () => {
    // Plant A only ever published 2025-26; Plant B only ever published 2026-27 — exactly the
    // "plants diverge" scenario `AdminDashboard`'s over-allocation tile exists to survive. A
    // buggy implementation using ONE global latest FY (2026-27, since B's FY sorts higher) would
    // zero out plant A entirely — both its allocation (no 2026-27 rows at A) and its committed
    // figure (the linked request's own FY, 2025-26, would no longer match the scope).
    const masterA = master({ id: 'mA', plant: 'plantA', fy: '2025-26', totalCost: 2 });
    const masterB = master({ id: 'mB', plant: 'plantB', fy: '2026-27', totalCost: 3 });
    const capexMaster = [masterA, masterB];
    const index = masterIndex(capexMaster);

    const reqA = req({
      id: 'rA', plant: 'plantA', fieldType: 'brown_field',
      lineItems: [{ ...line('l1'), masterItemId: 'mA' }],
    });
    const reqB = req({
      id: 'rB', plant: 'plantB', fieldType: 'brown_field',
      lineItems: [{ ...line('l1'), masterItemId: 'mB' }],
    });

    const rows = plantKpis({
      plants: ['plantA', 'plantB'],
      capexMaster, requests: [reqA, reqB], byRequest: new Map(), index,
      headOverrides: [], usedAmountByMasterItemId: {}, now: NOW,
    });
    const a = rows.find(p => p.plant === 'plantA')!;
    const b = rows.find(p => p.plant === 'plantB')!;

    expect(a.allocatedInr).toBe(2 * CR);
    expect(a.committedInr).toBe(2 * CR); // requestValue falls back to the linked master allocation
    expect(b.allocatedInr).toBe(3 * CR);
    expect(b.committedInr).toBe(3 * CR);
  });
});

describe('plantKpis — a plant with requests but no published budget', () => {
  it('still reports committed spend, so the per-plant rows add up to the portfolio roll-up', () => {
    // Today's real data shape: Brown Field requests at a plant that has NO Brown Field master row
    // (only another plant's Green Field rows exist). The requests are unlinked, so `requestFy`
    // attributes them to `getLatestMasterFyForField` — 2025-26 here, from the Green Field rows.
    const capexMaster = [master({ id: 'g1', plant: 'plantY', fy: '2025-26', fieldType: 'green_field', totalCost: 7 })];
    const r = req({
      id: 'rX', plant: 'plantX', fieldType: 'brown_field', status: 'sourcing', budget: 400000,
    });

    const [p] = plantKpis({
      plants: ['plantX'],
      capexMaster, requests: [r], byRequest: new Map(), index: masterIndex(capexMaster),
      headOverrides: [], usedAmountByMasterItemId: {}, now: NOW,
    });

    expect(p.committedInr).toBe(400000); // NOT 0 — the request exists and must be counted somewhere
    expect(p.allocatedInr).toBe(0); // genuinely no budget — callers render this as unmeasurable
    expect(p.utilisationPct).toBe(0); // guarded, never Infinity
    expect(p.breachedHeads).toBe(0);
  });
});

describe('plantKpis — a trailing plant\'s unlinked requests', () => {
  it('discloses the requests its own-FY scope excludes, instead of absorbing them', () => {
    // plantOld is still on 2025-26 while plantNew has published 2026-27, so the PORTFOLIO's live
    // Brown Field FY is 2026-27. An UNLINKED request at plantOld is attributed by `requestFy` to that
    // portfolio FY, so it falls outside plantOld's own-FY budget scope and is not in `committedInr`.
    // Absorbing it would pair a 2026-27 commitment with a 2025-26 allocation — a mixed basis. It is
    // counted and disclosed instead.
    const capexMaster = [
      master({ id: 'mOld', plant: 'plantOld', fy: '2025-26', totalCost: 2 }),
      master({ id: 'mNew', plant: 'plantNew', fy: '2026-27', totalCost: 3 }),
    ];
    const index = masterIndex(capexMaster);
    const linked = req({
      id: 'rLinked', plant: 'plantOld', fieldType: 'brown_field',
      lineItems: [{ ...line('l1'), masterItemId: 'mOld' }],
    });
    const unlinked = req({ id: 'rUnlinked', plant: 'plantOld', fieldType: 'brown_field', budget: 500000 });
    const draft = req({ id: 'rDraft', plant: 'plantOld', fieldType: 'brown_field', status: 'draft', budget: 900000 });

    const [p] = plantKpis({
      plants: ['plantOld'],
      capexMaster, requests: [linked, unlinked, draft], byRequest: new Map(), index,
      headOverrides: [], usedAmountByMasterItemId: {}, now: NOW,
    });

    expect(p.allocatedInr).toBe(2 * CR); // its own FY's allocation
    expect(p.committedInr).toBe(2 * CR); // the linked request only — one FY on both sides
    expect(p.requestsOutsideScopedFy).toBe(1); // the unlinked one, disclosed
  });

  it('reports nothing excluded when the plant is on the portfolio\'s live FY', () => {
    const capexMaster = [master({ id: 'mOnly', plant: 'plantP', fy: '2026-27', totalCost: 4 })];
    const unlinked = req({ id: 'rU', plant: 'plantP', fieldType: 'brown_field', budget: 500000 });

    const [p] = plantKpis({
      plants: ['plantP'],
      capexMaster, requests: [unlinked], byRequest: new Map(), index: masterIndex(capexMaster),
      headOverrides: [], usedAmountByMasterItemId: {}, now: NOW,
    });

    expect(p.requestsOutsideScopedFy).toBe(0);
    expect(p.committedInr).toBe(500000); // same FY on both sides, so it counts
  });
});

describe('plantKpis — foreign currency', () => {
  it('reports committed value and negotiation savings in INR, not the vendor face value', () => {
    const masterC = master({ id: 'mC', plant: 'plantC', fy: '2026-27', totalCost: 5 });
    const capexMaster = [masterC];
    const index = masterIndex(capexMaster);

    // Unlinked to a master row, but `requestFy`'s fallback (getLatestMasterFyForField) resolves
    // to 2026-27 anyway since that is the only Brown Field row in the whole fixture.
    const r = req({
      id: 'rC', plant: 'plantC', fieldType: 'brown_field', status: 'pi_requested',
      finalVendorId: 'v1', sourcingMode: 'rfq',
    });
    const inv = invite({
      requestId: 'rC', vendorId: 'v1', rfqStatus: 'approved',
      rfqQuote: { price: 1000, currency: 'USD' },
      rfqThread: [
        { id: 'm1', by: 'supplier', senderName: 'V', action: 'proposed', at: iso(5),
          quote: { price: 1200, currency: 'USD' } },
      ],
    });

    const [p] = plantKpis({
      plants: ['plantC'],
      capexMaster, requests: [r], byRequest: invitesByRequest([inv]), index,
      headOverrides: [], usedAmountByMasterItemId: {}, now: NOW,
    });

    const expectedValueInr = toInr(1000, 'USD');
    const expectedNegotiationInr = Math.round(toInr(1200, 'USD') - toInr(1000, 'USD'));

    expect(p.committedInr).toBe(expectedValueInr);
    expect(p.committedInr).not.toBe(1000); // not the raw USD face value
    expect(p.savingsInr).toBe(expectedNegotiationInr);
    expect(p.savingsInr).not.toBe(200); // not the raw USD (1200-1000) face-value difference
    expect(p.savingsComparable).toBe(1);
  });
});

describe('plantKpis — split award', () => {
  it('sums negotiation savings across every award on the request, counted as ONE contributing request', () => {
    const lines = [line('l1'), line('l2')];
    const r = req({ id: 'rE', plant: 'plantE', lineItems: lines });

    const openingThread = (price: number, linePrices: Record<string, number>) => [
      { id: 'm1', by: 'supplier' as const, senderName: 'V', action: 'proposed' as const, at: iso(5),
        quote: { price, linePrices, currency: 'INR' } },
    ];
    const inv1 = invite({
      id: 'i1', requestId: 'rE', vendorId: 'v1', awarded: true, awardedItemIds: ['l1'], awardAmount: 700,
      rfqThread: openingThread(1500, { l1: 1000, l2: 500 }),
    });
    const inv2 = invite({
      id: 'i2', requestId: 'rE', vendorId: 'v2', awarded: true, awardedItemIds: ['l2'], awardAmount: 200,
      rfqThread: openingThread(1500, { l1: 1000, l2: 500 }),
    });
    // l1: offered 1000, awarded 700 -> saved 300. l2: offered 500, awarded 200 -> saved 300.
    // A per-invite (rather than per-request) loop would still sum to 600 here by coincidence
    // (savingsForRequest's own split-award math is additive per award), but it would double-count
    // `savingsComparable` as 2 — pinned below.

    const [p] = plantKpis({
      plants: ['plantE'],
      capexMaster: [], requests: [r], byRequest: invitesByRequest([inv1, inv2]), index: masterIndex([]),
      headOverrides: [], usedAmountByMasterItemId: {}, now: NOW,
    });

    expect(p.savingsInr).toBe(600);
    expect(p.savingsComparable).toBe(1); // one REQUEST contributed, even though it has two awards
  });
});

describe('plantKpis — Brown Field head breaches', () => {
  it('flags an over-committed head and sums its overExposureCr', () => {
    const capexMaster = [master({ id: 'mh1', plant: 'plantH', fy: '2026-27', head: 'Machinery', totalCost: 1 })];
    const [p] = plantKpis({
      plants: ['plantH'],
      capexMaster, requests: [], byRequest: new Map(), index: masterIndex(capexMaster),
      headOverrides: [], usedAmountByMasterItemId: { mh1: 1.5 * CR }, now: NOW,
    });
    expect(p.breachedHeads).toBe(1);
    expect(p.overExposureCr).toBeCloseTo(0.5);
  });

  it('reports no breach when committed is within the effective allocation', () => {
    const capexMaster = [master({ id: 'mh1', plant: 'plantH', fy: '2026-27', head: 'Machinery', totalCost: 1 })];
    const [p] = plantKpis({
      plants: ['plantH'],
      capexMaster, requests: [], byRequest: new Map(), index: masterIndex(capexMaster),
      headOverrides: [], usedAmountByMasterItemId: { mh1: 0.5 * CR }, now: NOW,
    });
    expect(p.breachedHeads).toBe(0);
    expect(p.overExposureCr).toBe(0);
  });
});

describe('plantKpis — stalled / liveRequests', () => {
  it('counts only non-draft/completed/rejected requests as live, and flags SLA breaches among them', () => {
    const draft = req({ id: 'r1', plant: 'plantG', status: 'draft' });
    const completed = req({ id: 'r2', plant: 'plantG', status: 'completed' });
    // plantHead SLA is 3 days (SLA_DAYS.plantHead) — 4 days breaches it.
    const breached = req({
      id: 'r3', plant: 'plantG', status: 'pending_head_approval',
      statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(4) }],
    });
    const withinSla = req({
      id: 'r4', plant: 'plantG', status: 'pending_head_approval',
      statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(1) }],
    });

    const [p] = plantKpis({
      plants: ['plantG'],
      capexMaster: [], requests: [draft, completed, breached, withinSla], byRequest: new Map(),
      index: masterIndex([]), headOverrides: [], usedAmountByMasterItemId: {}, now: NOW,
    });

    expect(p.liveRequests).toBe(2); // breached + withinSla only
    expect(p.stalled).toBe(1); // breached only
  });
});

describe('plantKpis — TAT: live vs realised', () => {
  it('excludes a stopped (realised) TAT clock from delayExposureInr and medianTatDays', () => {
    // Track 1: still running, PI submitted 30 days ago -> 3 weeks late (grace ends at day 23).
    const running = req({ id: 'r1', plant: 'plantF', status: 'payment_in_progress' });
    const runningInvite = invite({
      id: 'i1', requestId: 'r1', vendorId: 'v1', awarded: true, awardAmount: 100_000, piSubmittedAt: iso(30),
    });
    // Track 2: stopped (paid) 10 days ago, PI submitted 60 days ago -> 6 weeks late, but SETTLED.
    const settled = req({ id: 'r2', plant: 'plantF', status: 'completed' });
    const settledInvite = invite({
      id: 'i2', requestId: 'r2', vendorId: 'v1', awarded: true, awardAmount: 200_000,
      piSubmittedAt: iso(60), tatStoppedAt: iso(10),
    });

    const [p] = plantKpis({
      plants: ['plantF'],
      capexMaster: [], requests: [running, settled], index: masterIndex([]),
      byRequest: invitesByRequest([runningInvite, settledInvite]),
      headOverrides: [], usedAmountByMasterItemId: {}, now: NOW,
    });

    // 3 weeks late * 0.5%/wk = 1.5% of 100,000 = 1,500 — running only, the 6-week/6,000 realised
    // deduction on the settled track must NOT be added in.
    expect(p.delayExposureInr).toBe(1500);
    // weeksLate(3) * 7 = 21 days — the settled track's 42 days must not appear in the sample.
    expect(p.medianTatDays).toBe(21);
  });
});
