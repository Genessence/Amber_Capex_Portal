/**
 * Helpers for next-FY Brown Field budget proposals. A proposal is authored by
 * maintenance / plant head / sourcing, then approved by an admin which publishes
 * its rows as a new live FY in the CAPEX master.
 */
import type {
  BudgetProposal,
  BudgetProposalEdit,
  BudgetProposalEditStage,
  BudgetProposalItem,
  BudgetProposalStatus,
  CapexMasterItem,
  FieldType,
  GreenFieldBudgetAllocations,
  ProjectType,
} from './types';
import {
  FLAT_MASTER_DIVISION,
  GREEN_FIELD_SECTION_ORDER,
  isGreenFieldSection,
  resolveProjectType,
} from './greenFieldConstants';
import type { ParsedMasterRow } from './bulkMasterImport';

export const BUDGET_PROPOSAL_STATUS_LABELS: Record<BudgetProposalStatus, string> = {
  draft: 'Draft',
  pending_plant_head: 'With Plant Head',
  pending_admin: 'With Admin',
  needs_correction: 'Sent Back for Correction',
  pending_accounts: 'With Global Accounts',
  approved: 'Approved & Published',
  rejected: 'Rejected',
};

export const BUDGET_PROPOSAL_STATUS_COLORS: Record<BudgetProposalStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 border border-slate-200',
  pending_plant_head: 'bg-amber-50 text-amber-700 border border-amber-200',
  pending_admin: 'bg-blue-50 text-blue-700 border border-blue-200',
  needs_correction: 'bg-orange-50 text-orange-700 border border-orange-200',
  pending_accounts: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
};

/** Given an FY code like "2026-27", return the next one ("2027-28"). */
export function nextFyCode(fy: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(fy.trim());
  if (!m) return fy;
  const start = parseInt(m[1], 10) + 1;
  const end = (start + 1) % 100;
  return `${start}-${String(end).padStart(2, '0')}`;
}

/**
 * The FY that contains `now`, on the Indian April–March financial year (2026-08 → "2026-27").
 * Green Field budgets seed a brand-new plant, so there is usually no prior Green Field year to take
 * "next FY" from — the live year is the right default, not a blank field the admin must guess at.
 */
