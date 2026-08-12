/**
 * The importer works on a plain 2-D grid, not on a SheetJS workbook.
 *
 * That boundary matters: every header-detection and row-parsing rule can be
 * unit-tested with literal arrays, and swapping the spreadsheet reader later
 * touches exactly one file (`readWorkbook.ts`).
 */

export type RawCell = string | number | boolean | Date | null;

export interface SheetGrid {
  name: string;
  hidden: boolean;
  /** Row-major. Rows may be ragged; readers must tolerate `undefined`. */
  cells: RawCell[][];
}

/** Safe cell access for ragged grids. */
export function cellAt(cells: RawCell[][], row: number, col: number): RawCell {
  const r = cells[row];
  if (!r) return null;
  const v = r[col];
  return v === undefined ? null : v;
}

/** Widest row in the grid, so callers can iterate columns safely. */
export function gridWidth(cells: RawCell[][]): number {
  let width = 0;
  for (const row of cells) {
    if (row && row.length > width) width = row.length;
  }
  return width;
}
