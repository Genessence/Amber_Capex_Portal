/**
 * Bulk import of Brown Field master rows from Excel/CSV for next-FY budget proposals.
 * Client-side only — exceljs is loaded via dynamic import (never bundled at startup),
 * mirroring `exportUtils.ts`.
 */

import type { CapexMasterItem, FieldType } from './types';
import { GREEN_FIELD_SECTION_HEADS, GREEN_FIELD_SECTION_ORDER } from './greenFieldConstants';

const CR_TO_INR = 1_00_00_000;

/** A normalized master row parsed from an uploaded workbook/CSV. */
export interface ParsedMasterRow {
  head: string;
  department: string;
  subParticulars: string;
  qty?: number;
  /** Total cost in Crore — the budget figure, entered directly (Rate was removed from the budget). */
  totalCost: number;
  sNo?: string;
  reasonForRequirement?: string;
  benefits?: string;
  roi?: string;
  /**
   * Green Field only. The sheet carries the whole envelope hierarchy so one upload assigns budget
   * at every level: plant → section (`division`) → head → this sub-particular (`totalCost`).
   * These three are per-SCOPE figures repeated on each row of that scope; the importer takes the
   * first non-empty one per scope and ignores the repeats.
   */
  division?: string;
  plantBudgetCr?: number;
  sectionBudgetCr?: number;
  headBudgetCr?: number;
}

export interface ParseResult {
  rows: ParsedMasterRow[];
  errors: string[];
}

/** Canonical column keys → the header aliases we accept (lower-cased, trimmed). */
const COLUMN_ALIASES: Record<string, string[]> = {
  sNo: ['s.no', 'sno', 's no', 'sr no', 'sr. no', '#'],
  head: ['head', 'budget head'],
  department: ['department', 'dept'],
  subParticulars: ['sub particulars', 'subparticulars', 'sub particular', 'particulars', 'item', 'description'],
  qty: ['qty', 'quantity', 'nos'],
  totalCost: ['total cost (cr)', 'total cost cr', 'total (cr)', 'budget (cr)', 'amount (cr)', 'total cost', 'budget'],
  reasonForRequirement: ['reason for requirement', 'reason', 'justification'],
  benefits: ['benefits', 'benefit'],
  roi: ['roi', 'payback'],
  // Green Field hierarchy columns. Ignored by the Brown Field template (which has none of them).
  division: ['section', 'division', 'green field section'],
  plantBudgetCr: ['plant budget (cr)', 'plant budget cr', 'plant budget', 'total plant budget (cr)'],
  sectionBudgetCr: ['section budget (cr)', 'section budget cr', 'section budget', 'division budget (cr)'],
  headBudgetCr: ['head budget (cr)', 'head budget cr', 'head budget', 'shop budget (cr)'],
};

// Legacy Rate column — no longer part of the budget, but still read so an OLD workbook that only
// carries qty + rate (no Total Cost) can derive its total instead of importing as ₹0. Never stored.
const LEGACY_RATE_ALIASES = ['rate (rs)', 'rate rs', 'rate (inr)', 'rate inr', 'unit rate', 'rate'];

/** Column index of a legacy Rate (Rs) header, if present — used only to derive a missing total. */
function findLegacyRateCol(headerCells: string[]): number | undefined {
  const idx = headerCells.findIndex((c) => LEGACY_RATE_ALIASES.includes(normalizeHeader(c)));
  return idx === -1 ? undefined : idx;
}

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Map a row of header cells to canonical-key → column-index. */
function buildHeaderMap(headerCells: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerCells.forEach((cell, idx) => {
    const norm = normalizeHeader(cell);
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (key in map) continue;
      if (aliases.includes(norm)) map[key] = idx;
    }
  });
  return map;
}

function toNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[, ₹]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Build a ParsedMasterRow from a raw cell array + header map. Returns null if it's an empty row. */
function rowFromCells(
  cells: unknown[],
  hm: Record<string, number>,
  legacyRateCol?: number,
): ParsedMasterRow | null {
  const head = hm.head != null ? str(cells[hm.head]) : '';
  const division = hm.division != null ? str(cells[hm.division]) : '';
  const subParticulars = hm.subParticulars != null ? str(cells[hm.subParticulars]) : '';
  const department = hm.department != null ? str(cells[hm.department]) : '';
  const qty = hm.qty != null ? toNumber(cells[hm.qty]) : undefined;
  const legacyRate = legacyRateCol != null ? toNumber(cells[legacyRateCol]) : undefined;
  let totalCost = hm.totalCost != null ? toNumber(cells[hm.totalCost]) : undefined;

  // Skip fully empty rows.
  if (!head && !division && !subParticulars && totalCost == null && legacyRate == null) return null;

  // Back-compat only: derive Total Cost (Cr) from qty × a legacy Rate column when it's the sole
  // source of the figure. Rate itself is not part of the budget and is never stored on the row.
  if (totalCost == null && qty != null && legacyRate != null) {
    totalCost = (qty * legacyRate) / CR_TO_INR;
  }

  return {
    head: head || 'Misc.',
    department,
    subParticulars,
    qty,
    totalCost: totalCost ?? 0,
    sNo: hm.sNo != null ? str(cells[hm.sNo]) : undefined,
    reasonForRequirement: hm.reasonForRequirement != null ? str(cells[hm.reasonForRequirement]) : undefined,
    benefits: hm.benefits != null ? str(cells[hm.benefits]) : undefined,
    roi: hm.roi != null ? str(cells[hm.roi]) : undefined,
    division: division || undefined,
    plantBudgetCr: hm.plantBudgetCr != null ? toNumber(cells[hm.plantBudgetCr]) : undefined,
    sectionBudgetCr: hm.sectionBudgetCr != null ? toNumber(cells[hm.sectionBudgetCr]) : undefined,
    headBudgetCr: hm.headBudgetCr != null ? toNumber(cells[hm.headBudgetCr]) : undefined,
  };
}

function validateRows(rows: ParsedMasterRow[]): string[] {
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    if (!r.subParticulars) errors.push(`Row ${line}: missing Sub Particulars.`);
    if (r.totalCost <= 0) errors.push(`Row ${line}: Total Cost (Cr) must be greater than 0.`);
  });
  return errors;
}

/** Parse an .xlsx/.xls File into master rows (first worksheet). */
export async function parseMasterWorkbook(file: File): Promise<ParseResult> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);
  const ws = workbook.worksheets[0];
  if (!ws) return { rows: [], errors: ['No worksheet found in the uploaded file.'] };

  const matrix: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    // ExcelJS values array is 1-indexed; drop the leading undefined.
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    matrix.push(values.map((c) => {
      if (c && typeof c === 'object' && 'result' in (c as object)) return (c as { result: unknown }).result;
      if (c && typeof c === 'object' && 'text' in (c as object)) return (c as { text: unknown }).text;
      return c;
    }));
  });

  if (!matrix.length) return { rows: [], errors: ['The file is empty.'] };

  const headerCells = matrix[0].map(str);
  const hm = buildHeaderMap(headerCells);
  if (hm.subParticulars == null && hm.head == null) {
    return { rows: [], errors: ['Could not find expected columns. Use the downloadable template headers.'] };
  }
  const legacyRateCol = findLegacyRateCol(headerCells);

  const rows = matrix
    .slice(1)
    .map((cells) => rowFromCells(cells, hm, legacyRateCol))
    .filter((r): r is ParsedMasterRow => r != null);

  return { rows, errors: validateRows(rows) };
}

/** Parse CSV text into master rows. Handles quoted fields. */
export function parseCsvText(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return { rows: [], errors: ['The CSV is empty.'] };

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };

  const headerCells = parseLine(lines[0]).map(str);
  const hm = buildHeaderMap(headerCells);
  if (hm.subParticulars == null && hm.head == null) {
    return { rows: [], errors: ['Could not find expected columns. Use the downloadable template headers.'] };
  }
  const legacyRateCol = findLegacyRateCol(headerCells);

  const rows = lines
    .slice(1)
    .map((line) => rowFromCells(parseLine(line), hm, legacyRateCol))
    .filter((r): r is ParsedMasterRow => r != null);

  return { rows, errors: validateRows(rows) };
}

