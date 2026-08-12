/**
 * JSON project backup and restore.
 *
 * The file is plain text and unencrypted, which the UI states plainly before
 * the download starts: once it leaves the browser it is the teacher's to look
 * after, exactly like the original spreadsheet.
 */

import type { Constraint } from '../constraints/kinds';
import type {
  ArrangementRecord,
  Classroom,
  Grouping,
  RosterMeta,
  SeatAssignment,
  Student,
} from '../model/types';
import { SCHEMA_VERSION } from '../model/types';
import { redactConstraints, redactGrouping, type ExportOptions } from './redact';

export interface ProjectBackup {
  schemaVersion: number;
  exportedAt: string;
  app: 'seat-planner';
  meta: RosterMeta | null;
  students: unknown[];
  classroom: Classroom;
  constraints: Constraint[];
  assignment: SeatAssignment;
  grouping: Grouping | null;
  history: ArrangementRecord[];
  seed: number;
}

export interface BackupInput {
  meta: RosterMeta | null;
  students: Student[];
  classroom: Classroom;
  constraints: Constraint[];
  assignment: SeatAssignment;
  grouping: Grouping | null;
  history: ArrangementRecord[];
  seed: number;
}

export function buildBackup(input: BackupInput, options: ExportOptions): ProjectBackup {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'seat-planner',
    meta: input.meta,
    students: input.students.map((student) => {
      // Built explicitly rather than by deleting keys, so a new sensitive field
      // added to `Student` later cannot leak by being forgotten here.
      const out: Record<string, unknown> = {
        id: student.id,
        number: student.number,
        name: student.name,
        status: student.status,
        customFields: student.customFields,
      };
      if (student.grade !== undefined) out.grade = student.grade;
      if (student.department !== undefined) out.department = student.department;
      if (student.classNumber !== undefined) out.classNumber = student.classNumber;
      if (student.lastSeatId !== undefined) out.lastSeatId = student.lastSeatId;
      if (options.includeGender) out.gender = student.gender;
      if (options.includeDivision) out.division = student.division;
      if (options.includeTags) out.tags = student.tags;
      if (options.includeTeacherMemo && student.teacherMemo) out.teacherMemo = student.teacherMemo;
      if (options.includeAccessibility && student.accessibilityNeeds) {
        out.accessibilityNeeds = student.accessibilityNeeds;
      }
      if (options.includeExcludeReason && student.excludeNote) out.excludeNote = student.excludeNote;
      return out;
    }),
    classroom: input.classroom,
    constraints: redactConstraints(input.constraints, options),
    assignment: input.assignment,
    grouping: input.grouping ? redactGrouping(input.grouping, options) : null,
    history: [...input.history],
    seed: input.seed,
  };
}

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupParseError';
  }
}

/** Restores a backup, filling in anything the file omitted. */
export function parseBackup(text: string): BackupInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupParseError('JSON 파일을 읽을 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupParseError('이 앱에서 내보낸 백업 파일이 아닙니다.');
  }

  const data = parsed as Partial<ProjectBackup>;
  if (data.app !== 'seat-planner') {
    throw new BackupParseError('이 앱에서 내보낸 백업 파일이 아닙니다.');
  }
  if (typeof data.schemaVersion !== 'number' || data.schemaVersion > SCHEMA_VERSION) {
    throw new BackupParseError(
      '더 새로운 버전에서 만든 파일입니다. 앱을 새로고침한 뒤 다시 시도해 주세요.',
    );
  }
  if (!Array.isArray(data.students) || !data.classroom) {
    throw new BackupParseError('백업 파일에 학생 명단이나 교실 정보가 없습니다.');
  }

  const students: Student[] = data.students.map((raw) => {
    const s = raw as Partial<Student> & { id?: string };
    return {
      id: String(s.id ?? ''),
      number: typeof s.number === 'number' ? s.number : null,
      name: String(s.name ?? ''),
      grade: s.grade,
      department: s.department,
      classNumber: s.classNumber,
      // A backup exported without these restores as 'unset' rather than
      // guessing, which keeps the no-inference rule intact across a round trip.
      gender: s.gender ?? 'unset',
      division: s.division ?? 'unset',
      status: s.status ?? 'active',
      excludeNote: s.excludeNote,
      lastSeatId: s.lastSeatId,
      tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
      teacherMemo: s.teacherMemo,
      accessibilityNeeds: s.accessibilityNeeds,
      customFields: (s.customFields as Record<string, string>) ?? {},
    };
  });

  return {
    meta: data.meta ?? null,
    students,
    classroom: data.classroom,
    constraints: Array.isArray(data.constraints) ? data.constraints : [],
    assignment: data.assignment ?? {},
    grouping: data.grouping ?? null,
    history: Array.isArray(data.history) ? data.history : [],
    seed: typeof data.seed === 'number' ? data.seed : 1,
  };
}
