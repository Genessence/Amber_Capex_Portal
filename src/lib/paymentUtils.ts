/**
 * Payment-milestone helpers. Milestones derive from the finalized vendor's payment-terms
 * split (e.g. 30% advance / 60% dispatch / 10% installation). Accounts (or sourcing) marks
 * each milestone paid; ticking the final one stops the TAT clock and completes the request.
 */
import type { AwardStatus, CapexLineItem, CapexRequest, CapexStatus, PaymentMilestone, Quote, TrialStatus, Vendor, VendorInvite } from './types';
import { DEFAULT_PAYMENT_SPLITS } from './docPackageUtils';
import { inrRfqTotal } from './rfqUtils';
import { gstAmount } from './hsnGst';
import { toInr } from './currencyUtils';

const FULFILLMENT_STATUSES = ['pi_submitted', 'accounts_processing', 'payment_in_progress', 'completed'];

// ── Split award (reverse auction) ───────────────────────────────────────────
// A request is "award-based" when at least one invite has `awarded === true`. Each awarded vendor
// runs its own PI → terms → PO → payments track via the invite's award fields.

export interface AwardGroup {
  vendorId: string;
  itemIds: string[];
  /** Net (price × (1-disc%) × qty) summed over the vendor's items + item-wise GST, rounded. */
  amount: number;
}

/** True when any invite has been awarded line items (split-award reverse auction). */
export function isAwardBased(invites: VendorInvite[]): boolean {
  return invites.some((i) => i.awarded);
}

/** The awarded invites for a request (one fulfillment track each). */
export function awardedInvites(invites: VendorInvite[]): VendorInvite[] {
  return invites.filter((i) => i.awarded);
}

/**
 * Line items no award covers yet. A split award is additive — sourcing awards one vendor at a
 * time — so between the first award and the last, some lines still have no winner.
 */
export function unawardedLineItemIds(
  lineItems: { id: string }[],
  invites: VendorInvite[],
): string[] {
  const covered = new Set<string>();
  for (const inv of invites) {
    if (!inv.awarded) continue;
    for (const id of inv.awardedItemIds ?? []) covered.add(id);
  }
  return lineItems.map((li) => li.id).filter((id) => !covered.has(id));
}

/**
 * A split award has started but is NOT finished — at least one vendor is awarded and at least one
 * line item still has no winner.
 *
 * This is the "still awardable" escape the award surfaces need. Awarding the first vendor bumps the
 * request to `pi_requested`, which reads as fulfillment everywhere; without this, the panels that
 * award the REMAINING vendors disappear and their line items are silently never ordered (the
 * request even auto-completes once the first award's payments finish). It is deliberately narrower
 * than `isAwardBased`: once every line has a winner there is nothing left to award, so a finished
 * single-vendor award correctly hides the surfaces again.
 */
export function splitAwardInProgress(
  lineItems: { id: string }[],
  invites: VendorInvite[],
): boolean {
  return isAwardBased(invites) && unawardedLineItemIds(lineItems, invites).length > 0;
}

/**
 * Group the Final-Decision selections (per-line vendor + price/disc) into one award per vendor,
 * computing each award's GST-inclusive amount. Mirrors VendorGrid's per-line `net` (price ×
 * (1-disc/100) × qty) and folds in item-wise GST via the line item's HSN code.
 */
export function buildAwardGroups(
  lineItems: CapexLineItem[],
  /** `finalPrices` are INR by contract — both write paths (`VendorGrid`, `RfqPanel`) apply `toInr`. */
  finalPrices: Record<string, string>,
  finalVendorPerItem: Record<string, string>,
): AwardGroup[] {
  const byVendor = new Map<string, { itemIds: string[]; amount: number }>();
  for (const item of lineItems) {
    const vendorId = finalVendorPerItem[item.id];
    if (!vendorId) continue;
    const price = Number(finalPrices[`${item.id}-price`] ?? 0);
    const disc = Number(finalPrices[`${item.id}-disc`] ?? 0);
    const qty = parseFloat(item.quantity) || 1;
    const net = price * (1 - disc / 100) * qty;
    const gross = net + gstAmount(net, item.hsnCode);
    const g = byVendor.get(vendorId) ?? { itemIds: [], amount: 0 };
    g.itemIds.push(item.id);
    g.amount += gross;
    byVendor.set(vendorId, g);
  }
  return [...byVendor.entries()].map(([vendorId, g]) => ({
    vendorId,
    itemIds: g.itemIds,
    amount: Math.round(g.amount),
  }));
}