const TEMPLATE_HEADERS = [
  'S.No', 'Head', 'Department', 'Sub Particulars', 'Qty', 'Total Cost (Cr)',
  'Reason for Requirement', 'Benefits', 'ROI',
];

/**
 * Green Field template headers. The sheet is deliberately WIDER than the Brown Field one because a
 * Green Field budget is a hierarchy, not a flat list: the plant gets an overall budget, that is
 * distributed across the four sections, each section across its heads (shops / utilities), and each
 * head across the individual machines. One row = one machine, and it repeats the three envelope
 * figures above it so a single upload assigns budget at every level.
 */
const GF_TEMPLATE_HEADERS = [
  'S.No', 'Plant Budget (Cr)', 'Section', 'Section Budget (Cr)', 'Head', 'Head Budget (Cr)',
  'Department', 'Sub Particulars', 'Qty', 'Total Cost (Cr)',
  'Reason for Requirement', 'Benefits', 'ROI',
];

/**
 * Green Field worked examples — one plant budget distributed across all four sections, each section
 * across its heads, each head across per-machine lines. The figures are internally consistent
 * (machines sum to their head, heads to their section, sections to the plant) so the author can see
 * exactly how the hierarchy is meant to add up before replacing the numbers with their own.
 */
const GF_FALLBACK_SAMPLES: ParsedMasterRow[] = [
  // Plant Machinery — 34.00 Cr
  { division: 'Plant Machinery', head: 'Moulding Shop', department: 'IMM', subParticulars: 'Injection Moulding Machine 650T', qty: 4, totalCost: 8, sectionBudgetCr: 34, headBudgetCr: 14, reasonForRequirement: 'Core moulding capacity for the new plant', benefits: 'Base capacity 1.2 lakh units/month' },
  { division: 'Plant Machinery', head: 'Moulding Shop', department: 'IMM', subParticulars: 'Injection Moulding Machine 1300T', qty: 2, totalCost: 6, sectionBudgetCr: 34, headBudgetCr: 14, reasonForRequirement: 'Large-part moulding (ODU cabinet)', benefits: 'In-house large parts; no outsourcing' },
  { division: 'Plant Machinery', head: 'Press Shop', department: 'Sheet Metal', subParticulars: 'Power Press 200T with Decoiler', qty: 2, totalCost: 4.5, sectionBudgetCr: 34, headBudgetCr: 7.5, reasonForRequirement: 'Sheet metal forming line', benefits: 'In-house sheet metal' },
  { division: 'Plant Machinery', head: 'Press Shop', department: 'Sheet Metal', subParticulars: 'CNC Turret Punch Press', qty: 1, totalCost: 3, sectionBudgetCr: 34, headBudgetCr: 7.5, benefits: 'Flexible low-volume panels' },
  { division: 'Plant Machinery', head: 'Assembly Shop', department: 'RAC', subParticulars: 'IDU Final Assembly Conveyor Line', qty: 1, totalCost: 5.5, sectionBudgetCr: 34, headBudgetCr: 8.5, reasonForRequirement: 'Main assembly line for the plant', benefits: '600 units/shift' },
  { division: 'Plant Machinery', head: 'Assembly Shop', department: 'RAC', subParticulars: 'Leak Testing & Charging Station', qty: 2, totalCost: 3, sectionBudgetCr: 34, headBudgetCr: 8.5, benefits: 'Mandatory QC gate before packing' },
  { division: 'Plant Machinery', head: 'Lab & Quality Shop', department: 'Quality', subParticulars: 'Psychrometric Test Chamber', qty: 1, totalCost: 4, sectionBudgetCr: 34, headBudgetCr: 4, reasonForRequirement: 'BEE star-rating validation in-house', benefits: 'No third-party lab dependency', roi: '3' },
  // Utilities — 12.00 Cr
  { division: 'Utilities', head: 'Electrical', department: 'Maintenance', subParticulars: 'HT Panel & 2500 KVA Transformer', qty: 1, totalCost: 4, sectionBudgetCr: 12, headBudgetCr: 6, reasonForRequirement: 'Plant power infrastructure', benefits: 'Full-load plant supply' },
  { division: 'Utilities', head: 'Electrical', department: 'Maintenance', subParticulars: 'DG Set 1010 KVA', qty: 2, totalCost: 2, sectionBudgetCr: 12, headBudgetCr: 6, benefits: 'Backup power; no line stoppage' },
  { division: 'Utilities', head: 'Fire & Safety', department: 'EHS', subParticulars: 'Fire Hydrant & Sprinkler System', qty: 1, totalCost: 2.5, sectionBudgetCr: 12, headBudgetCr: 2.5, reasonForRequirement: 'Statutory fire NOC requirement', benefits: 'Plant occupancy clearance' },
  { division: 'Utilities', head: 'ETP/STP', department: 'EHS', subParticulars: 'Effluent & Sewage Treatment Plant', qty: 1, totalCost: 2, sectionBudgetCr: 12, headBudgetCr: 2, reasonForRequirement: 'Pollution Control Board consent', benefits: 'Zero liquid discharge compliance' },
  { division: 'Utilities', head: 'N2/O2/Helium/LPG/PNG', department: 'Maintenance', subParticulars: 'Nitrogen Generation Plant', qty: 1, totalCost: 1.5, sectionBudgetCr: 12, headBudgetCr: 1.5, benefits: 'In-house N2 for brazing; cylinder cost eliminated', roi: '4' },
  // Compliances — 3.00 Cr (section is its own head)
  { division: 'Compliances', head: 'Compliances', department: 'Legal', subParticulars: 'Factory Licence, Pollution & Fire NOC', qty: 1, totalCost: 1.2, sectionBudgetCr: 3, headBudgetCr: 3, reasonForRequirement: 'Statutory approvals before commissioning' },
  { division: 'Compliances', head: 'Compliances', department: 'Legal', subParticulars: 'BIS / BEE Product Certification', qty: 1, totalCost: 1.8, sectionBudgetCr: 3, headBudgetCr: 3, reasonForRequirement: 'Mandatory for RAC sale in India' },
  // Information Technology — 6.00 Cr (section is its own head)
  { division: 'Information Technology', head: 'Information Technology', department: 'IT', subParticulars: 'SAP S/4HANA Plant Rollout', qty: 1, totalCost: 3, sectionBudgetCr: 6, headBudgetCr: 6, reasonForRequirement: 'Plant must run on group ERP from day one', benefits: 'Single source of truth across plants' },
  { division: 'Information Technology', head: 'Information Technology', department: 'IT', subParticulars: 'Network, Wi-Fi & Server Room Setup', qty: 1, totalCost: 2, sectionBudgetCr: 6, headBudgetCr: 6, benefits: 'Shop-floor connectivity' },
  { division: 'Information Technology', head: 'Information Technology', department: 'IT', subParticulars: 'MES & Shop-floor Data Collection', qty: 1, totalCost: 1, sectionBudgetCr: 6, headBudgetCr: 6, benefits: 'Live production traceability' },
];

