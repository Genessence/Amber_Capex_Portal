/**
 * The ① "my turn" and ② "waiting on" bands for each role dashboard.
 *
 * Every bucket carries its own rows so the UI can expand inline — there is no filtered route for
 * most of these, and each bucket links straight to `/capex/[id]`.
 */
import type {
  AdhocBudgetRequest, BudgetProposal, CapexRequest, VendorInvite,
} from './types';
import type { Party, SlaKey } from './kpiUtils';
import {
  PARTY_LABELS, PARTY_SLA, SLA_DAYS,
  ageInDays, ballHolders, statusHistoryOf,
} from './kpiUtils';
import { effectiveRfqStatus, canRequestPi } from './rfqUtils';
import { effectiveIncoTermsStatus } from './incoTermsUtils';
import { effectiveTechSpecStatus, techSpecBlocksAward } from './techSpecUtils';
import { effectiveTrialStatus } from './trialUtils';
import { isAwardBased } from './paymentUtils';
import { isAuctionExpired } from './auctionUtils';
import { proposalTotalCr } from './budgetProposalUtils';

export interface QueueItem {
  id: string;
  label: string;
  sub?: string;
  href: string;
  ageDays: number | null;
}

export interface QueueBucket {
  key: string;
  label: string;
  items: QueueItem[];
  count: number;
  oldestDays: number | null;
  breached: boolean;
  slaKey?: SlaKey;
  /** Only set where a real filtered route already exists. */
  href?: string;
  /** Σ value in Crore, for budget buckets. */
  amountCr?: number;
}

export interface QueueBands {
  mine: QueueBucket[];
  waiting: QueueBucket[];
}

/**
 * Has one wait breached its party's threshold? **The single implementation of that comparison.**
 *
 * The convention is STRICTLY greater than the limit — an age of exactly `SLA_DAYS[slaKey]` is inside
 * the threshold, not past it. It lives here, next to `buildBucket` (which applies it at bucket level
 * to `oldestDays`), so a per-ITEM caller — `queueHeadline` in `kpiSourcing.ts`, which drives the
 * Sourcing hero band — cannot drift from the bucket badge rendered beside it. Both a `null` age
 * (undatable) and a missing `slaKey` (no threshold defined for that queue at all) return `false`:
 * neither is a breach, and neither may be scored as one.
 */
export function itemBreached(ageDays: number | null | undefined, slaKey?: SlaKey): boolean {
  if (!slaKey || ageDays == null) return false;
  return ageDays > SLA_DAYS[slaKey];
}

export function buildBucket(opts: {
  key: string;
  label: string;
  items: QueueItem[];
  slaKey?: SlaKey;
  href?: string;
  amountCr?: number;
}): QueueBucket {
  // Only items that are actually datable count. Coercing a null age to 0 made a bucket where NO
  // item can be dated render "<1d" and never breach — a fabricated zero, not an honest one.
  const ages = opts.items.map((i) => i.ageDays).filter((a): a is number => a != null);
  const oldestDays = ages.length ? Math.max(...ages) : null;
  return {
    ...opts,
    count: opts.items.length,
    oldestDays,
    breached: itemBreached(oldestDays, opts.slaKey),
  };
}

const requestLabel = (r: CapexRequest) => `${r.requestNo ?? r.id.slice(0, 8)} · ${r.subject}`;
const requestHref = (r: CapexRequest) => `/capex/${r.id}`;
const lastAt = (r: CapexRequest) => statusHistoryOf(r).slice(-1)[0].at;

/* ── shared "waiting on" band, derived from ball holders ──────────────── */

/**
 * Group every request by whoever is currently blocking it. Used by both the buyer and sourcing
 * dashboards, so the two never disagree about who holds the ball.
 */
