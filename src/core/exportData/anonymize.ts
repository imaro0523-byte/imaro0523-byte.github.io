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

/**
 * The whole of a report, as one block of text.
 *
 * Diagnostics alone tell you the room was 5×8 and the seed was 41250. They do
 * not tell you what the teacher was trying to do, which is the only part a
 * machine cannot reconstruct. So the three sentences come first and the
 * automatic part follows, in one block with a header — a teacher pastes it
 * somewhere, it arrives whole, and whoever reads it can see at a glance
 * whether it is complete.
 *
 * Student names never enter this. Everything here is either typed by the
 * teacher or derived from counts and settings, and a test pins that down.
 */
export const FEEDBACK_REPORT_HEADER = '=== 자리배치 도우미 · 의견 (형식 v1) ===';
export const FEEDBACK_REPORT_FOOTER = '=== 여기까지 ===';

export interface FeedbackReportInput {
  /** What the teacher was trying to do. */
  situation: string;
  /** What actually happened. */
  problem: string;
  /** What they expected instead, or what they wish existed. */
  expected: string;
  /** Output of `describeForFeedback`. */
  diagnostics: string;
  /** Browser and screen, for bugs that only appear somewhere specific. */
  environment: string;
}

function orBlank(value: string): string {
  const trimmed = value.trim();
  return trimmed === '' ? '(적지 않음)' : trimmed;
}

export function buildFeedbackReport(input: FeedbackReportInput): string {
  return [
    FEEDBACK_REPORT_HEADER,
    '',
    '[1] 무엇을 하려고 했나',
    orBlank(input.situation),
    '',
    '[2] 무엇이 일어났나',
    orBlank(input.problem),
    '',
    '[3] 어떻게 되기를 바랐나',
    orBlank(input.expected),
    '',
    '--- 아래는 앱이 자동으로 채웁니다. 학생 이름은 들어 있지 않습니다. ---',
    input.diagnostics,
    input.environment,
    FEEDBACK_REPORT_FOOTER,
  ].join('\n');
}
