/**
 * Helpers for the Brown Field RFQ flow: a two-sided negotiation where the VENDOR quotes first.
 * Sourcing invites + sends the link (`awaiting_quote`); the vendor submits a full quotation
 * (price + freight/packing/service/delivery/warranty/currency) → `pending_sourcing`; sourcing
 * may counter inline → `pending_vendor`; either side then accepts → `approved`. On approval the
 * approval documents auto-send for separate sign-off; once those are approved the vendor uploads a PI.
 */
import type { RfqPriceStatus, RfqQuote, VendorInvite, RfqPriceMessage, CapexLineItem } from './types';
import { effectiveDocApprovalStatus } from './docPackageUtils';
import { incoTermsBlocksAward } from './incoTermsUtils';
import { gstAmount, gstRateForHsn } from './hsnGst';
import { toInr } from './currencyUtils';

/** Minimal line-item shape needed to compute item-wise GST (satisfied by CapexLineItem). */
export type GstLineItem = Pick<CapexLineItem, 'id' | 'quantity' | 'hsnCode'>;

export const RFQ_STATUS_LABELS: Record<RfqPriceStatus, string> = {
  not_sent: 'Not Sent',
  awaiting_quote: 'Awaiting Quote',
  pending_vendor: 'Counter Sent',
  pending_sourcing: 'Needs Review',
  approved: 'Quotation Approved',
  rejected: 'Quotation Rejected',
};

export const RFQ_STATUS_COLORS: Record<RfqPriceStatus, string> = {
  not_sent: 'bg-slate-100 text-slate-600 border border-slate-200',
  awaiting_quote: 'bg-amber-50 text-amber-700 border border-amber-200',
  pending_vendor: 'bg-blue-50 text-blue-700 border border-blue-200',
  pending_sourcing: 'bg-amber-50 text-amber-700 border border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
};

/**
 * Resolve an invite's RFQ status, tolerant of legacy data. In the vendor-quotes-first flow an
 * invited RFQ vendor with no quote yet is `awaiting_quote`; a stored quote with a stale/unset
 * status reads as `pending_sourcing` (sourcing's turn to review). Only ever called in RFQ
 * contexts, so auction invites (which never carry an RFQ quote) are unaffected.
 */
export function effectiveRfqStatus(invite: VendorInvite): RfqPriceStatus {
  const s = invite.rfqStatus;
  if (!s || s === 'not_sent') {
    return invite.rfqQuote ? 'pending_sourcing' : 'awaiting_quote';
  }
  return s;
}

/** Pre-GST subtotal = base subtotal + freight + packing + service. (Footer charges are NOT taxed.) */
export function rfqTaxableValue(quote?: RfqQuote): number {
  if (!quote) return 0;
  return (quote.price ?? 0) + (quote.freight ?? 0) + (quote.packing ?? 0) + (quote.service ?? 0);
}

/** Parsed quantity for a line item (defaults to 1). */
export function rfqItemQuantity(item?: GstLineItem): number {
  return parseFloat(item?.quantity ?? '1') || 1;
}

/** GST rate (%) for a single line item, derived from THAT item's HSN code (0 if none). */
export function rfqLineGstRate(item?: GstLineItem): number {
  return item?.hsnCode ? gstRateForHsn(item.hsnCode) : 0;
}

/** GST amount for one line item under a quote: (unit × qty) × the item's GST rate. 0 if no HSN/price. */
export function rfqLineGstAmount(quote: RfqQuote | undefined, item: GstLineItem): number {
  if (!quote || !item.hsnCode) return 0;
  const unit = quote.linePrices?.[item.id] ?? 0;
  const qty = rfqItemQuantity(item);
  return gstAmount(unit * qty, item.hsnCode);
}

/** Canonical per-line pricing breakdown (pre-GST subtotal, GST rate/amount, GST-inclusive total). */
export interface RfqLineBreakdown {
  unitPrice: number;
  quantity: number;
  taxableSubtotal: number;
  gstRate: number;
  gstAmount: number;
  lineTotalInclGst: number;
}

export function rfqLineBreakdown(quote: RfqQuote | undefined, item: GstLineItem): RfqLineBreakdown {
  const unitPrice = quote?.linePrices?.[item.id] ?? 0;
  const quantity = rfqItemQuantity(item);
  const taxableSubtotal = unitPrice * quantity;
  const gstRate = rfqLineGstRate(item);
  const lineGst = rfqLineGstAmount(quote, item);
  return {
    unitPrice,
    quantity,
    taxableSubtotal,
    gstRate,
    gstAmount: lineGst,
    lineTotalInclGst: taxableSubtotal + lineGst,
  };
}

/** True when every listed line item has a non-empty HSN in the map. */
export function isCompleteItemHsnMap(lineItemIds: string[], hsnByItem?: Record<string, string>): boolean {
  if (!lineItemIds.length) return true;
  return lineItemIds.every((id) => !!hsnByItem?.[id]?.trim());
}

