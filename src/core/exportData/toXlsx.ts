/**
 * Excel export, and re-import of a previously exported file.
 *
 * The `과거배치용데이터` sheet exists so a teacher who keeps results as
 * spreadsheets rather than JSON can still feed last month's arrangement back in
 * to avoid repeats.
 */

import * as XLSX from 'xlsx';

import type {
  ArrangementRecord,
  Classroom,
  Grouping,
  RosterMeta,
  SeatAssignment,
  Student,
} from '../model/types';
import { DIVISION_LABELS, GENDER_LABELS, SCHEMA_VERSION, STATUS_LABELS } from '../model/types';
import { normalizeHeader, parseNumberLike } from '../model/normalize';
import type { Constraint } from '../constraints/kinds';
import { CONSTRAINT_LABELS, SEVERITY_LABELS } from '../constraints/kinds';
import type { ExportOptions } from './redact';

export interface WorkbookInput {
  meta: RosterMeta | null;
  students: readonly Student[];
  classroom: Classroom;
  assignment: SeatAssignment;
  grouping: Grouping | null;
  constraints: readonly Constraint[];
  seed: number;
  /** Screen orientation the teacher was looking at, recorded for clarity. */
  viewpointLabel: string;
}

type Row = Array<string | number | null>;

function sheetOf(rows: Row[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows as unknown[][]);
}

