import { describe, expect, it } from 'vitest';

import { detectHeaderRow, detectHeaderRows, scoreHeaderRow } from '@/core/excel/detectHeader';
import { findRosters, parseWithManualMapping } from '@/core/excel/importRoster';
import { gridWidth, type RawCell, type SheetGrid } from '@/core/excel/grid';
import { parseBlock } from '@/core/excel/parseRoster';
import { readWorkbookGrids, readCsvGrid, WorkbookReadError } from '@/core/excel/readWorkbook';
import { normalizeHeader, parseNumberLike } from '@/core/model/normalize';
import { buildNeisGrid, buildNeisWorkbook, buildStackedGrid, fixtureName } from '../support/neisFixture';

function asSheet(cells: RawCell[][], name = 'sheet1', hidden = false): SheetGrid {
  return { name, hidden, cells };
}

describe('normalisation', () => {
  it('treats "성 명" and "성명" as the same header', () => {
    expect(normalizeHeader('성 명')).toBe('성명');
    expect(normalizeHeader('성  명')).toBe('성명');
    expect(normalizeHeader('  성\n명 ')).toBe('성명');
    expect(normalizeHeader('성명')).toBe('성명');
  });

  it('reads the float 1.0 as attendance number 1', () => {
    expect(parseNumberLike(1.0)).toBe(1);
    expect(parseNumberLike('1.0')).toBe(1);
    expect(parseNumberLike('01')).toBe(1);
    expect(parseNumberLike(' 3 ')).toBe(3);
    expect(parseNumberLike('１２')).toBe(12);
    expect(parseNumberLike('12번')).toBe(12);
  });

  it('refuses values that are not whole numbers', () => {
    expect(parseNumberLike(1.5)).toBeNull();
    expect(parseNumberLike('가나')).toBeNull();
    expect(parseNumberLike('')).toBeNull();
    expect(parseNumberLike(null)).toBeNull();
    expect(parseNumberLike(undefined)).toBeNull();
  });
});

describe('header detection', () => {
  it('finds the header row of a real-shaped NEIS sheet', () => {
    const cells = buildNeisGrid();
    const header = detectHeaderRow(cells);

    expect(header).not.toBeNull();
    // Row index 8 == spreadsheet row 9, and column 8 == column I.
    expect(header?.rowIndex).toBe(8);
    expect(header?.mapping.name).toBe(8);
    expect(header?.mapping.number).toBe(7);
    expect(header?.mapping.seq).toBe(1);
    expect(header?.mapping.grade).toBe(3);
    expect(header?.mapping.department).toBe(4);
    expect(header?.mapping.classNumber).toBe(6);
  });

  it('is not confused by the empty-string headers of the attendance grid', () => {
    const cells = buildNeisGrid();
    const headerRow = cells[8] ?? [];
    const emptyStringCells = headerRow.filter((c) => c === '').length;
    expect(emptyStringCells).toBeGreaterThan(15);
    expect(detectHeaderRow(cells)?.rowIndex).toBe(8);
  });

  it('does not assume a fixed row or column', () => {
    const shifted = buildNeisGrid({ offsetRows: 5, offsetCols: 4 });
    const header = detectHeaderRow(shifted);
    expect(header?.rowIndex).toBe(13);
    expect(header?.mapping.name).toBe(12);
  });

  it('accepts "성명" written without a space', () => {
    const cells = buildNeisGrid({ nameHeader: '성명' });
    expect(detectHeaderRow(cells)?.mapping.name).toBe(8);
  });

  it('rejects rows that lack either a name or a number column', () => {
    expect(scoreHeaderRow([['학년', '학과', '반']], 0)).toBeNull();
    expect(scoreHeaderRow([['번호', '학년']], 0)).toBeNull();
    expect(scoreHeaderRow([['성명', '학년']], 0)).toBeNull();
  });

  it('falls back to 연번 when there is no 번호 column', () => {
    const header = scoreHeaderRow([['연번', '성명']], 0);
    expect(header?.mapping.number).toBe(0);
    expect(header?.mapping.name).toBe(1);
    expect(header?.mapping.seq).toBeUndefined();
  });

  it('does not let 성별 match the 성명 column', () => {
    const header = scoreHeaderRow([['번호', '성명', '성별']], 0);
    expect(header?.mapping.name).toBe(1);
    expect(header?.mapping.gender).toBe(2);
  });

  it('finds two headers when a sheet stacks two classes', () => {
    expect(detectHeaderRows(buildStackedGrid())).toHaveLength(2);
  });
});