export function waitingBands(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  now: number,
  parties: Party[],
): QueueBucket[] {
  const grouped = new Map<Party, QueueItem[]>();
  for (const r of requests) {
    for (const h of ballHolders(r, byRequest.get(r.id) ?? [], now)) {
      if (!parties.includes(h.party)) continue;
      const list = grouped.get(h.party) ?? [];
      list.push({
        // No `sub`: it used to read `waiting ${days}d`, which `ActionQueue` rendered right next to
        // the age badge it derives from the SAME `ageDays` — "waiting 5d  5d". The badge wins.
        // (Buckets whose sub carries different information, e.g. "₹2.40 Cr", still set it.)
        id: h.inviteId ? `${r.id}:${h.inviteId}` : r.id,
        label: requestLabel(r),
        href: requestHref(r),
        ageDays: h.days,
      });
      grouped.set(h.party, list);
    }
  }
  return parties
    .filter((p) => grouped.has(p))
    .map((p) =>
      buildBucket({
        key: p,
        label: PARTY_LABELS[p],
        items: grouped.get(p) ?? [],
        slaKey: PARTY_SLA[p],
      }),
    );
}

/* ── buyer ────────────────────────────────────────────────────────────── */

export function buyerQueues(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  now: number,
): QueueBands {
  const item = (r: CapexRequest, at: string): QueueItem => ({
    id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(at, now),
  });

  return {
    mine: [
      buildBucket({
        key: 'drafts',
        label: 'Drafts to submit',
        items: requests.filter((r) => r.status === 'draft').map((r) => item(r, r.createdAt)),
        href: '/capex/requests?filter=draft',
      }),
      buildBucket({
        key: 'awaitingPlantHead',
        label: 'Awaiting plant head — send or chase the link',
        items: requests
          .filter((r) => r.status === 'pending_head_approval')
          .map((r) => item(r, lastAt(r))),
        slaKey: 'plantHead',
        href: '/capex/requests?filter=pending_head_approval',
      }),
      buildBucket({
        key: 'rejected',
        label: 'Rejected — needs rework',
        items: requests.filter((r) => r.status === 'rejected').map((r) => item(r, lastAt(r))),
        href: '/capex/requests?filter=rejected',
      }),
    ],
    // `plant_head` is deliberately absent: `mine.awaitingPlantHead` already lists exactly those
    // requests, with better framing (the buyer holds the copy-link / preview-email affordance).
    // Listing them in both bands double-counted the same rows on one screen.
    waiting: waitingBands(requests, byRequest, now, [
      'sourcing', 'vendor', 'technical', 'plant_accounts', 'global_accounts',
    ]),
  };
}

/* ── sourcing ─────────────────────────────────────────────────────────── */