export function buildWorkbook(input: WorkbookInput, options: ExportOptions): XLSX.WorkBook {
  const { students, classroom, assignment, grouping, meta } = input;
  const byId = new Map(students.map((s) => [s.id, s]));
  const seatById = new Map(classroom.seats.map((s) => [s.id, s]));
  const workbook = XLSX.utils.book_new();

  const label = (student: Student | undefined): string => {
    if (!student) return '';
    const parts: string[] = [];
    if (options.includeNumbers && student.number !== null) parts.push(String(student.number));
    if (options.includeNames) parts.push(student.name);
    return parts.join(' ');
  };

  // --- 자리배치 ----------------------------------------------------------
  const seatRows: Row[] = [];
  seatRows.push([`자리 배치도 (${input.viewpointLabel} 기준, 표의 첫 줄이 칠판에 가장 가까운 앞줄)`]);
  seatRows.push([]);
  for (let row = 0; row < classroom.rows; row += 1) {
    const line: Row = [`${row + 1}줄`];
    for (let col = 0; col < classroom.cols; col += 1) {
      const seat = classroom.seats.find((s) => s.row === row && s.col === col);
      if (!seat || seat.kind !== 'seat') {
        line.push(seat?.kind === 'aisle' ? '(통로)' : '');
        continue;
      }
      const studentId = assignment[seat.id];
      line.push(studentId ? label(byId.get(studentId)) : '(빈자리)');
    }
    seatRows.push(line);
  }
  XLSX.utils.book_append_sheet(workbook, sheetOf(seatRows), '자리배치');

  // --- 모둠편성 ----------------------------------------------------------
  const groupHeader: Row = ['모둠', '이름', '인원'];
  if (options.includeNumbers) groupHeader.push('번호');
  groupHeader.push('학생');
  if (options.includeRoles) groupHeader.push('역할');

  const groupRows: Row[] = [groupHeader];
  if (grouping) {
    for (const group of grouping.groups) {
      for (const memberId of group.memberIds) {
        const student = byId.get(memberId);
        const line: Row = [group.index, group.name ?? '', group.memberIds.length];
        if (options.includeNumbers) line.push(student?.number ?? null);
        line.push(options.includeNames ? (student?.name ?? '') : '');
        if (options.includeRoles) line.push(group.roles[memberId] ?? '');
        groupRows.push(line);
      }
    }
  } else {
    groupRows.push(['모둠을 만들지 않았습니다.']);
  }
  XLSX.utils.book_append_sheet(workbook, sheetOf(groupRows), '모둠편성');

  // --- 학생명단 ----------------------------------------------------------
  const rosterHeader: Row = ['번호', '이름', '상태'];
  if (options.includeGender) rosterHeader.push('성별');
  if (options.includeDivision) rosterHeader.push('구분');
  if (options.includeTags) rosterHeader.push('태그');
  if (options.includeExcludeReason) rosterHeader.push('제외 사유');
  if (options.includeTeacherMemo) rosterHeader.push('교사 메모');
  if (options.includeAccessibility) rosterHeader.push('배려 사항');
  rosterHeader.push('좌석');

  const seatOfStudent = new Map<string, string>();
  for (const [seatId, studentId] of Object.entries(assignment)) seatOfStudent.set(studentId, seatId);

  const rosterRows: Row[] = [rosterHeader];
  for (const student of students) {
    const line: Row = [
      options.includeNumbers ? student.number : null,
      options.includeNames ? student.name : '',
      STATUS_LABELS[student.status],
    ];
    if (options.includeGender) line.push(GENDER_LABELS[student.gender]);
    if (options.includeDivision) line.push(DIVISION_LABELS[student.division]);
    if (options.includeTags) line.push(student.tags.join(', '));
    if (options.includeExcludeReason) line.push(student.excludeNote ?? '');
    if (options.includeTeacherMemo) line.push(student.teacherMemo ?? '');
    if (options.includeAccessibility) line.push(student.accessibilityNeeds ?? '');

    const seatId = seatOfStudent.get(student.id);
    const seat = seatId ? seatById.get(seatId) : undefined;
    line.push(seat ? `${seat.row + 1}줄 ${seat.col + 1}번째` : '');
    rosterRows.push(line);
  }
  XLSX.utils.book_append_sheet(workbook, sheetOf(rosterRows), '학생명단');

  // --- 설정 --------------------------------------------------------------
  const settingRows: Row[] = [
    ['항목', '값'],
    ['학교', meta?.schoolName ?? ''],
    ['학년/반', meta?.classNumber ?? ''],
    ['교과', meta?.subject ?? ''],
    ['교실 크기', `${classroom.rows}줄 × ${classroom.cols}칸`],
    ['보기 기준', input.viewpointLabel],
    ['랜덤 시드', input.seed],
    ['만든 날짜', new Date().toISOString().slice(0, 10)],
    ['스키마 버전', SCHEMA_VERSION],
  ];
  if (options.includeConstraints) {
    settingRows.push([], ['조건 종류', '강도', '대상 수']);
    for (const constraint of input.constraints) {
      const targets =
        'studentIds' in constraint
          ? constraint.studentIds.length
          : 'studentId' in constraint
            ? 1
            : 0;
      settingRows.push([
        CONSTRAINT_LABELS[constraint.kind],
        SEVERITY_LABELS[constraint.severity],
        targets,
      ]);
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheetOf(settingRows), '설정');

  // --- 과거배치용데이터 --------------------------------------------------
  // Machine-readable, so this file can be loaded back as history later.
  const historyRows: Row[] = [['번호', '이름', '좌석행', '좌석열', '모둠']];
  for (const student of students) {
    const seatId = seatOfStudent.get(student.id);
    const seat = seatId ? seatById.get(seatId) : undefined;
    const groupIndex = grouping?.groups.find((g) => g.memberIds.includes(student.id))?.index ?? null;
    historyRows.push([
      student.number,
      student.name,
      seat ? seat.row : null,
      seat ? seat.col : null,
      groupIndex,
    ]);
  }
  XLSX.utils.book_append_sheet(workbook, sheetOf(historyRows), '과거배치용데이터');

  return workbook;
}

export function workbookToBytes(workbook: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

/**
 * Reads back a `과거배치용데이터` sheet as an arrangement record.
 *
 * Students are matched by attendance number, not by name, because two students
 * can share a name. Rows whose number is missing are skipped rather than
 * guessed at.
 */
export function readHistorySheet(
  buffer: ArrayBuffer,
  students: readonly Student[],
  date: string,
): ArrangementRecord | null {
  const workbook = XLSX.read(buffer, { type: 'array', cellFormula: false, cellStyles: false });
  const sheet = workbook.Sheets['과거배치용데이터'];
  if (!sheet) return null;

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const headerRow = rows.findIndex(
    (row) => Array.isArray(row) && row.some((cell) => normalizeHeader(cell) === '번호'),
  );
  if (headerRow < 0) return null;

  const byNumber = new Map<number, string>();
  for (const student of students) {
    if (student.number !== null && !byNumber.has(student.number)) {
      byNumber.set(student.number, student.id);
    }
  }

  const seatAssignment: SeatAssignment = {};
  const groupOf: Record<string, number> = {};

  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const number = parseNumberLike(row[0]);
    if (number === null) continue;
    const studentId = byNumber.get(number);
    if (!studentId) continue;

    const seatRow = parseNumberLike(row[2]);
    const seatCol = parseNumberLike(row[3]);
    if (seatRow !== null && seatCol !== null) {
      seatAssignment[`r${seatRow}c${seatCol}`] = studentId;
    }
    const groupIndex = parseNumberLike(row[4]);
    if (groupIndex !== null) groupOf[studentId] = groupIndex;
  }

  if (Object.keys(seatAssignment).length === 0 && Object.keys(groupOf).length === 0) return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    id: `xlsx-${date}`,
    date,
    students: students.map((s) => ({ id: s.id, number: s.number })),
    seatAssignment,
    partners: {},
    groupOf,
    neighbors: {},
    seed: 0,
  };
}
