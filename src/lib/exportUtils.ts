import type ExcelJS from 'exceljs';
import { CapexRequest, Vendor, VendorInvite } from './types';

export async function exportVendorGridToExcel(
  request: CapexRequest,
  invites: VendorInvite[],
  vendors: Vendor[]
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheetName = request.subject.slice(0, 31);
  const ws = workbook.addWorksheet(sheetName);

  const requestNo = request.requestNo ?? request.id;

  // ── Section A: Request Info ────────────────────────────────────

  // Determine how many columns we'll need (12 for the comparison table)
  const TOTAL_COLS = 12;

  // Row 1: Title
  ws.addRow(['CAPEX Vendor Comparison']);
  const titleRow = ws.getRow(1);
  ws.mergeCells(1, 1, 1, TOTAL_COLS);
  titleRow.getCell(1).value = 'CAPEX Vendor Comparison';
  titleRow.getCell(1).font = { bold: true, size: 16 };
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  titleRow.height = 28;

  // Rows 2–6: Key-value pairs
  const infoRows: [string, string | number][] = [
    ['Request No', requestNo],
    ['Subject',    request.subject],
    ['Category',   request.category],
    ['Quantity',   request.quantity],
    ['Budget',     request.budget ? '₹' + request.budget.toLocaleString('en-IN') : '—'],
  ];

  infoRows.forEach(([label, value]) => {
    const r = ws.addRow([label, value]);
    r.getCell(1).font = { bold: true };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws.mergeCells(r.number, 2, r.number, TOTAL_COLS);
  });

  // Row 7: blank separator
  ws.addRow([]);

  // ── Section B: Comparison Table starting at row 9 ─────────────

  const AMBER_FILL: ExcelJS.Fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBBF24' },
  };

  const headers = [
    '#', 'Vendor Name', 'Vendor Code', 'Status',
    'Base Price (₹)', 'Freight (₹)', 'Packing (₹)', 'Service (₹)', 'Total (₹)',
    'Delivery (days)', 'Warranty (yrs)', 'Valid Until',
  ];

  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => {
    cell.fill = AMBER_FILL;
    cell.font = { bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFD97706' } },
    };
  });

  const requestInvites = invites
    .filter(inv => inv.requestId === request.id && inv.quotes.length > 0)
    .map(inv => {
      const vendor = vendors.find(v => v.id === inv.vendorId);
      const quote = inv.quotes[inv.quotes.length - 1];
      const total = quote.price + (quote.freight ?? 0) + (quote.packing ?? 0) + (quote.service ?? 0);
      return { inv, vendor, quote, total };
    })
    .sort((a, b) => a.total - b.total);

  const approvedInviteId = invites.find(i => i.status === 'approved')?.id ?? null;

  const GREEN_FILL: ExcelJS.Fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF86EFAC' },
  };
  const LIGHT_GREEN_FILL: ExcelJS.Fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' },
  };
  const ALT_FILL: ExcelJS.Fill = {
    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' },
  };

  requestInvites.forEach(({ inv, vendor, quote, total }, idx) => {
    const isLowest   = idx === 0;
    const isApproved = inv.id === approvedInviteId;

    const dataRow = ws.addRow([
      idx + 1,
      vendor?.vendorName ?? '—',
      vendor?.vendorCode ?? '—',
      inv.status,
      quote.price,
      quote.freight ?? '—',
      quote.packing ?? '—',
      quote.service ?? '—',
      total,
      quote.deliveryDays,
      quote.warranty ?? '—',
      quote.validUntil ? new Date(quote.validUntil).toLocaleDateString('en-IN') : '—',
    ]);

    const fill: ExcelJS.Fill = isLowest
      ? GREEN_FILL
      : isApproved
      ? LIGHT_GREEN_FILL
      : idx % 2 === 1
      ? ALT_FILL
      : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

    dataRow.eachCell(cell => {
      cell.fill = fill;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    if (isLowest) {
      dataRow.font = { bold: true };
    }
  });

  // ── Section C: Recommended Vendor ─────────────────────────────

  // Blank separator
  ws.addRow([]);

  if (requestInvites.length > 0) {
    const cheapest = requestInvites[0];
    const recRow = ws.addRow([
      'Lowest Price Vendor:',
      cheapest.vendor?.vendorName ?? '—',
      '',
      'Total:',
      '₹' + cheapest.total.toLocaleString('en-IN'),
    ]);
    recRow.getCell(1).font = { bold: true };
    recRow.getCell(2).font = { bold: true };
    recRow.getCell(4).font = { bold: true };
    recRow.getCell(5).font = { bold: true };
  }

  // ── Auto-fit column widths ─────────────────────────────────────

  ws.columns.forEach(col => {
    let maxLength = 10;
    col?.eachCell?.({ includeEmpty: true }, cell => {
      const val = cell.value ? String(cell.value) : '';
      if (val.length > maxLength) maxLength = val.length;
    });
    col.width = maxLength + 2;
  });

  // ── Download ───────────────────────────────────────────────────

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `CAPEX-${requestNo}-Comparison.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
