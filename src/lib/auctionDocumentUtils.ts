import {
  AuctionApprovalDocument,
  AuctionApprovalStatus,
  AuctionRules,
  CapexRequest,
  DeliveryLocation,
  VendorInvite,
} from './types';
import { PLANTS, ROLE_NAMES } from './constants';
import { DEFAULT_PBG_TEXT, DEFAULT_DLC_TEXT } from './docPackageUtils';

export const DEFAULT_AUCTION_RULES: AuctionRules = {
  bidValidityDays: 180,
  maxDecrements: 5,
  extensionDurationMinutes: 15,
  maxExtensionsPerBidder: 2,
  currency: 'INR',
};

export function formatDateDDMMYYYY(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatTimeHHMMHrs(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} Hrs`;
}

export function formatTimeHHMMAMPM(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hoursStr = String(hours).padStart(2, '0');
  return `${hoursStr}:${minutes} ${ampm}`;
}

export function getEffectiveAuctionApprovalStatus(
  invite: VendorInvite,
  revertDeadline?: string,
): AuctionApprovalStatus {
  if (invite.auctionApprovalStatus === 'pending' && revertDeadline) {
    const deadline = new Date(revertDeadline);
    if (deadline < new Date()) {
      return 'overdue';
    }
  }
  return invite.auctionApprovalStatus;
}

export function isVendorEligibleForAuction(invite: VendorInvite, revertDeadline?: string): boolean {
  const status = getEffectiveAuctionApprovalStatus(invite, revertDeadline);
  return status === 'approved';
}

export function getApprovedVendors(
  invites: VendorInvite[],
  revertDeadline?: string,
): VendorInvite[] {
  return invites.filter((inv) => isVendorEligibleForAuction(inv, revertDeadline));
}

export interface AuctionDocumentPlaceholders {
  auctionNumber: string;
  itemName: string;
  enquiryNumber: string;
  itemDescription: string;
  itemCode: string;
  quantity: string;
  unit: string;
  auctionDate: string;
  openingTime: string;
  closingTime: string;
  acceptanceDeadlineDate: string;
  acceptanceDeadlineTime: string;
  vendorRevertExpectedByDate: string;
  vendorRevertExpectedByTime: string;
  buyerName: string;
  buyerDesignation: string;
  buyerEmail: string;
  buyerMobile: string;
  bidValidityDays: string;
  maxDecrements: string;
  extensionDurationMins: string;
  maxExtensionsPerBidder: string;
  currency: string;
  supplyFrame: string;
  paymentTerms: string;
  deliveryLocations: string;
  signatoryName: string;
  signatoryDesignation: string;
}

export function buildAuctionDocumentPlaceholders(
  request: CapexRequest,
  document: AuctionApprovalDocument,
): AuctionDocumentPlaceholders {
  const lineItems = request.lineItems || [];
  const firstItem = lineItems[0];

  const itemName = firstItem?.description || request.subject || 'N/A';
  const itemDescription = lineItems
    .map((li, idx) => `${idx + 1}. ${li.description}${li.machineCapacity ? ` (Capacity: ${li.machineCapacity})` : ''}`)
    .join('\n') || request.subject || 'N/A';
  const quantity = lineItems.length > 0
    ? lineItems.map((li) => `${li.quantity} ${li.uom || 'units'}`).join(', ')
    : request.quantity || 'N/A';
  const unit = firstItem?.uom || 'units';

  const plant = request.plant ? PLANTS.find((p) => p.value === request.plant) : undefined;
  const deliveryLocs = document.deliveryLocations && document.deliveryLocations.length > 0
    ? document.deliveryLocations
        .map((loc) => `${loc.name}, ${loc.state}${loc.subLocationCount ? ` (${loc.subLocationCount} locations)` : ''}`)
        .join('\n')
    : plant
      ? `${plant.label}, ${plant.state}`
      : 'Amber Locations';

  return {
    auctionNumber: request.requestNo || `AUC-${request.id.slice(0, 8).toUpperCase()}`,
    itemName,
    enquiryNumber: request.requestNo || `ENQ-${request.id.slice(0, 8).toUpperCase()}`,
    itemDescription,
    itemCode: firstItem?.masterItemId || firstItem?.id.slice(0, 12) || 'N/A',
    quantity,
    unit,
    auctionDate: formatDateDDMMYYYY(document.auctionDate),
    openingTime: document.auctionOpeningTime,
    closingTime: document.auctionClosingTime,
    acceptanceDeadlineDate: formatDateDDMMYYYY(document.bidderAcceptanceDeadlineDate),
    acceptanceDeadlineTime: formatTimeHHMMAMPM(document.bidderAcceptanceDeadlineTime),
    vendorRevertExpectedByDate: document.vendorRevertDeadlineAt
      ? formatDateDDMMYYYY(document.vendorRevertDeadlineAt)
      : 'TBD',
    vendorRevertExpectedByTime: document.vendorRevertDeadlineAt
      ? formatTimeHHMMAMPM(document.vendorRevertDeadlineAt)
      : 'TBD',
    buyerName: document.buyerName,
    buyerDesignation: document.buyerDesignation,
    buyerEmail: document.buyerEmail,
    buyerMobile: document.buyerMobile,
    bidValidityDays: String(document.rules.bidValidityDays),
    maxDecrements: String(document.rules.maxDecrements),
    extensionDurationMins: String(document.rules.extensionDurationMinutes),
    maxExtensionsPerBidder: String(document.rules.maxExtensionsPerBidder),
    currency: document.rules.currency,
    supplyFrame: document.supplyFrame || 'As per Amber Terms and Conditions',
    paymentTerms: document.paymentTerms || '60 Days from the date of Invoice (Open Account)',
    deliveryLocations: deliveryLocs,
    signatoryName: document.signatoryName || 'Daljit Singh',
    signatoryDesignation: document.signatoryDesignation || 'Managing Director',
  };
}

export function createAuctionApprovalDocument(
  request: CapexRequest,
  currentUser: { name: string; designation: string; email: string; mobile: string },
  params: {
    auctionDate: string;
    auctionOpeningTime: string;
    auctionClosingTime: string;
    bidderAcceptanceDeadlineDate: string;
    bidderAcceptanceDeadlineTime: string;
    vendorRevertDeadlineAt?: string;
    deliveryLocations?: DeliveryLocation[];
    rules?: Partial<AuctionRules>;
    supplyFrame?: string;
    paymentTerms?: string;
    signatoryName?: string;
    signatoryDesignation?: string;
    performanceBankGuaranteeText?: string;
    delayLiabilityClauseText?: string;
  },
): AuctionApprovalDocument {
  return {
    id: `doc-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    auctionDate: params.auctionDate,
    auctionOpeningTime: params.auctionOpeningTime,
    auctionClosingTime: params.auctionClosingTime,
    bidderAcceptanceDeadlineDate: params.bidderAcceptanceDeadlineDate,
    bidderAcceptanceDeadlineTime: params.bidderAcceptanceDeadlineTime,
    vendorRevertDeadlineAt: params.vendorRevertDeadlineAt,
    buyerName: currentUser.name,
    buyerDesignation: currentUser.designation,
    buyerEmail: currentUser.email,
    buyerMobile: currentUser.mobile,
    deliveryLocations: params.deliveryLocations,
    rules: {
      ...DEFAULT_AUCTION_RULES,
      ...params.rules,
    },
    supplyFrame: params.supplyFrame,
    paymentTerms: params.paymentTerms,
    signatoryName: params.signatoryName,
    signatoryDesignation: params.signatoryDesignation,
    performanceBankGuaranteeText: params.performanceBankGuaranteeText ?? DEFAULT_PBG_TEXT,
    delayLiabilityClauseText: params.delayLiabilityClauseText ?? DEFAULT_DLC_TEXT,
  };
}