/** Total plant budget the Green Field worked examples add up to (Cr). */
const GF_SAMPLE_PLANT_BUDGET_CR = 55;

/**
 * Green Field template rows drawn from the plant's own live budget where it has one, else the
 * worked examples. Unlike the Brown Field sampler this keeps EVERY row of the source: a Green Field
 * sheet has to show a hierarchy that adds up, and a round-robin sample of it would not.
 */
export function buildGreenFieldTemplateRows(source: CapexMasterItem[] = []): ParsedMasterRow[] {
  const usable = source.filter((i) => i.subParticulars?.trim() && i.totalCost > 0);
  if (!usable.length) return GF_FALLBACK_SAMPLES;
  const order = (d: string) => {
    const idx = (GREEN_FIELD_SECTION_ORDER as readonly string[]).indexOf(d);
    return idx === -1 ? GREEN_FIELD_SECTION_ORDER.length : idx;
  };
  return [...usable]
    .sort((a, b) => order(a.division ?? '') - order(b.division ?? '') || (a.head ?? '').localeCompare(b.head ?? ''))
    .map((i) => ({
      head: i.head?.trim() || 'Misc.',
      division: i.division,
      department: i.department ?? '',
      subParticulars: i.subParticulars,
      qty: i.qty,
      totalCost: i.totalCost,
      reasonForRequirement: i.reasonForRequirement,
      benefits: i.benefits,
      roi: i.roi,
    }));
}

