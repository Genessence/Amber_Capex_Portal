import { describe, expect, it } from 'vitest';
import { buildVendorComparisonRows } from './exportUtils';
import { toInr } from './currencyUtils';
import type { CapexRequest, Quote, Vendor, VendorInvite } from './types';

/**
 * The exported sheet paints its FIRST row green as "lowest" and circulates outside the portal,
 * where nobody can check the working. It used to sort on raw quoted totals, so a $1,00,000 bid
 * (₹85,50,000) took the green fill from an ₹80,00,000 one — under a `Total (₹)` header, with no
 * currency column anywhere in the file.
 */

const request: CapexRequest = {
  id: 'r1',
  subject: 'Moulding machine',
  category: 'Machinery',
  quantity: '1',
  priority: 'medium',
  justification: '',
  techSpecs: { specifications: '', complianceStandards: '' },
  assignedTo: 'sourcing_member',
  status: 'sourcing',
  createdBy: 'Arjun Mehta',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const vendors: Vendor[] = [
  {
    id: 'v1',
    vendorCode: 'VND-001',
    vendorName: 'Domestic Machines',
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
  },
  {
    id: 'v2',
    vendorCode: 'VND-002',
    vendorName: 'Overseas Machines',
    category: 'Machinery',
    gstin: '',
    pan: '',
    contactName: 'B',
    contactEmail: 'b@example.com',
    paymentTerms: 'Net-30',
    bankName: '',
    accountNumber: '',
    ifsc: '',
    onboardedAt: '2026-01-01T00:00:00.000Z',
    foreign: true,
  },
];

const quote = (over: Partial<Quote> = {}): Quote => ({
  id: 'q1',
  price: 8_000_000,
  deliveryDays: 60,
  validUntil: '2026-12-31T00:00:00.000Z',
  submittedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const invite = (over: Partial<VendorInvite> = {}): VendorInvite => ({
  id: 'i1',
  requestId: 'r1',
  vendorId: 'v1',
  token: 't1',
  status: 'quote_received',
  quotes: [],
  negotiationThread: [],
  invitedAt: '2026-07-01T00:00:00.000Z',
  auctionApprovalStatus: 'not_sent',
  ...over,
});

describe('buildVendorComparisonRows', () => {
  it('orders cheapest-first on an INR basis, not on the raw quoted number', () => {
    // Domestic ₹80,00,000 vs foreign $1,00,000 = ₹85,50,000 → the domestic vendor is cheaper.
    const domestic = invite({ id: 'i1', vendorId: 'v1', quotes: [quote({ id: 'qA', price: 8_000_000, currency: 'INR' })] });
    const foreign = invite({ id: 'i2', vendorId: 'v2', quotes: [quote({ id: 'qB', price: 100_000, currency: 'USD' })] });

    const rows = buildVendorComparisonRows(request, [foreign, domestic], vendors);

    expect(rows.map(r => r.vendor?.vendorName)).toEqual(['Domestic Machines', 'Overseas Machines']);
    expect(rows[0].inrTotal).toBe(8_000_000);
    expect(rows[1].inrTotal).toBe(toInr(100_000, 'USD'));
    // Raw face value would have inverted it — the exact defect.
    expect(rows[1].nativeTotal).toBeLessThan(rows[0].nativeTotal);
  });

  it('keeps the quoted figures as quoted, alongside the INR comparison total', () => {
    const foreign = invite({ vendorId: 'v2', quotes: [quote({ price: 100_000, freight: 2_000, currency: 'USD' })] });

    const [row] = buildVendorComparisonRows(request, [foreign], vendors);

    expect(row.currency).toBe('USD');
    expect(row.nativeTotal).toBe(102_000);
    expect(row.inrTotal).toBe(toInr(102_000, 'USD'));
  });

  it('includes freight / packing / service in the comparison total', () => {
    const inv = invite({ quotes: [quote({ price: 8_000_000, freight: 200_000, packing: 50_000, service: 100_000 })] });

    expect(buildVendorComparisonRows(request, [inv], vendors)[0].inrTotal).toBe(8_350_000);
  });

  it('treats a missing currency as INR, so domestic exports are unchanged', () => {
    const inv = invite({ quotes: [quote({ price: 8_000_000 })] });

    const [row] = buildVendorComparisonRows(request, [inv], vendors);
    expect(row.currency).toBe('INR');
    expect(row.inrTotal).toBe(row.nativeTotal);
  });

  it('reads the LATEST quote when a vendor has re-bid', () => {
    const inv = invite({
      quotes: [quote({ id: 'old', price: 9_000_000 }), quote({ id: 'new', price: 7_000_000 })],
    });

    const [row] = buildVendorComparisonRows(request, [inv], vendors);
    expect(row.quote.id).toBe('new');
    expect(row.inrTotal).toBe(7_000_000);
  });

  it('skips invites from other requests and invites with no quote', () => {
    const otherRequest = invite({ id: 'i2', requestId: 'r2', quotes: [quote()] });
    const noQuote = invite({ id: 'i3', vendorId: 'v2' });
    const mine = invite({ id: 'i4', quotes: [quote()] });

    const rows = buildVendorComparisonRows(request, [otherRequest, noQuote, mine], vendors);
    expect(rows.map(r => r.invite.id)).toEqual(['i4']);
  });

  it('returns nothing when no vendor has quoted (no row can be highlighted "lowest")', () => {
    expect(buildVendorComparisonRows(request, [invite()], vendors)).toEqual([]);
  });
});
