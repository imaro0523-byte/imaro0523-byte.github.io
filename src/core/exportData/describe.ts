/**
 * Saying what an arrangement actually is, in one line.
 *
 * A save used to be titled with the class number and nothing else, so a
 * teacher who saved three times ended up with «1-1», «1-1» and «1-1». That is
 * useless in exactly the situation the list exists for: a 담임 saving ordinary
 * seating and an exam layout, or a 교과 교사 saving one group arrangement per
 * class, both looking for the one from last Tuesday.
 *
 * Nothing here is guessed from geometry. The kind comes from what the app
 * produced — seats, groups, or both — and the room's name is the one its
 * builder gave it. A description that inferred «this looks like an exam
 * layout» from the spacing would be wrong the first time somebody widened
 * their aisles.
 */

import { hasGroupIslands } from '../layout/groupIslands';
import { isPlaceable } from '../model/types';
import type { Classroom, Grouping, SeatAssignment, Student } from '../model/types';

export type ArrangementKind = '모둠 + 자리 배치' | '모둠 편성만' | '자리 배치' | '배치 없음';

export interface ArrangementSummary {
  kind: ArrangementKind;
  /** One line a teacher can scan: counts, group sizes, room shape. */
  detail: string;
}

export interface DescribeInput {
  classroom: Classroom;
  grouping: Grouping | null;
  assignment: SeatAssignment;
  students: readonly Student[];
}

export function describeArrangement(input: DescribeInput): ArrangementSummary {
  const groups = input.grouping?.groups ?? [];
  const seated = Object.keys(input.assignment).length;
  const placeable = input.students.filter(isPlaceable).length;

  const kind: ArrangementKind =
    groups.length > 0 && seated > 0
      ? '모둠 + 자리 배치'
      : groups.length > 0
        ? '모둠 편성만'
        : seated > 0
          ? '자리 배치'
          : '배치 없음';

  const parts: string[] = [`${placeable}명`];

  if (groups.length > 0) {
    const sizes = groups.map((group) => group.memberIds.length);
    parts.push(`${groups.length}모둠 (${sizes.join(', ')}명)`);
  }

  // The room names itself. `createClassroom` calls a plain grid «교실», which
  // says nothing worth repeating, so only the shaped rooms are mentioned.
  if (input.classroom.name && input.classroom.name !== '교실') {
    parts.push(input.classroom.name);
  } else if (hasGroupIslands(input.classroom)) {
    parts.push('모둠 교실');
  }

  return { kind, detail: parts.join(' · ') };
}

/**
 * The class a save belongs to, for grouping the list.
 *
 * Falls back rather than inventing: a roster imported from a file that had no
 * title block genuinely has no class number, and «반 미지정» is the honest
 * label for it.
 */
export function classLabelOf(classNumber: string | undefined, grade: number | undefined): string {
  if (classNumber !== undefined && classNumber !== '') return classNumber;
  if (grade !== undefined) return `${grade}학년`;
  return '반 미지정';
}
