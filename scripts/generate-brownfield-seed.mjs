/**
 * Parses Capex FY 2026-27 RAC Plants workbook and emits brownfield seed TS.
 * Run: node scripts/generate-brownfield-seed.mjs
 */
import ExcelJS from 'exceljs';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const XLSX = join(ROOT, 'Capex FY 2026-27 RAC Plants final 18 April.xlsx');
const OUT = join(ROOT, 'src/lib/brownFieldSeedData.ts');

const SHEET_PLANT = {
  'DDN-4': 'ddn_4',
  'DDN-5': 'ddn_5',
  'DDN-6': 'ddn_6',
  'JJR P1': 'jhajjar_p1',
  'JJR P2': 'jhajjar_p2',
  SUPA: 'supa',
  Rudrapur: 'rudrapur',
  'Sricity-1': 'sircity_1',
  'Sricity-2': 'sircity_2',
};

const FY = '2026-27';
const CR = 10_000_000;

function normHead(h) {
  if (!h) return '';
  let s = String(h).trim();
  s = s.replace(/, If any$/i, '').replace(/, if any$/i, '');
  if (/^genral$/i.test(s) || /^general$/i.test(s)) return 'General';
  if (/^new business/i.test(s)) return 'New Business';
  if (/^misc\.?$/i.test(s)) return 'Misc.';
  if (/^safety$/i.test(s)) return 'Safety';
  if (/^quality$/i.test(s)) return 'Quality';
  if (/^compliance$/i.test(s)) return 'Compliance';
  if (/^moulding merger$/i.test(s)) return 'Moulding Merger';
  if (/^productivity improvement$/i.test(s)) return 'Productivity Improvement';
  if (/^standardization$/i.test(s)) return 'Standardization';
  if (/^business requirement$/i.test(s)) return 'Business Requirement';
  return s;
}

function isTotalRow(sno, sub, head) {
  const s = sno != null ? String(sno).trim().toLowerCase() : '';
  const subS = sub != null ? String(sub).trim().toLowerCase() : '';
  if (s === 'total' || s.startsWith('total ')) return true;
  if (subS === 'total' || subS === 'total value required') return true;
  return false;
}

function normalizeRateRs(rateVal, qtyVal, totalCr) {
  if (rateVal == null || rateVal === '') return null;
  const rate = Number(rateVal);
  if (!Number.isFinite(rate)) return null;
  const qty = qtyVal != null && qtyVal !== '' ? Number(qtyVal) : null;

  // Crore-like rate (JJR P1/P2, DDN-5): value < 100 and totalCr matches rate*qty when qty present
  if (rate > 0 && rate < 100) {
    if (qty != null && Number.isFinite(qty) && qty > 0 && totalCr != null) {
      const expectedCr = rate * qty;
      if (Math.abs(expectedCr - totalCr) < 0.02) {
        return Math.round((totalCr / qty) * CR);
      }
    }
    // Single qty crore rate
    if ((qty == null || qty === 1) && totalCr != null && Math.abs(rate - totalCr) < 0.001) {
      return Math.round(totalCr * CR);
    }
    return Math.round(rate * CR);
  }
  return Math.round(rate);
}

function esc(s) {
  if (s == null) return "''";
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function findHeaderRow(sheet) {
  for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
    const row = sheet.getRow(r);
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      vals[col - 1] = cell.value;
    });
    const lower = vals.map((v) => (v != null ? String(v).toLowerCase().replace(/\n/g, ' ') : ''));
    if (lower.some((h) => h.startsWith('s.no'))) {
      return { rowIndex: r, headers: vals };
    }
  }
  return null;
}

function colIndex(headers, ...needles) {
  const lower = headers.map((h) => (h != null ? String(h).toLowerCase().replace(/\n/g, ' ') : ''));
  for (let i = 0; i < lower.length; i++) {
    if (needles.every((n) => lower[i].includes(n))) return i;
  }
  return -1;
}

