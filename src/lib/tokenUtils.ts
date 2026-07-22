import { BudgetProposal, CapexRequest, VendorInvite } from './types';

export function resolveInviteByToken(
  token: string,
  invites: VendorInvite[]
): VendorInvite | null {
  return invites.find((inv) => inv.token === token) ?? null;
}

export function isSubmissionAllowed(
  invite: VendorInvite,
  requests: CapexRequest[]
): boolean {
  const request = requests.find((r) => r.id === invite.requestId);
  if (!request) return false;
  return request.status !== 'buyer_approved' && request.status !== 'rejected';
}

export function generateToken(vendorId: string, requestId: string): string {
  return `tok_${vendorId}_${requestId}`;
}

export function buildSupplierLink(token: string): string {
  return `${window.location.origin}/supplier/${token}`;
}

// ── Public approval links (no login) ─────────────────────────────────────────
// Neither the plant head nor the Global Accounts team has a portal account; request + budget
// approvals happen through an emailed public link at /approve/<token>. A token resolves to a
// request (plant head), a budget at the plant-head stage, or a budget at the Global-Accounts stage.

export type ApprovalStage = 'plant_head' | 'accounts';

export type ApprovalTarget =
  | { kind: 'request'; request: CapexRequest }
  | { kind: 'budget'; proposal: BudgetProposal; stage: ApprovalStage };

/** Resolve an approval token to the request / budget proposal (and stage) it belongs to. */
export function resolveApprovalTarget(
  token: string,
  requests: CapexRequest[],
  budgetProposals: BudgetProposal[],
): ApprovalTarget | null {
  if (!token) return null;
  const request = requests.find((r) => r.approvalToken === token);
  if (request) return { kind: 'request', request };
  const plantHeadProposal = budgetProposals.find((p) => p.approvalToken === token);
  if (plantHeadProposal) return { kind: 'budget', proposal: plantHeadProposal, stage: 'plant_head' };
  const accountsProposal = budgetProposals.find((p) => p.accountsToken === token);
  if (accountsProposal) return { kind: 'budget', proposal: accountsProposal, stage: 'accounts' };
  return null;
}

/** Mint a fresh approval token (CSPRNG suffix — this token is the only credential). */
export function generateApprovalToken(
  kind: 'request' | 'budget' | 'budget_accounts',
  id: string,
): string {
  const rand = crypto.randomUUID().replace(/-/g, '');
  return `aprv_${kind}_${id}_${rand}`;
}

export function buildApprovalLink(token: string): string {
  return `${window.location.origin}/approve/${token}`;
}

// ── Fulfillment links (public, no login) ─────────────────────────────────────
// Neither accounts team has a portal account, and the fulfillment track is split across two links
// that resolve to the same request/award:
//   • `poToken`      → /po/<token>       — **Plant Accounts**: FA codes, then the payment milestones
//   • `poIssueToken` → /po-issue/<token> — **Global Accounts ("Satish")**: issue the Purchase Order
// Plant Accounts email the second link to Satish from their own page the moment they submit the FA
// codes. Each page asserts the `stage` it expects, so one link can never do the other's job.

export type PoStage = 'plant_accounts' | 'po_issue';

export type PoTarget =
  | { kind: 'request'; request: CapexRequest; stage: PoStage }
  | { kind: 'award'; request: CapexRequest; invite: VendorInvite; stage: PoStage };

/** Resolve a Plant-Accounts OR PO-issue token to the request/award it belongs to, plus its stage. */
export function resolvePoTarget(
  token: string,
  requests: CapexRequest[],
  invites: VendorInvite[],
): PoTarget | null {
  if (!token) return null;
  const invite = invites.find((inv) => inv.poToken === token || inv.poIssueToken === token);
  if (invite) {
    const request = requests.find((r) => r.id === invite.requestId);
    if (request) {
      const stage: PoStage = invite.poToken === token ? 'plant_accounts' : 'po_issue';
      return { kind: 'award', request, invite, stage };
    }
  }
  const request = requests.find((r) => r.poToken === token || r.poIssueToken === token);
  if (request) {
    const stage: PoStage = request.poToken === token ? 'plant_accounts' : 'po_issue';
    return { kind: 'request', request, stage };
  }
  return null;
}

/** Mint a fresh Plant-Accounts token (CSPRNG suffix — this token is the only credential). */
export function generatePoToken(kind: 'request' | 'award', id: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '');
  return `po_${kind}_${id}_${rand}`;
}

/** Mint a fresh Global-Accounts PO-issue token (CSPRNG suffix — the only credential). */
export function generatePoIssueToken(kind: 'request' | 'award', id: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '');
  return `poissue_${kind}_${id}_${rand}`;
}

export function buildPoLink(token: string): string {
  return `${window.location.origin}/po/${token}`;
}

export function buildPoIssueLink(token: string): string {
  return `${window.location.origin}/po-issue/${token}`;
}

// ── Technical-team spec-approval links (public, no login) ────────────────────
// Amber's Technical team signs off a vendor's machine specification BEFORE sourcing can award that
// vendor. They have no portal account, so the package is reviewed at /tech-spec/<token>. A token is
// minted per VendorInvite (the approval is per vendor) and rotated on every re-send.

export interface TechSpecTarget {
  invite: VendorInvite;
  request: CapexRequest;
}

/** Resolve a technical spec-approval token to the vendor invite + request it belongs to. */
export function resolveTechSpecTarget(
  token: string,
  invites: VendorInvite[],
  requests: CapexRequest[],
): TechSpecTarget | null {
  if (!token) return null;
  const invite = invites.find((inv) => inv.techSpec?.token === token);
  if (!invite) return null;
  const request = requests.find((r) => r.id === invite.requestId);
  return request ? { invite, request } : null;
}

/** Mint a fresh spec-approval token (CSPRNG suffix — this token is the only credential). */
export function generateTechSpecToken(inviteId: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '');
  return `spec_${inviteId}_${rand}`;
}

export function buildTechSpecLink(token: string): string {
  return `${window.location.origin}/tech-spec/${token}`;
}
