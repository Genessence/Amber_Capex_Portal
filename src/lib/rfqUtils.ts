/**
 * Helpers for the Brown Field RFQ flow: a two-sided negotiation where the VENDOR quotes first.
 * Sourcing invites + sends the link (`awaiting_quote`); the vendor submits a full quotation
 * (price + freight/packing/service/delivery/warranty/currency) → `pending_sourcing`; sourcing
 * may counter inline → `pending_vendor`; either side then accepts → `approved`. On approval the
 * approval documents auto-send for separate sign-off; once those are approved the vendor uploads a PI.
 */
import type { RfqPriceStatus, RfqQuote, VendorInvite, RfqPriceMessage, CapexLineItem } from './types';
import { effectiveDocApprovalStatus } from './docPackageUtils';
import { gstAmount, gstRateForHsn } from './hsnGst';

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
  not_sent: 'bg-slate-100 text-slate-600',
  awaiting_quote: 'bg-indigo-100 text-indigo-800',
  pending_vendor: 'bg-amber-100 text-amber-800',
  pending_sourcing: 'bg-sky-100 text-sky-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
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

/** GST rate (%) for a single line item, derived from THAT item's HSN code (0 if none). */
export function rfqLineGstRate(item?: GstLineItem): number {
  return item?.hsnCode ? gstRateForHsn(item.hsnCode) : 0;
}

/** GST amount for one line item under a quote: (unit × qty) × the item's GST rate. 0 if no HSN/price. */
export function rfqLineGstAmount(quote: RfqQuote | undefined, item: GstLineItem): number {
  if (!quote || !item.hsnCode) return 0;
  const unit = quote.linePrices?.[item.id] ?? 0;
  const qty = parseFloat(item.quantity) || 1;
  return gstAmount(unit * qty, item.hsnCode);
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
 * A vendor is ready for a PI request once BOTH the quotation is approved AND the approval
 * documents (auto-sent on price agreement) are approved by the vendor.
 */
export function canRequestPi(invite: VendorInvite): boolean {
  return (
    effectiveRfqStatus(invite) === 'approved' &&
    effectiveDocApprovalStatus(invite.docApprovalStatus) === 'approved'
  );
}

/** Whether any vendor on a request has an approved quotation + approved documents. */
export function hasApprovedRfqVendor(invites: VendorInvite[]): boolean {
  return invites.some(canRequestPi);
}

/** The lowest RFQ grand total across invites that carry a quotation (null if none). */
export function lowestRfqTotal(invites: VendorInvite[], items?: GstLineItem[]): number | null {
  const totals = invites.filter((i) => i.rfqQuote).map((i) => rfqTotal(i.rfqQuote, items));
  return totals.length ? Math.min(...totals) : null;
}