export const AUCTION_APPROVAL_STATUS_LABELS: Record<AuctionApprovalStatus, string> = {
  not_sent: 'Not Sent',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  excluded: 'Excluded',
  overdue: 'Overdue',
};

export const AUCTION_APPROVAL_STATUS_COLORS: Record<AuctionApprovalStatus, string> = {
  not_sent: 'bg-slate-100 text-slate-600',
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  excluded: 'bg-gray-100 text-gray-600',
  overdue: 'bg-red-100 text-red-800',
};

export function canStartAuction(
  invites: VendorInvite[],
  revertDeadline?: string,
): { canStart: boolean; approvedCount: number; pendingCount: number; rejectedCount: number; overdueCount: number } {
  const approvedCount = invites.filter((inv) => getEffectiveAuctionApprovalStatus(inv, revertDeadline) === 'approved').length;
  const pendingCount = invites.filter((inv) => inv.auctionApprovalStatus === 'pending').length;
  const rejectedCount = invites.filter((inv) => ['rejected', 'excluded'].includes(inv.auctionApprovalStatus)).length;
  const overdueCount = invites.filter((inv) => getEffectiveAuctionApprovalStatus(inv, revertDeadline) === 'overdue').length;

  return {
    canStart: approvedCount > 0,
    approvedCount,
    pendingCount,
    rejectedCount,
    overdueCount,
  };
}
