import { describe, expect, it } from 'vitest';
import {
  ageInDays, oldestAgeDays, statusHistoryOf, stageDurations,
  firstReachedAt, median, medianStageDays, invitesByRequest, DAY_MS,
  masterIndex, allocatedForRequest, requestValue, paidForRequest,
  poIssuedForRequest, offerForItems, savingsForRequest,
  ballHolders, percentile, stageDaysPercentiles, agingBuckets, stageDaySample, statusTally,
} from './kpiUtils';
import { buildAwardGroups } from './paymentUtils';
import { toInr } from './currencyUtils';
import type {
  CapexRequest, VendorInvite, CapexMasterItem, PaymentMilestone, CapexLineItem,
  PurchaseOrder,
} from './types';

const NOW = new Date('2026-08-15T00:00:00.000Z').getTime();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', subject: 'Chiller', category: 'Machinery', quantity: '1',
    priority: 'medium', justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing',
    createdBy: 'Arjun Mehta', createdAt: iso(10),
    ...over,
  };
}

function master(over: Partial<CapexMasterItem> = {}): CapexMasterItem {
  return {
    id: 'm1', plant: 'jhajjar_p1', head: 'Machinery', department: 'Prod',
    subParticulars: 'Chiller', rate: 0, totalCost: 2, fy: '2026-27',
    fieldType: 'brown_field', projectType: 'rac',
    ...over,
  };
}

function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't1', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(6), auctionApprovalStatus: 'not_sent',
    ...over,
  };
}

const line = (id: string, quantity = '1', hsnCode?: string): CapexLineItem =>
  ({ id, description: id, category: 'Machinery', quantity, hsnCode });

const po = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po1', poNumber: 'PO-1', vendorId: 'v1', amount: 1000,
  createdAt: iso(2), createdBy: 'Satish', ...over,
});

describe('ageInDays', () => {
  it('returns whole and fractional days since the timestamp', () => {
    expect(ageInDays(iso(3), NOW)).toBeCloseTo(3);
  });
  it('returns null for missing or unparseable input', () => {
    expect(ageInDays(undefined, NOW)).toBeNull();
    expect(ageInDays('not-a-date', NOW)).toBeNull();
  });
  it('never returns a negative age for a future timestamp', () => {
    expect(ageInDays(new Date(NOW + DAY_MS).toISOString(), NOW)).toBe(0);
  });
});

describe('oldestAgeDays', () => {
  it('returns the largest age and ignores missing entries', () => {
    expect(oldestAgeDays([iso(1), undefined, iso(7)], NOW)).toBeCloseTo(7);
  });
  it('returns null when nothing is datable', () => {
    expect(oldestAgeDays([undefined], NOW)).toBeNull();
  });
});

describe('statusHistoryOf', () => {
  it('synthesises a single entry when history is absent (legacy records)', () => {
    const r = req({ statusHistory: undefined });
    expect(statusHistoryOf(r)).toEqual([
      { status: 'sourcing', actor: 'Arjun Mehta', at: r.createdAt },
    ]);
  });
});

describe('stageDurations', () => {
  it('measures each stage up to the next transition', () => {
    const r = req({
      status: 'sourcing',
      statusHistory: [
        { status: 'submitted', actor: 'A', at: iso(10) },
        { status: 'pending_head_approval', actor: 'A', at: iso(8) },
        { status: 'sourcing', actor: 'B', at: iso(5) },
      ],
    });
    const d = stageDurations(r, NOW);
    expect(d.map(x => Math.round(x.ms / DAY_MS))).toEqual([2, 3, 5]);
    expect(d[2].open).toBe(true);
  });

  it('does not accrue time on a terminal final stage', () => {
    const r = req({
      status: 'completed',
      statusHistory: [
        { status: 'sourcing', actor: 'B', at: iso(9) },
        { status: 'completed', actor: 'B', at: iso(4) },
      ],
    });
    const d = stageDurations(r, NOW);
    expect(Math.round(d[0].ms / DAY_MS)).toBe(5);
    expect(d[1].ms).toBe(0);
    expect(d[1].open).toBe(false);
  });
});