/** Line-item ids missing a non-empty HSN in the map. */
export function missingItemHsnIds(lineItemIds: string[], hsnByItem?: Record<string, string>): string[] {
  return lineItemIds.filter((id) => !hsnByItem?.[id]?.trim());
}

/**
 * Merge supplier-entered HSN with request-level HSN for a supplier quote. Returns null when any
 * priced line still lacks an HSN (required before a supplier quotation can be accepted).
 */
export function resolveSupplierItemHsn(
  items: GstLineItem[],
  quote: RfqQuote,
  itemHsn?: Record<string, string>,
): Record<string, string> | null {
  if (!items.length) return {};
  const pricedIds = quote.linePrices
    ? Object.entries(quote.linePrices)
        .filter(([, v]) => Number(v) > 0)
        .map(([id]) => id)
    : items.map((it) => it.id);
  const merged: Record<string, string> = {};
  for (const id of pricedIds) {
    const fromForm = itemHsn?.[id]?.trim();
    const fromRequest = items.find((it) => it.id === id)?.hsnCode?.trim();
    const code = fromForm || fromRequest;
    if (!code) return null;
    merged[id] = code;
  }
  return merged;
}

/**
 * Total GST on a quotation. ITEM-WISE: GST is derived from each line item's own HSN code
 * (set on the request, identical across vendors) applied to that line's unit × qty. Freight/
 * packing/service are NOT taxed. When `items` is omitted (legacy lump-sum data with no line
 * items), falls back to the deprecated quote-level `hsnCode` on the taxable value, else 0.
 */
export function rfqGstAmount(quote?: RfqQuote, items?: GstLineItem[]): number {
  if (!quote) return 0;
  if (items && items.length) {
    return items.reduce((sum, it) => sum + rfqLineGstAmount(quote, it), 0);
  }
  return quote.hsnCode ? gstAmount(rfqTaxableValue(quote), quote.hsnCode) : 0;
}

/** Grand total = pre-GST subtotal (incl. footer charges) + item-wise GST. */
export function rfqTotal(quote?: RfqQuote, items?: GstLineItem[]): number {
  if (!quote) return 0;
  return rfqTaxableValue(quote) + rfqGstAmount(quote, items);
}

/**
 * Grand total converted to INR using the quote's currency. Use this (not `rfqTotal`) whenever
 * comparing quotes across vendors or persisting an award amount, so a foreign-currency quote is
 * never mistaken for the lowest or paid at its raw face value.
 */
export function inrRfqTotal(quote?: RfqQuote, items?: GstLineItem[]): number {
  if (!quote) return 0;
  return toInr(rfqTotal(quote, items), quote.currency);
}

/** Unit price a quote offers for a given line item (per-line, with legacy single-price fallback). */
export function rfqLineUnitPrice(quote: RfqQuote | undefined, lineItemId: string): number | undefined {
  if (!quote) return undefined;
  const v = quote.linePrices?.[lineItemId];
  return v != null ? v : undefined;
}

/** Base subtotal across line items = Σ(unitPrice × qty). Used to (re)compute RfqQuote.price. */
export function rfqLineSubtotal(
  linePrices: Record<string, number>,
  items: { id: string; quantity: string }[],
): number {
  return items.reduce((sum, it) => {
    const unit = linePrices[it.id] ?? 0;
    const qty = parseFloat(it.quantity) || 1;
    return sum + unit * qty;
  }, 0);
}

/** The latest entry in the RFQ negotiation thread. */
export function latestRfqOffer(invite: VendorInvite): RfqPriceMessage | undefined {
  const thread = invite.rfqThread ?? [];
  return thread[thread.length - 1];
}

/**
 * A vendor is ready for a PI request once the quotation is approved, the approval documents
 * (auto-sent on price agreement) are approved by the vendor, and — for a foreign vendor — the
 * Incoterms agreement has been settled. Incoterms are answered alongside the quotation and
 * negotiated separately, so they can still be open when the price is agreed.
 */
export function canRequestPi(invite: VendorInvite): boolean {
  return (
    effectiveRfqStatus(invite) === 'approved' &&
    effectiveDocApprovalStatus(invite.docApprovalStatus) === 'approved' &&
    !incoTermsBlocksAward(invite)
  );
}

/** Whether any vendor on a request has an approved quotation + approved documents. */
export function hasApprovedRfqVendor(invites: VendorInvite[]): boolean {
  return invites.some(canRequestPi);
}

/** The lowest RFQ grand total across invites that carry a quotation (INR basis; null if none). */
export function lowestRfqTotal(invites: VendorInvite[], items?: GstLineItem[]): number | null {
  const totals = invites.filter((i) => i.rfqQuote).map((i) => inrRfqTotal(i.rfqQuote, items));
  return totals.length ? Math.min(...totals) : null;
}
