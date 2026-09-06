import { describe, expect, it } from 'vitest';
import { parseCsvText } from './bulkMasterImport';
import { parsedRowToProposalItem, summarizeProposalGreenField, validateProposal } from './budgetProposalUtils';
import type { BudgetProposal } from './types';

/**
 * The Green Field template's headers must be exactly the aliases the parser accepts — a header the
 * parser does not recognise drops that whole column SILENTLY (the upload "works", the envelope is
 * just missing), which is the failure mode this file exists to catch.
 */
const GF_SHEET = [
  'S.No,Plant Budget (Cr),Section,Section Budget (Cr),Head,Head Budget (Cr),Department,Sub Particulars,Qty,Total Cost (Cr),Reason for Requirement,Benefits,ROI',
  '1,55,Plant Machinery,34,Moulding Shop,14,IMM,Injection Moulding Machine 650T,4,8,Capacity,Base capacity,',
  '2,55,Plant Machinery,34,Moulding Shop,14,IMM,Injection Moulding Machine 1300T,2,6,Large parts,In-house,',
  '3,55,Utilities,12,Electrical,6,Maintenance,HT Panel & Transformer,1,4,Power,Full-load supply,',
].join('\n');

describe('Green Field template round trip', () => {
  const parsed = parseCsvText(GF_SHEET);

  it('parses every column the template writes', () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(3);
    const [first] = parsed.rows;
    expect(first.division).toBe('Plant Machinery');
    expect(first.head).toBe('Moulding Shop');
    expect(first.plantBudgetCr).toBe(55);
    expect(first.sectionBudgetCr).toBe(34);
    expect(first.headBudgetCr).toBe(14);
    expect(first.totalCost).toBe(8);
    expect(first.qty).toBe(4);
  });

  it('builds the plant → section → head hierarchy from the repeated envelope figures', () => {
    const items = parsed.rows.map((r) => parsedRowToProposalItem(r, 'green_field'));
    const summary = summarizeProposalGreenField(items);
    expect(summary.map((s) => s.section)).toEqual(['Plant Machinery', 'Utilities']);
    // Section envelope is the sheet's figure, taken once — not summed across its repeated rows.
    expect(summary[0].budgetCr).toBe(34);
    expect(summary[0].usedCr).toBe(14);
    expect(summary[0].heads).toEqual([
      { head: 'Moulding Shop', budgetCr: 14, usedCr: 14, count: 2 },
    ]);
    expect(summary[1].budgetCr).toBe(12);
  });

  it('accepts a Green Field proposal built from the template', () => {
    const proposal: BudgetProposal = {
      id: 'bp-1', plant: 'jhajjar_p1', projectType: 'rac', fieldType: 'green_field',
      targetFy: '2026-27', status: 'draft', createdBy: 'super_admin', createdAt: '2026-08-25T00:00:00Z',
      items: parsed.rows.map((r) => parsedRowToProposalItem(r, 'green_field')),
    };
    expect(validateProposal(proposal)).toEqual([]);
  });

  it('rejects a section name the request wizard could not render', () => {
    const bad = parseCsvText(GF_SHEET.replace('Utilities,12', 'Utilitys,12'));
    const proposal: BudgetProposal = {
      id: 'bp-2', plant: 'jhajjar_p1', projectType: 'rac', fieldType: 'green_field',
      targetFy: '2026-27', status: 'draft', createdBy: 'super_admin', createdAt: '2026-08-25T00:00:00Z',
      items: bad.rows.map((r) => parsedRowToProposalItem(r, 'green_field')),
    };
    expect(validateProposal(proposal).some((e) => e.includes('Section must be one of'))).toBe(true);
  });

  it('leaves the Brown Field sheet unchanged (no Section column, flat division)', () => {
    const bf = parseCsvText('S.No,Head,Department,Sub Particulars,Qty,Total Cost (Cr)\n1,Automation,HEX,Detection,3,0.33');
    expect(bf.errors).toEqual([]);
    expect(bf.rows[0].division).toBeUndefined();
    expect(parsedRowToProposalItem(bf.rows[0]).division).toBe('Other Brown Field');
  });
});
