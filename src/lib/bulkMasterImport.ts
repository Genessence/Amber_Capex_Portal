/**
 * Bulk import of Brown Field master rows from Excel/CSV for next-FY budget proposals.
 * Client-side only — exceljs is loaded via dynamic import (never bundled at startup),
 * mirroring `exportUtils.ts`.
 */

import type { CapexMasterItem } from './types';

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
  const subParticulars = hm.subParticulars != null ? str(cells[hm.subParticulars]) : '';
  const department = hm.department != null ? str(cells[hm.department]) : '';
  const qty = hm.qty != null ? toNumber(cells[hm.qty]) : undefined;
  const legacyRate = legacyRateCol != null ? toNumber(cells[legacyRateCol]) : undefined;
  let totalCost = hm.totalCost != null ? toNumber(cells[hm.totalCost]) : undefined;

  // Skip fully empty rows.
  if (!head && !subParticulars && totalCost == null && legacyRate == null) return null;

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
export async function downloadImportTemplate(source: CapexMasterItem[] = []): Promise<void> {
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
