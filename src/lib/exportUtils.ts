import { CapexRequest, Vendor, VendorInvite } from './types';

export async function exportVendorGridToExcel(
  request: CapexRequest,
  invites: VendorInvite[],
  vendors: Vendor[]
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheetName = request.subject.slice(0, 31);
  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

  const headers = [
    'Vendor Name',
    'Vendor Code',
    'Latest Price (INR)',
    'Delivery Days',
    'Quote Validity',
    'Status',
    'Quotes Received',
  ];

  const headerRow = worksheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF59E0B' },
    };
    cell.font = { bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const requestInvites = invites.filter((inv) => inv.requestId === request.id);

  for (const invite of requestInvites) {
    const vendor = vendors.find((v) => v.id === invite.vendorId);
    const latestQuote =
      invite.quotes.length > 0
        ? invite.quotes[invite.quotes.length - 1]
        : null;

    worksheet.addRow([
      vendor?.vendorName ?? '—',
      vendor?.vendorCode ?? '—',
      latestQuote?.price ?? '—',
      latestQuote?.deliveryDays ?? '—',
      latestQuote?.validUntil
        ? new Date(latestQuote.validUntil).toLocaleDateString('en-IN')
        : '—',
      invite.status,
      invite.quotes.length,
    ]);
  }

  worksheet.columns.forEach((col) => {
    let maxLength = 10;
    col?.eachCell?.({ includeEmpty: true }, (cell) => {
      const val = cell.value ? String(cell.value) : '';
      if (val.length > maxLength) maxLength = val.length;
    });
    col.width = maxLength + 2;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sheetName}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
