import type { Quote, VendorInvite } from './types';

/** UI state for a buyer-entered quote row on the new-request wizard. */
export interface RequestQuoteRow {
  id: string;
  vendorId: string;
  lineRowId: string;
  expectedAmount: string;
  freight: string;
  packing: string;
  service: string;
  deliveryWeeks: string;
  warrantyYears: string;
  currency: string;
  attachmentName: string;
  attachmentBase64: string;
}

export function emptyQuoteRow(lineRowId = ''): RequestQuoteRow {
  return {
    id: crypto.randomUUID(),
    vendorId: '',
    lineRowId,
    expectedAmount: '',
    freight: '',
    packing: '',
    service: '',
    deliveryWeeks: '',
    warrantyYears: '',
    currency: 'INR',
    attachmentName: '',
    attachmentBase64: '',
  };
}

/** Extract the first numeric quantity from free-text qty fields (e.g. "2 units"). */
export function parseQuantity(qtyStr: string): number {
  const match = qtyStr.trim().match(/[\d.]+/);
  if (!match) return 1;
  const n = parseFloat(match[0]);
  return n > 0 ? n : 1;
}

/** Default quote validity — 180 days from today (matches auction bid validity default). */
export function defaultQuoteValidUntil(): string {
  const d = new Date();
  d.setDate(d.getDate() + 180);
  return d.toISOString().slice(0, 10);
}

export function isQuoteRowEmpty(row: RequestQuoteRow): boolean {
  return (
    !row.vendorId &&
    !row.expectedAmount.trim() &&
    !row.freight.trim() &&
    !row.packing.trim() &&
    !row.service.trim() &&
    !row.deliveryWeeks.trim() &&
    !row.warrantyYears.trim() &&
    !row.attachmentName
  );
}

export function isQuoteRowComplete(row: RequestQuoteRow): boolean {
  return !!row.vendorId && !!row.lineRowId && !!row.expectedAmount.trim();
}

/** Every started quote row must be complete; empty rows are ignored. */
export function validateQuoteRows(rows: RequestQuoteRow[]): boolean {
  return rows.every((row) => isQuoteRowEmpty(row) || isQuoteRowComplete(row));
}

export function getQuotesForLine(quoteRows: RequestQuoteRow[], lineRowId: string): RequestQuoteRow[] {
  return quoteRows.filter((q) => q.lineRowId === lineRowId);
}

/** Each line row must have at least one complete quote; no incomplete quote rows allowed. */
export function validateQuotesPerLine(quoteRows: RequestQuoteRow[], lineRowIds: string[]): boolean {
  if (!lineRowIds.length) return false;
  return lineRowIds.every((lineId) => {
    const lineQuotes = getQuotesForLine(quoteRows, lineId);
    const hasComplete = lineQuotes.some(isQuoteRowComplete);
    const allValid = lineQuotes.every((q) => isQuoteRowEmpty(q) || isQuoteRowComplete(q));
    return hasComplete && allValid;
  });
}

/** Lowest expected total amount among complete quotes for a line — used for line budget derivation. */
export function getLowestQuoteAmountForLine(
  quoteRows: RequestQuoteRow[],
  lineRowId: string,
): number | undefined {
  const amounts = getQuotesForLine(quoteRows, lineRowId)
    .filter(isQuoteRowComplete)
    .map((q) => Number(q.expectedAmount))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!amounts.length) return undefined;
  return Math.min(...amounts);
}

export interface QuoteAllocationStatus {
  over: boolean;
  delta: number;
}

/** Compare a quote amount against master allocation for that line. */
export function getQuoteAllocationStatus(
  quoteAmount: number,
  allocatedINR: number | null,
): QuoteAllocationStatus | null {
  if (allocatedINR === null || !Number.isFinite(quoteAmount) || quoteAmount <= 0) return null;
  const delta = allocatedINR - quoteAmount;
  return { over: quoteAmount > allocatedINR, delta: Math.abs(delta) };
}

/** Returns vendor ids that have mixed currencies across their quote rows. */
export function findMixedCurrencyVendors(rows: RequestQuoteRow[]): string[] {
  const byVendor = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.vendorId || isQuoteRowEmpty(row)) continue;
    const set = byVendor.get(row.vendorId) ?? new Set<string>();
    set.add(row.currency || 'INR');
    byVendor.set(row.vendorId, set);
  }
  return [...byVendor.entries()]
    .filter(([, currencies]) => currencies.size > 1)
    .map(([vendorId]) => vendorId);
}