describe('medianStageDays', () => {
  it('medians only requests that reached the end status, and counts the rest as open', () => {
    const done = (from: number, to: number) => req({
      statusHistory: [
        { status: 'sourcing', actor: 'B', at: iso(from) },
        { status: 'pi_requested', actor: 'B', at: iso(to) },
      ],
    });
    const open = req({ statusHistory: [{ status: 'sourcing', actor: 'B', at: iso(20) }] });
    const r = medianStageDays([done(10, 6), done(10, 2), open], 'sourcing', 'pi_requested');
    expect(r.medianDays).toBeCloseTo(6);
    expect(r.sampled).toBe(2);
    expect(r.stillOpen).toBe(1);
  });

  it('returns a null median when nothing qualifies', () => {
    expect(medianStageDays([], 'sourcing', 'completed').medianDays).toBeNull();
  });
});

describe('median', () => {
  it('averages the middle pair for an even-length set', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('invitesByRequest', () => {
  it('groups invites by their requestId', () => {
    const inv = (id: string, requestId: string) => ({ id, requestId } as VendorInvite);
    const m = invitesByRequest([inv('i1', 'r1'), inv('i2', 'r1'), inv('i3', 'r2')]);
    expect(m.get('r1')?.map(i => i.id)).toEqual(['i1', 'i2']);
    expect(m.get('r2')?.map(i => i.id)).toEqual(['i3']);
    expect(m.get('nope')).toBeUndefined();
  });
});

describe('allocatedForRequest', () => {
  it('sums linked master totalCost in Cr and converts to INR', () => {
    const idx = masterIndex([master({ id: 'm1', totalCost: 2 }), master({ id: 'm2', totalCost: 0.5 })]);
    const r = req({
      lineItems: [
        { id: 'l1', masterItemId: 'm1', description: 'A', category: 'M', quantity: '1' },
        { id: 'l2', masterItemId: 'm2', description: 'B', category: 'M', quantity: '1' },
      ],
    });
    expect(allocatedForRequest(r, idx)).toBe(2.5 * 1_00_00_000);
  });

  it('falls back to the request-level master link when there are no line items', () => {
    const idx = masterIndex([master({ id: 'm9', totalCost: 1 })]);
    expect(allocatedForRequest(req({ masterItemId: 'm9' }), idx)).toBe(1_00_00_000);
  });

  it('returns 0 when nothing is linked', () => {
    expect(allocatedForRequest(req(), masterIndex([]))).toBe(0);
  });
});

describe('requestValue', () => {
  const idx = masterIndex([master({ id: 'm1', totalCost: 3 })]);

  it('prefers the sum of award amounts on an award-based request', () => {
    const v = requestValue(req(), [
      invite({ id: 'i1', awarded: true, awardAmount: 400 }),
      invite({ id: 'i2', awarded: true, awardAmount: 600 }),
      invite({ id: 'i3' }),
    ], idx);
    expect(v).toEqual({ inr: 1000, basis: 'awarded' });
  });

  it('uses the finalized vendor RFQ quotation when there is no split award', () => {
    const r = req({ finalVendorId: 'v1', sourcingMode: 'rfq' });
    const v = requestValue(r, [invite({ rfqQuote: { price: 900, freight: 100 }, rfqStatus: 'approved' })], idx);
    expect(v).toEqual({ inr: 1000, basis: 'awarded' });
  });

  it('uses an approved quotation when no vendor has been finalized yet', () => {
    // Order 3 of the chain: no split award, no finalVendorId, but a quotation both sides agreed.
    const v = requestValue(req(), [
      invite({ id: 'i1', rfqQuote: { price: 1200, freight: 50, currency: 'INR' }, rfqStatus: 'approved' }),
      invite({ id: 'i2', rfqQuote: { price: 400, currency: 'INR' }, rfqStatus: 'pending_sourcing' }),
    ], idx);
    // The approved quote wins outright — it is NOT the lowest live offer (400 is).
    expect(v).toEqual({ inr: 1250, basis: 'approved' });
  });

  it('converts an approved foreign-currency quotation to INR', () => {
    const v = requestValue(req(), [
      invite({ rfqQuote: { price: 1000, currency: 'USD' }, rfqStatus: 'approved' }),
    ], idx);
    expect(v.basis).toBe('approved');
    expect(v.inr).toBe(toInr(1000, 'USD'));
  });

  it('falls back to the lowest live offer, on an INR basis', () => {
    const v = requestValue(req(), [
      invite({ id: 'i1', rfqQuote: { price: 1000, currency: 'INR' }, rfqStatus: 'pending_sourcing' }),
      invite({ id: 'i2', rfqQuote: { price: 900, currency: 'INR' }, rfqStatus: 'pending_sourcing' }),
    ], idx);
    expect(v.basis).toBe('quoted');
    expect(v.inr).toBe(900);
  });

  it('falls back to the estimate, then the allocation, then zero', () => {
    expect(requestValue(req({ budget: 750 }), [], idx)).toEqual({ inr: 750, basis: 'estimated' });
    const linked = req({ lineItems: [{ id: 'l1', masterItemId: 'm1', description: 'A', category: 'M', quantity: '1' }] });
    expect(requestValue(linked, [], idx)).toEqual({ inr: 3 * 1_00_00_000, basis: 'allocated' });
    expect(requestValue(req(), [], masterIndex([]))).toEqual({ inr: 0, basis: 'none' });
  });
});

describe('paidForRequest', () => {
  const ms = (amount: number, status: PaymentMilestone['status']): PaymentMilestone =>
    ({ id: `pm${amount}`, label: 'x', percent: 10, amount, status });

  it('sums paid milestones across awards when the request is award-based', () => {
    const total = paidForRequest(req(), [
      invite({ id: 'i1', awarded: true, paymentMilestones: [ms(100, 'paid'), ms(50, 'pending')] }),
      invite({ id: 'i2', awarded: true, paymentMilestones: [ms(200, 'paid')] }),
    ]);
    expect(total).toBe(300);
  });

  it('uses request-level milestones for a single-vendor request', () => {
    expect(paidForRequest(req({ paymentMilestones: [ms(75, 'paid'), ms(25, 'pending')] }), [])).toBe(75);
  });
});

describe('poIssuedForRequest', () => {
  it('counts a request-level PO only once Global Accounts has issued it', () => {
    expect(poIssuedForRequest(req({ purchaseOrder: po({ amount: 5000 }) }), [])).toBe(0);
    expect(
      poIssuedForRequest(req({ purchaseOrder: po({ amount: 5000, issuedAt: iso(1) }) }), []),
    ).toBe(5000);
    expect(poIssuedForRequest(req(), [])).toBe(0);
  });

  it('sums only the issued POs across awards on an award-based request', () => {
    const total = poIssuedForRequest(req(), [
      invite({ id: 'i1', awarded: true, purchaseOrder: po({ amount: 3000, issuedAt: iso(2) }) }),
      // Drafted by Satish but not issued yet — not a commitment to the vendor.
      invite({ id: 'i2', awarded: true, purchaseOrder: po({ id: 'po2', amount: 7000 }) }),
      invite({ id: 'i3', awarded: true }),
      // Not awarded — must not contribute even with an issued PO on the record.
      invite({ id: 'i4', purchaseOrder: po({ id: 'po4', amount: 9999, issuedAt: iso(1) }) }),
    ]);
    expect(total).toBe(3000);
  });
});

describe('offerForItems', () => {
  it('sums unit x qty for the given items only, ignoring unlisted ones', () => {
    const items = [line('l1', '2'), line('l2', '3')];
    expect(offerForItems({ l1: 100, l2: 50 }, ['l1'], items, 'INR')).toBe(200);
  });

  it('converts a foreign-currency offer to INR', () => {
    const items = [line('l1')];
    const inr = offerForItems({ l1: 100 }, ['l1'], items, 'USD');
    expect(inr).toBeGreaterThan(100);
  });

  it('treats an unpriced item as zero rather than throwing', () => {
    expect(offerForItems({}, ['l1'], [line('l1')], 'INR')).toBe(0);
  });

  it('folds in item-wise GST from the line HSN code, exactly as buildAwardGroups does', () => {
    // 8415 (air-conditioning machines) = 28%. 100 x 2 = 200 taxable + 56 GST.
    const items = [line('l1', '2', '8415')];
    expect(offerForItems({ l1: 100 }, ['l1'], items, 'INR')).toBe(256);
    // The award side computes the same figure from the Final Decision price.
    expect(buildAwardGroups(items, { 'l1-price': '100', 'l1-disc': '0' }, { l1: 'v1' })[0].amount)
      .toBe(256);
  });

  it('applies GST before the FX conversion so both sides stay on one basis', () => {
    const items = [line('l1', '1', '8415')];
    expect(offerForItems({ l1: 100 }, ['l1'], items, 'USD')).toBe(toInr(128, 'USD'));
  });
});

describe('savingsForRequest', () => {
  const idx = masterIndex([master({ id: 'm1', totalCost: 0.01 })]); // ₹1,00,000

  it('returns null when the request has not been awarded or approved', () => {
    const r = req({ lineItems: [line('l1')] });
    expect(savingsForRequest(r, [invite({ rfqQuote: { price: 500 }, rfqStatus: 'pending_sourcing' })], idx)).toBeNull();
  });

  it('measures single-vendor negotiation from the first supplier quotation to the final', () => {
    const r = req({ finalVendorId: 'v1', sourcingMode: 'rfq', lineItems: [line('l1')] });
    const inv = invite({
      rfqStatus: 'approved',
      rfqQuote: { price: 800, currency: 'INR' },
      rfqThread: [
        { id: 'm1', by: 'supplier', senderName: 'V', action: 'proposed', at: iso(5), quote: { price: 1000, currency: 'INR' } },
        { id: 'm2', by: 'sourcing', senderName: 'S', action: 'countered', at: iso(4), quote: { price: 800, currency: 'INR' } },
      ],
    });
    const s = savingsForRequest(r, [inv], idx);
    expect(s?.negotiation).toBe(200);
    expect(s?.negotiationComparable).toBe(true);
  });

  it('measures split-award negotiation per vendor, restricted to that vendor awarded lines', () => {
    const r = req({ lineItems: [line('l1'), line('l2')] });
    const inv = invite({
      awarded: true, awardedItemIds: ['l1'], awardAmount: 700,
      rfqThread: [
        { id: 'm1', by: 'supplier', senderName: 'V', action: 'proposed', at: iso(5),
          quote: { price: 1500, linePrices: { l1: 1000, l2: 500 }, currency: 'INR' } },
      ],
    });
    // Only l1 counts on both sides: 1000 offered vs 700 awarded.
    expect(savingsForRequest(r, [inv], idx)?.negotiation).toBe(300);
  });

  it('flags negotiation as not comparable when there is no first offer to compare against', () => {
    const r = req({ lineItems: [line('l1')] });
    const inv = invite({ awarded: true, awardedItemIds: ['l1'], awardAmount: 700 });
    const s = savingsForRequest(r, [inv], idx);
    expect(s?.negotiation).toBe(0);
    expect(s?.negotiationComparable).toBe(false);
  });

  it('measures budget savings against the linked master allocation', () => {
    const r = req({
      lineItems: [{ ...line('l1'), masterItemId: 'm1' }],
    });
    const inv = invite({ awarded: true, awardedItemIds: ['l1'], awardAmount: 60_000 });
    const s = savingsForRequest(r, [inv], idx);
    expect(s?.budget).toBe(40_000);
    expect(s?.budgetComparable).toBe(true);
  });

  it('flags budget as not comparable with no allocation and no estimate', () => {
    const r = req({ lineItems: [line('l1')] });
    const inv = invite({ awarded: true, awardedItemIds: ['l1'], awardAmount: 700 });
    expect(savingsForRequest(r, [inv], idx)?.budgetComparable).toBe(false);
  });

  /**
   * Regression — `awardAmount` must be INR on BOTH award paths.
   *
   * This is a CONTRACT test for the downstream invariants, not coverage of the write-side call
   * sites (`VendorGrid.onSetFinalVendor` / `RfqPanel.setFinalVendor` — this file cannot see either
   * component; the repo has no jsdom/RTL harness). It pins three things `buildAwardGroups` and
   * `kpiUtils` must jointly uphold: `buildAwardGroups` must NOT convert `finalPrices` — it reads
   * them verbatim and simply trusts they are already INR; `offerForItems` MUST convert the vendor's
   * first offer (a foreign-currency quote) to INR; and `savingsForRequest` therefore subtracts on a
   * single INR basis. `awardPrice` below mirrors the write-side conversion the two call sites use
   * (`awardUnitPriceInr` in `paymentUtils.ts`) so the award figure fed into `buildAwardGroups` here
   * is INR, as the real write paths guarantee. The `broken` case at the bottom simulates what
   * happens if a write path ever stored the vendor's own-currency unit price unconverted instead —
   * it stays here to show the failure mode `buildAwardGroups`/`offerForItems`/`savingsForRequest`
   * would otherwise be blind to, not because reverting the component code would turn it red.
   */
  it('does not inflate negotiation savings on a foreign-currency split award', () => {
    const awardPrice = (unit: number, currency?: string) => String(Math.round(toInr(unit, currency)));

    const items = [line('l1')];
    const r = req({ lineItems: items });

    // Vendor opens at USD 100,000 for the single awarded line and is negotiated down to USD 95,000.
    const finalPrices = { 'l1-price': awardPrice(95_000, 'USD'), 'l1-disc': '0' };
    const [group] = buildAwardGroups(items, finalPrices, { l1: 'v1' });
    expect(group.amount).toBe(toInr(95_000, 'USD')); // ₹81,22,500 — already INR

    const inv = invite({
      awarded: true, awardedItemIds: ['l1'], awardAmount: group.amount,
      rfqThread: [
        { id: 'm1', by: 'supplier', senderName: 'V', action: 'proposed', at: iso(5),
          quote: { price: 100_000, linePrices: { l1: 100_000 }, currency: 'USD' } },
      ],
    });

    const s = savingsForRequest(r, [inv], idx);
    // The real saving is USD 5,000 ≈ ₹4.28 lakh on an ₹81 lakh order — not ₹84 lakh.
    expect(s?.negotiation).toBe(toInr(5_000, 'USD'));
    expect(s?.negotiationComparable).toBe(true);
    expect(s?.negotiation).toBeLessThan(group.amount);

    // What the un-converted (pre-fix) write path produced, pinned so the defect cannot return.
    const broken = buildAwardGroups(items, { 'l1-price': '95000', 'l1-disc': '0' }, { l1: 'v1' })[0];
    const brokenSavings = savingsForRequest(
      r, [{ ...inv, awardAmount: broken.amount }], idx,
    );
    expect(brokenSavings!.negotiation).toBeGreaterThan(group.amount);
  });
});

describe('ballHolders', () => {
  it('puts a draft on the requester and a terminal request on nobody', () => {
    expect(ballHolders(req({ status: 'draft' }), [], NOW)[0].party).toBe('buyer');
    expect(ballHolders(req({ status: 'completed' }), [], NOW)[0].party).toBe('none');
    expect(ballHolders(req({ status: 'rejected' }), [], NOW)[0].party).toBe('none');
  });

  it('puts a pending-approval request on the plant head, aged from the transition', () => {
    const r = req({
      status: 'pending_head_approval',
      statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(4) }],
    });
    const [h] = ballHolders(r, [], NOW);
    expect(h.party).toBe('plant_head');
    expect(h.days).toBeCloseTo(4);
  });

  it('prefers sourcing over vendor when a quotation is waiting to be reviewed', () => {
    const r = req({ status: 'sourcing' });
    const inv = [
      invite({ id: 'i1', rfqQuote: { price: 10 }, rfqStatus: 'pending_sourcing' }),
      invite({ id: 'i2', rfqStatus: 'awaiting_quote' }),
    ];
    expect(ballHolders(r, inv, NOW)[0].party).toBe('sourcing');
  });

  it('falls to the vendor, then the technical team, then sourcing', () => {
    const r = req({ status: 'sourcing' });
    expect(ballHolders(r, [invite({ rfqStatus: 'awaiting_quote' })], NOW)[0].party).toBe('vendor');
    expect(
      ballHolders(r, [invite({
        rfqStatus: 'approved', rfqQuote: { price: 10 },
        techSpec: { id: 't', status: 'pending_technical', documents: [], thread: [], sentAt: iso(2) },
      })], NOW)[0].party,
    ).toBe('technical');
    expect(ballHolders(r, [], NOW)[0].party).toBe('sourcing');
  });

  it('routes the fulfilment chain to the right off-portal team', () => {
    expect(ballHolders(req({ status: 'pi_requested' }), [], NOW)[0].party).toBe('vendor');
    expect(ballHolders(req({ status: 'pi_submitted' }), [], NOW)[0].party).toBe('plant_accounts');
    expect(ballHolders(req({ status: 'accounts_processing' }), [], NOW)[0].party).toBe('global_accounts');
    // PO issued: the vendor re-uploads the PI — Plant Accounts no longer tick payments (2026-09).
    expect(ballHolders(req({ status: 'payment_in_progress' }), [], NOW)[0].party).toBe('vendor');
    expect(
      ballHolders(req({ status: 'payment_in_progress', trialRequired: true, trialStatus: 'pending_review' }), [], NOW)[0].party,
    ).toBe('sourcing');
  });

  it('diverts payment stage to the vendor or sourcing while a trial is open', () => {
    const upload = req({ status: 'payment_in_progress', trialRequired: true, trialStatus: 'pending_upload' });
    const review = req({ status: 'payment_in_progress', trialRequired: true, trialStatus: 'pending_review' });
    expect(ballHolders(upload, [], NOW)[0].party).toBe('vendor');
    expect(ballHolders(review, [], NOW)[0].party).toBe('sourcing');
  });

  it('returns one holder per award on an award-based request', () => {
    const r = req({ status: 'pi_requested' });
    const holders = ballHolders(r, [
      invite({ id: 'i1', awarded: true, awardStatus: 'awarded' }),
      invite({ id: 'i2', awarded: true, awardStatus: 'pi_submitted', piSubmittedAt: iso(3) }),
      invite({ id: 'i3' }),
    ], NOW);
    expect(holders.map(h => h.party)).toEqual(['sourcing', 'plant_accounts']);
    expect(holders[1].days).toBeCloseTo(3);
  });
});

describe('percentile', () => {
  it('agrees with median at p50, for both an odd- and an even-length input', () => {
    expect(percentile([4, 1, 3, 2], 50)).toBe(median([4, 1, 3, 2]));
    expect(percentile([5, 1, 3], 50)).toBe(median([5, 1, 3]));
  });

  it('returns null for an empty array', () => {
    expect(percentile([], 50)).toBeNull();
  });

  it('interpolates linearly between the two closest ranks', () => {
    // n=4, p90 -> rank = 0.9 * 3 = 2.7 -> 70% of the way from index 2 (30) to index 3 (40).
    // A nearest-rank method (the other common convention) would instead return 40 outright.
    expect(percentile([10, 20, 30, 40], 90)).toBeCloseTo(37);
  });
});

describe('stageDaysPercentiles', () => {
  const done = (from: number, to: number) => req({
    statusHistory: [
      { status: 'sourcing', actor: 'B', at: iso(from) },
      { status: 'pi_requested', actor: 'B', at: iso(to) },
    ],
  });

  it('mirrors medianStageDays\' inclusion rule — same sampled/stillOpen counts, p50 agrees with the median', () => {
    const open = req({ statusHistory: [{ status: 'sourcing', actor: 'B', at: iso(20) }] });
    const requests = [done(10, 6), done(10, 2), open];
    const m = medianStageDays(requests, 'sourcing', 'pi_requested');
    const pct = stageDaysPercentiles(requests, 'sourcing', 'pi_requested');
    expect(pct.sampled).toBe(m.sampled);
    expect(pct.stillOpen).toBe(m.stillOpen);
    expect(pct.p50).toBeCloseTo(m.medianDays!);
  });

  it('reports stillOpen only for requests that reached `from` but never `to` — not those that never reached `from` at all', () => {
    const neverStarted = req({ statusHistory: [{ status: 'submitted', actor: 'A', at: iso(5) }] });
    const startedNeverFinished = req({ statusHistory: [{ status: 'sourcing', actor: 'B', at: iso(9) }] });
    const finished = done(9, 3);
    const pct = stageDaysPercentiles(
      [neverStarted, startedNeverFinished, finished], 'sourcing', 'pi_requested',
    );
    expect(pct.sampled).toBe(1);
    expect(pct.stillOpen).toBe(1); // neverStarted is excluded entirely, not counted as open
    expect(pct.p50).toBeCloseTo(6);
    expect(pct.p90).toBeCloseTo(6);
  });

  it('returns null percentiles, zero counts, when nothing qualifies', () => {
    const pct = stageDaysPercentiles([], 'sourcing', 'pi_requested');
    expect(pct.p50).toBeNull();
    expect(pct.p90).toBeNull();
    expect(pct.sampled).toBe(0);
    expect(pct.stillOpen).toBe(0);
  });
});

describe('agingBuckets', () => {
  it('puts each boundary value in the OLDER bucket — upper bound is exclusive', () => {
    const buckets = agingBuckets([3, 7, 2.9, 6.9, 14, 13.9, 0, 100]);
    const byLabel = Object.fromEntries(buckets.map((b) => [b.label, b.count]));
    // 2.9 -> 0-3 ; 3 (boundary) -> 3-7, NOT 0-3
    // 6.9 -> 3-7 ; 7 (boundary) -> 7-14, NOT 3-7
    // 13.9 -> 7-14 ; 14 (boundary) -> 14+, NOT 7-14
    // 0 -> 0-3 ; 100 -> 14+
    expect(byLabel['0-3']).toBe(2); // 2.9, 0
    expect(byLabel['3-7']).toBe(2); // 3, 6.9
    expect(byLabel['7-14']).toBe(2); // 7, 13.9
    expect(byLabel['14+']).toBe(2); // 14, 100
  });

  it('excludes null (undatable) ages rather than fabricating a bucket for them', () => {
    const buckets = agingBuckets([null, null, 1]);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(1);
    expect(buckets.find((b) => b.label === '0-3')?.count).toBe(1);
  });
});

describe('stageDaySample', () => {
  const hist = (entries: [CapexRequest['status'], number][]) =>
    req({ statusHistory: entries.map(([status, d]) => ({ status, actor: 'a', at: iso(d) })) });

  it('reports the four states the medians and the list routes both key off', () => {
    // Never reached `from` — invisible to the metric.
    expect(stageDaySample(hist([['submitted', 5]]), 'sourcing', 'pi_requested').state).toBe('not_reached');
    // Reached `from`, never `to` — the disclosed still-open case.
    expect(stageDaySample(hist([['sourcing', 5]]), 'sourcing', 'pi_requested').state).toBe('open');
    // Reached both.
    const sampled = stageDaySample(hist([['sourcing', 8], ['pi_requested', 3]]), 'sourcing', 'pi_requested');
    expect(sampled.state).toBe('sampled');
    expect(sampled.state === 'sampled' && Math.round(sampled.days)).toBe(5);
    // Out-of-order history (clock skew) — excluded from BOTH the sample and stillOpen.
    expect(stageDaySample(hist([['sourcing', 3], ['pi_requested', 8]]), 'sourcing', 'pi_requested').state)
      .toBe('dropped');
  });

  it('is the same inclusion rule medianStageDays uses', () => {
    const rs = [
      hist([['sourcing', 8], ['pi_requested', 3]]),
      hist([['sourcing', 10], ['pi_requested', 2]]),
      hist([['sourcing', 4]]),
      hist([['submitted', 4]]),
    ];
    const kpi = medianStageDays(rs, 'sourcing', 'pi_requested');
    const states = rs.map((r) => stageDaySample(r, 'sourcing', 'pi_requested').state);
    expect(states.filter((s) => s === 'sampled')).toHaveLength(kpi.sampled);
    expect(states.filter((s) => s === 'open')).toHaveLength(kpi.stillOpen);
  });
});

describe('statusTally', () => {
  it('counts the completed / rejected split and the rate over the same population', () => {
    const t = statusTally([
      req({ id: 'a', status: 'completed' }),
      req({ id: 'b', status: 'rejected' }),
      req({ id: 'c', status: 'sourcing' }),
      req({ id: 'd', status: 'draft' }),
    ]);
    expect(t).toEqual({ total: 4, completed: 1, rejected: 1, rejectionRatePct: 25 });
  });

  it('reports 0% — never NaN — on an empty set', () => {
    expect(statusTally([])).toEqual({ total: 0, completed: 0, rejected: 0, rejectionRatePct: 0 });
  });
});
