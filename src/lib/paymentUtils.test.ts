import { describe, expect, it } from 'vitest';
import {
  fulfillmentReadyToComplete,
  awardUnitPriceInr,
  buildMilestonesFromVendor,
  inrQuoteGrandTotal,
  inrQuoteGrandTotalInclGst,
  ownsFulfillmentTrack,
  quoteGrandTotal,
  quoteGrandTotalInclGst,
  quoteGstAmount,
  resolveOrderValue,
  splitAwardInProgress,
  unawardedLineItemIds,
} from './paymentUtils';
import { inrRfqTotal, rfqGstAmount, rfqTotal } from './rfqUtils';
import { FX_TO_INR, toInr } from './currencyUtils';
import type { CapexLineItem, CapexRequest, Quote, RfqQuote, Vendor, VendorInvite } from './types';

describe('awardUnitPriceInr', () => {
  it('passes an INR amount through with rounding only', () => {
    expect(awardUnitPriceInr(1234.6, 'INR')).toBe('1235');
  });

  it('converts a foreign-currency amount to INR', () => {
    const usd = awardUnitPriceInr(100, 'USD');
    expect(usd).toBe(String(Math.round(toInr(100, 'USD'))));
    expect(Number(usd)).toBeGreaterThan(100);
  });

  it('treats an undefined currency as INR', () => {
    expect(awardUnitPriceInr(500, undefined)).toBe('500');
    expect(awardUnitPriceInr(500)).toBe('500');
  });

  it('returns a string', () => {
    expect(typeof awardUnitPriceInr(42, 'EUR')).toBe('string');
  });

  /**
   * The award price is decided ENTIRELY by which currency the caller pairs with the amount — the
   * helper cannot tell a mis-paired currency from a correct one, so a wrong argument is silent.
   *
   * The RFQ Final-Decision auto-fill (`RfqPanel.setFinalVendor`) reads its unit through `unitFor`,
   * which returns the LIVE counter-form value while sourcing is editing that vendor's column. It
   * used to pair that live figure with the STORED quote's currency (`inv.rfqQuote?.currency`) —
   * a counter typed in INR against a quote filed in USD was then converted a second time and the
   * inflated number was PERSISTED into `sourcingDecision.finalPrices`, from where `buildAwardGroups`
   * carries it into `awardAmount`, the purchase order and every payment milestone.
   *
   * These cases pin the two readings apart so the size of the error is on the record. The call site
   * itself is a React component and this repo has no React harness by design, so the correct pairing
   * (`currencyOf`, which switches to the form on the SAME `editingId === inv.id` branch `unitFor`
   * does) is verified by reading, not by this test.
   */
  it('a live INR counter paired with the stored foreign currency inflates the award by the FX rate', () => {
    const counteredUnitInr = 40_00_000; // sourcing counters in INR; the quote on file is USD 50,000

    const correct = awardUnitPriceInr(counteredUnitInr, 'INR'); // currency read from the live form
    const misPaired = awardUnitPriceInr(counteredUnitInr, 'USD'); // currency read from the stored quote

    expect(correct).toBe('4000000');
    expect(misPaired).toBe(String(Math.round(toInr(counteredUnitInr, 'USD'))));
    expect(Number(misPaired)).toBe(Number(correct) * FX_TO_INR.USD); // ~₹34.2 crore, ~85.5x
    expect(Number(misPaired)).toBeGreaterThan(Number(correct));
  });

  it('a genuinely foreign unit still converts — the fix is the pairing, not skipping conversion', () => {
    // Not editing: `unitFor` returns the stored USD unit and `currencyOf` returns the stored 'USD'.
    expect(awardUnitPriceInr(50_000, 'USD')).toBe(String(Math.round(toInr(50_000, 'USD'))));
  });
});

// ── resolveOrderValue: the PO / milestone basis shared by AccountsPanel and the public PO pages ──

const LINE: CapexLineItem = {
  id: 'li-1',
  description: 'Chiller',
  category: 'Machinery',
  quantity: '1',
  hsnCode: '8415', // 28% GST
};

