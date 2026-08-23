import { describe, expect, it } from 'vitest';
import { incoTermsBlocksAward, incoTermsNegotiationOpen } from './incoTermsUtils';
import type { IncoTermsStatus, VendorInvite } from './types';

const invite = (incoTermsStatus?: IncoTermsStatus): VendorInvite => ({
  id: 'i1',
  requestId: 'r1',
  vendorId: 'v1',
  token: 't1',
  status: 'invited',
  quotes: [],
  negotiationThread: [],
  invitedAt: '2026-07-01T00:00:00.000Z',
  auctionApprovalStatus: 'not_sent',
  ...(incoTermsStatus ? { incoTermsStatus } : {}),
});

// `incoTermsNegotiationOpen` is the predicate the award mutations hard-block on. It has to be
// narrower than `incoTermsBlocksAward`, because the wider one is satisfiable only on the RFQ path.

describe('incoTermsNegotiationOpen', () => {
  it('blocks while the agreement is with sourcing', () => {
    expect(incoTermsNegotiationOpen(invite('pending_sourcing'))).toBe(true);
  });

  it('blocks while the agreement is back with the vendor', () => {
    expect(incoTermsNegotiationOpen(invite('pending_vendor'))).toBe(true);
  });

  it('blocks a rejected agreement', () => {
    expect(incoTermsNegotiationOpen(invite('rejected'))).toBe(true);
  });

  it('does not block once the terms are approved', () => {
    expect(incoTermsNegotiationOpen(invite('approved'))).toBe(false);
  });

  it('does not block a domestic vendor, who never has an agreement', () => {
    expect(incoTermsNegotiationOpen(invite())).toBe(false);
    expect(incoTermsNegotiationOpen(invite('not_sent'))).toBe(false);
  });

  it('does NOT block at awaiting_vendor — a foreign vendor seeded into a reverse auction is left there forever, and the auction bid form never collects Incoterms', () => {
    // Blocking here would make that vendor permanently unawardable with no UI to settle it:
    // a missing gate replaced by a dead end. On the RFQ path the questionnaire is submitted
    // atomically with the quotation, so a vendor who has quoted is never at `awaiting_vendor`.
    expect(incoTermsNegotiationOpen(invite('awaiting_vendor'))).toBe(false);
    expect(incoTermsBlocksAward(invite('awaiting_vendor'))).toBe(true);
  });

  it('is a strict subset of incoTermsBlocksAward', () => {
    const statuses: IncoTermsStatus[] = [
      'not_sent',
      'awaiting_vendor',
      'pending_sourcing',
      'pending_vendor',
      'approved',
      'rejected',
    ];
    for (const s of statuses) {
      const inv = invite(s);
      if (incoTermsNegotiationOpen(inv)) expect(incoTermsBlocksAward(inv)).toBe(true);
    }
  });
});
