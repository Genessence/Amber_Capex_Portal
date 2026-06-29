/**
 * Helpers for next-FY Brown Field budget proposals. A proposal is authored by
 * maintenance / plant head / sourcing, then approved by an admin which publishes
 * its rows as a new live FY in the CAPEX master.
 */
import type {
  BudgetProposal,
  BudgetProposalItem,
  BudgetProposalStatus,
  CapexMasterItem,
  ProjectType,
} from './types';
import { FLAT_MASTER_DIVISION, resolveProjectType } from './greenFieldConstants';
import type { ParsedMasterRow } from './bulkMasterImport';

export const BUDGET_PROPOSAL_STATUS_LABELS: Record<BudgetProposalStatus, string> = {
  draft: 'Draft',
  pending_admin: 'Pending Admin Approval',
  approved: 'Approved & Published',
  rejected: 'Rejected',
};

export const BUDGET_PROPOSAL_STATUS_COLORS: Record<BudgetProposalStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  pending_admin: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
};

/** Given an FY code like "2026-27", return the next one ("2027-28"). */
export function nextFyCode(fy: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(fy.trim());
  if (!m) return fy;
  const start = parseInt(m[1], 10) + 1;
  const end = (start + 1) % 100;
  return `${start}-${String(end).padStart(2, '0')}`;
}

/** Latest Brown Field FY among master rows, optionally scoped to a plant + project type. */
export function getLatestBrownFieldFy(
  capexMaster: CapexMasterItem[],
  plant?: string,
  projectType?: ProjectType,
): string {
  const scoped = capexMaster.filter((m) => {
    if ((m.fieldType ?? 'brown_field') !== 'brown_field') return false;
    if (plant && m.plant !== plant) return false;
    if (projectType && resolveProjectType(m) !== projectType) return false;
    return true;
  });
  const fys = [...new Set(scoped.map((m) => m.fy))].sort((a, b) => b.localeCompare(a));
  return fys[0] ?? '';
}

function masterItemToProposalItem(item: CapexMasterItem): BudgetProposalItem {
  return {
    id: `bpi-${crypto.randomUUID()}`,
    head: item.head,
    department: item.department,
    subParticulars: item.subParticulars,
    rate: item.rate,
    totalCost: item.totalCost,
    division: item.division ?? FLAT_MASTER_DIVISION,
    qty: item.qty,
    rateRs: item.rateRs,
    sNo: item.sNo,
    reasonForRequirement: item.reasonForRequirement,
    benefits: item.benefits,
    roi: item.roi,
    sourceMasterItemId: item.id,
  };
}

/** A blank proposal item for manual add. */
export function emptyProposalItem(head: string): BudgetProposalItem {
  return {
    id: `bpi-${crypto.randomUUID()}`,
    head,
    department: '',
    subParticulars: '',
    rate: 0,
    totalCost: 0,
    division: FLAT_MASTER_DIVISION,
  };
}

/** Convert a parsed bulk row into a proposal item. */
export function parsedRowToProposalItem(row: ParsedMasterRow): BudgetProposalItem {
  return {
    id: `bpi-${crypto.randomUUID()}`,
    head: row.head,
    department: row.department,
    subParticulars: row.subParticulars,
    rate: row.rateRs != null && row.qty != null ? row.totalCost : 0,
    totalCost: row.totalCost,
    division: FLAT_MASTER_DIVISION,
    qty: row.qty,
    rateRs: row.rateRs,
    sNo: row.sNo,
    reasonForRequirement: row.reasonForRequirement,
    benefits: row.benefits,
    roi: row.roi,
  };
}

export interface CreateProposalOpts {
  capexMaster: CapexMasterItem[];
  plant: string;
  projectType: ProjectType;
  /** Target FY to publish into; defaults to next FY after the latest live Brown Field FY. */
  targetFy?: string;
  createdBy: string;
}

/** Seed a new proposal by cloning the live-FY Brown Field rows for a plant + project type. */
export function createProposalFromLiveFy(opts: CreateProposalOpts): BudgetProposal {
  const sourceFy = getLatestBrownFieldFy(opts.capexMaster, opts.plant, opts.projectType);
  const items = opts.capexMaster
    .filter(
      (m) =>
        (m.fieldType ?? 'brown_field') === 'brown_field' &&
        m.plant === opts.plant &&
        m.fy === sourceFy &&
        resolveProjectType(m) === opts.projectType,
    )
    .map(masterItemToProposalItem);

  return {
    id: `bp-${crypto.randomUUID()}`,
    plant: opts.plant,
    projectType: opts.projectType,
    targetFy: opts.targetFy ?? (sourceFy ? nextFyCode(sourceFy) : ''),
    sourceFy: sourceFy || undefined,
    status: 'draft',
    items,
    createdBy: opts.createdBy,
    createdAt: new Date().toISOString(),
  };
}