const request = (over: Partial<CapexRequest> = {}): CapexRequest => ({
  id: 'r1',
  subject: 'Chiller',
  category: 'Machinery',
  quantity: '1',
  priority: 'medium',
  justification: '',
  techSpecs: { specifications: '', complianceStandards: '' },
  assignedTo: 'sourcing_member',
  status: 'accounts_processing',
  createdBy: 'Arjun Mehta',
  createdAt: '2026-08-01T00:00:00.000Z',
  lineItems: [LINE],
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

/** Negotiated: unit ₹80,00,000 × 1 + freight ₹2,00,000, HSN 8415 (28%) → ₹1,04,40,000. */
const NEGOTIATED: RfqQuote = {
  price: 8_000_000,
  linePrices: { 'li-1': 8_000_000 },
  freight: 200_000,
  currency: 'INR',
};

describe('resolveOrderValue', () => {
  it('uses the NEGOTIATED total, not the buyer’s budget estimate, on the single-vendor RFQ path', () => {
    // The reported bug: a ₹1.00 Cr estimate was used as the order value for a ₹1.044 Cr order.
    const req = request({ sourcingMode: 'rfq', finalVendorId: 'v1', budget: 10_000_000 });
    const inv = invite({ vendorId: 'v1', rfqQuote: NEGOTIATED });

    const amount = resolveOrderValue(req, [inv]);

    expect(amount).toBe(10_440_000);
    expect(amount).toBe(inrRfqTotal(NEGOTIATED, req.lineItems));
    expect(amount).not.toBe(req.budget);
  });

  it('matches what AccountsPanel shows internally (same resolveFinalVendor basis)', () => {
    const req = request({ sourcingMode: 'rfq', finalVendorId: 'v1', budget: 10_000_000 });
    const inv = invite({ vendorId: 'v1', rfqQuote: NEGOTIATED });

    // AccountsPanel's single-vendor track reads resolveFinalVendor(request, invites).amount.
    expect(resolveOrderValue(req, [inv])).toBe(inrRfqTotal(inv.rfqQuote, req.lineItems));
  });

  it('converts a foreign-currency quotation to INR', () => {
    const foreign: RfqQuote = { ...NEGOTIATED, currency: 'USD' };
    const req = request({ sourcingMode: 'rfq', finalVendorId: 'v1', budget: 10_000_000 });
    const inv = invite({ vendorId: 'v1', rfqQuote: foreign });

    const amount = resolveOrderValue(req, [inv]);

    expect(amount).toBe(toInr(rfqTotal(foreign, req.lineItems), 'USD'));
    expect(amount).toBeGreaterThan(rfqTotal(foreign, req.lineItems));
  });

  it('uses the award amount for a split-award track', () => {
    const req = request({ budget: 10_000_000 });
    const award = invite({ awarded: true, awardAmount: 9_440_000 });

    expect(resolveOrderValue(req, [award], award)).toBe(9_440_000);
  });

  it('falls back to the budget estimate ONLY when the finalized vendor has no quotation', () => {
    const req = request({ sourcingMode: 'rfq', finalVendorId: 'v1', budget: 10_000_000 });
    const inv = invite({ vendorId: 'v1' }); // no rfqQuote at all

    expect(resolveOrderValue(req, [inv])).toBe(10_000_000);
  });

  it('drives every payment milestone off the negotiated total', () => {
    const req = request({ sourcingMode: 'rfq', finalVendorId: 'v1', budget: 10_000_000 });
    const inv = invite({ vendorId: 'v1', rfqQuote: NEGOTIATED });
    const vendor: Vendor = {
      id: 'v1',
      vendorCode: 'VND-001',
      vendorName: 'Acme',
      category: 'Machinery',
      gstin: '',
      pan: '',
      contactName: 'A',
      contactEmail: 'a@example.com',
      paymentTerms: 'Net-30',
      bankName: '',
      accountNumber: '',
      ifsc: '',
      onboardedAt: '2026-01-01T00:00:00.000Z',
      paymentSplits: [
        { id: 'adv', label: 'Advance', percent: 30 },
        { id: 'disp', label: 'Dispatch', percent: 60 },
        { id: 'inst', label: 'Installation', percent: 10 },
      ],
    };

    const ms = buildMilestonesFromVendor(vendor, resolveOrderValue(req, [inv]));

    expect(ms.map(m => m.amount)).toEqual([3_132_000, 6_264_000, 1_044_000]);
  });
});

// ── Split-award progress: the escape that keeps the award surfaces alive mid-award (W1) ──

const LINE_2: CapexLineItem = {
  id: 'li-2',
  description: 'Compressor',
  category: 'Machinery',
  quantity: '1',
  hsnCode: '8415',
};

describe('unawardedLineItemIds', () => {
  it('returns every line when nothing is awarded yet', () => {
    expect(unawardedLineItemIds([LINE, LINE_2], [invite()])).toEqual(['li-1', 'li-2']);
  });

  it('excludes the lines an award already covers', () => {
    const awardA = invite({ id: 'i1', vendorId: 'v1', awarded: true, awardedItemIds: ['li-1'] });
    expect(unawardedLineItemIds([LINE, LINE_2], [awardA])).toEqual(['li-2']);
  });

  it('returns nothing once every line has a winner', () => {
    const awardA = invite({ id: 'i1', vendorId: 'v1', awarded: true, awardedItemIds: ['li-1'] });
    const awardB = invite({ id: 'i2', vendorId: 'v2', awarded: true, awardedItemIds: ['li-2'] });
    expect(unawardedLineItemIds([LINE, LINE_2], [awardA, awardB])).toEqual([]);
  });

  it('ignores awardedItemIds on an invite that was never awarded', () => {
    const stale = invite({ vendorId: 'v1', awardedItemIds: ['li-1'] }); // no `awarded` flag
    expect(unawardedLineItemIds([LINE, LINE_2], [stale])).toEqual(['li-1', 'li-2']);
  });
});

describe('splitAwardInProgress', () => {
  it('is false before any award (the panels are already visible via the status check)', () => {
    const quoted = invite({ vendorId: 'v1', rfqQuote: NEGOTIATED });
    expect(splitAwardInProgress([LINE, LINE_2], [quoted])).toBe(false);
  });

  it('is TRUE after the first of two vendors is awarded — the reported dead-end', () => {
    // Awarding vendor A bumps the request to `pi_requested`, which reads as "in fulfillment"
    // everywhere; without this escape the award bar vanishes and vendor B's line is never ordered.
    const awardA = invite({ id: 'i1', vendorId: 'v1', awarded: true, awardedItemIds: ['li-1'] });
    const pendingB = invite({ id: 'i2', vendorId: 'v2', rfqQuote: NEGOTIATED });
    expect(splitAwardInProgress([LINE, LINE_2], [awardA, pendingB])).toBe(true);
  });

  it('is false again once every line is awarded (a FINISHED award hides the panels)', () => {
    const awardA = invite({ id: 'i1', vendorId: 'v1', awarded: true, awardedItemIds: ['li-1'] });
    const awardB = invite({ id: 'i2', vendorId: 'v2', awarded: true, awardedItemIds: ['li-2'] });
    expect(splitAwardInProgress([LINE, LINE_2], [awardA, awardB])).toBe(false);
  });

  it('is false for a finished single-vendor award covering all lines', () => {
    const only = invite({ vendorId: 'v1', awarded: true, awardedItemIds: ['li-1', 'li-2'] });
    expect(splitAwardInProgress([LINE, LINE_2], [only])).toBe(false);
  });

  it('is false when the request has no line items at all', () => {
    const awardA = invite({ vendorId: 'v1', awarded: true, awardedItemIds: [] });
    expect(splitAwardInProgress([], [awardA])).toBe(false);
  });
});

// ── Fulfillment ownership: who may see the PI request, the PO and the payments (W6) ──

describe('ownsFulfillmentTrack', () => {
  it('grants the awarded vendor their own split-award track', () => {
    const award = invite({ vendorId: 'v1', awarded: true });
    expect(ownsFulfillmentTrack({ finalVendorId: undefined }, award)).toBe(true);
  });

  it('DENIES a losing vendor on an award-based request', () => {
    // The leak: the request sits at pi_requested for the winner, and this vendor was shown
    // "Upload Proforma Invoice" purely because request.status said so.
    const loser = invite({ id: 'i2', vendorId: 'v2' });
    expect(ownsFulfillmentTrack({ finalVendorId: undefined }, loser)).toBe(false);
  });

  it('grants the finalized vendor on the single-vendor request-level track', () => {
    const winner = invite({ vendorId: 'v1' });
    expect(ownsFulfillmentTrack({ finalVendorId: 'v1' }, winner)).toBe(true);
  });

  it('DENIES a losing vendor on the single-vendor track (the issued PO / trial leak)', () => {
    const loser = invite({ id: 'i2', vendorId: 'v2' });
    expect(ownsFulfillmentTrack({ finalVendorId: 'v1' }, loser)).toBe(false);
  });

  it('fails closed when no winner has been recorded', () => {
    expect(ownsFulfillmentTrack({ finalVendorId: undefined }, invite())).toBe(false);
    expect(ownsFulfillmentTrack({}, invite())).toBe(false);
  });

  it('the finalVendorId truthiness guard is load-bearing, not just the vendorId comparison', () => {
    // Every case above uses `vendorId: 'v1'` (the `invite()` default), so `'v1' === undefined` is
    // false whether or not `!!request.finalVendorId &&` is there — those cases can't tell the guard
    // apart from the bare equality check. Here BOTH sides are undefined: without the guard,
    // `invite.vendorId === request.finalVendorId` evaluates `undefined === undefined` → true,
    // wrongly granting a fulfillment track nobody actually owns.
    const noVendor = { awarded: false, vendorId: undefined as unknown as string };
    expect(ownsFulfillmentTrack({ finalVendorId: undefined }, noVendor)).toBe(false);
    expect(ownsFulfillmentTrack({}, noVendor)).toBe(false);
  });

  it('covers BOTH award shapes — an awarded invite wins even with a stale finalVendorId elsewhere', () => {
    const award = invite({ vendorId: 'v2', awarded: true });
    expect(ownsFulfillmentTrack({ finalVendorId: 'v1' }, award)).toBe(true);
  });
});

// ── One comparison basis for the approver: GST-inclusive, INR (W-B finding 3) ──
//
// `RequestQuotationView` renders on the PUBLIC plant-head approval page. It used to sum an
// `rfqQuote` through `inrRfqTotal` (GST-INCLUSIVE) and a buyer-seeded / auction `Quote` through
// `inrQuoteGrandTotal` (GST-EXCLUSIVE), then flag the minimum of that mixed list "Lowest".

const GST_LINE: CapexLineItem = {
  id: 'li-1',
  description: 'Moulding machine',
  category: 'Machinery',
  quantity: '1',
  hsnCode: '8479', // 18% GST
};

const quote = (over: Partial<Quote> = {}): Quote => ({
  id: 'q1',
  price: 8_500_000,
  itemPrices: { 'li-1': 8_500_000 },
  deliveryDays: 60,
  validUntil: '2026-12-31T00:00:00.000Z',
  submittedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

describe('quoteGstAmount / quoteGrandTotalInclGst — the Quote counterpart of rfqTotal', () => {
  it('taxes each line from its own HSN, and leaves footer charges untaxed', () => {
    const q = quote({ price: 8_500_000, freight: 200_000 });
    expect(quoteGstAmount(q, [GST_LINE])).toBe(1_530_000); // 18% of 85,00,000 only
    expect(quoteGrandTotal(q)).toBe(8_700_000); // GST-exclusive
    expect(quoteGrandTotalInclGst(q, [GST_LINE])).toBe(10_230_000);
  });

  it('multiplies the unit price by the line quantity', () => {
    const twoUp: CapexLineItem = { ...GST_LINE, quantity: '2' };
    const q = quote({ price: 17_000_000, itemPrices: { 'li-1': 8_500_000 } });
    expect(quoteGstAmount(q, [twoUp])).toBe(3_060_000); // 18% of 1,70,00,000
  });

  it('agrees with rfqGstAmount for the same prices — the two bases now match', () => {
    const q = quote({ price: 8_500_000, itemPrices: { 'li-1': 8_500_000 } });
    const asRfq: RfqQuote = { price: 8_500_000, linePrices: { 'li-1': 8_500_000 } };
    expect(quoteGstAmount(q, [GST_LINE])).toBe(rfqGstAmount(asRfq, [GST_LINE]));
  });

  it('yields no GST for a legacy lump-sum quote with no per-line prices', () => {
    const lump = quote({ price: 8_500_000, itemPrices: undefined });
    expect(quoteGstAmount(lump, [GST_LINE])).toBe(0);
    expect(quoteGrandTotalInclGst(lump, [GST_LINE])).toBe(quoteGrandTotal(lump));
  });

  it('yields no GST when the line carries no HSN code', () => {
    const noHsn: CapexLineItem = { ...GST_LINE, hsnCode: undefined };
    expect(quoteGstAmount(quote(), [noHsn])).toBe(0);
  });

  it('converts the GST-inclusive total to INR for a foreign-currency bid', () => {
    const usd = quote({ price: 100_000, itemPrices: { 'li-1': 100_000 }, currency: 'USD' });
    // 1,00,000 + 18% = 1,18,000 USD → INR
    expect(quoteGrandTotalInclGst(usd, [GST_LINE])).toBe(118_000);
    expect(inrQuoteGrandTotalInclGst(usd, [GST_LINE])).toBe(toInr(118_000, 'USD'));
  });

  it('is a no-op vs the GST-exclusive helper when there are no line items to tax', () => {
    const q = quote();
    expect(quoteGrandTotalInclGst(q, [])).toBe(quoteGrandTotal(q));
    expect(inrQuoteGrandTotalInclGst(q, [])).toBe(inrQuoteGrandTotal(q));
  });

  it('picks the genuinely cheaper offer once BOTH sides carry GST (the audit’s I5 case)', () => {
    // Vendor A — RFQ quotation, subtotal ₹80,00,000 @18% → ₹94,40,000 incl. GST.
    const rfq: RfqQuote = { price: 8_000_000, linePrices: { 'li-1': 8_000_000 }, currency: 'INR' };
    // Vendor B — buyer-seeded Quote, ₹85,00,000 → ₹1,00,30,000 incl. GST.
    const seeded = quote({ seededByBuyer: true });

    const aInr = inrRfqTotal(rfq, [GST_LINE]);
    const bInr = inrQuoteGrandTotalInclGst(seeded, [GST_LINE]);

    expect(aInr).toBe(9_440_000);
    expect(bInr).toBe(10_030_000);
    expect(aInr).toBeLessThan(bInr); // A is cheapest — B used to win on its untaxed ₹85,00,000

    // The old, mixed basis got it backwards.
    expect(inrQuoteGrandTotal(seeded)).toBeLessThan(aInr);
  });
});

describe('fulfillmentReadyToComplete — the PI re-upload is the last step', () => {
  const at = '2026-09-01T00:00:00.000Z';
  it('is not ready until the vendor re-uploads the PI against the PO', () => {
    expect(fulfillmentReadyToComplete({})).toBe(false);
    expect(fulfillmentReadyToComplete({ piReuploadedAt: at })).toBe(true);
  });
  it('waits for a required trial to be approved, whichever happens last', () => {
    expect(fulfillmentReadyToComplete({ piReuploadedAt: at, trialRequired: true, trialStatus: 'pending_review' })).toBe(false);
    expect(fulfillmentReadyToComplete({ piReuploadedAt: at, trialRequired: true, trialStatus: 'approved' })).toBe(true);
    expect(fulfillmentReadyToComplete({ trialRequired: true, trialStatus: 'approved' })).toBe(false);
  });
});
