/**
 * Pulls the title block above the student table.
 *
 * Everything here is best-effort. Metadata is never a precondition for reading
 * the roster: a sheet with no title block at all must still import cleanly.
 */

import { normalizeCell } from '../model/normalize';
import type { RosterMeta } from '../model/types';
import { cellAt, gridWidth, type RawCell } from './grid';

const DATE_PATTERN = /^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*\.?$/;
const SCHOOL_PATTERN = /^(.+?(?:초등학교|중학교|고등학교))$/;
const SUBJECT_PATTERN = /^교과\s*[:：]\s*(.+)$/;
const TEACHER_PATTERN = /^담당\s*교사\s*[:：]\s*(.+)$/;
const PERIODS_PATTERN = /^\[\s*[월화수목금토일]\s*\d+\s*\](\s*,\s*\[\s*[월화수목금토일]\s*\d+\s*\])*$/;
const GRADE_PATTERN = /(\d+)\s*학년/;
const CLASS_PATTERN = /(\d+)\s*-\s*(\d+)/;

/**
 * Reads metadata from the rows above `headerRow` plus the footer rows below the
 * table, where the school name normally lives.
 */
export function extractMeta(
  cells: RawCell[][],
  sheetName: string,
  headerRow: number,
  endRow: number,
): RosterMeta {
  const meta: RosterMeta = { sheetName };
  const width = gridWidth(cells);

  const scan = (from: number, to: number) => {
    for (let row = from; row < to && row < cells.length; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const text = normalizeCell(cellAt(cells, row, col));
        if (text === '') continue;

        const date = DATE_PATTERN.exec(text);
        if (date && meta.createdOn === undefined) {
          const [, y, m, d] = date;
          meta.createdOn = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          continue;
        }

        const school = SCHOOL_PATTERN.exec(text.replace(/\s/g, ''));
        if (school && meta.schoolName === undefined) {
          meta.schoolName = school[1];
          continue;
        }

        const subject = SUBJECT_PATTERN.exec(text);
        if (subject) {
          const body = (subject[1] ?? '').trim();
          const grade = GRADE_PATTERN.exec(body);
          const klass = CLASS_PATTERN.exec(body);
          if (grade && meta.grade === undefined) meta.grade = Number(grade[1]);
          if (klass && meta.classNumber === undefined) meta.classNumber = `${klass[1]}-${klass[2]}`;
          // Whatever precedes "N학년" is the subject name.
          const subjectName = grade ? body.slice(0, grade.index).trim() : body;
          if (subjectName !== '' && meta.subject === undefined) meta.subject = subjectName;
          continue;
        }

        const teacher = TEACHER_PATTERN.exec(text);
        if (teacher && meta.teacherName === undefined) {
          meta.teacherName = (teacher[1] ?? '').trim();
          continue;
        }

        if (PERIODS_PATTERN.test(text) && meta.periods === undefined) {
          meta.periods = text;
        }
      }
    }
  };

  scan(0, headerRow);
  scan(endRow, endRow + 4);

  return meta;
}

/**
 * Class and grade taken from the student rows themselves, which is far more
 * reliable than parsing the title line. Returns the value shared by every row,
 * or `undefined` when the rows disagree.
 */
export function consensusValue<T>(values: Array<T | null | undefined>): T | undefined {
  const present = values.filter((v): v is T => v !== null && v !== undefined);
  if (present.length === 0) return undefined;
  const first = present[0] as T;
  return present.every((v) => v === first) ? first : undefined;
}
