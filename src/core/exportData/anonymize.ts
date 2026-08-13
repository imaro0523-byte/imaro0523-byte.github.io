/**
 * A copy of the roster with every real name replaced.
 *
 * Screenshots are the most useful thing a teacher can attach to a bug report,
 * and a screenshot of this app is a photograph of a class list. Asking people
 * to blur names by hand means either a lot of work or, more likely, a roster
 * arriving in an inbox.
 *
 * So the app produces the safe version itself: the same layout, the same
 * groups, the same problem visible — with 학생01, 학생02 in place of the
 * names, and every teacher-only field emptied.
 */

import type { Grouping, Student } from '../model/types';
import { inRosterOrder } from '../roster/divisionSplit';

/** `학생01`, `학생02`, … following roster order so the numbering reads naturally. */
export function anonymizeStudents(students: readonly Student[]): Student[] {
  const order = inRosterOrder(students);
  const aliasOf = new Map<string, string>();
  order.forEach((student, index) => {
    aliasOf.set(student.id, `학생${String(index + 1).padStart(2, '0')}`);
  });

  return students.map((student) => ({
    ...student,
    name: aliasOf.get(student.id) ?? '학생',
    // Free text is where a real name is most likely to be hiding.
    teacherMemo: undefined,
    accessibilityNeeds: undefined,
    excludeNote: undefined,
    tags: student.tags.map((_, index) => `태그${index + 1}`),
    customFields: {},
  }));
}

/** Group names and roles can carry names too, so they go as well. */
export function anonymizeGrouping(grouping: Grouping | null): Grouping | null {
  if (!grouping) return null;
  return {
    excludedIds: [...grouping.excludedIds],
    groups: grouping.groups.map((group) => ({
      ...group,
      name: undefined,
      roles: {},
    })),
  };
}

export interface DiagnosticInfo {
  appVersion: string;
  screen: string;
  studentCount: number;
  excludedCount: number;
  classroom: string;
  seatCount: number;
  groups: string;
  constraints: number;
  seed: number;
  viewpoint: string;
}

/**
 * The numbers a maintainer needs to reproduce a problem — sizes, counts, the
 * seed — and nothing that identifies anybody.
 *
 * Deliberately built field by field rather than by stripping an object, so a
 * future addition cannot arrive here by accident.
 */
export function describeForFeedback(info: DiagnosticInfo): string {
  return [
    `앱 버전: ${info.appVersion}`,
    `화면: ${info.screen}`,
    `학생 수: ${info.studentCount}명 (배치 제외 ${info.excludedCount}명)`,
    `교실: ${info.classroom} · 좌석 ${info.seatCount}석`,
    `모둠: ${info.groups}`,
    `조건 수: ${info.constraints}개`,
    `랜덤 시드: ${info.seed}`,
    `보기 기준: ${info.viewpoint}`,
  ].join('\n');
}
