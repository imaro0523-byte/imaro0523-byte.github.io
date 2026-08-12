/**
 * Static conflict detection, run *before* any search starts.
 *
 * Two hard rules that contradict each other have no solution, and a search that
 * keeps looking for one will spin until the time budget runs out and then say
 * nothing useful. Catching the contradiction up front lets the app explain what
 * is wrong and offer a specific way to relax it.
 */

import { usableSeatCount } from '../layout/grid';
import type { Classroom, Student } from '../model/types';
import { isPlaceable } from '../model/types';
import { activeConstraints, type Constraint } from './kinds';

export type DiagnosisCode =
  | 'noStudents'
  | 'notEnoughSeats'
  | 'fixedSeatClash'
  | 'fixedSeatUnusable'
  | 'fixedSeatOnExcluded'
  | 'togetherSeparateClash'
  | 'fixedGroupOverflow'
  | 'fixedGroupOutOfRange'
  | 'spreadTagShortage'
  | 'genderUnknown'
  | 'tooManySeparations'
  | 'examSpacingImpossible';

export interface Diagnosis {
  code: DiagnosisCode;
  /** `blocking` means no valid arrangement exists until it is resolved. */
  level: 'blocking' | 'warning';
  message: string;
  /** A concrete way out, phrased as an instruction. */
  suggestion: string;
  studentIds?: string[];
  constraintIds?: string[];
}

export interface DiagnoseSeatingInput {
  classroom: Classroom;
  students: readonly Student[];
  constraints: readonly Constraint[];
}

