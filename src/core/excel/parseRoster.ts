/**
 * Reads the student rows that follow a detected header, and decides where the
 * table ends.
 *
 * The end-of-table rules come from the real export: after the last student the
 * sheet has one blank row, then a print footer holding the page number `1 / 1`
 * and the school name. Neither is a student.
 */

import { normalizeCell, normalizeName, parseNumberLike } from '../model/normalize';
import { uuid } from '../model/ids';
import type { Gender, Student } from '../model/types';
import { cellAt, type RawCell } from './grid';
import { scoreHeaderRow, type ColumnMapping, type HeaderDetection } from './detectHeader';

/** Blank rows tolerated inside the table before it is considered finished. */
const BLANK_RUN_LIMIT = 3;

/** `1 / 1`, `2/3`, `- 1 -` style print artefacts. */
const PAGE_NUMBER = /^(\d+\s*\/\s*\d+|-\s*\d+\s*-)$/;

/** A lone cell naming the school, e.g. `○○고등학교`. */
const SCHOOL_NAME = /(초등학교|중학교|고등학교|학교)$/;

/** Row-level totals that some teachers append below the roster. */
const SUMMARY_WORDS = new Set(['계', '합계', '소계', '총계', '인원', '총원', '비고']);

export interface RowIssue {
  kind: 'duplicateNumber' | 'duplicateName' | 'missingNumber' | 'emptyName' | 'skippedRow';
  rowIndex: number;
  message: string;
}

export interface ParsedBlock {
  header: HeaderDetection;
  students: Student[];
  /** Exclusive index of the first row after the table. */
  endRow: number;
  issues: RowIssue[];
}

function parseGender(raw: RawCell): Gender {
  const text = normalizeCell(raw).replace(/\s/g, '');
  if (text === '') return 'unset';
  if (['남', '남자', '남학생', 'M', 'm', 'male', '1'].includes(text)) return 'male';
  if (['여', '여자', '여학생', 'F', 'f', 'female', '2'].includes(text)) return 'female';
  if (['기타', 'other', 'X', 'x'].includes(text)) return 'other';
  if (['비공개', '미공개'].includes(text)) return 'undisclosed';
  return 'unset';
}

/** True when the row is a print footer, a page number or a totals line. */
function isFooterRow(cells: RawCell[][], rowIndex: number, width: number): boolean {
  const texts: string[] = [];
  for (let col = 0; col < width; col += 1) {
    const text = normalizeCell(cellAt(cells, rowIndex, col));
    if (text !== '') texts.push(text);
  }
  if (texts.length === 0) return false;
  // A footer row is short and made only of print artefacts.
  if (texts.length > 4) return false;
  return texts.every(
    (text) =>
      PAGE_NUMBER.test(text) ||
      SCHOOL_NAME.test(text.replace(/\s/g, '')) ||
      SUMMARY_WORDS.has(text.replace(/\s/g, '')),
  );
}

function readRow(
  cells: RawCell[][],
  rowIndex: number,
  mapping: ColumnMapping,
): { number: number | null; name: string } {
  return {
    number: parseNumberLike(cellAt(cells, rowIndex, mapping.number)),
    name: normalizeName(cellAt(cells, rowIndex, mapping.name)),
  };
}

/**
 * Parses one student table.
 *
 * @param stopBefore rows at or after this index are never read; callers pass
 *   the next header's row index when a sheet stacks several classes.
 */
export function parseBlock(
  cells: RawCell[][],
  header: HeaderDetection,
  width: number,
  stopBefore = Number.POSITIVE_INFINITY,
): ParsedBlock {
  const { mapping } = header;
  const students: Student[] = [];
  const sourceRows: number[] = [];
  const issues: RowIssue[] = [];

  let blankRun = 0;
  let row = header.rowIndex + 1;
  let endRow = row;

  for (; row < cells.length && row < stopBefore; row += 1) {
    const { number, name } = readRow(cells, row, mapping);

    if (number === null && name === '') {
      blankRun += 1;
      if (blankRun >= BLANK_RUN_LIMIT) break;
      continue;
    }

    if (isFooterRow(cells, row, width)) break;

    // Another header means the next class block starts here.
    if (name !== '' && scoreHeaderRow(cells, row) !== null && number === null) break;

    blankRun = 0;

    if (name === '') {
      issues.push({
        kind: 'emptyName',
        rowIndex: row,
        message: `${row + 1}행: 번호는 있지만 이름이 비어 있어 건너뛰었습니다.`,
      });
      continue;
    }

    if (number === null) {
      issues.push({
        kind: 'missingNumber',
        rowIndex: row,
        message: `${row + 1}행: 번호를 숫자로 읽을 수 없습니다. 명단에서 직접 입력해 주세요.`,
      });
    }

    const gradeRaw = mapping.grade !== undefined ? parseNumberLike(cellAt(cells, row, mapping.grade)) : null;
    const departmentRaw =
      mapping.department !== undefined ? normalizeCell(cellAt(cells, row, mapping.department)) : '';
    const classRaw =
      mapping.classNumber !== undefined ? normalizeCell(cellAt(cells, row, mapping.classNumber)) : '';
    const genderRaw = mapping.gender !== undefined ? cellAt(cells, row, mapping.gender) : null;

    const student: Student = {
      id: uuid(),
      number,
      name,
      gender: parseGender(genderRaw),
      // Never guessed from a name. Set by the teacher, or by the
      // «이름 순서로 구분 나누기» button on the roster screen.
      division: 'unset',
      status: 'active',
      tags: [],
      customFields: {},
    };
    if (gradeRaw !== null) student.grade = gradeRaw;
    if (departmentRaw !== '') student.department = departmentRaw;
    if (classRaw !== '') student.classNumber = classRaw;

    students.push(student);
    sourceRows.push(row);
    endRow = row + 1;
  }

  // Duplicate detection runs on the finished list so row numbers stay accurate.
  const numberSeen = new Map<number, number>();
  const nameSeen = new Map<string, number>();
  students.forEach((student, index) => {
    const sourceRow = sourceRows[index] ?? header.rowIndex + 1 + index;
    if (student.number !== null) {
      if (numberSeen.has(student.number)) {
        issues.push({
          kind: 'duplicateNumber',
          rowIndex: sourceRow,
          message: `${sourceRow + 1}행: 출석번호 ${student.number}번이 두 번 이상 나옵니다. 확인해 주세요.`,
        });
      } else {
        numberSeen.set(student.number, index);
      }
    }
    const key = student.name.replace(/\s/g, '');
    if (nameSeen.has(key)) {
      issues.push({
        kind: 'duplicateName',
        rowIndex: sourceRow,
        message: `${sourceRow + 1}행: 이름이 같은 학생이 있습니다. 서로 다른 학생으로 구분해 두었습니다.`,
      });
    } else {
      nameSeen.set(key, index);
    }
  });

  return { header, students, endRow, issues };
}

/** True when a parsed block holds enough students to be worth offering. */
export function isUsableBlock(block: ParsedBlock): boolean {
  return block.students.length > 0;
}
