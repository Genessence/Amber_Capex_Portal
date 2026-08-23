import { describe, expect, it } from 'vitest';
import {
  computeVendorRankings,
  getL1Price,
  computeAuctionBestPrice,
  lowestInrUnitIndex,
  quoteLineUnitPrice,
} from './auctionUtils';
import { toInr } from './currencyUtils';
import type { Quote, VendorInvite } from './types';

const quote = (over: Partial<Quote> = {}): Quote => ({
  id: 'q1',
  price: 0,
  deliveryDays: 30,
  validUntil: '2026-12-31',
  submittedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const invite = (over: Partial<VendorInvite> = {}): VendorInvite => ({
  id: 'i1',
  requestId: 'r1',
  vendorId: 'v1',
  token: 't1',
  status: 'invited',
  quotes: [],
  negotiationThread: [],
  invitedAt: '2026-07-01T00:00:00.000Z',
  auctionApprovalStatus: 'not_sent',
  ...over,
});

describe('computeVendorRankings — currency basis', () => {
  it('ranks a foreign bid at its INR value, not its face value', () => {
    // The reported bug: vendor B bids $1,00,000 (= ₹85,50,000) against vendor A's ₹80,00,000.
    // Ranking on the raw number made B "L1" at "₹1,00,000" while A was genuinely cheaper.
    const a = invite({ id: 'iA', vendorId: 'vA', quotes: [quote({ price: 8_000_000, currency: 'INR' })] });
    const b = invite({ id: 'iB', vendorId: 'vB', quotes: [quote({ price: 100_000, currency: 'USD' })] });

    const ranks = computeVendorRankings([a, b]);

    expect(ranks.map(r => r.inviteId)).toEqual(['iA', 'iB']);
    expect(ranks[0].rank).toBe(1);
    expect(ranks[1].rank).toBe(2);
    expect(ranks[1].price).toBe(toInr(100_000, 'USD'));
    expect(ranks[1].price).toBeGreaterThan(ranks[0].price);
  });

  it('keeps the vendor’s own-currency figure alongside the INR basis for display', () => {
    const b = invite({ id: 'iB', vendorId: 'vB', quotes: [quote({ price: 100_000, currency: 'USD' })] });

    const [row] = computeVendorRankings([b]);

    expect(row.nativePrice).toBe(100_000);
    expect(row.currency).toBe('USD');
    expect(row.price).toBe(toInr(100_000, 'USD'));
  });

  it('treats a quote with no currency as INR', () => {
    const a = invite({ id: 'iA', vendorId: 'vA', quotes: [quote({ price: 500_000 })] });

    const [row] = computeVendorRankings([a]);

    expect(row.price).toBe(500_000);
    expect(row.nativePrice).toBe(500_000);
    expect(row.currency).toBe('INR');
  });

  it('ranks the vendor’s LATEST bid and ignores earlier ones', () => {
    const a = invite({ id: 'iA', vendorId: 'vA', quotes: [quote({ price: 9_000_000 }), quote({ id: 'q2', price: 7_000_000 })] });
    const b = invite({ id: 'iB', vendorId: 'vB', quotes: [quote({ id: 'q3', price: 8_000_000 })] });

    expect(computeVendorRankings([a, b]).map(r => r.inviteId)).toEqual(['iA', 'iB']);
  });

  it('never ranks a vendor who has not bid (a seeded openingQuote is not a bid)', () => {
    const seeded = invite({ id: 'iS', quotes: [], openingQuote: quote({ price: 1_000_000 }) });

    expect(computeVendorRankings([seeded])).toEqual([]);
  });

  it('ranks on the BASE SUBTOTAL, not the whole quote (charges excluded)', () => {
    // A has the lower subtotal but higher freight; the ranking basis is deliberately the subtotal.
    const a = invite({ id: 'iA', vendorId: 'vA', quotes: [quote({ price: 7_000_000, freight: 900_000 })] });
    const b = invite({ id: 'iB', vendorId: 'vB', quotes: [quote({ id: 'q2', price: 7_500_000, freight: 0 })] });

    const ranks = computeVendorRankings([a, b]);

    expect(ranks[0].inviteId).toBe('iA');
    expect(ranks[0].price).toBe(7_000_000);
  });

  it('exposes an INR L1 price that gap-to-L1 arithmetic can use directly', () => {
    const a = invite({ id: 'iA', vendorId: 'vA', quotes: [quote({ price: 8_000_000, currency: 'INR' })] });
    const b = invite({ id: 'iB', vendorId: 'vB', quotes: [quote({ id: 'q2', price: 100_000, currency: 'USD' })] });

    const ranks = computeVendorRankings([a, b]);
    const l1 = getL1Price(ranks);

    expect(l1).toBe(8_000_000);
    expect(ranks[1].price - l1!).toBe(toInr(100_000, 'USD') - 8_000_000);
  });

  it('returns null L1 when nobody has bid', () => {
    expect(getL1Price(computeVendorRankings([invite()]))).toBeNull();
  });

  it('agrees with computeAuctionBestPrice about which vendor is cheapest', () => {
    // Both helpers must pick the same winner; before the fix the ranking said USD, the best price
    // (already INR-normalised) said INR, and the two surfaces contradicted each other.
    const a = invite({ id: 'iA', vendorId: 'vA', quotes: [quote({ price: 8_000_000, currency: 'INR' })] });
    const b = invite({ id: 'iB', vendorId: 'vB', quotes: [quote({ id: 'q2', price: 100_000, currency: 'USD' })] });

    const ranks = computeVendorRankings([a, b]);
    const best = computeAuctionBestPrice([a, b]);

    expect(ranks[0].inviteId).toBe('iA');
    expect(best).toBe(8_000_000);
    expect(getL1Price(ranks)).toBe(best);
  });
});

// ── Per-line "↓ Lowest" in the comparison grid (W-B finding 1) ──
//
// This index drives the emerald highlight AND, through the Final-Decision vendor picker, which
// vendor's price is auto-filled onto the award. Comparing raw quoted units handed both to
// whichever vendor quoted in the smallest-numbered currency.

describe('quoteLineUnitPrice', () => {
  it('reads the per-line price when the bid was priced line by line', () => {
    expect(quoteLineUnitPrice(quote({ price: 9_000_000, itemPrices: { 'li-1': 4_000_000 } }), 'li-1')).toBe(4_000_000);
  });

  it('falls back to the whole-quote price for a legacy bid with no per-line prices', () => {
    expect(quoteLineUnitPrice(quote({ price: 4_000_000 }), 'li-1')).toBe(4_000_000);
  });

  it('falls back for a line the bid did not price', () => {
    expect(quoteLineUnitPrice(quote({ price: 4_000_000, itemPrices: { 'li-2': 1 } }), 'li-1')).toBe(4_000_000);
  });

  it('is null with no quote at all', () => {
    expect(quoteLineUnitPrice(null, 'li-1')).toBeNull();
    expect(quoteLineUnitPrice(undefined, 'li-1')).toBeNull();
  });
});

describe('lowestInrUnitIndex', () => {
  it('picks the vendor who is cheapest in RUPEES, not the smallest raw number', () => {
    // Audit I8: line 1, vendor A ₹40,00,000 vs vendor B $50,000 (= ₹42,75,000). A is cheaper.
    const a = quote({ id: 'qA', price: 4_000_000, itemPrices: { 'li-1': 4_000_000 }, currency: 'INR' });
    const b = quote({ id: 'qB', price: 50_000, itemPrices: { 'li-1': 50_000 }, currency: 'USD' });

    expect(lowestInrUnitIndex([a, b], 'li-1')).toBe(0);
    // The raw comparison the grid used to make would have said 1 (50,000 < 40,00,000).
    expect(b.itemPrices!['li-1']).toBeLessThan(a.itemPrices!['li-1']);
  });

  it('still picks a foreign vendor when they really are cheaper', () => {
    const a = quote({ price: 4_000_000, itemPrices: { 'li-1': 4_000_000 }, currency: 'INR' });
    const b = quote({ price: 40_000, itemPrices: { 'li-1': 40_000 }, currency: 'USD' }); // ₹34,20,000

    expect(lowestInrUnitIndex([a, b], 'li-1')).toBe(1);
  });

  it('ignores columns with no bid, and keeps the surviving column’s index', () => {
    const b = quote({ price: 4_000_000, itemPrices: { 'li-1': 4_000_000 } });
    expect(lowestInrUnitIndex([null, b, undefined], 'li-1')).toBe(1);
  });

  it('is null when nobody has bid on the line', () => {
    expect(lowestInrUnitIndex([null, undefined], 'li-1')).toBeNull();
    expect(lowestInrUnitIndex([], 'li-1')).toBeNull();
  });

  it('keeps the FIRST column on an exact tie, so the highlight does not jump', () => {
    const a = quote({ id: 'qA', price: 4_000_000, itemPrices: { 'li-1': 4_000_000 } });
    const b = quote({ id: 'qB', price: 4_000_000, itemPrices: { 'li-1': 4_000_000 } });
    expect(lowestInrUnitIndex([a, b], 'li-1')).toBe(0);
  });

  it('treats a missing currency as INR, so domestic-only grids are unchanged', () => {
    const a = quote({ price: 5_000_000, itemPrices: { 'li-1': 5_000_000 } });
    const b = quote({ price: 4_000_000, itemPrices: { 'li-1': 4_000_000 } });
    expect(lowestInrUnitIndex([a, b], 'li-1')).toBe(1);
  });
});
