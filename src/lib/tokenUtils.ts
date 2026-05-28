import { CapexRequest, VendorInvite } from './types';

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