/** The template ships with worked examples, so the expected shape is never ambiguous. */
export const TEMPLATE_MIN_ROWS = 10;
export const TEMPLATE_MIN_HEADS = 3;

/**
 * Jhajjar Plant 1 worked examples — used when the plant has no live Brown Field rows yet (FY
 * 2026-27 was cleared so budgets are authored from scratch). Spans five heads so the template
 * still meets TEMPLATE_MIN_ROWS / TEMPLATE_MIN_HEADS.
 */
const FALLBACK_SAMPLES: ParsedMasterRow[] = [
  { head: 'Automation', department: 'HEX', subParticulars: 'HEX Black Copper Detection', qty: 3, totalCost: 0.33, reasonForRequirement: 'Operator manual inspection can miss defective IGT; leads to HE rejection, refrigerant loss, field failure', benefits: 'Fool-proof 360° camera detection of Eddy Current marking on hairpin' },
  { head: 'Machinery', department: 'HEX', subParticulars: 'Shrink less Vertical M/C', qty: 1, totalCost: 2.1, reasonForRequirement: 'Normal V.expander applies copper shrinkage factor', benefits: 'Shrinkless V.expander eliminates shrinkage; copper saving (~₹40/HE)', roi: '2' },
  { head: 'General', department: 'IMM', subParticulars: 'Centralised Material Feeding for Molding Machines (24 Machine, 450T to 1300Ton)', qty: 1, totalCost: 1.5, reasonForRequirement: 'Manpower fatigue for RM loading; black spot from atmospheric dust', benefits: '4 MP elimination (day+night); black-spot rejection down; 5S improvement', roi: '18.75' },
  { head: 'Digitization', department: 'Innovation / Data Analyst', subParticulars: 'Plant ESG/EMS', qty: 1, totalCost: 0.4, benefits: 'Department wise Traceability' },
  { head: 'New Business', department: 'Hex', subParticulars: 'Mezzanine, Goods Lift & Utilities', qty: 1, totalCost: 2.1, reasonForRequirement: 'Eva Coating for Urban Company', benefits: 'New Requirement' },
  { head: 'Automation', department: 'IMM', subParticulars: 'Part Conveying system (Injection Machine to Mezzanine) (10 Machines)', qty: 1, totalCost: 1.05, reasonForRequirement: 'Direct material feeding from Molding Shop to Mezzanine as sub-assembly shifts upstairs', benefits: '6 MP elimination (day+night)', roi: '8.75' },
  { head: 'Machinery', department: 'HEX', subParticulars: 'Scissor Lifter', qty: 1, totalCost: 0.05, reasonForRequirement: 'Manpower fatigue — 4000 coils/day loaded pallet↔conveyor by one MP', benefits: 'Fatigue reduced; easier load & unload' },
  { head: 'General', department: 'RAC', subParticulars: 'Declined Conveyors from Mezzanine to RAC Drop points', qty: 9, totalCost: 0.405, reasonForRequirement: 'Pre-assembled material conveying from Mezzanine to Final Assembly (online feeding)', benefits: 'Overfeeding & man-movement elimination' },
  { head: 'Digitization', department: 'Innovation / Data Analyst', subParticulars: 'MES for water Purifier', qty: 1, totalCost: 0.2 },
  { head: 'New Business', department: '', subParticulars: 'UC (Urban Company — already approved Nov 2025, balance shifted to FY26-27)', qty: 1, totalCost: 28.5, reasonForRequirement: 'CAPEX approved Nov 2025; ₹1.5 Cr used in FY 2025-26; balance ₹28.5 Cr shifted to FY26-27' },
  { head: 'Automation', department: 'RAC Quality', subParticulars: 'Printing Part Inspection', qty: 1, totalCost: 0.1, reasonForRequirement: 'IDU manuals inspected manually; no data capture', benefits: 'Digital vision inspection + data validation / traceability' },
  { head: 'Machinery', department: 'HEX', subParticulars: 'BOPT (Battery Operated Pallet Truck)', qty: 1, totalCost: 0.05, reasonForRequirement: 'Fatigue — 4500 coils/day fed from HEX Shop to RAC', benefits: 'Fatigue reduced; easier feed' },
  { head: 'General', department: 'Maintenance', subParticulars: 'DG1010 KVA', qty: 1, totalCost: 0.75, reasonForRequirement: 'Rental DG ~₹1.75 Lakh/month', benefits: 'Own asset', roi: '4' },
  { head: 'Digitization', department: 'Maintenance', subParticulars: 'Digital competency for utility', qty: 50, totalCost: 0.185, reasonForRequirement: 'Find energy-saving potential', benefits: 'Reduce electricity consumption; better use of natural resources' },
];

