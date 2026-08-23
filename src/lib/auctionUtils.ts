import type { AuctionConfig, Quote, RfqQuote, VendorInvite } from './types';
import { toInr } from './currencyUtils';
import { rfqTotal, type GstLineItem } from './rfqUtils';

export function isAuctionExpired(config?: AuctionConfig): boolean {
  if (!config?.endsAt) return false;
  return new Date(config.endsAt) <= new Date();
}

export function isAuctionActive(config?: AuctionConfig): boolean {
  if (!config?.startedAt || !config?.endsAt) return false;
  const now = new Date();
  return new Date(config.startedAt) <= now && new Date(config.endsAt) > now;
}

export function formatAuctionCountdown(endsAt: string): string {
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Auction closed';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${days}d ${hours}h ${mins}m`;
}

export interface VendorRanking {
  inviteId: string;
  vendorId: string;
  /**
   * The ranking basis: the bid's BASE SUBTOTAL converted to INR. Foreign-currency bids used to be
   * ranked (and displayed under a ₹ sign) at their raw face value, so a $1,00,000 bid outranked an
   * ₹80,00,000 one. Rank, gap-to-L1 and every ₹-labelled figure derived from this are INR.
   */
  price: number;
  /** The same subtotal in the currency the vendor actually quoted — display only, never compared. */
  nativePrice: number;
  /** The bid's own currency (defaults to INR when the quote carries none). */
  currency: string;
  rank: number;
}

/**
 * Rank vendors L1..Ln by their current bid, cheapest first, on an INR basis.
 *
 * Basis note: this ranks the bid's `price` — the BASE SUBTOTAL, per the auction-bid convention —
 * while `computeAuctionBestPrice` below prices the WHOLE quote (subtotal + freight/packing/service).
 * That difference is intentional and unchanged here; only the currency normalisation was missing.
 * Only `quotes` is read (never `openingQuote`), so ranks stay empty until a vendor actually re-bids.
 */
