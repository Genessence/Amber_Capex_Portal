import { describe, expect, it } from 'vitest';
import { delayLiabilityExposure, sourcingPerformance, vendorScorecard } from './kpiRisk';
import { masterIndex, invitesByRequest, DAY_MS } from './kpiUtils';
import type { CapexRequest, Vendor, VendorInvite } from './types';

const NOW = new Date('2026-08-15T00:00:00.000Z').getTime();
const iso = (d: number) => new Date(NOW - d * DAY_MS).toISOString();
const IDX = masterIndex([]);

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', subject: 'S', category: 'M', quantity: '1', priority: 'medium',
    justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'payment_in_progress',
    createdBy: 'Arjun Mehta', createdAt: iso(60), ...over,
  };
}
function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(30),
    auctionApprovalStatus: 'not_sent', ...over,
  };
}
const vendor = (id: string, vendorName: string): Vendor => ({
  id, vendorCode: id.toUpperCase(), vendorName, category: 'Machinery', gstin: '', pan: '',
  contactName: '', contactEmail: '', paymentTerms: 'Net-30', bankName: '', accountNumber: '',
  ifsc: '', onboardedAt: iso(200),
});

describe('delayLiabilityExposure', () => {
  it('accrues 0.5% per week after the one-week grace period', () => {
    // PI 5 weeks ago = 1 week grace + 4 late weeks = 2% of 10,00,000 = 20,000.
    const requests = [req({ piSubmittedAt: iso(35), budget: 1_000_000 })];
    const e = delayLiabilityExposure(requests, new Map(), IDX, NOW);
    expect(e.runningInr).toBe(20_000);
    expect(e.runningCount).toBe(1);
    expect(e.pastGraceCount).toBe(1);
  });

  it('counts a stopped clock as realised, not running', () => {
    const requests = [req({ status: 'completed', piSubmittedAt: iso(35), tatStoppedAt: iso(21), budget: 1_000_000 })];
    const e = delayLiabilityExposure(requests, new Map(), IDX, NOW);
    expect(e.runningInr).toBe(0);
    expect(e.realisedInr).toBeGreaterThan(0);
  });

  it('measures each award separately against its own award amount', () => {
    const requests = [req({ id: 'r1' })];
    const byRequest = invitesByRequest([
      invite({ id: 'i1', awarded: true, awardAmount: 1_000_000, piSubmittedAt: iso(35) }),
      invite({ id: 'i2', awarded: true, awardAmount: 2_000_000, piSubmittedAt: iso(35) }),
    ]);
    expect(delayLiabilityExposure(requests, byRequest, IDX, NOW).runningInr).toBe(60_000);
  });

  it('ignores tracks with no PI', () => {
    expect(delayLiabilityExposure([req({ piSubmittedAt: undefined })], new Map(), IDX, NOW).runningCount).toBe(0);
  });
});

describe('vendorScorecard', () => {
  it('computes response rate and median response time from invite to first supplier quote', () => {
    const vendors = [vendor('v1', 'Acme'), vendor('v2', 'Zeta')];
    const requests = [req({ id: 'r1', status: 'sourcing' })];
    const byRequest = invitesByRequest([
      invite({ id: 'i1', vendorId: 'v1', invitedAt: iso(10), rfqThread: [
        { id: 'm1', by: 'supplier', senderName: 'Acme', action: 'proposed', at: iso(6), quote: { price: 1 } },
      ] }),
      invite({ id: 'i2', vendorId: 'v1', invitedAt: iso(10) }),
      invite({ id: 'i3', vendorId: 'v2', invitedAt: iso(10) }),
    ]);
    const rows = vendorScorecard(vendors, requests, byRequest, IDX, NOW);
    const acme = rows.find(r => r.vendorId === 'v1')!;
    expect(acme.invited).toBe(2);
    expect(acme.quoted).toBe(1);
    expect(acme.responseRatePct).toBe(50);
    expect(acme.medianResponseDays).toBeCloseTo(4);
    expect(rows.find(r => r.vendorId === 'v2')!.medianResponseDays).toBeNull();
  });

  it('sums awarded value per vendor', () => {
    const vendors = [vendor('v1', 'Acme')];
    const requests = [req({ id: 'r1' })];
    const byRequest = invitesByRequest([
      invite({ id: 'i1', vendorId: 'v1', awarded: true, awardAmount: 500 }),
    ]);
    const row = vendorScorecard(vendors, requests, byRequest, IDX, NOW)[0];
    expect(row.awards).toBe(1);
    expect(row.awardedInr).toBe(500);
  });
});