/**
 * Pick worked example rows for the template out of the budget that already exists.
 *
 * Rows are taken **round-robin across heads** — one from each head, then a second from each, and so
 * on — so the sample spans as many heads as the data allows rather than filling up from whichever
 * head happens to be listed first. It stops at the end of the round that satisfies BOTH minimums
 * (so a slight overshoot is normal and fine — the ask is "at least"), and pads from
 * `FALLBACK_SAMPLES` only if the source could not supply enough.
 */
export function buildTemplateSampleRows(
  source: CapexMasterItem[],
  minRows: number = TEMPLATE_MIN_ROWS,
  minHeads: number = TEMPLATE_MIN_HEADS,
): ParsedMasterRow[] {
  const byHead = new Map<string, CapexMasterItem[]>();
  for (const item of source) {
    // Only rows that would survive `validateRows` are worth showing as an example.
    if (!item.subParticulars?.trim() || !(item.totalCost > 0)) continue;
    const head = item.head?.trim() || 'Misc.';
    const list = byHead.get(head) ?? [];
    list.push(item);
    byHead.set(head, list);
  }

  const heads = [...byHead.keys()];
  const picked: CapexMasterItem[] = [];
  for (let round = 0; heads.length; round++) {
    const before = picked.length;
    for (const head of heads) {
      const list = byHead.get(head)!;
      if (round < list.length) picked.push(list[round]);
    }
    if (picked.length === before) break; // source exhausted
    const distinctHeads = new Set(picked.map((p) => p.head?.trim() || 'Misc.')).size;
    if (picked.length >= minRows && distinctHeads >= Math.min(minHeads, heads.length)) break;
  }

  const rows: ParsedMasterRow[] = picked.map((item) => ({
    head: item.head?.trim() || 'Misc.',
    department: item.department ?? '',
    subParticulars: item.subParticulars,
    qty: item.qty,
    totalCost: item.totalCost,
    reasonForRequirement: item.reasonForRequirement,
    benefits: item.benefits,
    roi: item.roi,
  }));

  // Top up from the built-in examples when the live budget was too thin to meet the minimums.
  for (const sample of FALLBACK_SAMPLES) {
    const enoughRows = rows.length >= minRows;
    const enoughHeads = new Set(rows.map((r) => r.head)).size >= minHeads;
    if (enoughRows && enoughHeads) break;
    rows.push(sample);
  }
  return rows;
}

/**
 * Download the Excel import template, pre-filled with worked examples drawn from `source` (the
 * plant's existing budget) — at least 10 rows across at least 3 heads. The sheet is header + data
 * only, so the downloaded file can be edited and re-uploaded through `parseMasterWorkbook` as-is.
 */