/**
 * The Final-Decision price for one unit, normalised to INR.
 *
 * `finalPrices` is INR by contract (see `buildAwardGroups`), but the auto-fill on both award
 * surfaces reads a unit price in the VENDOR's currency. Both paths must convert through here —
 * they were once hand-copied expressions and drifted, which silently inflated every award-basis
 * figure on the RFQ path.
 */
export function awardUnitPriceInr(rawUnit: number, currency?: string): string {
  return String(Math.round(toInr(rawUnit, currency)));
}

/**
 * Whether THIS invite owns a fulfillment track — i.e. whether the vendor holding this link is
 * entitled to see the PI request, the issued purchase order, the payment milestones and the trial
 * gate for this request.
 *
 * Two award shapes, both checked, because handling one and not the other is how a losing bidder
 * ends up looking at someone else's purchase order:
 *  - split award  → the invite itself is `awarded` and carries its own PO / milestones;
 *  - single vendor → the request names the winner in `finalVendorId` (RFQ and auction alike).
 *
 * A vendor who quoted and lost owns NOTHING here, even though `request.status` has moved into
 * fulfillment for the winner. Fails closed: with no winner recorded, nobody owns the track.
 */
export function ownsFulfillmentTrack(
  request: Pick<CapexRequest, 'finalVendorId'>,
  invite: Pick<VendorInvite, 'awarded' | 'vendorId'>,
): boolean {
  if (invite.awarded) return true;
  return !!request.finalVendorId && invite.vendorId === request.finalVendorId;
}

/**
 * Coarse request-level status derived from award progress (award-based requests only):
 * - `completed` when every award is completed
 * - `pi_requested` once any award has moved past the terms phase (`awardStatus !== 'awarded'`)
 * - `null` while all awards are still in the terms phase (keep the request at `sourcing`)
 */
export function deriveRequestStatus(invites: VendorInvite[]): CapexStatus | null {
  const awards = awardedInvites(invites);
  if (!awards.length) return null;
  if (awards.every((a) => a.awardStatus === 'completed')) return 'completed';
  if (awards.some((a) => a.awardStatus && a.awardStatus !== 'awarded')) return 'pi_requested';
  return null;
}

/** "{completed} / {total} awards complete" counts for the request badge. */
export function awardSummary(invites: VendorInvite[]): { total: number; completed: number } {
  const awards = awardedInvites(invites);
  return { total: awards.length, completed: awards.filter((a) => a.awardStatus === 'completed').length };
}

const AWARD_FULFILLMENT_STATUSES: AwardStatus[] = [
  'pi_submitted',
  'accounts_processing',
  'payment_in_progress',
];

/** True when this award sits in an Accounts-queue stage (PI submitted → payments). */
export function isAwardInAccounts(inv: VendorInvite): boolean {
  return !!inv.awardStatus && AWARD_FULFILLMENT_STATUSES.includes(inv.awardStatus);
}

/** Build payment milestones for an order amount from the vendor's payment-terms split. */
export function buildMilestonesFromVendor(vendor: Vendor | undefined, amount: number): PaymentMilestone[] {
  const splits = vendor?.paymentSplits?.length ? vendor.paymentSplits : DEFAULT_PAYMENT_SPLITS;
  return splits.map((s, i) => ({
    id: `pm-${s.id}-${i}`,
    label: s.label,
    percent: s.percent,
    trigger: s.trigger,
    amount: Math.round((amount * s.percent) / 100),
    status: 'pending' as const,
    isFinal: i === splits.length - 1,
  }));
}

