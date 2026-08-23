import { describe, expect, it } from 'vitest';
import { adminQueues, buildBucket, buyerQueues, maintenanceQueues, sourcingQueues } from './kpiQueues';
import { invitesByRequest, DAY_MS } from './kpiUtils';
import type { AdhocBudgetRequest, BudgetProposal, CapexRequest, VendorInvite } from './types';

const NOW = new Date('2026-08-15T00:00:00.000Z').getTime();
const iso = (d: number) => new Date(NOW - d * DAY_MS).toISOString();
// Generic so TS infers the concrete QueueBucket shape from the call site instead of widening to
// the annotated `{ key: string }` — a non-generic signature here erases `.count`/`.breached`/etc.
// on every call (a tsc-only defect: vitest's dynamic `expect` still reads the real values fine).
const bucket = <B extends { key: string }>(bands: { mine: B[] }, key: string) =>
  bands.mine.find((b) => b.key === key)!;

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', requestNo: 'CAP-2627-0001', subject: 'Chiller', category: 'M', quantity: '1',
    priority: 'medium', justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing', plant: 'jhajjar_p1',
    createdBy: 'Arjun Mehta', createdAt: iso(10), ...over,
  };
}
function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(9),
    auctionApprovalStatus: 'not_sent', ...over,
  };
}
function proposal(over: Partial<BudgetProposal> = {}): BudgetProposal {
  return {
    id: 'p1', plant: 'jhajjar_p1', projectType: 'rac', targetFy: '2027-28',
    status: 'pending_admin', items: [{ id: 'bi1', head: 'Machinery', department: 'Prod',
      subParticulars: 'Chiller', rate: 0, totalCost: 2 }],
    createdBy: 'Sunil Verma', createdAt: iso(20), submittedAt: iso(6), ...over,
  };
}

describe('buildBucket', () => {
  const item = (id: string, ageDays: number | null) => ({ id, label: id, href: '/x', ageDays });

  it('reports the oldest datable age and breaches past its SLA', () => {
    const b = buildBucket({ key: 'k', label: 'K', items: [item('a', 1), item('b', 9)], slaKey: 'plantHead' });
    expect(b.oldestDays).toBe(9);
    expect(b.breached).toBe(true);
  });

  it('ignores undatable items when computing the oldest age', () => {
    const b = buildBucket({ key: 'k', label: 'K', items: [item('a', null), item('b', 4)], slaKey: 'plantHead' });
    expect(b.count).toBe(2);
    expect(b.oldestDays).toBe(4);
    expect(b.breached).toBe(true);
  });

  it('reports a null age — never a fabricated 0 — when NO item is datable', () => {
    // Coercing null to 0 rendered "<1d" on a bucket nothing is known about, and could never breach.
    const b = buildBucket({ key: 'k', label: 'K', items: [item('a', null), item('b', null)], slaKey: 'plantHead' });
    expect(b.count).toBe(2);
    expect(b.oldestDays).toBeNull();
    expect(b.breached).toBe(false);
  });

  it('reports a null age for an empty bucket', () => {
    expect(buildBucket({ key: 'k', label: 'K', items: [] }).oldestDays).toBeNull();
  });
});

describe('sourcingQueues', () => {
  it('flags a sourcing request with no invites as one to pick up', () => {
    const b = sourcingQueues([req({ status: 'sourcing' })], new Map(), NOW);
    expect(bucket(b, 'pickup').count).toBe(1);
    expect(bucket(b, 'pickup').items[0].label).toContain('CAP-2627-0001');
  });

  it('does not flag pickup once vendors are invited', () => {
    const byRequest = invitesByRequest([invite({ rfqStatus: 'awaiting_quote' })]);
    expect(bucket(sourcingQueues([req()], byRequest, NOW), 'pickup').count).toBe(0);
  });

  it('collects quotations awaiting sourcing review and breaches nothing inside SLA', () => {
    const byRequest = invitesByRequest([
      invite({ id: 'i1', rfqQuote: { price: 10 }, rfqStatus: 'pending_sourcing' }),
    ]);
    const q = bucket(sourcingQueues([req()], byRequest, NOW), 'quotesToReview');
    expect(q.count).toBe(1);
    expect(q.breached).toBe(false);
  });

  it('flags a vendor who has sat on an RFQ past the SLA', () => {
    const byRequest = invitesByRequest([invite({ rfqStatus: 'awaiting_quote', invitedAt: iso(9) })]);
    const bands = sourcingQueues([req()], byRequest, NOW);
    const waiting = bands.waiting.find(b => b.key === 'vendor')!;
    expect(waiting.count).toBe(1);
    expect(waiting.breached).toBe(true);
  });

  it('flags an ended auction that was never awarded', () => {
    const r = req({ auctionConfig: { startedAt: iso(5), durationDays: 2, endsAt: iso(3) } });
    expect(bucket(sourcingQueues([r], new Map(), NOW), 'auctionUnawarded').count).toBe(1);
  });

  it('flags a vendor ready to award only when the tech spec is approved', () => {
    const ready = invite({
      rfqStatus: 'approved', rfqQuote: { price: 10 }, docApprovalStatus: 'approved',
      techSpec: { id: 't', status: 'approved', documents: [], thread: [] },
    });
    const blocked = { ...ready, id: 'i2', techSpec: { id: 't2', status: 'pending_technical' as const, documents: [], thread: [] } };
    expect(bucket(sourcingQueues([req()], invitesByRequest([ready]), NOW), 'readyToAward').count).toBe(1);
    expect(bucket(sourcingQueues([req()], invitesByRequest([blocked]), NOW), 'readyToAward').count).toBe(0);
  });

  it('flags an ended-auction bidder whose tech spec was never sent, even though the RFQ was never approved', () => {
    const r = req({ auctionConfig: { startedAt: iso(10), durationDays: 2, endsAt: iso(3) } });
    const byRequest = invitesByRequest([
      invite({ openingQuote: { id: 'q1', price: 10, deliveryDays: 7, validUntil: iso(-180), submittedAt: iso(9) } }),
    ]);
    expect(bucket(sourcingQueues([r], byRequest, NOW), 'techSpecToSend').count).toBe(1);
  });

  it('does not flag an ended-auction vendor who never placed a bid', () => {
    const r = req({ auctionConfig: { startedAt: iso(10), durationDays: 2, endsAt: iso(3) } });
    const byRequest = invitesByRequest([invite()]);
    expect(bucket(sourcingQueues([r], byRequest, NOW), 'techSpecToSend').count).toBe(0);
  });
});