export function sourcingQueues(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  now: number,
): QueueBands {
  const pickup: QueueItem[] = [];
  const quotesToReview: QueueItem[] = [];
  const incoToSettle: QueueItem[] = [];
  const techSpecToSend: QueueItem[] = [];
  const techSpecToRevise: QueueItem[] = [];
  const readyToAward: QueueItem[] = [];
  const auctionUnawarded: QueueItem[] = [];
  const trialsToReview: QueueItem[] = [];

  const inviteItem = (r: CapexRequest, inv: VendorInvite, at: string | undefined): QueueItem => ({
    id: inv.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(at, now),
  });

  for (const r of requests) {
    const reqInvites = byRequest.get(r.id) ?? [];
    const awardBased = isAwardBased(reqInvites);

    if (r.status === 'sourcing' && reqInvites.length === 0) {
      pickup.push({ id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(lastAt(r), now) });
    }

    if (isAuctionExpired(r.auctionConfig) && !awardBased) {
      auctionUnawarded.push({ id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(r.auctionConfig?.endsAt, now) });
    }

    if (!awardBased && reqInvites.some((i) => canRequestPi(i) && !techSpecBlocksAward(i))) {
      readyToAward.push({ id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(lastAt(r), now) });
    }

    if (effectiveTrialStatus(r) === 'pending_review') {
      trialsToReview.push({ id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(r.trialSubmission?.uploadedAt, now) });
    }

    for (const inv of reqInvites) {
      const rfq = effectiveRfqStatus(inv);
      if (inv.rfqQuote && rfq === 'pending_sourcing') quotesToReview.push(inviteItem(r, inv, lastAt(r)));
      if (effectiveIncoTermsStatus(inv) === 'pending_sourcing') incoToSettle.push(inviteItem(r, inv, inv.incoTermsDoc?.respondedAt ?? lastAt(r)));

      const spec = effectiveTechSpecStatus(inv);
      if (spec === 'needs_revision') techSpecToRevise.push(inviteItem(r, inv, inv.techSpec?.decidedAt));
      // A serious award candidate in either sourcing mode: an approved RFQ quotation, or a vendor
      // who actually bid in an auction that has now ended. `openingQuote` counts because
      // `seedAuctionFromRfq` parks the seeded opening bid there and out of `quotes[]`, so a vendor
      // who never re-bid is still a candidate.
      const auctionCandidate =
        isAuctionExpired(r.auctionConfig) && (inv.quotes.length > 0 || !!inv.openingQuote);
      if (spec === 'not_sent' && (rfq === 'approved' || auctionCandidate)) {
        techSpecToSend.push(inviteItem(r, inv, lastAt(r)));
      }

      if (inv.awarded && effectiveTrialStatus(inv) === 'pending_review') {
        trialsToReview.push(inviteItem(r, inv, inv.trialSubmission?.uploadedAt));
      }
    }
  }

  return {
    mine: [
      buildBucket({ key: 'pickup', label: 'New requests to pick up', items: pickup }),
      buildBucket({ key: 'quotesToReview', label: 'Quotations to review', items: quotesToReview }),
      buildBucket({ key: 'incoToSettle', label: 'INCO terms to settle', items: incoToSettle }),
      buildBucket({ key: 'techSpecToSend', label: 'Tech spec to send', items: techSpecToSend, slaKey: 'techSpec' }),
      buildBucket({ key: 'techSpecToRevise', label: 'Tech spec to revise', items: techSpecToRevise, slaKey: 'techSpec' }),
      buildBucket({ key: 'readyToAward', label: 'Ready to award', items: readyToAward }),
      buildBucket({ key: 'auctionUnawarded', label: 'Auction ended, not awarded', items: auctionUnawarded }),
      buildBucket({ key: 'trialsToReview', label: 'Trials to review', items: trialsToReview, slaKey: 'trialReview' }),
    ],
    waiting: waitingBands(requests, byRequest, now, [
      'vendor', 'technical', 'plant_head', 'plant_accounts', 'global_accounts',
    ]),
  };
}

/* ── administration ───────────────────────────────────────────────────── */

/**
 * Requests sitting with the plant head PAST the plant-head SLA — the Administration dashboard's
 * "Stuck at plant head" tile. Exported because the tile's ROUTE has to carry the same predicate,
 * age threshold included: linking that tile at `?filter=pending_head_approval` listed every
 * pending request, so a tile reading 2 landed on a list of 11 with nothing marking the 2.
 */
export function stuckAtPlantHead(requests: CapexRequest[], now: number): CapexRequest[] {
  return requests.filter((r) => {
    if (r.status !== 'pending_head_approval') return false;
    const age = ageInDays(lastAt(r), now);
    return age != null && age > SLA_DAYS.plantHead;
  });
}