export interface BuildInvitesInput {
  requestId: string;
  quoteRows: RequestQuoteRow[];
  lineRowIdToLineItemId: Map<string, string>;
  quantityByLineRowId: Map<string, string>;
}

/**
 * Group buyer quote rows by vendor and produce VendorInvite records with seeded Quote data.
 * Monetary extras are summed; delivery uses max weeks; warranty uses min years.
 */
export function buildInvitesFromQuoteRows(input: BuildInvitesInput): VendorInvite[] {
  const { requestId, quoteRows, lineRowIdToLineItemId, quantityByLineRowId } = input;
  const completeRows = quoteRows.filter(isQuoteRowComplete);
  if (!completeRows.length) return [];

  const mixed = findMixedCurrencyVendors(completeRows);
  if (mixed.length) {
    console.error(
      '[requestQuoteUtils] Mixed currencies for vendors — skipping quote seed:',
      mixed.join(', '),
    );
    return [];
  }

  const byVendor = new Map<string, RequestQuoteRow[]>();
  for (const row of completeRows) {
    const list = byVendor.get(row.vendorId) ?? [];
    list.push(row);
    byVendor.set(row.vendorId, list);
  }

  const nowMs = Date.now();
  const nowIso = new Date().toISOString();
  const validUntil = defaultQuoteValidUntil();
  const invites: VendorInvite[] = [];

  for (const [vendorId, vendorRows] of byVendor) {
    const currency = vendorRows[0].currency || 'INR';
    const itemPrices: Record<string, number> = {};
    let totalPrice = 0;
    let freightSum = 0;
    let packingSum = 0;
    let serviceSum = 0;
    let maxDeliveryWeeks = 0;
    let minWarranty: number | undefined;
    let attachmentName: string | undefined;
    let attachmentBase64: string | undefined;

    for (const qr of vendorRows) {
      const lineItemId = lineRowIdToLineItemId.get(qr.lineRowId);
      if (!lineItemId) continue;

      const qty = parseQuantity(quantityByLineRowId.get(qr.lineRowId) ?? '1');
      const amount = Number(qr.expectedAmount);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      itemPrices[lineItemId] = amount / qty;
      totalPrice += amount;

      freightSum += qr.freight ? Number(qr.freight) : 0;
      packingSum += qr.packing ? Number(qr.packing) : 0;
      serviceSum += qr.service ? Number(qr.service) : 0;

      const weeks = qr.deliveryWeeks ? Number(qr.deliveryWeeks) : 0;
      if (weeks > maxDeliveryWeeks) maxDeliveryWeeks = weeks;

      if (qr.warrantyYears.trim()) {
        const w = Number(qr.warrantyYears);
        if (Number.isFinite(w)) {
          minWarranty = minWarranty === undefined ? w : Math.min(minWarranty, w);
        }
      }

      if (qr.attachmentName) {
        attachmentName = qr.attachmentName;
        attachmentBase64 = qr.attachmentBase64;
      }
    }

    if (totalPrice <= 0) continue;

    const quote: Quote = {
      id: `q-seed-${nowMs}-${vendorId}`,
      price: totalPrice,
      itemPrices: Object.keys(itemPrices).length ? itemPrices : undefined,
      deliveryDays: Math.max(Math.round(maxDeliveryWeeks * 7), 7),
      validUntil,
      freight: freightSum || undefined,
      packing: packingSum || undefined,
      service: serviceSum || undefined,
      warranty: minWarranty,
      currency,
      attachmentName,
      attachmentBase64,
      submittedAt: nowIso,
      seededByBuyer: true,
      note: 'Added during request creation',
    };

    invites.push({
      id: `inv-${nowMs}-${vendorId}`,
      requestId,
      vendorId,
      token: `tok_${vendorId}_${requestId}_${nowMs}`,
      status: 'quote_received',
      auctionApprovalStatus: 'not_sent',
      quotes: [quote],
      negotiationThread: [],
      invitedAt: nowIso,
    });
  }

  return invites;
}