/** Next unpaid milestone (advance-first by array order). */
export function nextPayableMilestone(ms: PaymentMilestone[]): PaymentMilestone | undefined {
  return ms.find(m => m.status === 'pending');
}

export function totalPaid(ms: PaymentMilestone[]): number {
  return ms.filter(m => m.status === 'paid').reduce((s, m) => s + m.amount, 0);
}

export function totalOutstanding(ms: PaymentMilestone[]): number {
  return ms.filter(m => m.status !== 'paid').reduce((s, m) => s + m.amount, 0);
}

export function allPaid(ms: PaymentMilestone[]): boolean {
  return ms.length > 0 && ms.every(m => m.status === 'paid');
}

/**
 * Resolve the finalized vendor + order amount for fulfillment.
 * RFQ → finalVendorId + approved RFQ price. Auction → approved invite + its latest quote total.
 */
export function resolveFinalVendor(
  request: CapexRequest,
  invites: VendorInvite[],
): { invite?: VendorInvite; amount: number } {
  // All amounts resolved on an INR basis (converts a foreign-currency quote) for PO/milestone math.
  if (request.sourcingMode === 'rfq' && request.finalVendorId) {
    const invite = invites.find(i => i.vendorId === request.finalVendorId);
    return { invite, amount: invite?.rfqQuote ? inrRfqTotal(invite.rfqQuote, request.lineItems) : request.budget ?? 0 };
  }
  const approved = invites.find(i => i.status === 'approved');
  if (approved) {
    // Auction ranks reset on start (seeded bid lives on openingQuote, not quotes[]) — fall back to
    // the opening bid so an awarded vendor who never re-bid still has a price to fulfill against.
    const q = latestQuote(approved);
    const amount = q ? inrQuoteGrandTotal(q) : request.budget ?? 0;
    return { invite: approved, amount };
  }
  return { amount: request.budget ?? 0 };
}

/**
 * The order value of ONE fulfillment track, on an INR basis — the figure the PO is raised for and
 * every payment milestone is computed from.
 *
 * Pass `invite` for a split-award track (its own awarded amount); omit it for the single-vendor
 * RFQ/auction track, which resolves through `resolveFinalVendor` — the negotiated, GST-inclusive
 * INR total. This is the same resolution `AccountsPanel` shows internally, so the internal tracker
 * and the public Plant-Accounts / PO-issue pages can never disagree about the same order.
 *
 * NOTE ON THE FALLBACK: `resolveFinalVendor` returns `request.budget` — the buyer's ex-ante
 * ESTIMATE — only when the finalized vendor has no quotation at all. That is a genuine last resort
 * so the page still renders a number; it is never a substitute for an agreed price. The public PO
 * pages previously reached that estimate directly, which issued POs at the estimate rather than the
 * negotiated total (e.g. ₹1.00 Cr against a ₹1.044 Cr agreed order).
 */
export function resolveOrderValue(
  request: CapexRequest,
  invites: VendorInvite[],
  invite?: VendorInvite,
): number {
  if (invite) return invite.awardAmount ?? invite.purchaseOrder?.amount ?? 0;
  return resolveFinalVendor(request, invites).amount;
}

export function isFulfillmentStatus(status: string): boolean {
  return FULFILLMENT_STATUSES.includes(status);
}

/**
 * Grand total of an auction / buyer-seeded `Quote` in its OWN currency: the base subtotal plus the
 * untaxed footer charges. Mirrors `rfqTotal`'s shape for the RFQ side.
 */
export function quoteGrandTotal(quote?: Quote): number {
  if (!quote) return 0;
  return quote.price + (quote.freight ?? 0) + (quote.packing ?? 0) + (quote.service ?? 0);
}

