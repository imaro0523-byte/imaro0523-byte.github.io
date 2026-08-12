/**
 * Command-line check that the importer understands a particular roster file.
 *
 *   npm run inspect -- "C:/path/to/1-1반 명렬표.xlsx"
 *
 * Prints structure only. Student names are replaced with `<이름N자>` so the
 * output can be pasted into a bug report without leaking personal data.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { findRosters } from '../src/core/excel/importRoster';
import { detectHeaderRows } from '../src/core/excel/detectHeader';
import { readCsvGrid, readWorkbookGrids } from '../src/core/excel/readWorkbook';
import type { SheetGrid } from '../src/core/excel/grid';

const target = process.argv[2];
if (!target) {
  console.error('사용법: npm run inspect -- "<파일 경로>"');
  process.exit(1);
}

const bytes = readFileSync(target);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

let grids: SheetGrid[];
try {
  grids = target.toLowerCase().endsWith('.csv')
    ? [readCsvGrid(buffer as ArrayBuffer, basename(target))]
    : readWorkbookGrids(buffer as ArrayBuffer);
} catch (error) {
  console.error('읽기 실패:', error instanceof Error ? error.message : error);
  process.exit(2);
}

console.log(`파일: ${basename(target)}`);
console.log(`시트 수: ${grids.length}`);
for (const grid of grids) {
  console.log(
    `  · ${grid.name}${grid.hidden ? ' (숨김)' : ''} — ${grid.cells.length}행, ` +
      `헤더 후보 ${detectHeaderRows(grid.cells).length}개`,
  );
}

const rosters = findRosters(grids);
console.log(`\n인식된 명렬표: ${rosters.length}개`);

for (const roster of rosters) {
  console.log(`\n[${roster.label}]`);
  console.log(`  헤더 행: ${roster.header.rowIndex + 1}행 (점수 ${roster.header.score})`);
  console.log(`  열 매핑: ${JSON.stringify(roster.header.mapping)}`);
  console.log(`  메타: ${JSON.stringify(roster.meta)}`);
  console.log(`  학생 수: ${roster.students.length}`);
  console.log(`  번호: ${roster.students.map((s) => s.number ?? '?').join(', ')}`);
  // Names are deliberately reduced to a length, never printed.
  const lengths = roster.students.map((s) => s.name.replace(/\s/g, '').length);
  console.log(`  이름 글자 수 분포: ${JSON.stringify(tally(lengths))}`);
  console.log(`  성별 미지정: ${roster.students.filter((s) => s.gender === 'unset').length}명`);
  if (roster.issues.length > 0) {
    console.log(`  경고 ${roster.issues.length}건:`);
    for (const issue of roster.issues) console.log(`    - [${issue.kind}] ${issue.message}`);
  } else {
    console.log('  경고 없음');
  }
}

function tally(values: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) {
    const key = `${value}자`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
