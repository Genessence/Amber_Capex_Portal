/**
 * Document-approval package helpers. Before fulfillment, a vendor must agree to the
 * Performance Bank Guarantee and Delay Liability Clause (and, for one-time / non-onboarded
 * vendors, the payment terms). Used by both the RFQ flow and the reverse-auction approval.
 */
import type { DocApprovalStatus, DocApprovalPackage, PaymentSplit, Vendor } from './types';

export const DOC_APPROVAL_STATUS_LABELS: Record<DocApprovalStatus, string> = {
  not_sent: 'Not Sent',
  pending: 'Awaiting Vendor',
  approved: 'Documents Approved',
  rejected: 'Documents Declined',
};

export const DOC_APPROVAL_STATUS_COLORS: Record<DocApprovalStatus, string> = {
  not_sent: 'bg-slate-100 text-slate-600',
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
};

export const DEFAULT_TERMS_TEXT =
  'These commercial terms govern the supply against this enquiry, including scope, quality, ' +
  'inspection, packing, freight, and warranty obligations as communicated by Amber Enterprises India Ltd.';

export const DEFAULT_PBG_TEXT =
  'Performance Bank Guarantee (PBG): The supplier shall furnish a Performance Bank Guarantee equal to 10% ' +
  'of the order value, valid through the warranty period, towards due performance of the contract. The PBG ' +
  'will be released on successful completion of supply, installation, and the warranty obligations.';

export const DEFAULT_DLC_TEXT =
  'Delay Liability Clause (DLC): A Turn-Around-Time (TAT) begins one week after the Proforma Invoice is raised. ' +
  'A deduction of 0.5% of the order value applies for every week of delay. Once cumulative deductions reach 5%, ' +
  'the deduction rate escalates to 5% of the order value per week thereafter. Deductions stop when the final ' +
  'payment is released.';

export const DEFAULT_ONE_TIME_PAYMENT_TERMS =
  'As a one-time / not-yet-onboarded vendor, the following payment terms apply and require your acceptance.';

export const DEFAULT_PAYMENT_SPLITS: PaymentSplit[] = [
  { id: 'adv', label: 'Advance', percent: 30, trigger: 'On PO' },
  { id: 'dispatch', label: 'On Dispatch', percent: 60, trigger: 'On dispatch' },
  { id: 'install', label: 'On Installation', percent: 10, trigger: 'On installation' },
];

export function effectiveDocApprovalStatus(status?: DocApprovalStatus): DocApprovalStatus {
  return status ?? 'not_sent';
}

/**
 * Build the document-approval package for a vendor. Always includes PBG + DLC; includes
 * payment terms only for one-time / non-onboarded vendors (onboarded vendors' terms are
 * fetched from the external onboarding portal and shown separately).
 */
export function buildDocApprovalPackage(
  vendor: Vendor,
  opts?: { termsText?: string; revisionNote?: string },
): DocApprovalPackage {
  return {
    id: `dap-${crypto.randomUUID()}`,
    termsText: opts?.termsText ?? DEFAULT_TERMS_TEXT,
    performanceBankGuaranteeText: DEFAULT_PBG_TEXT,
    delayLiabilityClauseText: DEFAULT_DLC_TEXT,
    paymentTermsText: vendor.oneTime
      ? (vendor.paymentTermsText || DEFAULT_ONE_TIME_PAYMENT_TERMS)
      : undefined,
    paymentSplits: vendor.oneTime
      ? (vendor.paymentSplits?.length ? vendor.paymentSplits : DEFAULT_PAYMENT_SPLITS)
      : undefined,
    revisionNote: opts?.revisionNote,
  };
}