describe('sourcingPerformance', () => {
  it('does NOT let a live, unawarded auction quote inflate auction effectiveness', () => {
    // openingBestPrice is set (an auction is configured) but nothing has been awarded yet — the
    // vendor's live bid must not be mistaken for a closed, comparable auction result.
    const requests = [req({
      id: 'r1',
      auctionConfig: { startedAt: iso(10), durationDays: 5, endsAt: iso(5), openingBestPrice: 1_000 },
    })];
    const byRequest = invitesByRequest([
      invite({
        id: 'i1', requestId: 'r1', vendorId: 'v1',
        quotes: [{ id: 'q1', price: 900, deliveryDays: 10, validUntil: iso(-10), submittedAt: iso(3) }],
      }),
    ]);
    const perf = sourcingPerformance(requests, byRequest, IDX, NOW, []);
    expect(perf.auctionSaved).toBe(0);
    expect(perf.auctionPct).toBeNull();
  });

  it('credits auction effectiveness once the request is actually awarded', () => {
    // Same shape as above, but this time the invite is awarded — value.basis becomes 'awarded'
    // and the opening-price comparison should now count.
    const requests = [req({
      id: 'r1',
      auctionConfig: { startedAt: iso(10), durationDays: 5, endsAt: iso(5), openingBestPrice: 1_000 },
    })];
    const byRequest = invitesByRequest([
      invite({
        id: 'i1', requestId: 'r1', vendorId: 'v1', awarded: true, awardAmount: 900,
        awardedItemIds: ['x'],
      }),
    ]);
    const perf = sourcingPerformance(requests, byRequest, IDX, NOW, []);
    expect(perf.auctionSaved).toBe(100);
    expect(perf.auctionPct).toBeCloseTo(10);
  });

  it('flags an award decided against only one quoting vendor', () => {
    const requests = [req({ id: 'r1' })];
    const byRequest = invitesByRequest([
      invite({
        id: 'i1', requestId: 'r1', vendorId: 'v1', awarded: true, awardAmount: 500,
        quotes: [{ id: 'q1', price: 500, deliveryDays: 10, validUntil: iso(-10), submittedAt: iso(5) }],
      }),
      // Invited but never quoted — must not count toward "quoting vendors" for this award.
      invite({ id: 'i2', requestId: 'r1', vendorId: 'v2', invitedAt: iso(10) }),
    ]);
    const perf = sourcingPerformance(requests, byRequest, IDX, NOW, []);
    expect(perf.awardCount).toBe(1);
    expect(perf.singleQuoteAwards).toBe(1);
  });

  it('does not flag a multi-quote award as single-quote', () => {
    const requests = [req({ id: 'r1' })];
    const byRequest = invitesByRequest([
      invite({
        id: 'i1', requestId: 'r1', vendorId: 'v1', awarded: true, awardAmount: 500,
        quotes: [{ id: 'q1', price: 500, deliveryDays: 10, validUntil: iso(-10), submittedAt: iso(5) }],
      }),
      invite({
        id: 'i2', requestId: 'r1', vendorId: 'v2',
        quotes: [{ id: 'q2', price: 600, deliveryDays: 10, validUntil: iso(-10), submittedAt: iso(5) }],
      }),
    ]);
    const perf = sourcingPerformance(requests, byRequest, IDX, NOW, []);
    expect(perf.awardCount).toBe(1);
    expect(perf.singleQuoteAwards).toBe(0);
  });

  it('measures the invite → first supplier quote cycle leg in days', () => {
    // invitedAt 10 days ago, first supplier quote 4 days ago = 6-day leg.
    const requests = [req({ id: 'r1' })];
    const byRequest = invitesByRequest([
      invite({
        id: 'i1', requestId: 'r1', vendorId: 'v1', invitedAt: iso(10),
        rfqThread: [
          { id: 'm1', by: 'supplier', senderName: 'Acme', action: 'proposed', at: iso(4), quote: { price: 1 } },
        ],
      }),
    ]);
    const perf = sourcingPerformance(requests, byRequest, IDX, NOW, []);
    expect(perf.firstQuote).toBe(6);
  });

  it('expresses negotiation savings as a % of first offer, over the comparable subset only', () => {
    // First offer 1000 -> final awarded 800 = 200 saved, 20% of the first offer.
    const requests = [req({ id: 'r1', finalVendorId: 'v1' })];
    const byRequest = invitesByRequest([
      invite({
        id: 'i1', requestId: 'r1', vendorId: 'v1', invitedAt: iso(20),
        rfqQuote: { price: 800, freight: 0, packing: 0, service: 0 },
        rfqThread: [
          {
            id: 'm1', by: 'supplier', senderName: 'Acme', action: 'proposed', at: iso(15),
            quote: { price: 1_000, freight: 0, packing: 0, service: 0 },
          },
        ],
      }),
    ]);
    const perf = sourcingPerformance(requests, byRequest, IDX, NOW, []);
    expect(perf.negotiation).toBe(200);
    expect(perf.negotiationPctOfFirstOffer).toBeCloseTo(20);
  });

  it('computes top-vendor and top-3 share of total awarded spend', () => {
    const vendors = [vendor('v1', 'Acme'), vendor('v2', 'Zeta')];
    const requests = [req({ id: 'r1' })];
    const byRequest = invitesByRequest([
      invite({ id: 'i1', requestId: 'r1', vendorId: 'v1', awarded: true, awardAmount: 700 }),
      invite({ id: 'i2', requestId: 'r1', vendorId: 'v2', awarded: true, awardAmount: 300 }),
    ]);
    const perf = sourcingPerformance(requests, byRequest, IDX, NOW, vendors);
    expect(perf.concentration.topVendorName).toBe('Acme');
    expect(perf.concentration.topVendorSharePct).toBeCloseTo(70);
    expect(perf.concentration.top3SharePct).toBeCloseTo(100);
  });

  it('reports spend concentration honestly (null, not 0%) when nothing has been awarded yet', () => {
    const perf = sourcingPerformance([], new Map(), IDX, NOW, []);
    expect(perf.concentration.totalAwardedInr).toBe(0);
    expect(perf.concentration.topVendorName).toBeNull();
    expect(perf.concentration.topVendorSharePct).toBeNull();
    expect(perf.concentration.top3SharePct).toBeNull();
  });

  it('computes mean vendors invited per award, null before any award exists', () => {
    const requests = [req({ id: 'r1' })];
    const byRequest = invitesByRequest([
      invite({ id: 'i1', requestId: 'r1', vendorId: 'v1', awarded: true, awardAmount: 500 }),
      invite({ id: 'i2', requestId: 'r1', vendorId: 'v2' }),
      invite({ id: 'i3', requestId: 'r1', vendorId: 'v3' }),
    ]);
    const perf = sourcingPerformance(requests, byRequest, IDX, NOW, []);
    expect(perf.awardCount).toBe(1);
    expect(perf.vendorsPerAward).toBe(3);

    expect(sourcingPerformance([], new Map(), IDX, NOW, []).vendorsPerAward).toBeNull();
  });
});
