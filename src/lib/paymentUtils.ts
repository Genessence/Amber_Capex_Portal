/**
 * Payment-milestone helpers. Milestones derive from the finalized vendor's payment-terms
 * split (e.g. 30% advance / 60% dispatch / 10% installation). Accounts (or sourcing) marks
 * each milestone paid; ticking the final one stops the TAT clock and completes the request.
 */
import type { AwardStatus, CapexLineItem, CapexRequest, CapexStatus, PaymentMilestone, TrialStatus, Vendor, VendorInvite } from './types';
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
 * Group the Final-Decision selections (per-line vendor + price/disc) into one award per vendor,
 * computing each award's GST-inclusive amount. Mirrors VendorGrid's per-line `net` (price ×
 * (1-disc/100) × qty) and folds in item-wise GST via the line item's HSN code.
 */
export function buildAwardGroups(
  lineItems: CapexLineItem[],
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
    const q = approved.quotes[approved.quotes.length - 1] ?? approved.openingQuote;
    const amount = q
      ? toInr(q.price + (q.freight ?? 0) + (q.packing ?? 0) + (q.service ?? 0), q.currency)
      : request.budget ?? 0;
    return { invite: approved, amount };
  }
  return { amount: request.budget ?? 0 };
}

export function isFulfillmentStatus(status: string): boolean {
  return FULFILLMENT_STATUSES.includes(status);
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
