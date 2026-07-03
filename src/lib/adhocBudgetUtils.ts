/**
 * Adhoc budget reallocation: move budget between two heads in the same plant + FY (Brown Field),
 * admin-approved. Approved transfers write per-head allocation overrides (BrownFieldHeadBudget,
 * same shape as GreenFieldHeadBudget) that take precedence over the summed line-item budgets.
 */
import type {
  AdhocBudgetStatus,
  BrownFieldHeadBudget,
  CapexMasterItem,
  ProjectType,
} from './types';
import { FLAT_MASTER_DIVISION, resolveProjectType } from './greenFieldConstants';

const CR_TO_INR = 1_00_00_000;

export const ADHOC_STATUS_LABELS: Record<AdhocBudgetStatus, string> = {
  pending_admin: 'Pending Admin Approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const ADHOC_STATUS_COLORS: Record<AdhocBudgetStatus, string> = {
  pending_admin: 'bg-amber-50 text-amber-700 border border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
};

function brownFieldRows(
  capexMaster: CapexMasterItem[],
  plant: string,
  fy: string,
  projectType: ProjectType,
  head?: string,
): CapexMasterItem[] {
  return capexMaster.filter(
    (m) =>
      (m.fieldType ?? 'brown_field') === 'brown_field' &&
      m.plant === plant &&
      m.fy === fy &&
      resolveProjectType(m) === projectType &&
      (head ? m.head === head : true),
  );
}

/** The override allocation (Cr) for a Brown Field head, or null when none has been set. */
export function getBrownFieldHeadBudgetCr(
  overrides: BrownFieldHeadBudget[],
  plant: string,
  fy: string,
  projectType: ProjectType,
  head: string,
): number | null {
  const match = overrides.find(
    (b) =>
      b.plant === plant &&
      b.fy === fy &&
      b.projectType === projectType &&
      b.division === FLAT_MASTER_DIVISION &&
      b.head === head,
  );
  return match ? match.budgetCr : null;
}

/** Sum of a head's master line-item budgets (Cr) — the default allocation. */
export function headLineSumCr(
  capexMaster: CapexMasterItem[],
  plant: string,
  fy: string,
  projectType: ProjectType,
  head: string,
): number {
  return brownFieldRows(capexMaster, plant, fy, projectType, head).reduce((s, i) => s + i.totalCost, 0);
}

/** Effective head allocation (Cr): override if present, else the summed line items. */
export function effectiveHeadAllocationCr(
  capexMaster: CapexMasterItem[],
  overrides: BrownFieldHeadBudget[],
  plant: string,
  fy: string,
  projectType: ProjectType,
  head: string,
): number {
  return getBrownFieldHeadBudgetCr(overrides, plant, fy, projectType, head)
    ?? headLineSumCr(capexMaster, plant, fy, projectType, head);
}

/** Budget consumed by requests against a head (Cr). */
export function headUsedCr(
  capexMaster: CapexMasterItem[],
  usedAmountByMasterItemId: Record<string, number>,
  plant: string,
  fy: string,
  projectType: ProjectType,
  head: string,
): number {
  const items = brownFieldRows(capexMaster, plant, fy, projectType, head);
  return items.reduce((s, i) => s + (usedAmountByMasterItemId[i.id] ?? 0), 0) / CR_TO_INR;
}

/** Unspent budget on a head (Cr) — what's available to transfer out. */
export function headSpareCr(
  capexMaster: CapexMasterItem[],
  overrides: BrownFieldHeadBudget[],
  usedAmountByMasterItemId: Record<string, number>,
  plant: string,
  fy: string,
  projectType: ProjectType,
  head: string,
): number {
  const alloc = effectiveHeadAllocationCr(capexMaster, overrides, plant, fy, projectType, head);
  const used = headUsedCr(capexMaster, usedAmountByMasterItemId, plant, fy, projectType, head);
  return alloc - used;
}

/** Heads with at least one master row for the scope. */
export function headsForScope(
  capexMaster: CapexMasterItem[],
  plant: string,
  fy: string,
  projectType: ProjectType,
): string[] {
  return [...new Set(brownFieldRows(capexMaster, plant, fy, projectType).map((m) => m.head))].sort();
}

export function validateAdhoc(opts: {
  fromHead: string;
  toHead: string;
  amountCr: number;
  fromSpareCr: number;
}): string[] {
  const errors: string[] = [];
  if (!opts.fromHead) errors.push('Choose a source head.');
  if (!opts.toHead) errors.push('Choose a destination head.');
  if (opts.fromHead && opts.toHead && opts.fromHead === opts.toHead) errors.push('Source and destination heads must differ.');
  if (!(opts.amountCr > 0)) errors.push('Enter an amount greater than 0.');
  if (opts.amountCr > opts.fromSpareCr + 1e-9) errors.push(`Source head has only ₹${opts.fromSpareCr.toFixed(2)} Cr spare.`);
  return errors;
}
