/**
 * Technical specification approval helpers (pre-award gate, per vendor).
 *
 * Flow: sourcing attaches the machine's spec documents — typically the datasheet the VENDOR
 * provided — plus notes, and sends the package to Amber's Technical team through a tokenised
 * public link (`/tech-spec/<token>`). The Technical team approves, sends it back for revision,
 * or rejects. Sourcing revises and re-sends; the loop repeats until approved. Only then can that
 * vendor be awarded and their Proforma Invoice requested (`techSpecBlocksAward`).
 */
import type { TechSpecApproval, TechSpecStatus, VendorInvite } from './types';

/** Max spec documents per vendor package (keeps the IndexedDB payload sane). */
export const MAX_TECH_SPEC_DOCS = 6;
/** Per-file cap for spec documents (2 MB — drawings and datasheets run larger than quotes). */
export const MAX_TECH_SPEC_FILE_BYTES = 2 * 1024 * 1024;

export const TECH_SPEC_STATUS_LABELS: Record<TechSpecStatus, string> = {
  not_sent: 'Spec Not Sent',
  pending_technical: 'With Technical Team',
  needs_revision: 'Revision Needed',
  approved: 'Spec Approved',
  rejected: 'Spec Rejected',
};

export const TECH_SPEC_STATUS_COLORS: Record<TechSpecStatus, string> = {
  not_sent: 'bg-slate-100 text-slate-600 border border-slate-200',
  pending_technical: 'bg-amber-50 text-amber-700 border border-amber-200',
  needs_revision: 'bg-orange-50 text-orange-700 border border-orange-200',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
};

/** Tolerant read — an invite with no package has simply never been sent. */
export function effectiveTechSpecStatus(invite: VendorInvite): TechSpecStatus {
  return invite.techSpec?.status ?? 'not_sent';
}

/** A blank package, created the first time sourcing attaches a document or writes notes. */
export function buildBlankTechSpec(): TechSpecApproval {
  return { id: `ts-${crypto.randomUUID()}`, status: 'not_sent', documents: [], thread: [] };
}

/** Statuses sourcing can (re-)send from: never sent, sent back, or rejected outright. */
const SENDABLE: TechSpecStatus[] = ['not_sent', 'needs_revision', 'rejected'];

/** Whether sourcing may send / re-send this vendor's spec to the Technical team right now. */
export function canSendTechSpec(invite: VendorInvite): boolean {
  return SENDABLE.includes(effectiveTechSpecStatus(invite));
}

/** Whether the Technical team may act on this package right now (their turn). */
export function canDecideTechSpec(invite: VendorInvite): boolean {
  return effectiveTechSpecStatus(invite) === 'pending_technical';
}

/**
 * Award gate: a vendor cannot be awarded / have their PI requested until the Technical team has
 * approved their machine specification. Every status other than `approved` blocks — including
 * `not_sent`, so the step cannot be skipped by simply never sending it.
 */
export function techSpecBlocksAward(invite: VendorInvite): boolean {
  return effectiveTechSpecStatus(invite) !== 'approved';
}

/** A package is sendable only with something for the Technical team to actually review. */
export function isTechSpecReadyToSend(spec?: TechSpecApproval): boolean {
  if (!spec) return false;
  return spec.documents.length > 0 || !!spec.notes?.trim();
}

/** Short "what happens next" line per status, for the sourcing tracker. */
export const TECH_SPEC_HINTS: Record<TechSpecStatus, string> = {
  not_sent: 'Attach the spec documents and send them to the Technical team.',
  pending_technical: 'With Amber’s Technical team for specification sign-off.',
  needs_revision: 'Technical sent it back — revise the spec and re-send.',
  approved: 'Specification approved — this vendor can be awarded.',
  rejected: 'Specification rejected — this vendor cannot be awarded.',
};
