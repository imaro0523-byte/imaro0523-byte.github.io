/**
 * Locates the student table's header row by scoring every row in the sheet.
 *
 * No fixed cell address, no assumed starting row, no assumed starting column.
 * The real NEIS 교과시간별출석부 puts its header on row 9 starting at column B,
 * with roughly twenty *empty-string* header cells to the right of 성 명 for the
 * attendance grid — so neither "first non-empty row" nor "row with the most
 * filled cells" works. Keyword matching does.
 */

import { normalizeHeader } from '../model/normalize';
import { cellAt, gridWidth, type RawCell } from './grid';

export type FieldKey =
  | 'seq'
  | 'grade'
  | 'department'
  | 'classNumber'
  | 'number'
  | 'name'
  | 'gender';

/**
 * Exact-match tokens per field, compared after all whitespace is removed.
 * Exact matching keeps `성` (성별) from swallowing `성명`.
 */
const FIELD_TOKENS: Record<FieldKey, readonly string[]> = {
  seq: ['연번', '순번', '일련번호', '연번호'],
  grade: ['학년'],
  department: ['학과', '계열', '전공', '학과명'],
  classNumber: ['반', '학반', '분반', '반명'],
  number: ['번호', '출석번호', '번', '학번', 'no', 'no.', 'NO', '번호순'],
  name: ['성명', '이름', '성함', '학생명', '학생이름', 'name', '성명(한글)'],
  gender: ['성별', '성'],
};

/** Points a field contributes when found in a row. */
const FIELD_WEIGHT: Record<FieldKey, number> = {
  name: 4,
  number: 4,
  seq: 2,
  grade: 1,
  department: 1,
  classNumber: 1,
  gender: 1,
};

export type ColumnMapping = Partial<Record<FieldKey, number>> & {
  number: number;
  name: number;
};

export interface HeaderDetection {
  rowIndex: number;
  score: number;
  mapping: ColumnMapping;
  /** Normalised header text per mapped column, for the preview UI. */
  headerTexts: Partial<Record<FieldKey, string>>;
}

function matchField(token: string): FieldKey | null {
  if (token === '') return null;
  const lower = token.toLowerCase();
  for (const key of Object.keys(FIELD_TOKENS) as FieldKey[]) {
    for (const candidate of FIELD_TOKENS[key]) {
      if (token === candidate || lower === candidate.toLowerCase()) return key;
    }
  }
  return null;
}

/**
 * Scores one row as a header candidate. Returns `null` when the row does not
 * carry both a name-like and a number-like column, which are the two fields the
 * rest of the importer cannot work without.
 */
export function scoreHeaderRow(cells: RawCell[][], rowIndex: number): HeaderDetection | null {
  const width = gridWidth(cells);
  const found: Partial<Record<FieldKey, number>> = {};
  const texts: Partial<Record<FieldKey, string>> = {};

  for (let col = 0; col < width; col += 1) {
    const token = normalizeHeader(cellAt(cells, rowIndex, col));
    const field = matchField(token);
    // First occurrence wins, so a repeated header further right cannot hijack
    // the mapping (NEIS repeats blank headers, not real ones).
    if (field && found[field] === undefined) {
      found[field] = col;
      texts[field] = token;
    }
  }

  const nameCol = found.name;
  // 연번 alone is an acceptable stand-in when the sheet has no 번호 column.
  const numberCol = found.number ?? found.seq;
  if (nameCol === undefined || numberCol === undefined) return null;

  let score = 0;
  for (const key of Object.keys(found) as FieldKey[]) {
    if (found[key] !== undefined) score += FIELD_WEIGHT[key];
  }

  const mapping: ColumnMapping = { ...found, name: nameCol, number: numberCol };
  // When 번호 was missing we consumed 연번 as the attendance number; do not
  // also report it as a separate sequence column.
  if (found.number === undefined) delete mapping.seq;

  return { rowIndex, score, mapping, headerTexts: texts };
}

/**
 * All plausible header rows in a sheet, ordered top to bottom.
 *
 * More than one is normal: some schools stack several classes in a single
 * sheet, each with its own header.
 */
export function detectHeaderRows(cells: RawCell[][]): HeaderDetection[] {
  const out: HeaderDetection[] = [];
  for (let row = 0; row < cells.length; row += 1) {
    const detection = scoreHeaderRow(cells, row);
    if (detection) out.push(detection);
  }
  return out;
}

/** The single best header row, or `null` when the sheet has none. */
export function detectHeaderRow(cells: RawCell[][]): HeaderDetection | null {
  const candidates = detectHeaderRows(cells);
  if (candidates.length === 0) return null;
  let best = candidates[0] as HeaderDetection;
  for (const candidate of candidates) {
    // Highest score wins; ties go to the topmost row.
    if (candidate.score > best.score) best = candidate;
  }
  return best;
}
