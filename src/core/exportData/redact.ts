/**
 * Removes teacher-only information from anything that leaves the app.
 *
 * This is a separate pure function rather than a set of `if` statements inside
 * each exporter, so that "the student-facing PDF must not contain the teacher's
 * memo" is one testable rule instead of a promise repeated in four places.
 *
 * The default for every flag is `false`: an export carries the minimum unless
 * the teacher deliberately asks for more.
 */

import type { Constraint } from '../constraints/kinds';
import type { Grouping, Student } from '../model/types';

export interface ExportOptions {
  /** Teacher's private notes about a student. */
  includeTeacherMemo: boolean;
  /** Accessibility / support needs. */
  includeAccessibility: boolean;
  includeGender: boolean;
  /** The neutral 구분1/구분2 split. Treated as sensitive as gender. */
  includeDivision: boolean;
  includeTags: boolean;
  /** The rule set, which can reveal conflicts between named students. */
  includeConstraints: boolean;
  /** Why a student is excluded (전출·자퇴 등). */
  includeExcludeReason: boolean;
  /** Group roles such as 발표·기록. */
  includeRoles: boolean;
  includeNames: boolean;
  includeNumbers: boolean;
}

/** What a printout handed to students may contain. */
export const STUDENT_FACING: ExportOptions = {
  includeTeacherMemo: false,
  includeAccessibility: false,
  includeGender: false,
  includeDivision: false,
  includeTags: false,
  includeConstraints: false,
  includeExcludeReason: false,
  includeRoles: false,
  includeNames: true,
  includeNumbers: true,
};

/** What the teacher's own copy may contain, once they opt in. */
export const TEACHER_FACING: ExportOptions = {
  includeTeacherMemo: true,
  includeAccessibility: true,
  includeGender: true,
  includeDivision: true,
  includeTags: true,
  includeConstraints: true,
  includeExcludeReason: true,
  includeRoles: true,
  includeNames: true,
  includeNumbers: true,
};

/** A student stripped down to what the chosen options permit. */
export interface RedactedStudent {
  id: string;
  number: number | null;
  name: string;
  status: string;
  gender?: string;
  division?: string;
  tags?: string[];
  teacherMemo?: string;
  accessibilityNeeds?: string;
  excludeNote?: string;
}

export function redactStudent(student: Student, options: ExportOptions): RedactedStudent {
  const out: RedactedStudent = {
    id: student.id,
    number: options.includeNumbers ? student.number : null,
    name: options.includeNames ? student.name : '',
    status: student.status,
  };
  if (options.includeGender) out.gender = student.gender;
  if (options.includeDivision) out.division = student.division;
  if (options.includeTags) out.tags = [...student.tags];
  if (options.includeTeacherMemo && student.teacherMemo) out.teacherMemo = student.teacherMemo;
  if (options.includeAccessibility && student.accessibilityNeeds) {
    out.accessibilityNeeds = student.accessibilityNeeds;
  }
  if (options.includeExcludeReason && student.excludeNote) out.excludeNote = student.excludeNote;
  return out;
}

export function redactStudents(
  students: readonly Student[],
  options: ExportOptions,
): RedactedStudent[] {
  return students.map((student) => redactStudent(student, options));
}

export function redactGrouping(grouping: Grouping, options: ExportOptions): Grouping {
  return {
    excludedIds: [...grouping.excludedIds],
    groups: grouping.groups.map((group) => ({
      ...group,
      memberIds: [...group.memberIds],
      roles: options.includeRoles ? { ...group.roles } : {},
    })),
  };
}

export function redactConstraints(
  constraints: readonly Constraint[],
  options: ExportOptions,
): Constraint[] {
  if (!options.includeConstraints) return [];
  // Even in the teacher's copy the free-text note is dropped, because it is
  // where sensitive wording about a student's circumstances tends to end up.
  return constraints.map(({ note: _note, ...rest }) => rest as Constraint);
}

/**
 * Last line of defence: asserts that a serialised export really does not carry
 * teacher-only fields. Used by the export path and by the test suite.
 */
export function findLeakedFields(payload: unknown, options: ExportOptions): string[] {
  const forbidden: string[] = [];
  if (!options.includeTeacherMemo) forbidden.push('teacherMemo');
  if (!options.includeAccessibility) forbidden.push('accessibilityNeeds');
  if (!options.includeGender) forbidden.push('gender');
  if (!options.includeDivision) forbidden.push('division');
  if (!options.includeTags) forbidden.push('tags');
  if (!options.includeExcludeReason) forbidden.push('excludeNote');

  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.includes(key)) found.add(key);
      walk(child);
    }
  };
  walk(payload);
  return [...found];
}
