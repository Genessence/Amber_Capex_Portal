/**
 * INCO (Incoterms 2020) agreement helpers.
 *
 * Flow (2026-07): the Incoterms questionnaire is answered **with the quotation, not before it**.
 * A FOREIGN vendor fills in their prices, hits Submit Quotation, and is shown the 12 questions in a
 * modal; answering them submits the quote and the Incoterms together in one atomic mutation
 * (`proposeRfqQuote(..., incoDoc)`) — neither is persisted without the other. Sourcing then sees the
 * answers, and the two sides negotiate exactly like the RFQ price thread:
 *
 *   vendor fills (with quote) → pending_sourcing
 *     sourcing edits & sends back → pending_vendor
 *       vendor accepts → approved | suggests changes → pending_sourcing | declines → rejected
 *     sourcing approves → approved | rejects → rejected
 *
 * The loop repeats until the terms are approved. An unsettled Incoterms agreement no longer blocks
 * quoting — it blocks the **award** (see `incoTermsBlocksAward`, folded into `canRequestPi`).
 */
import type { IncoTermsDoc, IncoTermsStatus, VendorInvite, Vendor } from './types';

export type IncoQuestionKey = keyof Omit<IncoTermsDoc, 'id' | 'sentAt' | 'respondedAt' | 'revisionNote'>;

export interface IncoQuestion {
  key: IncoQuestionKey;
  label: string;
  type: 'select' | 'text' | 'textarea';
  options?: string[];
  required?: boolean;
}

/** The 11 official Incoterms 2020 rules. */
export const INCOTERM_RULES = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];

/** The 12-question vendor questionnaire (Incoterms 2020). */
export const INCO_TERMS_QUESTIONS: IncoQuestion[] = [
  { key: 'incoterm', label: 'Incoterm rule', type: 'select', options: INCOTERM_RULES, required: true },
  { key: 'placeOfDelivery', label: 'Place / port of delivery', type: 'text', required: true },
  { key: 'modeOfTransport', label: 'Mode of transport', type: 'select', options: ['Air', 'Road', 'Rail', 'Sea', 'Inland Waterway', 'Multimodal'], required: true },
  { key: 'freightArrangedBy', label: 'Who arranges main freight', type: 'select', options: ['Seller', 'Buyer'], required: true },
  { key: 'freightCostBy', label: 'Freight cost borne by', type: 'select', options: ['Seller', 'Buyer', 'Shared'], required: true },
  { key: 'insuranceArrangedBy', label: 'Who arranges insurance', type: 'select', options: ['Seller', 'Buyer', 'Not covered'], required: true },
  { key: 'insuranceCostBy', label: 'Insurance cost borne by', type: 'select', options: ['Seller', 'Buyer', 'Not covered'], required: true },
  { key: 'exportCustoms', label: 'Export customs clearance', type: 'select', options: ['Seller', 'Buyer'], required: true },
  { key: 'importCustoms', label: 'Import customs & duties', type: 'select', options: ['Seller', 'Buyer'], required: true },
  { key: 'riskTransfer', label: 'Risk transfers at', type: 'select', options: ['Seller premises', 'Carrier handoff', 'Alongside vessel', 'On board vessel', 'Destination (before unload)', 'Destination (after unload)'], required: true },
  { key: 'loadingUnloading', label: 'Loading / unloading responsibility', type: 'select', options: ['Seller loads / Buyer unloads', 'Seller loads & unloads', 'Buyer loads & unloads'], required: true },
  { key: 'remarks', label: 'Delivery timeline, currency & remarks', type: 'textarea' },
];

export const INCO_TERMS_STATUS_LABELS: Record<IncoTermsStatus, string> = {
  not_sent: 'Not Sent',
  awaiting_vendor: 'Awaiting Vendor',
  pending_sourcing: 'Needs Review',
  pending_vendor: 'Sent to Vendor',
  approved: 'INCO Approved',
  rejected: 'INCO Rejected',
};

export const INCO_TERMS_STATUS_COLORS: Record<IncoTermsStatus, string> = {
  not_sent: 'bg-slate-100 text-slate-600 border border-slate-200',
  awaiting_vendor: 'bg-amber-50 text-amber-700 border border-amber-200',
  pending_sourcing: 'bg-amber-50 text-amber-700 border border-amber-200',
  pending_vendor: 'bg-blue-50 text-blue-700 border border-blue-200',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
};

export function effectiveIncoTermsStatus(invite: VendorInvite): IncoTermsStatus {
  return invite.incoTermsStatus ?? 'not_sent';
}

/** A blank INCO doc, with a couple of sensible defaults to guide the vendor. */
export function buildBlankIncoTermsDoc(): IncoTermsDoc {
  return {
    id: `inco-${crypto.randomUUID()}`,
    incoterm: 'FOB',
    modeOfTransport: 'Sea',
  };
}

/** Whether all required questions are answered (for enabling submit). */
export function isIncoDocComplete(doc?: IncoTermsDoc): boolean {
  if (!doc) return false;
  return INCO_TERMS_QUESTIONS.every((q) => !q.required || !!(doc[q.key] && String(doc[q.key]).trim()));
}

/**
 * Incoterms apply to FOREIGN vendors only (they are international-shipping terms). Domestic
 * vendors never see the questionnaire. `vendor` may be undefined for a yet-unresolved invite.
 */
export function incoTermsRequired(vendor?: Vendor | null): boolean {
  return !!vendor?.foreign;
}

/** Statuses that mean the vendor has never actually answered the questionnaire. */
const UNANSWERED: IncoTermsStatus[] = ['not_sent', 'awaiting_vendor'];

/**
 * Whether submitting a quotation must first collect the Incoterms answers — i.e. the vendor is
 * foreign and has not yet filled the form. Once answered, re-quoting never re-asks: the agreement
 * negotiates on its own track.
 */
export function needsIncoTermsWithQuote(invite: VendorInvite, vendor?: Vendor | null): boolean {
  if (!incoTermsRequired(vendor)) return false;
  return UNANSWERED.includes(effectiveIncoTermsStatus(invite));
}

/** True while the Incoterms ball is in the vendor's court (sourcing sent back a revision). */
export function incoTermsAwaitingVendor(invite: VendorInvite, vendor?: Vendor | null): boolean {
  return incoTermsRequired(vendor) && effectiveIncoTermsStatus(invite) === 'pending_vendor';
}

/**
 * Award gate: a foreign vendor cannot be taken to Proforma Invoice while the Incoterms agreement
 * is still open. Keyed off the invite alone (the field is only ever set for foreign vendors), so
 * callers that have no `Vendor` in hand — e.g. `canRequestPi` — can still enforce it.
 */
export function incoTermsBlocksAward(invite: VendorInvite): boolean {
  const status = invite.incoTermsStatus;
  if (!status || status === 'not_sent') return false; // never applied to this vendor
  return status !== 'approved';
}
