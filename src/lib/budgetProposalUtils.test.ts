import { describe, expect, it } from 'vitest';
import { approverEditImpact } from './budgetProposalUtils';
import type { BudgetProposal, BudgetProposalEdit } from './types';

function edit(totalBeforeCr: number, totalAfterCr: number): BudgetProposalEdit {
  return {
    id: `bpe-${totalBeforeCr}-${totalAfterCr}`,
    stage: 'plant_head',
    by: 'Plant Head',
    at: '2026-08-10T00:00:00.000Z',
    linesBefore: 3,
    linesAfter: 3,
    totalBeforeCr,
    totalAfterCr,
  };
}

function proposal(over: Partial<BudgetProposal> = {}): BudgetProposal {
  return {
    id: 'p1', plant: 'jhajjar_p1', projectType: 'rac', targetFy: '2027-28',
    status: 'pending_admin', items: [],
    createdBy: 'maintenance', createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

describe('approverEditImpact', () => {
  it('reports a POSITIVE trim when approvers cut the ask', () => {
    const r = approverEditImpact([proposal({ edits: [edit(10, 8), edit(8, 7.5)] })]);
    expect(r.trimCr).toBeCloseTo(2.5);
  });

  it('reports zero when approvers left the numbers unchanged', () => {
    expect(approverEditImpact([proposal({ edits: [edit(10, 10)] })]).trimCr).toBe(0);
    // A proposal with no edits at all is the same story, not a special case.
    expect(approverEditImpact([proposal()]).trimCr).toBe(0);
    expect(approverEditImpact([]).trimCr).toBe(0);
  });

  it('reports a NEGATIVE trim when approvers RAISED the ask', () => {
    // The sign is the whole point: callers flip label + tone on it, so it must not be absolute.
    expect(approverEditImpact([proposal({ edits: [edit(10, 14)] })]).trimCr).toBeCloseTo(-4);
  });

  it('nets a raise against a trim across stages and proposals', () => {
    const r = approverEditImpact([
      proposal({ id: 'p1', edits: [edit(10, 6)] }),
      proposal({ id: 'p2', edits: [edit(5, 8)] }),
    ]);
    expect(r.trimCr).toBeCloseTo(1);
  });

  it('sums resubmitCount across proposals, treating an absent count as zero', () => {
    const r = approverEditImpact([
      proposal({ id: 'p1', resubmitCount: 2 }),
      proposal({ id: 'p2' }),
      proposal({ id: 'p3', resubmitCount: 1 }),
    ]);
    expect(r.resubmits).toBe(3);
  });
});
