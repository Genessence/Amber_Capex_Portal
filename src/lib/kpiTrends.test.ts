import { describe, expect, it } from 'vitest';
import { monthlyFlow } from './kpiTrends';
import { masterIndex, invitesByRequest } from './kpiUtils';
import type { CapexRequest, VendorInvite } from './types';

// Noon UTC keeps every fixture date safely inside its intended calendar month regardless of the
// test runner's local timezone (max real-world UTC offset is +14, min is -12 — neither can push a
// noon-UTC timestamp into a different month).
const NOW = new Date('2026-08-15T12:00:00.000Z').getTime();

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', subject: 'S', category: 'M', quantity: '1', priority: 'medium',
    justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing',
    createdBy: 'Arjun Mehta', createdAt: '2026-06-01T12:00:00.000Z', ...over,
  };
}

function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't1', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: '2026-06-01T12:00:00.000Z',
    auctionApprovalStatus: 'not_sent', ...over,
  };
}

describe('monthlyFlow', () => {
  it('returns a contiguous, zero-filled series ending at the current local month', () => {
    const points = monthlyFlow([], new Map(), masterIndex([]), { now: NOW, months: 3 });
    expect(points.map(p => p.month)).toEqual(['2026-06', '2026-07', '2026-08']);
    for (const p of points) {
      expect(p).toEqual({ month: p.month, raised: 0, awarded: 0, completed: 0, valueAwardedInr: 0 });
    }
  });

  it('buckets raised in its own month and, separately, awarded in a later month', () => {
    const index = masterIndex([]);

    // Raised in June, never awarded.
    const raisedOnly = req({
      id: 'r2', createdAt: '2026-05-20T12:00:00.000Z',
    });
    // Raised in June, awarded (reaches pi_requested) in August — a different bucket for each.
    const raisedThenAwarded = req({
      id: 'r1', createdAt: '2026-06-10T12:00:00.000Z',
      status: 'pi_requested',
      statusHistory: [
        { status: 'sourcing', actor: 'A', at: '2026-06-10T12:00:00.000Z' },
        { status: 'pi_requested', actor: 'A', at: '2026-08-05T12:00:00.000Z' },
      ],
    });
    // Raised, awarded, AND completed within the window, but its value basis is 'estimated' (no
    // award) — must increment `awarded`'s COUNT but contribute nothing to `valueAwardedInr`.
    const estimatedAward = req({
      id: 'r4', createdAt: '2026-07-01T12:00:00.000Z', budget: 40_000,
      status: 'completed',
      statusHistory: [
        { status: 'sourcing', actor: 'A', at: '2026-07-01T12:00:00.000Z' },
        { status: 'pi_requested', actor: 'A', at: '2026-07-10T12:00:00.000Z' },
        { status: 'completed', actor: 'A', at: '2026-08-12T12:00:00.000Z' },
      ],
    });
    // Raised BEFORE the 4-month window (April) — must not leak into the earliest bucket (May).
    const outsideWindow = req({ id: 'r3', createdAt: '2026-04-01T12:00:00.000Z' });

    const awardInvite = invite({ requestId: 'r1', vendorId: 'v1', awarded: true, awardAmount: 500_000 });
    const byRequest = invitesByRequest([awardInvite]);

    const requests = [raisedOnly, raisedThenAwarded, estimatedAward, outsideWindow];
    const points = monthlyFlow(requests, byRequest, index, { now: NOW, months: 4 });
    const byMonth = Object.fromEntries(points.map(p => [p.month, p]));

    expect(points.map(p => p.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);

    expect(byMonth['2026-05']).toEqual({ month: '2026-05', raised: 1, awarded: 0, completed: 0, valueAwardedInr: 0 });
    expect(byMonth['2026-06']).toEqual({ month: '2026-06', raised: 1, awarded: 0, completed: 0, valueAwardedInr: 0 });
    expect(byMonth['2026-07']).toEqual({ month: '2026-07', raised: 1, awarded: 1, completed: 0, valueAwardedInr: 0 });
    expect(byMonth['2026-08']).toEqual({ month: '2026-08', raised: 0, awarded: 1, completed: 1, valueAwardedInr: 500_000 });

    // The April request must not appear in ANY bucket — total raised across the window is 3, not 4.
    expect(points.reduce((s, p) => s + p.raised, 0)).toBe(3);
  });
});
