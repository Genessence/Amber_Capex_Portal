/**
 * Approval remarks — the one place a remark left at ANY gate is built, sanitized and appended.
 *
 * Every approval surface in this app writes through here: the internal ones (super-admin budget
 * approvals, sourcing sending a spec) and, more importantly, the four TOKENISED PUBLIC pages whose
 * actors have no portal login — the plant head (`/approve`), Amber's Technical team (`/tech-spec`),
 * Plant Accounts (`/po`) and Global Accounts (`/po-issue`). Those pages take free text from an
 * unauthenticated browser, so the text is trimmed and length-capped HERE rather than at each call
 * site; a boundary that is enforced per-page is a boundary that is eventually forgotten on one page.
 *
 * The trail is append-only and lives on the entity the gate belongs to (`CapexRequest`,
 * `BudgetProposal`, `VendorInvite`). It is deliberately NOT a second status field: a remark never
 * changes what the workflow does, it only carries what the approver said to whoever acts next.
 *
 * Pure module — no React, no I/O — so the whole of it is unit-tested (`approvalRemarks.test.ts`).
 */
import type { ApprovalAction, ApprovalRemark, ApprovalStage } from './types';

/**
 * Hard cap on one remark. Remarks share the ~5 MB `localStorage` payload with the primary workflow
 * record, and the text arrives from an unauthenticated public page, so it is bounded rather than
 * trusted. Anything longer is truncated (with an ellipsis) — never silently dropped, because losing
 * an approver's reasoning is worse than losing its tail.
 */
export const MAX_REMARK_LENGTH = 1000;

/**
 * Hard cap on how many remarks one entity keeps. A request that loops through a spec revision a
 * dozen times still bounds its payload; the OLDEST are dropped, because the recent ones are the
 * ones the next approver acts on.
 */
export const MAX_REMARKS_PER_ENTITY = 60;

export const APPROVAL_STAGE_LABELS: Record<ApprovalStage, string> = {
  plant_head_request: 'Plant Head',
  plant_head_budget: 'Plant Head · Budget',
  admin_budget: 'Admin · Budget',
  accounts_budget: 'Global Accounts · Budget',
  technical_spec: 'Technical Team',
  sourcing_tech_spec: 'Sourcing → Technical Team',
  plant_accounts_fa: 'Plant Accounts · FA Codes',
  plant_accounts_payment: 'Plant Accounts · Payment',
  global_accounts_po: 'Global Accounts · PO',
};

export const APPROVAL_ACTION_LABELS: Record<ApprovalAction, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  sent_back: 'Sent back',
  forwarded: 'Approved with edits',
  sent: 'Sent',
  noted: 'Remark',
};

/** Badge classes per action — the portal's shared 5-phase tone palette (see `BADGE_TONE`). */
export const APPROVAL_ACTION_COLORS: Record<ApprovalAction, string> = {
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  sent_back: 'bg-orange-50 text-orange-700 border-orange-200',
  forwarded: 'bg-blue-50 text-blue-700 border-blue-200',
  sent: 'bg-blue-50 text-blue-700 border-blue-200',
  noted: 'bg-slate-50 text-slate-700 border-slate-200',
};

/**
 * Normalise untrusted remark text: coerce to string, strip control characters (a pasted NUL or
 * vertical-tab would survive JSON round-tripping and render as a blank box), collapse runs of blank lines, trim,
 * and truncate at `MAX_REMARK_LENGTH`.
 *
 * Returns `undefined` for anything that is empty once trimmed — an empty remark is not a remark, and
 * storing one would put a meaningless entry in the trail that the next approver has to read past.
 */
export function sanitizeRemarkText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw
    // Keep \n and \t; drop every other C0/C1 control character.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > MAX_REMARK_LENGTH ? `${cleaned.slice(0, MAX_REMARK_LENGTH - 1).trimEnd()}…` : cleaned;
}

/**
 * Build a remark, or `null` when there is nothing to record. Callers pass the raw textarea value
 * straight in — "the user opened the box and typed nothing" must produce no entry, and every call
 * site relying on the same `null` short-circuit is what keeps that consistent.
 *
 * `at` and `id` are injectable so the whole module stays deterministic under test.
 */
export function buildApprovalRemark(input: {
  stage: ApprovalStage;
  action: ApprovalAction;
  by: string;
  text: unknown;
  at?: string;
  id?: string;
}): ApprovalRemark | null {
  const text = sanitizeRemarkText(input.text);
  if (!text) return null;
  const at = input.at ?? new Date().toISOString();
  const by = (typeof input.by === 'string' ? input.by.trim() : '') || 'Unknown';
  return {
    id: input.id ?? `rmk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stage: input.stage,
    action: input.action,
    by,
    text,
    at,
  };
}

/**
 * Append a remark to a trail, oldest-first, bounded at `MAX_REMARKS_PER_ENTITY`.
 * A `null` remark (nothing typed) returns the trail UNCHANGED — including returning the very same
 * array reference — so a no-op decision cannot dirty the entity or churn React identity.
 */
export function appendRemark(
  trail: ApprovalRemark[] | undefined,
  remark: ApprovalRemark | null,
): ApprovalRemark[] | undefined {
  if (!remark) return trail;
  const next = [...(trail ?? []), remark];
  return next.length > MAX_REMARKS_PER_ENTITY ? next.slice(next.length - MAX_REMARKS_PER_ENTITY) : next;
}

/**
 * The spread-ready patch for a decision mutation:
 *
 *   { ...entity, status: 'approved', ...remarkPatch(entity.approvalRemarks, remark) }
 *
 * Returns an EMPTY object when there is no remark, so the field is left exactly as it was rather
 * than being rewritten to an identical array on every decision.
 */
export function remarkPatch(
  trail: ApprovalRemark[] | undefined,
  remark: ApprovalRemark | null,
): { approvalRemarks?: ApprovalRemark[] } {
  if (!remark) return {};
  return { approvalRemarks: appendRemark(trail, remark) };
}

/** Convenience: build + patch in one call, straight from a raw textarea value. */
export function remarkPatchFrom(
  trail: ApprovalRemark[] | undefined,
  input: { stage: ApprovalStage; action: ApprovalAction; by: string; text: unknown; at?: string },
): { approvalRemarks?: ApprovalRemark[] } {
  return remarkPatch(trail, buildApprovalRemark(input));
}

/** Remarks for one stage, oldest-first. */
export function remarksForStage(
  trail: ApprovalRemark[] | undefined,
  stage: ApprovalStage | ApprovalStage[],
): ApprovalRemark[] {
  const stages = Array.isArray(stage) ? stage : [stage];
  return (trail ?? []).filter((r) => stages.includes(r.stage));
}

/** The most recent remark (optionally within one stage), or `undefined`. */
export function latestRemark(
  trail: ApprovalRemark[] | undefined,
  stage?: ApprovalStage | ApprovalStage[],
): ApprovalRemark | undefined {
  const list = stage ? remarksForStage(trail, stage) : (trail ?? []);
  return list.length ? list[list.length - 1] : undefined;
}

/** One-line description used in email bodies and toasts. */
export function describeRemark(remark: ApprovalRemark): string {
  return `${APPROVAL_STAGE_LABELS[remark.stage] ?? remark.stage} — ${
    APPROVAL_ACTION_LABELS[remark.action] ?? remark.action
  } by ${remark.by}: ${remark.text}`;
}
