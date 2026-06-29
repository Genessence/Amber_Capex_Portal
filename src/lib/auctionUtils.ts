import type { AuctionConfig, VendorInvite } from './types';

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
  price: number;
  rank: number;
}

export function computeVendorRankings(invites: VendorInvite[]): VendorRanking[] {
  const withQuotes = invites
    .map((inv) => {
      const latest = inv.quotes[inv.quotes.length - 1];
      if (!latest) return null;
      return { inviteId: inv.id, vendorId: inv.vendorId, price: latest.price };
    })
    .filter((entry): entry is { inviteId: string; vendorId: string; price: number } => entry !== null);

  withQuotes.sort((a, b) => a.price - b.price);
  return withQuotes.map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

export function rankLabel(rank: number): string {
  return `L${rank}`;
}

export function getL1Price(rankings: VendorRanking[]): number | null {
  const l1 = rankings.find((r) => r.rank === 1);
  return l1?.price ?? null;
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
