import ExcelJS from 'exceljs';

export interface ExcelSheetPreview {
  name: string;
  rows: string[][];
}

function cellToDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>).map((run) => run.text ?? '').join('');
    }
    if ('formula' in v) {
      // Formula result may itself be a primitive, a Date, or absent (e.g. errors).
      return v.result !== undefined && typeof v.result !== 'object' ? cellToDisplayValue(v.result) : '';
    }
    if ('error' in v) return String(v.error);
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(value);
}

/**
 * Parses an .xlsx workbook and extracts a bounded preview: up to `maxSheets`
 * sheets, up to `maxRows` rows per sheet, up to `maxCols` columns per row.
 * Fully blank rows are skipped (exceljs's default eachRow behavior).
 *
 * Note: exceljs's WorkbookReader (streaming parser) is unreliable for files
 * with 3+ sheets -- it throws `Cannot read properties of undefined (reading
 * 'sheets')`, a reproducible bug in exceljs 4.4.0. This uses the standard
 * (non-streaming) reader instead, which parses the whole file into memory
 * before truncating. Callers that run automatically/unattended on arbitrary
 * files (e.g. background thumbnail generation) should guard against huge
 * inputs before calling this rather than relying on it to stop early.
 */
export async function readExcelPreview(
  filePath: string,
  opts: { maxSheets: number; maxRows: number; maxCols: number },
): Promise<ExcelSheetPreview[]> {
  const { maxSheets, maxRows, maxCols } = opts;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets: ExcelSheetPreview[] = [];
  for (const worksheet of workbook.worksheets) {
    if (sheets.length >= maxSheets) break;
    const rows: string[][] = [];
    worksheet.eachRow((row) => {
      if (rows.length >= maxRows) return;
      const values = (row.values as unknown[]).slice(1, maxCols + 1);
      rows.push(values.map(cellToDisplayValue));
    });
    sheets.push({ name: worksheet.name, rows });
  }

  return sheets;
}
