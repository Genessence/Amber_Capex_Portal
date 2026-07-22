/**
 * Bulk import of Brown Field master rows from Excel/CSV for next-FY budget proposals.
 * Client-side only — exceljs is loaded via dynamic import (never bundled at startup),
 * mirroring `exportUtils.ts`.
 */

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

/** Download a blank Excel template with the expected column headers. */
export async function downloadImportTemplate(): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Budget Master');
  const headerRow = ws.addRow(TEMPLATE_HEADERS);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' } };
  });
  ws.addRow(['1', 'Automation', 'Press Shop', '6 Axis Robot on line 1', 6, 1.26, 'Manpower Elimination', '8 MP removed', '7 Years']);
  ws.columns.forEach((col) => { col.width = 22; });
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
