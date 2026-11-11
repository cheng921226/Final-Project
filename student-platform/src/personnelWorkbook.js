import ExcelJS from 'exceljs';

export const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function downloadPersonnelWorkbook(filename, headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('人員名冊');
  sheet.columns = headers.map(header => ({
    header,
    width: header === 'Email' || header === '最近登入' ? 30 : 16,
    style: { numFmt: '@' },
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.addRows(rows.map(row => row.map(value => String(value ?? ''))));

  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: EXCEL_MIME_TYPE }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function readPersonnelWorkbook(file) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('請上傳 Excel（.xlsx）檔案');
  if (file.size > 2 * 1024 * 1024) throw new Error('Excel 檔案不可超過 2 MB');

  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error('無法讀取 Excel 檔案，請確認檔案格式與內容');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || !sheet.getRow(1).hasValues) throw new Error('Excel 第一張工作表缺少標題列');

  const columnCount = sheet.getRow(1).cellCount;
  const blankRow = Array(columnCount).fill('""').join(',');
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    const values = Array.from({ length: columnCount }, (_, index) => {
      const cell = row.getCell(index + 1);
      if (cell.type === ExcelJS.ValueType.Formula) {
        throw new Error(`第 ${rowNumber} 列含有公式，請先貼上為值再匯入`);
      }
      return `"${cell.text.replace(/"/g, '""')}"`;
    });
    rows[rowNumber - 1] = values.join(',');
  });

  const csv = Array.from(rows, row => row ?? blankRow).join('\r\n');
  return new File([csv], 'personnel.csv', { type: 'text/csv' });
}
