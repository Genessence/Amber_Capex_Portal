import { describe, expect, it } from 'vitest';
import { requestFy, fyBudgetPosition, headPositions, valueFunnel } from './kpiPortfolio';
import { masterIndex, invitesByRequest, DAY_MS } from './kpiUtils';
import type { CapexMasterItem, CapexRequest, VendorInvite } from './types';

const NOW = new Date('2026-08-15T00:00:00.000Z').getTime();
const iso = (d: number) => new Date(NOW - d * DAY_MS).toISOString();

function master(over: Partial<CapexMasterItem> = {}): CapexMasterItem {
  return {
    id: 'm1', plant: 'jhajjar_p1', head: 'Machinery', department: 'Prod',
    subParticulars: 'Chiller', rate: 0, totalCost: 2, fy: '2026-27',
    fieldType: 'brown_field', projectType: 'rac', ...over,
  };
}
function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', subject: 'S', category: 'M', quantity: '1', priority: 'medium',
    justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing', plant: 'jhajjar_p1',
    fieldType: 'brown_field', projectType: 'rac',
    createdBy: 'Arjun Mehta', createdAt: iso(10), ...over,
  };
}
function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(6),
    auctionApprovalStatus: 'not_sent', ...over,
  };
}

describe('requestFy', () => {
  const capexMaster = [master({ id: 'm1', fy: '2026-27' }), master({ id: 'm2', fy: '2025-26' })];
  const idx = masterIndex(capexMaster);

  it('takes the FY of the first linked master row', () => {
    const r = req({ lineItems: [{ id: 'l1', masterItemId: 'm2', description: 'x', category: 'M', quantity: '1' }] });
    expect(requestFy(r, idx, capexMaster)).toBe('2025-26');
  });

  it('falls back to the live FY of the request own field type', () => {
    expect(requestFy(req({ fieldType: 'brown_field' }), idx, capexMaster)).toBe('2026-27');
  });
});

describe('fyBudgetPosition', () => {
  const capexMaster = [
    master({ id: 'm1', totalCost: 2, fy: '2026-27' }),
    master({ id: 'm2', totalCost: 1, fy: '2026-27' }),
    // A Green Field row in the same FY must never leak into a Brown Field position (defect D6).
    master({ id: 'g1', totalCost: 99, fy: '2026-27', fieldType: 'green_field' }),
  ];

  it('scopes allocation to the field type and plant', () => {
    const p = fyBudgetPosition({
      capexMaster, requests: [], byRequest: new Map(),
      scope: { fieldType: 'brown_field', fy: '2026-27', plant: 'jhajjar_p1' },
    });
    expect(p.allocatedInr).toBe(3 * 1_00_00_000);
  });

  it('excludes draft and rejected requests from committed', () => {
    const requests = [
      req({ id: 'r1', status: 'sourcing', budget: 100 }),
      req({ id: 'r2', status: 'draft', budget: 500 }),
      req({ id: 'r3', status: 'rejected', budget: 500 }),
    ];
    const p = fyBudgetPosition({
      capexMaster, requests, byRequest: new Map(),
      scope: { fieldType: 'brown_field', fy: '2026-27', plant: 'jhajjar_p1' },
    });
    expect(p.committedInr).toBe(100);
  });

  it('counts only awarded-basis value as awarded, and reports utilisation', () => {
    const requests = [req({ id: 'r1', status: 'pi_requested', budget: 100 })];
    const byRequest = invitesByRequest([invite({ requestId: 'r1', awarded: true, awardAmount: 1_00_00_000 })]);
    const p = fyBudgetPosition({
      capexMaster, requests, byRequest,
      scope: { fieldType: 'brown_field', fy: '2026-27', plant: 'jhajjar_p1' },
    });
    expect(p.awardedInr).toBe(1_00_00_000);
    expect(p.remainingInr).toBe(2 * 1_00_00_000);
    expect(p.utilisationPct).toBeCloseTo(33.3, 0);
  });

  it('reports 0% utilisation rather than dividing by zero on an empty FY', () => {
    const p = fyBudgetPosition({
      capexMaster: [], requests: [], byRequest: new Map(),
      scope: { fieldType: 'brown_field', fy: '2026-27' },
    });
    expect(p.utilisationPct).toBe(0);
    expect(p.allocatedInr).toBe(0);
  });
});

describe('headPositions', () => {
  it('flags a head as over when committed exceeds its effective allocation', () => {
    const capexMaster = [master({ id: 'm1', head: 'Machinery', totalCost: 1 })];
    const rows = headPositions({
      capexMaster, headOverrides: [], usedAmountByMasterItemId: { m1: 1.5 * 1_00_00_000 },
      scope: { plant: 'jhajjar_p1', fy: '2026-27', projectType: 'rac' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].head).toBe('Machinery');
    expect(rows[0].allocatedCr).toBe(1);
    expect(rows[0].committedCr).toBeCloseTo(1.5);
    expect(rows[0].over).toBe(true);
  });

  it('prefers an approved adhoc override over the summed line items', () => {
    const capexMaster = [master({ id: 'm1', head: 'Machinery', totalCost: 1 })];
    const rows = headPositions({
      capexMaster,
      headOverrides: [{ plant: 'jhajjar_p1', fy: '2026-27', projectType: 'rac', division: 'Other Brown Field', head: 'Machinery', budgetCr: 3 }],
      usedAmountByMasterItemId: {},
      scope: { plant: 'jhajjar_p1', fy: '2026-27', projectType: 'rac' },
    });
    expect(rows[0].allocatedCr).toBe(3);
    expect(rows[0].over).toBe(false);
  });
});

describe('valueFunnel', () => {
  it('counts a request as approved once it reached sourcing', () => {
    const requests = [
      req({ id: 'r1', status: 'sourcing', budget: 100, statusHistory: [
        { status: 'submitted', actor: 'A', at: iso(9) },
        { status: 'sourcing', actor: 'A', at: iso(8) },
      ] }),
      req({ id: 'r2', status: 'pending_head_approval', budget: 50, statusHistory: [
        { status: 'pending_head_approval', actor: 'A', at: iso(9) },
      ] }),
    ];
    const f = valueFunnel(requests, new Map(), masterIndex([]));
    expect(f.requested).toBe(150);
    expect(f.approved).toBe(100);
  });
});
