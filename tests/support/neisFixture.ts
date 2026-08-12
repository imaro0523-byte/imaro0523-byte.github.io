/**
 * Builds synthetic rosters shaped exactly like a real NEIS 교과시간별출석부.
 *
 * The layout below was derived by inspecting an actual export: the table starts
 * at column B (column A is empty), attendance numbers are stored as floats, the
 * header carries roughly twenty empty-string cells to the right of 성 명 for the
 * attendance grid, and the sheet ends with a print footer holding `1 / 1` and
 * the school name.
 *
 * Names are always synthetic (학생01, 학생02, …). No real student name appears
 * anywhere in this repository.
 */

import * as XLSX from 'xlsx';
import type { RawCell } from '@/core/excel/grid';

export interface NeisFixtureOptions {
  studentCount?: number;
  grade?: number;
  classNumber?: number;
  subject?: string;
  teacherName?: string;
  schoolName?: string;
  /** `성 명` (as NEIS writes it) or `성명`. */
  nameHeader?: string;
  /** Emit attendance numbers as floats (NEIS) or as strings. */
  numberStyle?: 'float' | 'string' | 'mixed';
  /** Insert a fully blank row in the middle of the table. */
  blankRowInMiddle?: boolean;
  /** Give two students the same name, to exercise 동명이인 handling. */
  duplicateName?: boolean;
  /** Reuse one attendance number, to exercise duplicate detection. */
  duplicateNumber?: boolean;
  /** Leave one name cell empty. */
  emptyName?: boolean;
  /** Drop the whole metadata block above the table. */
  withoutMeta?: boolean;
  /** Add a 성별 column. Off by default: NEIS does not export one. */
  withGender?: boolean;
  /** Shift the whole table right/down, to prove no fixed offsets are assumed. */
  offsetRows?: number;
  offsetCols?: number;
}

/** Synthetic student name for index `i` (0-based). */
export function fixtureName(i: number): string {
  return `학생${String(i + 1).padStart(2, '0')}`;
}

const COL = {
  seq: 1, // B
  grade: 3, // D
  department: 4, // E
  classNumber: 6, // G
  number: 7, // H
  name: 8, // I
} as const;

/** Right edge of the attendance grid that follows 성 명 in the real file. */
const ATTENDANCE_LAST_COL = 27; // AB

function put(cells: RawCell[][], row: number, col: number, value: RawCell): void {
  let target = cells[row];
  if (!target) {
    target = [];
    cells[row] = target;
  }
  while (target.length < col) target.push(null);
  target[col] = value;
}

export function buildNeisGrid(options: NeisFixtureOptions = {}): RawCell[][] {
  const {
    studentCount = 25,
    grade = 1,
    classNumber = 1,
    subject = '통합과학1',
    teacherName = '교사01',
    schoolName = '가나고등학교',
    nameHeader = '성 명',
    numberStyle = 'float',
    blankRowInMiddle = false,
    duplicateName = false,
    duplicateNumber = false,
    emptyName = false,
    withoutMeta = false,
    withGender = false,
    offsetRows = 0,
    offsetCols = 0,
  } = options;

  const cells: RawCell[][] = [];
  const c = (col: number) => col + offsetCols;

  if (!withoutMeta) {
    put(cells, offsetRows + 1, c(19), '2026.08.12.');
    put(cells, offsetRows + 3, c(5), '교과시간별출석부');
    // Two spaces before the class number, exactly as NEIS writes it.
    put(cells, offsetRows + 5, c(2), `교과 : ${subject} ${grade}학년  ${grade}-${classNumber}`);
    put(cells, offsetRows + 5, c(19), `담당교사 : ${teacherName}`);
    put(cells, offsetRows + 6, c(2), '[월 6], [화 1], [수 5]');
  }

  const headerRow = offsetRows + 8;
  put(cells, headerRow, c(COL.seq), '연번');
  put(cells, headerRow, c(COL.grade), '학년');
  put(cells, headerRow, c(COL.department), '학과');
  put(cells, headerRow, c(COL.classNumber), '반');
  put(cells, headerRow, c(COL.number), '번호');
  put(cells, headerRow, c(COL.name), nameHeader);
  if (withGender) put(cells, headerRow, c(COL.name + 1), '성별');
  // The empty-string headers of the attendance grid.
  for (let col = COL.name + (withGender ? 2 : 1); col <= ATTENDANCE_LAST_COL; col += 1) {
    put(cells, headerRow, c(col), '');
  }

  let row = headerRow + 1;
  for (let i = 0; i < studentCount; i += 1) {
    if (blankRowInMiddle && i === Math.floor(studentCount / 2)) {
      put(cells, row, c(COL.seq), null);
      row += 1;
    }

    const seq = i + 1;
    const number = duplicateNumber && i === 3 ? 3 : seq;
    const asNumber: RawCell =
      numberStyle === 'string'
        ? String(number)
        : numberStyle === 'mixed' && i % 2 === 1
          ? `${number}.0`
          : number;

    let name = fixtureName(i);
    if (duplicateName && i === 5) name = fixtureName(0);
    if (emptyName && i === 7) name = '';

    put(cells, row, c(COL.seq), seq);
    put(cells, row, c(COL.grade), grade);
    put(cells, row, c(COL.department), '일반학과');
    put(cells, row, c(COL.classNumber), classNumber);
    put(cells, row, c(COL.number), asNumber);
    put(cells, row, c(COL.name), name);
    if (withGender) put(cells, row, c(COL.name + 1), i % 2 === 0 ? '남' : '여');
    for (let col = COL.name + (withGender ? 2 : 1); col <= ATTENDANCE_LAST_COL; col += 1) {
      put(cells, row, c(col), '');
    }
    row += 1;
  }

  // Blank row, then the print footer.
  row += 1;
  put(cells, row, c(9), '1 / 1');
  put(cells, row, c(22), schoolName);

  // Normalise ragged rows so the grid is rectangular, like sheet_to_json output.
  const width = cells.reduce((w, r) => Math.max(w, r ? r.length : 0), 0);
  for (let i = 0; i < cells.length; i += 1) {
    const r = cells[i] ?? [];
    while (r.length < width) r.push(null);
    cells[i] = r;
  }
  return cells;
}

/** The same fixture as a real `.xlsx` byte stream, for E2E upload tests. */
export function buildNeisWorkbook(options: NeisFixtureOptions = {}): ArrayBuffer {
  const cells = buildNeisGrid(options);
  const sheet = XLSX.utils.aoa_to_sheet(cells as unknown[][]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'sheet1');
  const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return out as ArrayBuffer;
}

/** Two classes stacked in one sheet, to exercise multi-block detection. */
export function buildStackedGrid(): RawCell[][] {
  const first = buildNeisGrid({ studentCount: 4, classNumber: 1 });
  const second = buildNeisGrid({ studentCount: 6, classNumber: 2, withoutMeta: true });
  const gap: RawCell[][] = [[], []];
  return [...first, ...gap, ...second];
}