export function computeVendorRankings(invites: VendorInvite[]): VendorRanking[] {
  const withQuotes = invites
    .map((inv) => {
      const latest = inv.quotes[inv.quotes.length - 1];
      if (!latest) return null;
      const currency = latest.currency ?? 'INR';
      return {
        inviteId: inv.id,
        vendorId: inv.vendorId,
        price: toInr(latest.price, currency),
        nativePrice: latest.price,
        currency,
      };
    })
    .filter((entry): entry is Omit<VendorRanking, 'rank'> => entry !== null);

  withQuotes.sort((a, b) => a.price - b.price);
  return withQuotes.map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

export function rankLabel(rank: number): string {
  return `L${rank}`;
}

/**
 * The unit price a bid offers for one line item, in the bid's OWN currency. Falls back to the
 * whole-quote `price` for legacy bids that were never priced line by line — the same fallback the
 * comparison grid and the Final-Decision auto-fill use.
 */
export function quoteLineUnitPrice(quote: Quote | null | undefined, lineItemId: string): number | null {
  if (!quote) return null;
  return quote.itemPrices?.[lineItemId] ?? quote.price ?? null;
}

/**
 * Index of the column holding the LOWEST unit price for a line item, compared on an INR basis.
 * Returns null when no column carries a bid.
 *
 * This drives the comparison grid's per-line "↓ Lowest" highlight, which in turn steers the award
 * (selecting a vendor auto-fills that line's Final-Decision price). Comparing the raw quoted units
 * hands the highlight — and the award — to whichever vendor happens to quote in the smallest-
 * numbered currency: a USD unit of 50,000 (₹42,75,000) beat an INR unit of ₹40,00,000.
 */
export function lowestInrUnitIndex(
  quotes: (Quote | null | undefined)[],
  lineItemId: string,
): number | null {
  let min = Infinity;
  let minIdx = -1;
  quotes.forEach((q, i) => {
    if (!q) return;
    const unit = quoteLineUnitPrice(q, lineItemId);
    if (unit == null) return;
    const inr = toInr(unit, q.currency);
    if (inr < min) {
      min = inr;
      minIdx = i;
    }
  });
  return minIdx >= 0 ? minIdx : null;
}

/** The L1 (cheapest) bid's base subtotal, INR — comparable with every other ranking `price`. */
export function getL1Price(rankings: VendorRanking[]): number | null {
  const l1 = rankings.find((r) => r.rank === 1);
  return l1?.price ?? null;
}

// ── Auction "best price" ─────────────────────────────────────────────────────
//
// The auction OPENS at the lowest RFQ quotation less 5% — that is the price vendors must beat.
// It is set once, and from then on the best price only moves when a vendor actually beats it: a
// live bid below the opening price becomes the new best price, while bids above it leave the
// opening price standing. It is a whole-quote number; there is deliberately no per-line-item best
// price. Everything is derived on demand from data every auction already has, so in-flight
// auctions get this with no backfill or migration.

/** The decrement applied to the lowest RFQ quotation to open the auction's "price to beat". */
export const AUCTION_DECREMENT = 0.05;

/** Lowest RFQ quotation → the auction's opening best price. */
export function applyAuctionDecrement(price: number): number {
  return Math.round(price * (1 - AUCTION_DECREMENT));
}

/** Whole-quote total on an INR basis, so a foreign-currency quote isn't mistaken for the lowest. */
function quoteTotalInr(q: Quote): number | null {
  // `price` is the base subtotal by the auction-bid convention; charges are separate.
  const total = q.price + (q.freight ?? 0) + (q.packing ?? 0) + (q.service ?? 0);
  return Number.isFinite(total) && total > 0 ? toInr(total, q.currency) : null;
}

function rfqTotalInr(rq: RfqQuote, lineItems?: GstLineItem[]): number | null {
  const total = rfqTotal(rq, lineItems);
  return Number.isFinite(total) && total > 0 ? toInr(total, rq.currency) : null;
}

/**
 * A vendor's pre-auction quotation: the `openingQuote` seeded once by `seedAuctionFromRfq`, else
 * their RFQ quotation. `quotes` is deliberately NOT consulted — `submitQuote` overwrites it in
 * place, so it only ever holds the vendor's CURRENT bid, which is the live figure below.
 */
function openingTotalInr(invite: VendorInvite, lineItems?: GstLineItem[]): number | null {
  if (invite.openingQuote) return quoteTotalInr(invite.openingQuote);
  if (invite.rfqQuote) return rfqTotalInr(invite.rfqQuote, lineItems);
  return null;
}

/** A vendor's current standing auction bid. */
function liveBidTotalInr(invite: VendorInvite): number | null {
  const latest = invite.quotes[invite.quotes.length - 1];
  return latest ? quoteTotalInr(latest) : null;
}

/**
 * The auction's current best price (INR, whole quote).
 *
 * Opens at the lowest RFQ quotation − 5% — preferring `config.openingBestPrice`, stamped by
 * `setAuctionConfig` at setup, and deriving it only for auctions configured before that field
 * existed. Once a vendor bids BELOW that, their bid is the best price. Null when the auction has
 * neither an opening quotation nor a live bid to price against.
 */
export function computeAuctionBestPrice(
  invites: VendorInvite[],
  lineItems?: GstLineItem[],
  config?: AuctionConfig,
): number | null {
  const openings = invites
    .map((inv) => openingTotalInr(inv, lineItems))
    .filter((n): n is number => n !== null);
  const openingBest =
    config?.openingBestPrice ??
    (openings.length ? applyAuctionDecrement(Math.min(...openings)) : null);

  const liveBids = invites.map(liveBidTotalInr).filter((n): n is number => n !== null);
  const lowestLive = liveBids.length ? Math.min(...liveBids) : null;

  if (openingBest === null) return lowestLive;
  if (lowestLive === null) return openingBest;
  return Math.min(openingBest, lowestLive);
}

export function buildAuctionEndsAt(startedAt: string, durationDays: number): string {
  const end = new Date(startedAt);
  end.setDate(end.getDate() + durationDays);
  return end.toISOString();
}

export function extendAuctionEndsAt(endsAt: string, extraDays: number): string {
  const end = new Date(endsAt);
  end.setDate(end.getDate() + extraDays);
  return end.toISOString();
}
