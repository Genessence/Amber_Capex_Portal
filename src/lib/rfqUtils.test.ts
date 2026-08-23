import { describe, expect, it } from 'vitest';
import { rfqTotal, inrRfqTotal, lowestRfqTotal, rfqTaxableValue } from './rfqUtils';
import { toInr } from './currencyUtils';
import type { CapexLineItem, RfqQuote, VendorInvite } from './types';

const LINE: CapexLineItem = {
  id: 'li-1',
  description: 'Moulding machine',
  category: 'Machinery',
  quantity: '1',
  hsnCode: '8479', // 18% GST
};

/** The audit's worked example: $1,00,000 subtotal + $2,000 freight, 18% GST → $1,20,000. */
const FOREIGN_QUOTE: RfqQuote = {
  price: 100_000,
  linePrices: { 'li-1': 100_000 },
  freight: 2_000,
  currency: 'USD',
};

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

describe('rfqTotal vs inrRfqTotal — the ₹ / own-currency boundary', () => {
  it('rfqTotal stays in the vendor’s OWN currency (GST on lines, not on freight)', () => {
    expect(rfqTaxableValue(FOREIGN_QUOTE)).toBe(102_000);
    expect(rfqTotal(FOREIGN_QUOTE, [LINE])).toBe(120_000);
  });

  it('inrRfqTotal converts that same total to rupees', () => {
    // This is the figure Accounts consume (PI amount, order value, PO, milestones). Pre-filling the
    // PI field with `rfqTotal` under a "PI Amount (₹)" label understated a ₹1.03 Cr order as ₹1.2 L.
    expect(inrRfqTotal(FOREIGN_QUOTE, [LINE])).toBe(10_260_000);
    expect(inrRfqTotal(FOREIGN_QUOTE, [LINE])).toBe(toInr(120_000, 'USD'));
  });

  it('is a no-op for an INR quotation, so domestic vendors are unaffected', () => {
    const domestic: RfqQuote = { ...FOREIGN_QUOTE, currency: 'INR' };
    expect(inrRfqTotal(domestic, [LINE])).toBe(rfqTotal(domestic, [LINE]));
  });

  it('treats a missing currency as INR', () => {
    const noCurrency: RfqQuote = { price: 100_000, linePrices: { 'li-1': 100_000 } };
    expect(inrRfqTotal(noCurrency, [LINE])).toBe(rfqTotal(noCurrency, [LINE]));
  });

  it('picks the genuinely cheapest quotation across currencies', () => {
    const cheaperInInr = invite({
      id: 'iA',
      rfqQuote: { price: 8_000_000, linePrices: { 'li-1': 8_000_000 }, currency: 'INR' },
    });
    const dearerInInr = invite({ id: 'iB', rfqQuote: FOREIGN_QUOTE });

    // Raw face value would pick the USD quote (120,000 < 9,440,000) — INR basis picks correctly.
    expect(lowestRfqTotal([cheaperInInr, dearerInInr], [LINE])).toBe(9_440_000);
  });
});