export function diagnoseSeating(input: DiagnoseSeatingInput): Diagnosis[] {
  const { classroom, students, constraints } = input;
  const out: Diagnosis[] = [];
  const active = activeConstraints(constraints);
  const placeable = students.filter(isPlaceable);
  const byId = new Map(students.map((s) => [s.id, s]));

  if (placeable.length === 0) {
    out.push({
      code: 'noStudents',
      level: 'blocking',
      message: '배치할 학생이 없습니다.',
      suggestion: '명단에서 학생을 추가하거나, 제외한 학생을 «배치 대상»으로 되돌려 주세요.',
    });
    return out;
  }

  const seats = usableSeatCount(classroom);
  if (seats < placeable.length) {
    out.push({
      code: 'notEnoughSeats',
      level: 'blocking',
      message: `학생 ${placeable.length}명에 좌석이 ${seats}석뿐입니다. ${placeable.length - seats}석이 모자랍니다.`,
      suggestion: '교실 설정에서 줄이나 칸을 늘리거나, 사용 안 함으로 꺼 둔 좌석을 켜 주세요.',
    });
  }

  // --- fixed seats -------------------------------------------------------
  const fixed = active.filter((c) => c.kind === 'fixedSeat');
  const seatClaims = new Map<string, string[]>();
  for (const constraint of fixed) {
    if (constraint.kind !== 'fixedSeat') continue;
    const list = seatClaims.get(constraint.seatId) ?? [];
    list.push(constraint.studentId);
    seatClaims.set(constraint.seatId, list);

    const seat = classroom.seats.find((s) => s.id === constraint.seatId);
    if (!seat || seat.kind !== 'seat') {
      out.push({
        code: 'fixedSeatUnusable',
        level: 'blocking',
        message: '고정하려는 좌석이 지금 교실 구조에 없거나 사용하지 않는 자리입니다.',
        suggestion: '해당 좌석을 다시 사용으로 바꾸거나, 고정 조건을 삭제해 주세요.',
        studentIds: [constraint.studentId],
        constraintIds: [constraint.id],
      });
    }

    const student = byId.get(constraint.studentId);
    if (student && !isPlaceable(student)) {
      out.push({
        code: 'fixedSeatOnExcluded',
        level: 'warning',
        message: '배치에서 제외한 학생에게 고정석이 남아 있습니다.',
        suggestion: '이 조건은 무시됩니다. 학생을 다시 배치 대상으로 바꾸거나 조건을 지워 주세요.',
        studentIds: [constraint.studentId],
        constraintIds: [constraint.id],
      });
    }
  }
  for (const [, claimants] of seatClaims) {
    const distinct = [...new Set(claimants)];
    if (distinct.length > 1) {
      out.push({
        code: 'fixedSeatClash',
        level: 'blocking',
        message: `학생 ${distinct.length}명이 같은 좌석을 고정석으로 지정했습니다.`,
        suggestion: '한 명만 남기고 나머지 고정 조건을 지우거나 다른 좌석으로 옮겨 주세요.',
        studentIds: distinct,
      });
    }
  }

  // --- contradictory pairs ----------------------------------------------
  const togetherPairs = new Set<string>();
  for (const constraint of active) {
    if (constraint.kind !== 'together') continue;
    for (const [a, b] of allPairs(constraint.studentIds)) togetherPairs.add(key(a, b));
  }
  for (const constraint of active) {
    if (constraint.kind !== 'separate') continue;
    for (const [a, b] of allPairs(constraint.studentIds)) {
      if (togetherPairs.has(key(a, b))) {
        out.push({
          code: 'togetherSeparateClash',
          level: constraint.severity === 'hard' ? 'blocking' : 'warning',
          message: '같은 두 학생에게 «가까이»와 «떨어뜨리기»가 동시에 걸려 있습니다.',
          suggestion: '둘 중 하나를 지우거나, 한쪽의 강도를 «되도록 지킴»으로 낮춰 주세요.',
          studentIds: [a, b],
          constraintIds: [constraint.id],
        });
      }
    }
  }

  // --- gender ------------------------------------------------------------
  const wantsGender = active.some((c) => c.kind === 'genderMix');
  if (wantsGender) {
    const unknown = placeable.filter((s) => s.gender !== 'male' && s.gender !== 'female');
    if (unknown.length > 0) {
      out.push({
        code: 'genderUnknown',
        level: 'warning',
        message: `성별이 입력되지 않은 학생이 ${unknown.length}명이라 남녀 균형을 정확히 맞출 수 없습니다.`,
        suggestion:
          unknown.length === placeable.length
            ? '이 조건은 사실상 아무 효과가 없습니다. 명단에서 성별을 입력하거나 조건을 꺼 주세요.'
            : '성별이 입력된 학생끼리만 균형을 맞춥니다. 필요하면 명단에서 성별을 채워 주세요.',
      });
    }
  }

  // --- separation load ---------------------------------------------------
  const separationDegree = new Map<string, number>();
  for (const constraint of active) {
    if (constraint.kind !== 'separate' || constraint.severity !== 'hard') continue;
    if (constraint.scope === 'sameGroup') continue;
    for (const [a, b] of allPairs(constraint.studentIds)) {
      separationDegree.set(a, (separationDegree.get(a) ?? 0) + 1);
      separationDegree.set(b, (separationDegree.get(b) ?? 0) + 1);
    }
  }
  // A seat has at most four orthogonal neighbours, so a student who must be
  // kept away from more people than there are non-neighbouring seats cannot be
  // placed. This is a lower bound, not a proof, so it is a warning.
  for (const [studentId, degree] of separationDegree) {
    if (degree > Math.max(0, placeable.length - 5)) {
      out.push({
        code: 'tooManySeparations',
        level: 'warning',
        message: '한 학생에게 «반드시 떨어뜨리기» 조건이 너무 많이 걸려 현재 교실에서는 어려울 수 있습니다.',
        suggestion: '일부 조건의 강도를 «가능하면 꼭 지킴»으로 낮추거나 교실을 넓혀 주세요.',
        studentIds: [studentId],
      });
    }
  }

  // --- exam spacing ------------------------------------------------------
  for (const constraint of active) {
    if (constraint.kind !== 'examSpacing') continue;
    const spacing = Math.max(1, constraint.minDistance);
    // With a spacing of d, only every d-th row and column can be occupied.
    const capacity =
      Math.ceil(classroom.rows / spacing) * Math.ceil(classroom.cols / spacing);
    if (capacity < placeable.length) {
      out.push({
        code: 'examSpacingImpossible',
        level: constraint.severity === 'hard' ? 'blocking' : 'warning',
        message: `${spacing}칸 간격으로는 최대 ${capacity}명까지만 앉힐 수 있는데 학생은 ${placeable.length}명입니다.`,
        suggestion: '간격을 줄이거나 교실 크기를 키워 주세요.',
        constraintIds: [constraint.id],
      });
    }
  }

  return out;
}

export interface DiagnoseGroupingInput {
  students: readonly Student[];
  groupCount: number;
  groupSizes: readonly number[];
  constraints: readonly Constraint[];
}