export async function downloadImportTemplate(
  source: CapexMasterItem[] = [],
  fieldType: FieldType = 'brown_field',
): Promise<void> {
  if (fieldType === 'green_field') return downloadGreenFieldTemplate(source);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Budget Master');
  const headerRow = ws.addRow(TEMPLATE_HEADERS);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
  });
  buildTemplateSampleRows(source).forEach((r, i) => {
    ws.addRow([
      String(i + 1), r.head, r.department, r.subParticulars,
      r.qty ?? '', r.totalCost,
      r.reasonForRequirement ?? '', r.benefits ?? '', r.roi ?? '',
    ]);
  });
  ws.columns.forEach((col) => { col.width = 22; });
  ws.getColumn(4).width = 46; // Sub Particulars — the longest field by far
  ws.getColumn(7).width = 40; // Reason for Requirement
  ws.getColumn(8).width = 40; // Benefits
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'CAPEX-Master-Import-Template.xlsx';
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Download the Green Field template — the plant budget and its distribution across sections, heads
 * and individual machines, on one sheet. The envelope figures repeat down each scope (that is what
 * makes a flat sheet able to carry a tree), and the importer takes the first non-empty one per
 * scope. Headers are exactly the aliases `buildHeaderMap` accepts, so the downloaded file can be
 * edited and re-uploaded unchanged.
 */
async function downloadGreenFieldTemplate(source: CapexMasterItem[] = []): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Green Field Budget');
  const headerRow = ws.addRow(GF_TEMPLATE_HEADERS);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
  });

  const rows = buildGreenFieldTemplateRows(source);
  // Roll the envelopes up from the rows when the source did not carry them, so the sheet always
  // adds up: head = Σ its machines, section = Σ its heads, plant = Σ its sections.
  const headTotals = new Map<string, number>();
  const sectionTotals = new Map<string, number>();
  let plantTotal = 0;
  for (const r of rows) {
    const section = r.division || 'Plant Machinery';
    const key = `${section}\u0000${r.head}`;
    headTotals.set(key, (headTotals.get(key) ?? 0) + (r.totalCost || 0));
    sectionTotals.set(section, (sectionTotals.get(section) ?? 0) + (r.totalCost || 0));
    plantTotal += r.totalCost || 0;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const plantBudget = rows === GF_FALLBACK_SAMPLES ? GF_SAMPLE_PLANT_BUDGET_CR : round2(plantTotal);

  rows.forEach((r, i) => {
    const section = r.division || 'Plant Machinery';
    ws.addRow([
      String(i + 1),
      plantBudget,
      section,
      r.sectionBudgetCr ?? round2(sectionTotals.get(section) ?? 0),
      r.head,
      r.headBudgetCr ?? round2(headTotals.get(`${section}\u0000${r.head}`) ?? 0),
      r.department, r.subParticulars, r.qty ?? '', r.totalCost,
      r.reasonForRequirement ?? '', r.benefits ?? '', r.roi ?? '',
    ]);
  });

  // A reference sheet, so the author knows which section names and heads the portal recognises —
  // a typo in Section silently lands the machine in the wrong envelope otherwise.
  const ref = workbook.addWorksheet('Sections & Heads');
  const refHeader = ref.addRow(['Section', 'Head (shop / utility)']);
  refHeader.eachCell((cell) => { cell.font = { bold: true }; });
  GREEN_FIELD_SECTION_ORDER.forEach((section) => {
    const heads = GREEN_FIELD_SECTION_HEADS[section];
    if (!heads.length) ref.addRow([section, `${section} (section is its own head)`]);
    else heads.forEach((h) => ref.addRow([section, h]));
  });
  ref.columns.forEach((col) => { col.width = 34; });

  ws.columns.forEach((col) => { col.width = 20; });
  ws.getColumn(8).width = 46;  // Sub Particulars
  ws.getColumn(11).width = 40; // Reason for Requirement
  ws.getColumn(12).width = 40; // Benefits
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'CAPEX-Green-Field-Budget-Template.xlsx';
  anchor.click();
  URL.revokeObjectURL(url);
}