describe('buyerQueues', () => {
  it('lists drafts and rejections as the requester own work', () => {
    const bands = buyerQueues([req({ id: 'r1', status: 'draft' }), req({ id: 'r2', status: 'rejected' })], new Map(), NOW);
    expect(bucket(bands, 'drafts').count).toBe(1);
    expect(bucket(bands, 'rejected').count).toBe(1);
  });

  it('surfaces a request awaiting the plant head as the requester next move', () => {
    const r = req({ status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(5) }] });
    const b = bucket(buyerQueues([r], new Map(), NOW), 'awaitingPlantHead');
    expect(b.count).toBe(1);
    expect(b.breached).toBe(true);
  });

  it('lists a plant-head request in the "needs you" band ONLY, never in both', () => {
    const r = req({ status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(2) }] });
    const bands = buyerQueues([r], new Map(), NOW);
    expect(bucket(bands, 'awaitingPlantHead').count).toBe(1);
    expect(bands.waiting.some(b => b.key === 'plant_head')).toBe(false);
  });

  it('still lists the other parties in the waiting band', () => {
    const bands = buyerQueues([req({ status: 'pi_submitted' })], new Map(), NOW);
    expect(bands.waiting.find(b => b.key === 'plant_accounts')!.count).toBe(1);
  });

  it('does not repeat the waiting age in the row sub-text (the age badge carries it)', () => {
    const bands = buyerQueues([req({ status: 'pi_requested' })], new Map(), NOW);
    expect(bands.waiting.find(b => b.key === 'vendor')!.items[0].sub).toBeUndefined();
  });
});

describe('adminQueues', () => {
  it('groups proposals and adhoc transfers awaiting admin, with their Cr totals', () => {
    const adhoc: AdhocBudgetRequest = {
      id: 'a1', plant: 'jhajjar_p1', fy: '2026-27', projectType: 'rac',
      fromHead: 'General', toHead: 'Machinery', amountCr: 0.6, status: 'pending_admin',
      createdBy: 'Neha Kapoor', createdAt: iso(2),
    };
    const bands = adminQueues([], new Map(), [proposal()], [adhoc], NOW);
    expect(bucket(bands, 'proposals').count).toBe(1);
    expect(bucket(bands, 'proposals').amountCr).toBe(2);
    expect(bucket(bands, 'proposals').breached).toBe(true);
    expect(bucket(bands, 'adhoc').amountCr).toBeCloseTo(0.6);
    expect(bucket(bands, 'adhoc').breached).toBe(false);
  });

  it('ages the admin bucket from the plant-head handoff, not the original submission', () => {
    // submittedAt is 10 days old (would breach the 3-day adminApproval SLA on its own), but the
    // proposal only reached the admin's desk 1 day ago (plantHeadDecidedAt) — that is the clock
    // that should be running.
    const p = proposal({ submittedAt: iso(10), plantHeadDecidedAt: iso(1) });
    const bands = adminQueues([], new Map(), [p], [], NOW);
    expect(bucket(bands, 'proposals').breached).toBe(false);
  });

  it('lists a proposal awaiting the Global Accounts link exactly once, in the admin band', () => {
    const p = proposal({ status: 'pending_accounts', adminDecidedAt: iso(4) });
    const bands = adminQueues([], new Map(), [p], [], NOW);
    expect(bucket(bands, 'accountsLink').count).toBe(1);
    expect(bands.waiting.some(b => b.key === 'accountsLink')).toBe(false);
  });

  it('only flags plant-head requests once past the SLA', () => {
    const fresh = req({ id: 'r1', status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(1) }] });
    const stale = req({ id: 'r2', status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(9) }] });
    expect(bucket(adminQueues([fresh, stale], new Map(), [], [], NOW), 'stuckPlantHead').count).toBe(1);
  });
});

describe('maintenanceQueues', () => {
  it('separates the author own rework from what is with approvers', () => {
    const bands = maintenanceQueues([
      proposal({ id: 'p1', status: 'draft' }),
      proposal({ id: 'p2', status: 'needs_correction' }),
      proposal({ id: 'p3', status: 'pending_admin' }),
    ], NOW);
    expect(bucket(bands, 'drafts').count).toBe(1);
    expect(bucket(bands, 'needsCorrection').count).toBe(1);
    expect(bands.waiting.find(b => b.key === 'withAdmin')!.count).toBe(1);
  });
});
