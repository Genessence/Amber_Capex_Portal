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
  rateRs?: number;
  /** Total cost in Crore — the budget figure. Derived from qty × rateRs when not supplied. */
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
  rateRs: ['rate (rs)', 'rate rs', 'rate (inr)', 'rate inr', 'unit rate', 'rate'],
  totalCost: ['total cost (cr)', 'total cost cr', 'total (cr)', 'budget (cr)', 'amount (cr)', 'total cost', 'budget'],
  reasonForRequirement: ['reason for requirement', 'reason', 'justification'],
  benefits: ['benefits', 'benefit'],
  roi: ['roi', 'payback'],
};

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
function rowFromCells(cells: unknown[], hm: Record<string, number>): ParsedMasterRow | null {
  const head = hm.head != null ? str(cells[hm.head]) : '';
  const subParticulars = hm.subParticulars != null ? str(cells[hm.subParticulars]) : '';
  const department = hm.department != null ? str(cells[hm.department]) : '';
  const qty = hm.qty != null ? toNumber(cells[hm.qty]) : undefined;
  const rateRs = hm.rateRs != null ? toNumber(cells[hm.rateRs]) : undefined;
  let totalCost = hm.totalCost != null ? toNumber(cells[hm.totalCost]) : undefined;

  // Skip fully empty rows.
  if (!head && !subParticulars && totalCost == null && rateRs == null) return null;

  // Derive total cost (Cr) from qty × unit rate (INR) when not provided directly.
  if (totalCost == null && qty != null && rateRs != null) {
    totalCost = (qty * rateRs) / CR_TO_INR;
  }

  return {
    head: head || 'Misc.',
    department,
    subParticulars,
    qty,
    rateRs,
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

  const hm = buildHeaderMap(matrix[0].map(str));
  if (hm.subParticulars == null && hm.head == null) {
    return { rows: [], errors: ['Could not find expected columns. Use the downloadable template headers.'] };
  }

  const rows = matrix
    .slice(1)
    .map((cells) => rowFromCells(cells, hm))
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

  const hm = buildHeaderMap(parseLine(lines[0]).map(str));
  if (hm.subParticulars == null && hm.head == null) {
    return { rows: [], errors: ['Could not find expected columns. Use the downloadable template headers.'] };
  }

  const rows = lines
    .slice(1)
    .map((line) => rowFromCells(parseLine(line), hm))
    .filter((r): r is ParsedMasterRow => r != null);

  return { rows, errors: validateRows(rows) };
}

const TEMPLATE_HEADERS = [
  'S.No', 'Head', 'Department', 'Sub Particulars', 'Qty', 'Rate (Rs)', 'Total Cost (Cr)',
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
  ws.addRow(['1', 'Automation', 'Press Shop', '6 Axis Robot on line 1', 6, 2100000, 1.26, 'Manpower Elimination', '8 MP removed', '7 Years']);
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