export function currentFyCode(now: Date = new Date()): string {
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
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

/**
 * Which budget a proposal authors. Proposals written before Green Field planning existed carry no
 * `fieldType`, and every one of them is Brown Field — so the fallback is not a guess.
 */
export function proposalFieldType(proposal: Pick<BudgetProposal, 'fieldType'>): FieldType {
  return proposal.fieldType ?? 'brown_field';
}

/** Green Field publishes straight from the admin's upload — no plant-head / accounts chain. */
export function publishesDirectly(proposal: Pick<BudgetProposal, 'fieldType'>): boolean {
  return proposalFieldType(proposal) === 'green_field';
}

/**
 * Latest FY of the field type this proposal authors, scoped to the plant + project type. Green
 * Field has its own FY line (a published Brown Field year must never move the Green Field one), so
 * the lookup is field-scoped rather than reusing the Brown Field helper.
 */
export function getLatestFyForProposal(
  capexMaster: CapexMasterItem[],
  fieldType: FieldType,
  plant?: string,
  projectType?: ProjectType,
): string {
  const scoped = capexMaster.filter((m) => {
    if ((m.fieldType ?? 'brown_field') !== fieldType) return false;
    if (plant && m.plant !== plant) return false;
    if (projectType && resolveProjectType(m) !== projectType) return false;
    return true;
  });
  const fys = [...new Set(scoped.map((m) => m.fy))].sort((a, b) => b.localeCompare(a));
  return fys[0] ?? '';
}

/** A blank proposal item for manual add. */
export function emptyProposalItem(head: string, division?: string): BudgetProposalItem {
  return {
    id: `bpi-${crypto.randomUUID()}`,
    head,
    department: '',
    subParticulars: '',
    rate: 0,
    totalCost: 0,
    division: division ?? FLAT_MASTER_DIVISION,
  };
}

/** Convert a parsed bulk row into a proposal item. Rate is not part of the budget any more. */
export function parsedRowToProposalItem(
  row: ParsedMasterRow,
  fieldType: FieldType = 'brown_field',
): BudgetProposalItem {
  const greenField = fieldType === 'green_field';
  return {
    id: `bpi-${crypto.randomUUID()}`,
    head: row.head,
    department: row.department,
    subParticulars: row.subParticulars,
    rate: 0,
    totalCost: row.totalCost,
    // Brown Field is flat and always lands in the internal bucket. Green Field's division IS the
    // section the machine belongs to, so it is carried through from the sheet.
    division: greenField ? (row.division || GREEN_FIELD_SECTION_ORDER[0]) : FLAT_MASTER_DIVISION,
    sectionBudgetCr: greenField ? row.sectionBudgetCr : undefined,
    headBudgetCr: greenField ? row.headBudgetCr : undefined,
    qty: row.qty,
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
  /** Defaults to Brown Field. Green Field proposals are `super_admin`-only. */
  fieldType?: FieldType;
  /** Target FY to publish into; defaults to next FY after the latest live Brown Field FY. */
  targetFy?: string;
  createdBy: string;
}

/**
 * Start a new next-FY proposal. It is deliberately **BLANK** — the previous FY's budget is never
 * pre-filled, so each year is authored from scratch (add lines manually or bulk-upload a workbook).
 * The live FY is still read, but only to derive the default target FY.
 */
export function createBlankProposal(opts: CreateProposalOpts): BudgetProposal {
  const fieldType = opts.fieldType ?? 'brown_field';
  const latestFy = getLatestFyForProposal(opts.capexMaster, fieldType, opts.plant, opts.projectType);
  return {
    id: `bp-${crypto.randomUUID()}`,
    plant: opts.plant,
    projectType: opts.projectType,
    fieldType,
    // Brown Field plans the year AFTER the live one. Green Field opens a plant's budget for the
    // CURRENT year (or re-publishes into the year it already has), so it does not roll forward.
    targetFy:
      opts.targetFy ??
      (fieldType === 'green_field'
        ? latestFy || currentFyCode()
        : latestFy
          ? nextFyCode(latestFy)
          : ''),
    status: 'draft',
    items: [],
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

export function proposalTotalCr(proposal: BudgetProposal): number {
  return proposal.items.reduce((s, it) => s + (it.totalCost || 0), 0);
}

const itemsTotalCr = (items: BudgetProposalItem[]) => items.reduce((s, it) => s + (it.totalCost || 0), 0);

/** Do these two line-item sets differ in any way an approver would care about? */
function itemsChanged(before: BudgetProposalItem[], after: BudgetProposalItem[]): boolean {
  if (before.length !== after.length) return true;
  const key = (it: BudgetProposalItem) =>
    [it.id, it.head, it.department, it.subParticulars, it.qty ?? '', it.totalCost || 0].join('\0');
  const beforeKeys = before.map(key).sort();
  const afterKeys = after.map(key).sort();
  return beforeKeys.some((k, i) => k !== afterKeys[i]);
}

/**
 * Apply an approver's line-item edits while the proposal moves FORWARD to the next stage, and
 * append an audit entry so the downstream approver (and the author) can see that the numbers were
 * changed, by whom, and by how much.
 *
 * Returns the proposal unchanged when there is nothing to apply — no edits passed, or the edits
 * are identical to what is already stored — so an approver who merely opens the edit panel and
 * approves does not pollute the trail. A remark on its own is still recorded.
 */
export function applyApproverEdit(
  proposal: BudgetProposal,
  editedItems: BudgetProposalItem[] | undefined,
  stage: BudgetProposalEditStage,
  by: string,
  at: string,
  note?: string,
): BudgetProposal {
  const trimmedNote = note?.trim() || undefined;
  const changed = !!editedItems && itemsChanged(proposal.items, editedItems);
  if (!changed && !trimmedNote) return proposal;

  const nextItems = changed ? editedItems! : proposal.items;
  const entry: BudgetProposalEdit = {
    id: `bpe-${crypto.randomUUID()}`,
    stage,
    by,
    at,
    note: trimmedNote,
    linesBefore: proposal.items.length,
    linesAfter: nextItems.length,
    totalBeforeCr: itemsTotalCr(proposal.items),
    totalAfterCr: itemsTotalCr(nextItems),
  };
  return { ...proposal, items: nextItems, edits: [...(proposal.edits ?? []), entry] };
}

export interface ApproverEditImpact {
  /**
   * Σ (`totalBeforeCr` − `totalAfterCr`) across every approver edit.
   *
   * POSITIVE means approvers TRIMMED the ask; NEGATIVE means they RAISED it. Callers must flip the
   * label, the sign and the tone together — rendering a negative as "trimmed" reads backwards.
   */
  trimCr: number;
  /** Σ `resubmitCount` — how often proposals had to go round again. */
  resubmits: number;
}

/** What the approval chain actually changed across a set of proposals. */
export function approverEditImpact(proposals: BudgetProposal[]): ApproverEditImpact {
  let trimCr = 0;
  let resubmits = 0;
  for (const p of proposals) {
    for (const e of p.edits ?? []) trimCr += e.totalBeforeCr - e.totalAfterCr;
    resubmits += p.resubmitCount ?? 0;
  }
  return { trimCr, resubmits };
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
  if (proposalFieldType(proposal) === 'green_field') {
    proposal.items.forEach((it, i) => {
      // A typo in Section would silently file the machine under an envelope the request wizard
      // never shows, so it is rejected at the door rather than published wrong.
      if (!it.division || !isGreenFieldSection(it.division)) {
        errors.push(
          `Line ${i + 1}: Section must be one of ${GREEN_FIELD_SECTION_ORDER.join(', ')}.`,
        );
      }
      if (!it.head?.trim()) errors.push(`Line ${i + 1}: Head is required.`);
    });
  }
  return errors;
}

// ── Green Field hierarchy ─────────────────────────────────────────────────────

export interface GreenFieldScopeSummary {
  section: string;
  /** Envelope assigned to the section (Cr) — the sheet's figure, else Σ of its heads. */
  budgetCr: number;
  /** Σ of every machine line in the section (Cr). */
  usedCr: number;
  heads: { head: string; budgetCr: number; usedCr: number; count: number }[];
}

/**
 * The Green Field hierarchy a proposal describes: section envelope → head envelope → Σ machines.
 *
 * The uploaded sheet repeats each envelope figure on every row of its scope, so the FIRST non-empty
 * value per scope wins and the repeats are ignored. Where the sheet carries no envelope at all, the
 * scope rolls up from its children — a budget that adds up is always better than a zero envelope
 * that would render every head as "over allocation".
 */
export function summarizeProposalGreenField(items: BudgetProposalItem[]): GreenFieldScopeSummary[] {
  const sections = new Map<string, GreenFieldScopeSummary>();
  const sectionDeclared = new Map<string, number>();
  const headDeclared = new Map<string, number>();

  for (const it of items) {
    const section = it.division || GREEN_FIELD_SECTION_ORDER[0];
    const head = it.head?.trim() || section;
    if (it.sectionBudgetCr != null && !sectionDeclared.has(section)) {
      sectionDeclared.set(section, it.sectionBudgetCr);
    }
    const headKey = `${section}\u0000${head}`;
    if (it.headBudgetCr != null && !headDeclared.has(headKey)) {
      headDeclared.set(headKey, it.headBudgetCr);
    }
    const entry = sections.get(section) ?? { section, budgetCr: 0, usedCr: 0, heads: [] };
    entry.usedCr += it.totalCost || 0;
    const headEntry = entry.heads.find((h) => h.head === head);
    if (headEntry) { headEntry.usedCr += it.totalCost || 0; headEntry.count += 1; }
    else entry.heads.push({ head, budgetCr: 0, usedCr: it.totalCost || 0, count: 1 });
    sections.set(section, entry);
  }

  const order = (d: string) => {
    const idx = (GREEN_FIELD_SECTION_ORDER as readonly string[]).indexOf(d);
    return idx === -1 ? GREEN_FIELD_SECTION_ORDER.length : idx;
  };
  return [...sections.values()]
    .map((entry) => ({
      ...entry,
      budgetCr: sectionDeclared.get(entry.section) ?? entry.usedCr,
      heads: entry.heads
        .map((h) => ({
          ...h,
          budgetCr: headDeclared.get(`${entry.section}\u0000${h.head}`) ?? h.usedCr,
        }))
        .sort((a, b) => a.head.localeCompare(b.head)),
    }))
    .sort((a, b) => order(a.section) - order(b.section));
}

/** The plant envelope a Green Field proposal publishes — the stated figure, else Σ its sections. */
export function greenFieldPlantBudgetCr(proposal: BudgetProposal): number {
  if (proposal.plantBudgetCr != null && proposal.plantBudgetCr > 0) return proposal.plantBudgetCr;
  return summarizeProposalGreenField(proposal.items).reduce((s, sec) => s + sec.budgetCr, 0);
}

/**
 * Turn an approved Green Field proposal into the plant / section / head budget envelopes, ready to
 * be merged into `greenFieldBudgetAllocations`. This is what makes ONE upload assign budget at
 * every level of the hierarchy instead of only at the machine line.
 */
export function buildGreenFieldAllocationsFromProposal(
  proposal: BudgetProposal,
): GreenFieldBudgetAllocations {
  const { plant, targetFy: fy, projectType } = proposal;
  const summary = summarizeProposalGreenField(proposal.items);
  return {
    plantBudgets: [{ plant, fy, projectType, budgetCr: greenFieldPlantBudgetCr(proposal) }],
    sectionBudgets: summary.map((sec) => ({
      plant, fy, projectType, division: sec.section, budgetCr: sec.budgetCr,
    })),
    headBudgets: summary.flatMap((sec) =>
      sec.heads.map((h) => ({
        plant, fy, projectType, division: sec.section, head: h.head, budgetCr: h.budgetCr,
      })),
    ),
  };
}

/** Convert an approved proposal's items into new CapexMasterItem rows for the target FY. */
export function buildMasterItemsFromProposal(proposal: BudgetProposal): CapexMasterItem[] {
  const fieldType = proposalFieldType(proposal);
  const fallbackDivision =
    fieldType === 'green_field' ? GREEN_FIELD_SECTION_ORDER[0] : FLAT_MASTER_DIVISION;
  return proposal.items.map((it) => ({
    id: `cm-${crypto.randomUUID()}`,
    fieldType,
    projectType: proposal.projectType,
    greenFieldProjectType: proposal.projectType,
    division: it.division ?? fallbackDivision,
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