describe('row parsing', () => {
  it('reads 25 students and stops before the print footer', () => {
    const cells = buildNeisGrid({ studentCount: 25 });
    const header = detectHeaderRow(cells);
    const block = parseBlock(cells, header!, gridWidth(cells));

    expect(block.students).toHaveLength(25);
    expect(block.students[0]?.number).toBe(1);
    expect(block.students[0]?.name).toBe(fixtureName(0));
    expect(block.students[24]?.number).toBe(25);
    expect(block.students.some((s) => s.name.includes('/'))).toBe(false);
    expect(block.students.some((s) => s.name.endsWith('고등학교'))).toBe(false);
  });

  it('tolerates a blank row in the middle of the table', () => {
    const cells = buildNeisGrid({ studentCount: 25, blankRowInMiddle: true });
    const header = detectHeaderRow(cells);
    const block = parseBlock(cells, header!, gridWidth(cells));
    expect(block.students).toHaveLength(25);
  });

  it('handles numbers stored as floats, strings and a mixture', () => {
    for (const style of ['float', 'string', 'mixed'] as const) {
      const cells = buildNeisGrid({ studentCount: 10, numberStyle: style });
      const header = detectHeaderRow(cells);
      const block = parseBlock(cells, header!, gridWidth(cells));
      expect(block.students.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  it('gives students with the same name different ids', () => {
    const cells = buildNeisGrid({ studentCount: 10, duplicateName: true });
    const header = detectHeaderRow(cells);
    const block = parseBlock(cells, header!, gridWidth(cells));

    const sameName = block.students.filter((s) => s.name === fixtureName(0));
    expect(sameName).toHaveLength(2);
    expect(sameName[0]?.id).not.toBe(sameName[1]?.id);
    expect(new Set(block.students.map((s) => s.id)).size).toBe(block.students.length);
    expect(block.issues.some((i) => i.kind === 'duplicateName')).toBe(true);
  });

  it('reports duplicate attendance numbers without dropping the row', () => {
    const cells = buildNeisGrid({ studentCount: 10, duplicateNumber: true });
    const header = detectHeaderRow(cells);
    const block = parseBlock(cells, header!, gridWidth(cells));

    expect(block.students).toHaveLength(10);
    expect(block.issues.some((i) => i.kind === 'duplicateNumber')).toBe(true);
  });

  it('skips a row whose name cell is empty and says so', () => {
    const cells = buildNeisGrid({ studentCount: 10, emptyName: true });
    const header = detectHeaderRow(cells);
    const block = parseBlock(cells, header!, gridWidth(cells));

    expect(block.students).toHaveLength(9);
    expect(block.issues.some((i) => i.kind === 'emptyName')).toBe(true);
  });

  it('never infers gender from a name', () => {
    const cells = buildNeisGrid({ studentCount: 5 });
    const header = detectHeaderRow(cells);
    const block = parseBlock(cells, header!, gridWidth(cells));
    expect(block.students.every((s) => s.gender === 'unset')).toBe(true);
  });

  it('reads gender only when a column is mapped', () => {
    const cells = buildNeisGrid({ studentCount: 4, withGender: true });
    const header = detectHeaderRow(cells);
    const block = parseBlock(cells, header!, gridWidth(cells));
    expect(block.students.map((s) => s.gender)).toEqual(['male', 'female', 'male', 'female']);
  });
});

describe('roster candidates', () => {
  it('extracts metadata but still imports when it is absent', () => {
    const withMeta = findRosters([asSheet(buildNeisGrid())]);
    expect(withMeta).toHaveLength(1);
    expect(withMeta[0]?.meta.subject).toBe('통합과학1');
    expect(withMeta[0]?.meta.grade).toBe(1);
    expect(withMeta[0]?.meta.classNumber).toBe('1-1');
    expect(withMeta[0]?.meta.teacherName).toBe('교사01');
    expect(withMeta[0]?.meta.schoolName).toBe('가나고등학교');
    expect(withMeta[0]?.meta.createdOn).toBe('2026-08-12');
    expect(withMeta[0]?.meta.periods).toBe('[월 6], [화 1], [수 5]');

    const bare = findRosters([asSheet(buildNeisGrid({ withoutMeta: true }))]);
    expect(bare[0]?.students).toHaveLength(25);
  });

  it('separates two classes stacked in one sheet', () => {
    const rosters = findRosters([asSheet(buildStackedGrid())]);
    expect(rosters.map((r) => r.students.length).sort((a, b) => a - b)).toEqual([4, 6]);
  });

  it('ranks visible sheets above hidden ones', () => {
    const rosters = findRosters([
      asSheet(buildNeisGrid({ studentCount: 3 }), 'hidden', true),
      asSheet(buildNeisGrid({ studentCount: 4 }), 'visible', false),
    ]);
    expect(rosters[0]?.sheetName).toBe('visible');
  });

  it('supports manual mapping when detection is not wanted', () => {
    const grid = asSheet(buildNeisGrid({ studentCount: 5 }));
    const roster = parseWithManualMapping(grid, 0, 8, { number: 7, name: 8, grade: 3 });
    expect(roster.students).toHaveLength(5);
    expect(roster.students[0]?.number).toBe(1);
  });
});

describe('workbook reading', () => {
  it('round-trips a generated .xlsx through SheetJS', () => {
    const buffer = buildNeisWorkbook({ studentCount: 25 });
    const grids = readWorkbookGrids(buffer);
    expect(grids).toHaveLength(1);

    const rosters = findRosters(grids);
    expect(rosters[0]?.students).toHaveLength(25);
    expect(rosters[0]?.students[0]?.name).toBe(fixtureName(0));
  });

  it('raises a friendly error for a file whose .xlsx zip is damaged', () => {
    const good = new Uint8Array(buildNeisWorkbook({ studentCount: 3 }));
    // Keep the ZIP signature but destroy the archive body.
    const broken = good.slice(0, 400);
    broken.fill(0, 40);

    expect(() => readWorkbookGrids(broken.buffer as ArrayBuffer)).toThrow(WorkbookReadError);
    try {
      readWorkbookGrids(broken.buffer as ArrayBuffer);
    } catch (error) {
      expect((error as WorkbookReadError).reason).toBe('corrupt');
      expect((error as Error).message).toContain('손상');
    }
  });

  it('rejects an empty file', () => {
    expect(() => readWorkbookGrids(new ArrayBuffer(0))).toThrow(WorkbookReadError);
  });

  it('offers no roster (so the UI falls back to manual mapping) for unrecognised bytes', () => {
    // SheetJS parses arbitrary bytes as loose text rather than throwing, so the
    // safety net is "no header found" rather than an exception.
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;
    const grids = readWorkbookGrids(junk);
    expect(findRosters(grids)).toHaveLength(0);
  });

  it('reads a UTF-8 CSV with a BOM', () => {
    const csv = '﻿번호,성명\n1,학생01\n2,학생02\n';
    const bytes = new TextEncoder().encode(csv);
    const grid = readCsvGrid(bytes.buffer as ArrayBuffer);
    const rosters = findRosters([grid]);
    expect(rosters[0]?.students.map((s) => s.name)).toEqual(['학생01', '학생02']);
  });
});
