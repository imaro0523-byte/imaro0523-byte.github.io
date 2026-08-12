/**
 * Turns a set of sheets into roster candidates the teacher can choose between.
 *
 * A workbook may hold several classes — one per sheet, or several stacked in a
 * single sheet — so the importer collects every table it can find instead of
 * assuming there is exactly one.
 */

import type { RosterMeta, Student } from '../model/types';
import { consensusValue, extractMeta } from './meta';
import { detectHeaderRows, type ColumnMapping, type HeaderDetection } from './detectHeader';
import { gridWidth, type SheetGrid } from './grid';
import { parseBlock, type ParsedBlock, type RowIssue } from './parseRoster';

export interface RosterCandidate {
  key: string;
  sheetName: string;
  sheetIndex: number;
  sheetHidden: boolean;
  header: HeaderDetection;
  students: Student[];
  meta: RosterMeta;
  issues: RowIssue[];
  /** Human-readable label for the sheet/class picker. */
  label: string;
}

function labelFor(meta: RosterMeta, sheetName: string, count: number): string {
  const parts: string[] = [];
  if (meta.grade !== undefined && meta.classNumber) parts.push(`${meta.classNumber}`);
  else if (meta.grade !== undefined) parts.push(`${meta.grade}학년`);
  if (meta.subject) parts.push(meta.subject);
  parts.push(`${count}명`);
  return `${sheetName} — ${parts.join(' · ')}`;
}

function enrich(block: ParsedBlock, grid: SheetGrid, sheetIndex: number): RosterCandidate {
  const meta = extractMeta(grid.cells, grid.name, block.header.rowIndex, block.endRow);

  // Values read from the student rows beat anything parsed out of the title
  // line, because they come straight from NEIS's own columns.
  const gradeFromRows = consensusValue(block.students.map((s) => s.grade));
  const classFromRows = consensusValue(block.students.map((s) => s.classNumber));
  if (gradeFromRows !== undefined) meta.grade = gradeFromRows;
  if (classFromRows !== undefined && gradeFromRows !== undefined) {
    meta.classNumber = `${gradeFromRows}-${classFromRows}`;
  } else if (classFromRows !== undefined) {
    meta.classNumber = classFromRows;
  }

  return {
    key: `${sheetIndex}:${block.header.rowIndex}`,
    sheetName: grid.name,
    sheetIndex,
    sheetHidden: grid.hidden,
    header: block.header,
    students: block.students,
    meta,
    issues: block.issues,
    label: labelFor(meta, grid.name, block.students.length),
  };
}

/** Every student table the detector can find, best sheet first. */
export function findRosters(grids: SheetGrid[]): RosterCandidate[] {
  const out: RosterCandidate[] = [];

  grids.forEach((grid, sheetIndex) => {
    const headers = detectHeaderRows(grid.cells);
    if (headers.length === 0) return;
    const width = gridWidth(grid.cells);

    headers.forEach((header, i) => {
      const next = headers[i + 1];
      const block = parseBlock(grid.cells, header, width, next ? next.rowIndex : undefined);
      if (block.students.length === 0) return;
      out.push(enrich(block, grid, sheetIndex));
    });
  });

  // Visible sheets first, then larger rosters — the most likely intent.
  return out.sort((a, b) => {
    if (a.sheetHidden !== b.sheetHidden) return a.sheetHidden ? 1 : -1;
    if (a.sheetIndex !== b.sheetIndex) return a.sheetIndex - b.sheetIndex;
    return b.students.length - a.students.length;
  });
}

/**
 * Manual fallback: the teacher points at the header row and the columns after
 * automatic detection has failed or picked the wrong table.
 */
export function parseWithManualMapping(
  grid: SheetGrid,
  sheetIndex: number,
  headerRow: number,
  mapping: ColumnMapping,
): RosterCandidate {
  const header: HeaderDetection = {
    rowIndex: headerRow,
    score: 0,
    mapping,
    headerTexts: {},
  };
  const block = parseBlock(grid.cells, header, gridWidth(grid.cells));
  return enrich(block, grid, sheetIndex);
}