async function parseSheet(sheet, plant) {
  const header = findHeaderRow(sheet);
  if (!header) return [];

  const { rowIndex, headers } = header;
  const cSno = colIndex(headers, 's.no');
  const cHead = colIndex(headers, 'head');
  const cSub = colIndex(headers, 'sub');
  const cDept =
    colIndex(headers, 'department') >= 0
      ? colIndex(headers, 'department')
      : colIndex(headers, 'departments');
  const cRate = colIndex(headers, 'rate');
  const cQty = headers.findIndex((h) => h != null && String(h).toLowerCase().includes('qty'));
  const tcCols = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h != null && String(h).toLowerCase().includes('total cost') && String(h).toLowerCase().includes('cr'))
    .map(({ i }) => i);
  const cTotal = tcCols.length > 1 ? tcCols[tcCols.length - 1] : tcCols[0] ?? -1;
  const cReason = colIndex(headers, 'reason');
  const cBenefits = colIndex(headers, 'benefit');
  const cRoi = colIndex(headers, 'roi');

  const items = [];
  let currentHead = '';

  for (let r = rowIndex + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const get = (c) => (c >= 0 ? row.getCell(c + 1).value : null);

    const snoRaw = get(cSno);
    const subRaw = get(cSub);
    const headRaw = get(cHead);

    if (snoRaw == null && (subRaw == null || subRaw === '')) continue;

    if (headRaw != null && String(headRaw).trim() !== '') {
      currentHead = normHead(headRaw);
    }

    const sub = subRaw != null ? String(subRaw).trim() : '';
    const snoStr = snoRaw != null ? String(snoRaw).trim() : '';

    // Include UC and Sricity-2 placeholder even without sub
    const isUc =
      plant === 'jhajjar_p1' &&
      (snoStr.toUpperCase() === 'NB1' || (sub && /urban company|^uc$/i.test(sub)));
    const isSricityPlaceholder =
      plant === 'sircity_2' &&
      currentHead === 'New Business' &&
      !sub &&
      get(cTotal) != null &&
      Number(get(cTotal)) > 1;

    if (isTotalRow(snoRaw, subRaw, currentHead) && !isUc && !isSricityPlaceholder) continue;

    if (!sub && !isUc && !isSricityPlaceholder) continue;

    const totalCrVal = get(cTotal);
    const totalCost =
      totalCrVal != null && totalCrVal !== '' && Number.isFinite(Number(totalCrVal))
        ? Number(totalCrVal)
        : 0;

    const qtyRaw = get(cQty);
    const qty =
      qtyRaw != null && qtyRaw !== '' && Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : undefined;

    const rateRs = normalizeRateRs(get(cRate), qtyRaw, totalCost);
    const rateCr = rateRs != null ? rateRs / CR : 0;

    const reason = get(cReason);
    const benefits = get(cBenefits);
    const roiRaw = get(cRoi);
    const roi =
      roiRaw == null || roiRaw === '' || String(roiRaw).trim() === '-'
        ? undefined
        : String(roiRaw).trim();

    const deptRaw = get(cDept);
    const department = deptRaw != null ? String(deptRaw).trim() : '';

    const sNo = snoStr || undefined;

    items.push({
      plant,
      sNo,
      head: currentHead || 'General',
      department,
      subParticulars: sub || (isSricityPlaceholder ? 'New business items (FY 2026-27)' : 'UC (Urban Company)'),
      rateRs,
      qty,
      totalCost,
      rate: rateCr,
      reasonForRequirement: reason != null ? String(reason).trim() : undefined,
      benefits: benefits != null ? String(benefits).trim() : undefined,
      roi,
    });
  }

  return items;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);

  const all = [];
  for (const [sheetName, plant] of Object.entries(SHEET_PLANT)) {
    const sheet = wb.getWorksheet(sheetName);
    if (!sheet) {
      console.warn('Missing sheet:', sheetName);
      continue;
    }
    const rows = await parseSheet(sheet, plant);
    all.push(...rows);
    const sum = rows.reduce((s, i) => s + i.totalCost, 0);
    console.log(`${sheetName} (${plant}): ${rows.length} rows, ${sum.toFixed(3)} Cr`);
  }

  const totals = {};
  for (const item of all) {
    totals[item.plant] = (totals[item.plant] ?? 0) + item.totalCost;
  }
  console.log('\nPlant totals:', totals);
  console.log('Grand total:', Object.values(totals).reduce((a, b) => a + b, 0).toFixed(3));

  const lines = [
    "import type { CapexMasterItem } from './types';",
    '',
    '/** FY 2026-27 Brown Field RAC plant master — generated from workbook. Do not edit by hand. */',
    'export const brownFieldSeedData: CapexMasterItem[] = [',
  ];

  all.forEach((item, idx) => {
    const id = `cm-bf-${item.plant}-${String(idx + 1).padStart(4, '0')}`;
    const parts = [
      `id: ${esc(id)}`,
      `fieldType: 'brown_field'`,
      `fy: ${esc(FY)}`,
      `plant: ${esc(item.plant)}`,
      `head: ${esc(item.head)}`,
      `department: ${esc(item.department)}`,
      `subParticulars: ${esc(item.subParticulars)}`,
      `rate: ${item.rate}`,
      `totalCost: ${item.totalCost}`,
    ];
    if (item.sNo) parts.push(`sNo: ${esc(item.sNo)}`);
    if (item.rateRs != null) parts.push(`rateRs: ${item.rateRs}`);
    if (item.qty != null) parts.push(`qty: ${item.qty}`);
    if (item.reasonForRequirement) parts.push(`reasonForRequirement: ${esc(item.reasonForRequirement)}`);
    if (item.benefits) parts.push(`benefits: ${esc(item.benefits)}`);
    if (item.roi) parts.push(`roi: ${esc(item.roi)}`);

    lines.push(`  { ${parts.join(', ')} },`);
  });

  lines.push('];', '');
  writeFileSync(OUT, lines.join('\n'));
  console.log(`\nWrote ${all.length} items to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
