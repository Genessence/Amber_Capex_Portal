import { describe, expect, it } from 'vitest';
import { ALLOWED_TRANSITIONS, PRE_PI_REQUEST_STATUSES, canTransitionStatus } from './statusFlow';
import { CAPEX_STATUS_FLOW } from './types';
import type { CapexStatus } from './types';

describe('canTransitionStatus', () => {
  it('allows a declared edge', () => {
    expect(canTransitionStatus('pending_head_approval', 'sourcing')).toBe(true);
  });

  it('refuses an undeclared edge', () => {
    expect(canTransitionStatus('sourcing', 'completed')).toBe(false);
  });

  it('treats a no-op as allowed (updateRequest only validates a CHANGE of status)', () => {
    expect(canTransitionStatus('payment_in_progress', 'payment_in_progress')).toBe(true);
    expect(canTransitionStatus('completed', 'completed')).toBe(true);
  });

  it('refuses every outgoing move from the terminal states', () => {
    for (const to of CAPEX_STATUS_FLOW) {
      if (to !== 'completed') expect(canTransitionStatus('completed', to)).toBe(false);
      if (to !== 'rejected') expect(canTransitionStatus('rejected', to)).toBe(false);
    }
  });
});

// ── W3: the comparison grid's Reject control targets `rejected` from wherever the grid renders ──

describe('rejection edges', () => {
  it('allows sourcing → rejected (the grid Reject button ran here and silently no-op’d)', () => {
    expect(canTransitionStatus('sourcing', 'rejected')).toBe(true);
  });

  it('allows buyer_approved → rejected (same control, legacy state, same silent no-op)', () => {
    expect(canTransitionStatus('buyer_approved', 'rejected')).toBe(true);
  });

  it('lets every pre-fulfillment status be rejected', () => {
    const preFulfillment: CapexStatus[] = [
      'pending_head_approval',
      'sourcing',
      'negotiation',
      'sourcing_approved',
      'buyer_approved',
      'pi_requested',
      'pi_submitted',
      'accounts_processing',
    ];
    for (const from of preFulfillment) {
      expect(canTransitionStatus(from, 'rejected')).toBe(true);
    }
  });

  it('still refuses payment_in_progress → rejected — money has moved, so cancelling is a governance decision, not a status hop', () => {
    // Deliberately NOT added. The UI must ask `canTransitionStatus` and say so, rather than
    // toast "Request rejected" over a request that is still being paid.
    expect(canTransitionStatus('payment_in_progress', 'rejected')).toBe(false);
  });
});

// ── W2: an approval that strands a request is a bug in the map, not just the UI ──

describe('award reachability', () => {
  it('every pre-PI status the award paths accept can actually reach pi_requested', () => {
    for (const from of PRE_PI_REQUEST_STATUSES) {
      expect(canTransitionStatus(from, 'pi_requested')).toBe(true);
    }
  });

  it('sourcing_approved and buyer_approved are not dead ends', () => {
    // The legacy grid footer parks requests here; both must still reach fulfillment.
    expect(ALLOWED_TRANSITIONS.sourcing_approved.length).toBeGreaterThan(0);
    expect(ALLOWED_TRANSITIONS.buyer_approved.length).toBeGreaterThan(0);
  });

  it('leaves no non-terminal status without an outgoing edge', () => {
    for (const status of CAPEX_STATUS_FLOW) {
      if (status === 'completed' || status === 'rejected') continue;
      expect(ALLOWED_TRANSITIONS[status].length).toBeGreaterThan(0);
    }
  });

  it('names only real statuses on both sides of every edge', () => {
    const known = new Set<string>(CAPEX_STATUS_FLOW);
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      expect(known.has(from)).toBe(true);
      for (const to of targets) expect(known.has(to)).toBe(true);
    }
  });
});