/** Same, converted to an INR basis so quotes in different currencies can be compared. */
export function inrQuoteGrandTotal(quote?: Quote): number {
  if (!quote) return 0;
  return toInr(quoteGrandTotal(quote), quote.currency);
}

/**
 * Item-wise GST on an auction / buyer-seeded `Quote`, in the quote's OWN currency — the `Quote`
 * counterpart of `rfqGstAmount`. GST comes from each LINE ITEM's own HSN code applied to that
 * line's `itemPrices[id] × qty`; footer charges are not taxed, exactly as on the RFQ side.
 *
 * A quote with no `itemPrices` (legacy lump-sum) yields 0 — there is no per-line price to tax —
 * which is the same answer `rfqGstAmount` gives for a quotation with no line prices.
 */
export function quoteGstAmount(quote?: Quote, items?: CapexLineItem[]): number {
  if (!quote || !items?.length) return 0;
  return items.reduce((sum, it) => {
    const unit = quote.itemPrices?.[it.id];
    if (unit == null || !it.hsnCode) return sum;
    return sum + gstAmount(unit * (parseFloat(it.quantity) || 1), it.hsnCode);
  }, 0);
}

/**
 * GST-INCLUSIVE grand total of a `Quote`, in its own currency: subtotal + freight/packing/service
 * + item-wise GST. Mirrors `rfqTotal`, so a `Quote` and an `RfqQuote` on the same request can be
 * compared on one basis. Comparing `quoteGrandTotal` (GST-exclusive) against `rfqTotal`
 * (GST-inclusive) is how a dearer seeded quote came to be flagged "Lowest" to an approver.
 */
export function quoteGrandTotalInclGst(quote?: Quote, items?: CapexLineItem[]): number {
  if (!quote) return 0;
  return quoteGrandTotal(quote) + quoteGstAmount(quote, items);
}

/** Same, on an INR basis — the figure to compare across vendors and currencies. */
export function inrQuoteGrandTotalInclGst(quote?: Quote, items?: CapexLineItem[]): number {
  if (!quote) return 0;
  return toInr(quoteGrandTotalInclGst(quote, items), quote.currency);
}

/** The quote that represents a vendor's current position: latest bid, else their opening bid. */
export function latestQuote(invite: VendorInvite): Quote | undefined {
  return invite.quotes[invite.quotes.length - 1] ?? invite.openingQuote;
}

// ── Trials + delivery-lead-time → final-payment date ─────────────────────────

/**
 * Whether the FINAL payment is blocked because a required trial has not been approved yet.
 * Only the final (`isFinal`) milestone is gated — advance + interim milestones are unaffected.
 */
export function finalPaymentBlockedByTrial(entity: { trialRequired?: boolean; trialStatus?: TrialStatus }): boolean {
  return !!entity.trialRequired && entity.trialStatus !== 'approved';
}

/** Delivery lead time in DAYS from a vendor invite (RFQ days → weeks fallback → auction quote). */
export function deliveryLeadDays(invite?: VendorInvite): number | undefined {
  if (!invite) return undefined;
  const rq = invite.rfqQuote;
  if (rq?.deliveryDays != null) return rq.deliveryDays;
  if (rq?.deliveryWeeks != null) return rq.deliveryWeeks * 7;
  const q = invite.quotes[invite.quotes.length - 1] ?? invite.openingQuote;
  if (q?.deliveryDays != null) return q.deliveryDays;
  return undefined;
}

/**
 * Expected final-payment date = advance-tick date + delivery lead time (days). The delivery clock
 * starts when Plant Accounts tick the advance milestone. Returns null when either input is missing.
 */
export function expectedFinalPaymentDate(advancePaidAt?: string, leadDays?: number): Date | null {
  if (!advancePaidAt || leadDays == null) return null;
  const start = new Date(advancePaidAt);
  if (isNaN(start.getTime())) return null;
  const d = new Date(start);
  d.setDate(d.getDate() + Math.round(leadDays));
  return d;
}
