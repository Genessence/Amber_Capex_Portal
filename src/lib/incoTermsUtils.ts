/**
 * INCO (Incoterms 2020) agreement helpers. A new / one-time vendor must agree to a 12-question
 * Incoterms document before they can submit a price quote. Sourcing and the vendor negotiate it
 * (fill → review → edit & resend → approve/reject), mirroring the RFQ turn-taking.
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
 * INCO gating: a one-time / new vendor must reach `approved` before quoting. Onboarded vendors
 * (not one-time) are never gated. `vendor` may be undefined for a yet-unresolved invite.
 */
export function incoTermsBlocksQuote(invite: VendorInvite, vendor?: Vendor | null): boolean {
  if (!vendor?.oneTime) return false;
  return effectiveIncoTermsStatus(invite) !== 'approved';
}