export function diagnoseGrouping(input: DiagnoseGroupingInput): Diagnosis[] {
  const { students, groupCount, groupSizes, constraints } = input;
  const out: Diagnosis[] = [];
  const active = activeConstraints(constraints);
  const placeable = students.filter(isPlaceable);
  const byId = new Map(students.map((s) => [s.id, s]));

  if (placeable.length === 0) {
    out.push({
      code: 'noStudents',
      level: 'blocking',
      message: '모둠을 만들 학생이 없습니다.',
      suggestion: '명단에서 제외한 학생을 «배치 대상»으로 되돌려 주세요.',
    });
    return out;
  }

  // --- fixed groups ------------------------------------------------------
  const demandPerGroup = new Map<number, string[]>();
  for (const constraint of active) {
    if (constraint.kind !== 'fixedGroup') continue;
    const student = byId.get(constraint.studentId);
    if (student && !isPlaceable(student)) continue;

    if (constraint.groupIndex < 1 || constraint.groupIndex > groupCount) {
      out.push({
        code: 'fixedGroupOutOfRange',
        level: 'blocking',
        message: `${constraint.groupIndex}모둠으로 고정했지만 지금은 모둠이 ${groupCount}개뿐입니다.`,
        suggestion: '모둠 수를 늘리거나 고정 모둠 번호를 바꿔 주세요.',
        studentIds: [constraint.studentId],
        constraintIds: [constraint.id],
      });
      continue;
    }
    const list = demandPerGroup.get(constraint.groupIndex) ?? [];
    list.push(constraint.studentId);
    demandPerGroup.set(constraint.groupIndex, list);
  }
  for (const [groupIndex, members] of demandPerGroup) {
    const capacity = groupSizes[groupIndex - 1] ?? 0;
    if (members.length > capacity) {
      out.push({
        code: 'fixedGroupOverflow',
        level: 'blocking',
        message: `${groupIndex}모둠 정원은 ${capacity}명인데 ${members.length}명이 고정되어 있습니다.`,
        suggestion: '고정을 일부 풀거나, 모둠별 정원을 직접 지정해 이 모둠을 늘려 주세요.',
        studentIds: members,
      });
    }
  }

  // --- one-per-group tags ------------------------------------------------
  for (const constraint of active) {
    if (constraint.kind !== 'spreadTag') continue;
    const holders = placeable.filter((s) => s.tags.includes(constraint.tag));
    if (holders.length < groupCount) {
      out.push({
        code: 'spreadTagShortage',
        level: 'warning',
        message: `«${constraint.tag}» 학생이 ${holders.length}명인데 모둠은 ${groupCount}개라 모든 모둠에 한 명씩 넣을 수 없습니다.`,
        suggestion: `모둠을 ${holders.length}개 이하로 줄이거나, 명단에서 «${constraint.tag}» 태그를 더 지정해 주세요.`,
        constraintIds: [constraint.id],
      });
    }
  }

  // --- contradictory pairs ----------------------------------------------
  const togetherPairs = new Set<string>();
  for (const constraint of active) {
    if (constraint.kind !== 'together' || constraint.scope !== 'sameGroup') continue;
    for (const [a, b] of allPairs(constraint.studentIds)) togetherPairs.add(key(a, b));
  }
  for (const constraint of active) {
    if (constraint.kind !== 'separate' || constraint.scope !== 'sameGroup') continue;
    for (const [a, b] of allPairs(constraint.studentIds)) {
      if (togetherPairs.has(key(a, b))) {
        out.push({
          code: 'togetherSeparateClash',
          level: constraint.severity === 'hard' ? 'blocking' : 'warning',
          message: '같은 두 학생에게 «같은 모둠»과 «다른 모둠»이 동시에 걸려 있습니다.',
          suggestion: '둘 중 하나를 지워 주세요.',
          studentIds: [a, b],
          constraintIds: [constraint.id],
        });
      }
    }
  }

  const wantsGender = active.some((c) => c.kind === 'genderMix');
  if (wantsGender) {
    const unknown = placeable.filter((s) => s.gender !== 'male' && s.gender !== 'female');
    if (unknown.length > 0) {
      out.push({
        code: 'genderUnknown',
        level: 'warning',
        message: `성별이 입력되지 않은 학생이 ${unknown.length}명이라 남녀 균형이 정확하지 않을 수 있습니다.`,
        suggestion: '명단에서 성별을 채우거나 이 조건을 꺼 주세요.',
      });
    }
  }

  return out;
}

export function hasBlocking(diagnoses: readonly Diagnosis[]): boolean {
  return diagnoses.some((d) => d.level === 'blocking');
}

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function allPairs(ids: readonly string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) out.push([ids[i] as string, ids[j] as string]);
  }
  return out;
}
