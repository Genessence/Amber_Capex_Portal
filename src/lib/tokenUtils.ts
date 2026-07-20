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

// ── Plant-head approval links (public, no login) ─────────────────────────────
// The plant head has no portal account; budget + request approvals happen through an emailed
// public link at /approve/<token>. A token resolves to either a request or a budget proposal.

export type ApprovalTarget =
  | { kind: 'request'; request: CapexRequest }
  | { kind: 'budget'; proposal: BudgetProposal };

/** Resolve a plant-head approval token to the request or budget proposal it belongs to. */
export function resolveApprovalTarget(
  token: string,
  requests: CapexRequest[],
  budgetProposals: BudgetProposal[],
): ApprovalTarget | null {
  if (!token) return null;
  const request = requests.find((r) => r.approvalToken === token);
  if (request) return { kind: 'request', request };
  const proposal = budgetProposals.find((p) => p.approvalToken === token);
  if (proposal) return { kind: 'budget', proposal };
  return null;
}

/** Mint a fresh plant-head approval token (CSPRNG suffix — this token is the only credential). */
export function generateApprovalToken(kind: 'request' | 'budget', id: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '');
  return `aprv_${kind}_${id}_${rand}`;
}

export function buildApprovalLink(token: string): string {
  return `${window.location.origin}/approve/${token}`;
}

// ── Global Accounts (Sandeep) PO-issue links (public, no login) ───────────────
// After Plant Accounts submit FA codes, Sandeep raises the PO via an emailed public link at
// /po/<token>. A token resolves to either a single-vendor request or a split-award invite.

export type PoTarget =
  | { kind: 'request'; request: CapexRequest }
  | { kind: 'award'; request: CapexRequest; invite: VendorInvite };

/** Resolve a Sandeep PO-issue token to the request or award it belongs to. */
export function resolvePoTarget(
  token: string,
  requests: CapexRequest[],
  invites: VendorInvite[],
): PoTarget | null {
  if (!token) return null;
  const invite = invites.find((inv) => inv.poToken === token);
  if (invite) {
    const request = requests.find((r) => r.id === invite.requestId);
    if (request) return { kind: 'award', request, invite };
  }
  const request = requests.find((r) => r.poToken === token);
  if (request) return { kind: 'request', request };
  return null;
}

/** Mint a fresh Global-Accounts PO-issue token (CSPRNG suffix — this token is the only credential). */
export function generatePoToken(kind: 'request' | 'award', id: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '');
  return `po_${kind}_${id}_${rand}`;
}

export function buildPoLink(token: string): string {
  return `${window.location.origin}/po/${token}`;
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