export function adminQueues(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  budgetProposals: BudgetProposal[],
  adhocRequests: AdhocBudgetRequest[],
  now: number,
): QueueBands {
  const proposalItem = (p: BudgetProposal, at: string | undefined): QueueItem => ({
    id: p.id,
    label: `FY ${p.targetFy} · ${p.plant}`,
    sub: `₹${proposalTotalCr(p).toFixed(2)} Cr`,
    href: '/capex/budget-approvals',
    ageDays: ageInDays(at, now),
  });

  const pendingAdmin = budgetProposals.filter((p) => p.status === 'pending_admin');
  const pendingAccounts = budgetProposals.filter((p) => p.status === 'pending_accounts');
  const pendingPlantHead = budgetProposals.filter((p) => p.status === 'pending_plant_head');
  const adhocPending = adhocRequests.filter((a) => a.status === 'pending_admin');

  const stuckPlantHead = stuckAtPlantHead(requests, now);

  const sumCr = (ps: BudgetProposal[]) => ps.reduce((s, p) => s + proposalTotalCr(p), 0);

  return {
    mine: [
      buildBucket({
        key: 'proposals',
        label: 'Budget proposals to decide',
        items: pendingAdmin.map((p) => proposalItem(p, p.plantHeadDecidedAt ?? p.submittedAt ?? p.createdAt)),
        slaKey: 'adminApproval',
        href: '/capex/budget-approvals',
        amountCr: sumCr(pendingAdmin),
      }),
      buildBucket({
        key: 'adhoc',
        label: 'Adhoc transfers to decide',
        items: adhocPending.map((a) => ({
          id: a.id,
          label: `${a.fromHead} → ${a.toHead}`,
          sub: `₹${a.amountCr.toFixed(2)} Cr · ${a.plant}`,
          href: '/capex/adhoc-budget',
          ageDays: ageInDays(a.createdAt, now),
        })),
        slaKey: 'adminApproval',
        href: '/capex/adhoc-budget',
        amountCr: adhocPending.reduce((s, a) => s + a.amountCr, 0),
      }),
      buildBucket({
        key: 'accountsLink',
        label: 'Awaiting Global Accounts sign-off — share or chase the link',
        items: pendingAccounts.map((p) => proposalItem(p, p.adminDecidedAt ?? p.submittedAt)),
        slaKey: 'accounts',
        href: '/capex/budget-approvals',
        amountCr: sumCr(pendingAccounts),
      }),
      buildBucket({
        key: 'stuckPlantHead',
        label: 'Requests stuck at the plant head',
        items: stuckPlantHead.map((r) => ({
          id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(lastAt(r), now),
        })),
        slaKey: 'plantHead',
        // Carries the age threshold, not just the status — this bucket counts only the breached
        // ones, so `?filter=pending_head_approval` would list rows the count excludes.
        href: '/capex/requests?metric=stuck_plant_head',
      }),
    ],
    waiting: [
      buildBucket({
        key: 'proposalsPlantHead',
        label: 'Budget proposals with the plant head',
        items: pendingPlantHead.map((p) => proposalItem(p, p.submittedAt ?? p.createdAt)),
        slaKey: 'plantHead',
        amountCr: sumCr(pendingPlantHead),
      }),
      ...waitingBands(requests, byRequest, now, ['sourcing', 'vendor', 'technical', 'plant_accounts', 'global_accounts']),
    ],
  };
}

/* ── maintenance (budget author) ──────────────────────────────────────── */

export function maintenanceQueues(proposals: BudgetProposal[], now: number): QueueBands {
  const item = (p: BudgetProposal, at: string | undefined): QueueItem => ({
    id: p.id,
    label: `FY ${p.targetFy} · ${p.plant}`,
    sub: `₹${proposalTotalCr(p).toFixed(2)} Cr`,
    href: '/capex/budget-proposals',
    ageDays: ageInDays(at, now),
  });
  const byStatus = (s: BudgetProposal['status']) => proposals.filter((p) => p.status === s);

  return {
    mine: [
      buildBucket({ key: 'drafts', label: 'Drafts to submit', items: byStatus('draft').map((p) => item(p, p.createdAt)) }),
      buildBucket({ key: 'needsCorrection', label: 'Sent back for correction', items: byStatus('needs_correction').map((p) => item(p, p.decidedAt ?? p.submittedAt)) }),
      buildBucket({ key: 'rejected', label: 'Rejected', items: byStatus('rejected').map((p) => item(p, p.decidedAt ?? p.submittedAt)) }),
    ],
    waiting: [
      buildBucket({ key: 'withPlantHead', label: 'With the plant head', items: byStatus('pending_plant_head').map((p) => item(p, p.submittedAt)), slaKey: 'plantHead' }),
      buildBucket({ key: 'withAdmin', label: 'With the admin', items: byStatus('pending_admin').map((p) => item(p, p.plantHeadDecidedAt ?? p.submittedAt)), slaKey: 'adminApproval' }),
      buildBucket({ key: 'withAccounts', label: 'With Global Accounts', items: byStatus('pending_accounts').map((p) => item(p, p.adminDecidedAt)), slaKey: 'accounts' }),
    ],
  };
}
