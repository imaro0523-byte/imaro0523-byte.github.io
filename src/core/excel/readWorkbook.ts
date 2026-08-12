/**
 * The only file that knows about SheetJS.
 *
 * Reads an `ArrayBuffer` straight from the user's `File` object and produces
 * plain grids. Nothing here touches the network: SheetJS is bundled into the
 * application, and the buffer never leaves the function.
 */

import * as XLSX from 'xlsx';
import type { RawCell, SheetGrid } from './grid';

export class WorkbookReadError extends Error {
  readonly reason: 'encrypted' | 'corrupt' | 'empty' | 'tooLarge' | 'tooManyRows' | 'unknown';

  constructor(reason: WorkbookReadError['reason'], message: string) {
    super(message);
    this.name = 'WorkbookReadError';
    this.reason = reason;
  }
}

function toRawCell(value: unknown): RawCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value;
  return String(value);
}

/**
 * Converts a worksheet into a dense row-major grid.
 *
 * Uses `sheet_to_json` with `header: 1` so values arrive positionally; the
 * object-keyed form is deliberately avoided because that is the code path with
 * the known prototype-pollution issue in older SheetJS builds.
 */
function sheetToGrid(sheet: XLSX.WorkSheet, name: string, hidden: boolean): SheetGrid {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });
  if (rows.length > LIMITS.rowsPerSheet) {
    throw new WorkbookReadError(
      'tooManyRows',
      `«${name}» 시트에 ${rows.length.toLocaleString('ko-KR')}행이 있습니다. ` +
        `명렬표로 보기에는 너무 커서 열지 않았습니다 (${LIMITS.rowsPerSheet.toLocaleString('ko-KR')}행까지).`,
    );
  }
  // Wide sheets are truncated rather than refused: the roster columns are on
  // the left, so cutting the far right loses nothing a teacher needs.
  const cells: RawCell[][] = rows.map((row) =>
    Array.isArray(row) ? row.slice(0, LIMITS.columnsPerSheet).map(toRawCell) : [],
  );
  return { name, hidden, cells };
}

/** `PK\x03\x04` — every .xlsx is a zip archive. */
function looksLikeZip(buffer: ArrayBuffer): boolean {
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/**
 * Ceilings on what will be parsed.
 *
 * A class roster is a few hundred cells. These limits are far above anything a
 * real one reaches, and they exist so that a wrong file — a compressed archive
 * that expands enormously, a database export, a spreadsheet with a million
 * blank rows — produces an explanation instead of a frozen tab. The risk is to
 * the teacher's own browser, not to their data, but a tool that hangs with no
 * message is still a broken tool.
 */
export const LIMITS = {
  /** 20 MB. A NEIS roster is around 10 KB. */
  fileBytes: 20 * 1024 * 1024,
  rowsPerSheet: 20000,
  columnsPerSheet: 512,
  sheets: 100,
} as const;

function describeBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))}MB`
    : `${Math.round(bytes / 1024)}KB`;
}

/**
 * Reads every sheet of a workbook, including hidden ones — a hidden sheet still
 * holds a usable roster, and the UI lets the teacher pick.
 */
export function readWorkbookGrids(buffer: ArrayBuffer): SheetGrid[] {
  if (buffer.byteLength === 0) {
    throw new WorkbookReadError('empty', '내용이 없는 파일입니다.');
  }
  if (buffer.byteLength > LIMITS.fileBytes) {
    throw new WorkbookReadError(
      'tooLarge',
      `파일이 너무 큽니다 (${describeBytes(buffer.byteLength)}). ` +
        `명렬표는 보통 1MB를 넘지 않습니다. ${describeBytes(LIMITS.fileBytes)} 이하 파일만 열 수 있습니다.`,
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'array',
      // Cell formatting, formulas and styles are irrelevant here and skipping
      // them keeps memory down on large files.
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      sheetStubs: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/password|encrypt/i.test(message)) {
      throw new WorkbookReadError(
        'encrypted',
        '암호가 걸린 파일입니다. 엑셀에서 암호를 푼 뒤 다시 시도해 주세요.',
      );
    }
    throw new WorkbookReadError(
      'corrupt',
      looksLikeZip(buffer)
        ? '엑셀 파일이 손상되어 열 수 없습니다. 엑셀에서 열어 «다른 이름으로 저장»한 뒤 다시 시도해 주세요.'
        : '엑셀 파일로 읽을 수 없는 형식입니다. .xlsx, .xls 또는 CSV 파일인지 확인해 주세요.',
    );
  }

  const names = workbook.SheetNames ?? [];
  if (names.length === 0) {
    throw new WorkbookReadError('empty', '시트가 없는 파일입니다.');
  }
  if (names.length > LIMITS.sheets) {
    throw new WorkbookReadError(
      'tooManyRows',
      `시트가 ${names.length}개나 있습니다. 명렬표 파일이 맞는지 확인해 주세요.`,
    );
  }

  const hiddenByName = new Map<string, boolean>();
  for (const entry of workbook.Workbook?.Sheets ?? []) {
    if (entry?.name) hiddenByName.set(entry.name, (entry.Hidden ?? 0) !== 0);
  }

  const grids: SheetGrid[] = [];
  for (const name of names) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    grids.push(sheetToGrid(sheet, name, hiddenByName.get(name) ?? false));
  }
  return grids;
}

/**
 * CSV needs its own path because Korean CSVs are still commonly saved as
 * EUC-KR/CP949, and decoding those as UTF-8 produces mojibake rather than an
 * error. Tries UTF-8 first and falls back when the result contains replacement
 * characters.
 */
export function readCsvGrid(buffer: ArrayBuffer, name = 'CSV'): SheetGrid {
  const bytes = new Uint8Array(buffer);
  let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (text.includes('�')) {
    try {
      const fallback = new TextDecoder('euc-kr').decode(bytes);
      if (!fallback.includes('�')) text = fallback;
    } catch {
      // TextDecoder without the euc-kr label: keep the UTF-8 reading.
    }
  }
  // Strip a UTF-8 BOM so the first header cell is not prefixed with U+FEFF.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const workbook = XLSX.read(text, { type: 'string', raw: true, FS: ',' });
  const first = workbook.SheetNames[0];
  if (!first) throw new WorkbookReadError('empty', '내용이 없는 CSV 파일입니다.');
  const sheet = workbook.Sheets[first];
  if (!sheet) throw new WorkbookReadError('empty', '내용이 없는 CSV 파일입니다.');
  return sheetToGrid(sheet, name, false);
}