export interface HeadSummary {
  head: string;
  totalCr: number;
  count: number;
}

/** Group proposal items by head with summed totalCost (Cr) and row count. */
export function summarizeProposalByHead(items: BudgetProposalItem[]): HeadSummary[] {
  const map = new Map<string, HeadSummary>();
  items.forEach((it) => {
    const existing = map.get(it.head) ?? { head: it.head, totalCr: 0, count: 0 };
    existing.totalCr += it.totalCost || 0;
    existing.count += 1;
    map.set(it.head, existing);
  });
  return [...map.values()].sort((a, b) => a.head.localeCompare(b.head));
}

/** Group live master rows by head for diffing against a proposal. */
export function summarizeMasterByHead(
  capexMaster: CapexMasterItem[],
  plant: string,
  fy: string,
  projectType: ProjectType,
): HeadSummary[] {
  const items = capexMaster.filter(
    (m) =>
      (m.fieldType ?? 'brown_field') === 'brown_field' &&
      m.plant === plant &&
      m.fy === fy &&
      resolveProjectType(m) === projectType,
  );
  const map = new Map<string, HeadSummary>();
  items.forEach((it) => {
    const existing = map.get(it.head) ?? { head: it.head, totalCr: 0, count: 0 };
    existing.totalCr += it.totalCost || 0;
    existing.count += 1;
    map.set(it.head, existing);
  });
  return [...map.values()].sort((a, b) => a.head.localeCompare(b.head));
}

export interface HeadDiffRow {
  head: string;
  liveCr: number;
  proposedCr: number;
  deltaCr: number;
}

/** Per-head diff of a proposal vs the live FY it was based on. */
export function diffProposalAgainstLive(
  proposal: BudgetProposal,
  capexMaster: CapexMasterItem[],
): HeadDiffRow[] {
  const live = summarizeMasterByHead(
    capexMaster,
    proposal.plant,
    proposal.sourceFy ?? '',
    proposal.projectType,
  );
  const proposed = summarizeProposalByHead(proposal.items);
  const heads = [...new Set([...live.map((h) => h.head), ...proposed.map((h) => h.head)])].sort(
    (a, b) => a.localeCompare(b),
  );
  return heads.map((head) => {
    const liveCr = live.find((h) => h.head === head)?.totalCr ?? 0;
    const proposedCr = proposed.find((h) => h.head === head)?.totalCr ?? 0;
    return { head, liveCr, proposedCr, deltaCr: proposedCr - liveCr };
  });
}

export function proposalTotalCr(proposal: BudgetProposal): number {
  return proposal.items.reduce((s, it) => s + (it.totalCost || 0), 0);
}

/** Validate a proposal before it can be submitted for approval. */
export function validateProposal(proposal: BudgetProposal): string[] {
  const errors: string[] = [];
  if (!proposal.targetFy || !/^\d{4}-\d{2}$/.test(proposal.targetFy)) {
    errors.push('Target financial year must be in YYYY-YY format (e.g. 2027-28).');
  }
  if (!proposal.items.length) {
    errors.push('Add at least one budget line before submitting.');
  }
  proposal.items.forEach((it, i) => {
    if (!it.subParticulars.trim()) errors.push(`Line ${i + 1}: Sub Particulars is required.`);
    if (!(it.totalCost > 0)) errors.push(`Line ${i + 1}: Total Cost (Cr) must be greater than 0.`);
  });
  return errors;
}

/** Convert an approved proposal's items into new CapexMasterItem rows for the target FY. */
export function buildMasterItemsFromProposal(proposal: BudgetProposal): CapexMasterItem[] {
  return proposal.items.map((it) => ({
    id: `cm-${crypto.randomUUID()}`,
    fieldType: 'brown_field' as const,
    projectType: proposal.projectType,
    greenFieldProjectType: proposal.projectType,
    division: it.division ?? FLAT_MASTER_DIVISION,
    plant: proposal.plant,
    head: it.head,
    department: it.department,
    subParticulars: it.subParticulars,
    rate: it.rate,
    totalCost: it.totalCost,
    fy: proposal.targetFy,
    sNo: it.sNo,
    rateRs: it.rateRs,
    qty: it.qty,
    reasonForRequirement: it.reasonForRequirement,
    benefits: it.benefits,
    roi: it.roi,
  }));
}
