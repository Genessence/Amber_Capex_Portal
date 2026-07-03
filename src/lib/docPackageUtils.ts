/**
 * Document-approval package helpers. Before fulfillment, a vendor must agree to the
 * Performance Bank Guarantee and Delay Liability Clause (and, for one-time / non-onboarded
 * vendors, the payment terms). Used by both the RFQ flow and the reverse-auction approval.
 */
import type { DocApprovalStatus, DocApprovalPackage, DocSelection, PaymentSplit, Vendor } from './types';

/** Canonical named documents sourcing can choose to send (besides custom extras). */
export const DOC_OPTIONS = [
  { key: 'commercialTerms', label: 'Commercial Terms' },
  { key: 'pbg', label: 'Performance Bank Guarantee (PBG)' },
  { key: 'dlc', label: 'Delay Liability Clause (DLC)' },
  { key: 'paymentTerms', label: 'Payment Terms' },
] as const;

export const DOC_APPROVAL_STATUS_LABELS: Record<DocApprovalStatus, string> = {
  not_sent: 'Not Sent',
  pending: 'Awaiting Vendor',
  approved: 'Documents Approved',
  rejected: 'Documents Declined',
};

export const DOC_APPROVAL_STATUS_COLORS: Record<DocApprovalStatus, string> = {
  not_sent: 'bg-slate-100 text-slate-600 border border-slate-200',
  pending: 'bg-amber-50 text-amber-700 border border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
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
 * Default document selection when sourcing didn't choose explicitly: Commercial Terms + PBG + DLC
 * for everyone, plus Payment Terms for one-time / non-onboarded vendors. Preserves the historical
 * behaviour for every call site that doesn't pass a per-vendor selection.
 */
export function defaultDocSelection(vendor: Vendor): DocSelection {
  return { commercialTerms: true, pbg: true, dlc: true, paymentTerms: !!vendor.oneTime, extraDocs: [] };
}

/**
 * Build the document-approval package for a vendor, honouring a per-vendor `selection` of which
 * documents to send (chosen by sourcing at invite time). Omitted documents are left undefined so
 * the supplier renderer and the PI gate simply don't show / require them.
 */
export function buildDocApprovalPackage(
  vendor: Vendor,
  opts?: { termsText?: string; revisionNote?: string; selection?: DocSelection },
): DocApprovalPackage {
  const sel = opts?.selection ?? defaultDocSelection(vendor);
  return {
    id: `dap-${crypto.randomUUID()}`,
    termsText: sel.commercialTerms ? (opts?.termsText ?? DEFAULT_TERMS_TEXT) : undefined,
    performanceBankGuaranteeText: sel.pbg ? DEFAULT_PBG_TEXT : undefined,
    delayLiabilityClauseText: sel.dlc ? DEFAULT_DLC_TEXT : undefined,
    paymentTermsText: sel.paymentTerms
      ? (vendor.paymentTermsText || DEFAULT_ONE_TIME_PAYMENT_TERMS)
      : undefined,
    paymentSplits: sel.paymentTerms
      ? (vendor.paymentSplits?.length ? vendor.paymentSplits : DEFAULT_PAYMENT_SPLITS)
      : undefined,
    extraDocs: sel.extraDocs?.length ? sel.extraDocs : undefined,
    revisionNote: opts?.revisionNote,
  };
}

/** Human-readable titles of the documents actually present in a package (for summary/decline copy). */
export function docPackageTitles(pkg?: DocApprovalPackage): string[] {
  if (!pkg) return [];
  const out: string[] = [];
  if (pkg.termsText) out.push('Commercial Terms');
  if (pkg.performanceBankGuaranteeText) out.push('Performance Bank Guarantee');
  if (pkg.delayLiabilityClauseText) out.push('Delay Liability Clause');
  if (pkg.paymentTermsText) out.push('Payment Terms');
  for (const d of pkg.extraDocs ?? []) out.push(d.title);
  return out;
}
