/**
 * Scores a candidate arrangement against the teacher's rules.
 *
 * The evaluator is a pure function of (assignment, constraints, context).
 * It reports *why* a candidate is good or bad rather than just a number,
 * because a teacher needs to be able to look at a result and see which of
 * their rules it broke.
 */

import { buildAdjacency, seatDistance, type SeatNeighbours } from '../layout/adjacency';
import { pairKey, type HistoryIndex } from '../history';
import { emptyHistoryIndex } from '../history';
import type { Classroom, Grouping, Seat, SeatAssignment, Student } from '../model/types';
import {
  activeConstraints,
  SEVERITY_WEIGHT,
  type Constraint,
  type ProximityScope,
  type Severity,
} from './kinds';

export interface Violation {
  constraintId: string;
  kind: Constraint['kind'];
  severity: Severity;
  /** Sentence a teacher can act on. Never contains a student name — the UI
   * resolves ids to names only when rendering for the teacher. */
  message: string;
  studentIds: string[];
  penalty: number;
}

export interface Evaluation {
  /** Lower is better. Hard violations dominate by construction. */
  penalty: number;
  hardViolations: Violation[];
  softViolations: Violation[];
  /** constraintId → penalty contributed, for the score breakdown UI. */
  byConstraint: Record<string, number>;
  satisfiedConstraintIds: string[];
}

export interface EvaluationContext {
  classroom: Classroom;
  studentsById: Map<string, Student>;
  adjacency: Map<string, SeatNeighbours>;
  seatsById: Map<string, Seat>;
  history: HistoryIndex;
  /** studentId → 1-based group number, when a grouping is in play. */
  groupOf?: Map<string, number>;
}

export function buildContext(
  classroom: Classroom,
  students: readonly Student[],
  history: HistoryIndex = emptyHistoryIndex(),
  grouping?: Grouping,
): EvaluationContext {
  const seatsById = new Map<string, Seat>();
  for (const seat of classroom.seats) seatsById.set(seat.id, seat);

  const groupOf = new Map<string, number>();
  if (grouping) {
    for (const group of grouping.groups) {
      for (const memberId of group.memberIds) groupOf.set(memberId, group.index);
    }
  }

  return {
    classroom,
    studentsById: new Map(students.map((s) => [s.id, s])),
    adjacency: buildAdjacency(classroom),
    seatsById,
    history,
    groupOf: grouping ? groupOf : undefined,
  };
}

// ---------------------------------------------------------------------------
// Proximity helpers
// ---------------------------------------------------------------------------

/** studentId → seatId, the inverse of a seat assignment. */
export function invertAssignment(assignment: SeatAssignment): Map<string, string> {
  const out = new Map<string, string>();
  for (const [seatId, studentId] of Object.entries(assignment)) out.set(studentId, seatId);
  return out;
}

function areClose(
  a: string,
  b: string,
  scope: ProximityScope,
  seatOf: Map<string, string>,
  ctx: EvaluationContext,
  minDistance = 2,
): boolean {
  if (scope === 'sameGroup') {
    const ga = ctx.groupOf?.get(a);
    const gb = ctx.groupOf?.get(b);
    return ga !== undefined && ga === gb;
  }

  const seatA = seatOf.get(a);
  const seatB = seatOf.get(b);
  if (!seatA || !seatB) return false;

  const neighbours = ctx.adjacency.get(seatA);
  if (!neighbours) return false;

  switch (scope) {
    case 'adjacent':
      return neighbours.orthogonal.includes(seatB);
    case 'anyAdjacent':
      return neighbours.orthogonal.includes(seatB) || neighbours.diagonal.includes(seatB);
    case 'sameDesk':
      return neighbours.desk.includes(seatB);
    case 'distance': {
      const sa = ctx.seatsById.get(seatA);
      const sb = ctx.seatsById.get(seatB);
      if (!sa || !sb) return false;
      return seatDistance(sa, sb) < minDistance;
    }
    default:
      return false;
  }
}

/** All unordered pairs from a list. */
function pairsOf(ids: readonly string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      out.push([ids[i] as string, ids[j] as string]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seating evaluation
// ---------------------------------------------------------------------------

export function evaluateSeating(
  assignment: SeatAssignment,
  constraints: readonly Constraint[],
  ctx: EvaluationContext,
): Evaluation {
  const seatOf = invertAssignment(assignment);
  const hardViolations: Violation[] = [];
  const softViolations: Violation[] = [];
  const byConstraint: Record<string, number> = {};
  const satisfied: string[] = [];
  let penalty = 0;

  const record = (violation: Violation) => {
    penalty += violation.penalty;
    byConstraint[violation.constraintId] =
      (byConstraint[violation.constraintId] ?? 0) + violation.penalty;
    if (violation.severity === 'hard') hardViolations.push(violation);
    else softViolations.push(violation);
  };

  for (const constraint of activeConstraints(constraints)) {
    const before = penalty;
    const weight = SEVERITY_WEIGHT[constraint.severity];

    switch (constraint.kind) {
      case 'fixedSeat': {
        const actual = seatOf.get(constraint.studentId);
        // A student excluded from the arrangement simply has no seat; that is
        // not a violation, it is the teacher removing them on purpose.
        if (actual !== undefined && actual !== constraint.seatId) {
          record({
            constraintId: constraint.id,
            kind: constraint.kind,
            severity: constraint.severity,
            message: '지정한 좌석에 앉히지 못했습니다.',
            studentIds: [constraint.studentId],
            penalty: weight,
          });
        }
        break;
      }

      case 'separate': {
        for (const [a, b] of pairsOf(constraint.studentIds)) {
          if (areClose(a, b, constraint.scope, seatOf, ctx, constraint.minDistance ?? 2)) {
            record({
              constraintId: constraint.id,
              kind: constraint.kind,
              severity: constraint.severity,
              message: '떨어뜨려야 할 두 학생이 붙어 있습니다.',
              studentIds: [a, b],
              penalty: weight,
            });
          }
        }
        break;
      }

      case 'together': {
        for (const [a, b] of pairsOf(constraint.studentIds)) {
          const bothSeated = seatOf.has(a) && seatOf.has(b);
          if (bothSeated && !areClose(a, b, constraint.scope, seatOf, ctx)) {
            record({
              constraintId: constraint.id,
              kind: constraint.kind,
              severity: constraint.severity,
              message: '가까이 앉혀야 할 두 학생이 떨어져 있습니다.',
              studentIds: [a, b],
              penalty: weight,
            });
          }
        }
        break;
      }

      case 'zone': {
        const seatId = seatOf.get(constraint.studentId);
        if (seatId) {
          const seat = ctx.seatsById.get(seatId);
          if (seat && !seat.zones.includes(constraint.zone)) {
            record({
              constraintId: constraint.id,
              kind: constraint.kind,
              severity: constraint.severity,
              message: '희망한 자리 위치에 앉히지 못했습니다.',
              studentIds: [constraint.studentId],
              penalty: weight,
            });
          }
        }
        break;
      }

      case 'avoidPastPartner': {
        for (const [seatId, studentId] of Object.entries(assignment)) {
          const neighbours = ctx.adjacency.get(seatId);
          if (!neighbours) continue;
          for (const deskSeat of neighbours.desk) {
            const other = assignment[deskSeat];
            if (!other || other <= studentId) continue; // count each pair once
            const key = pairKey(studentId, other);
            const past = ctx.history.partner.get(key) ?? 0;
            if (past > 0) {
              record({
                constraintId: constraint.id,
                kind: constraint.kind,
                severity: constraint.severity,
                message: '전에 짝이었던 두 학생이 다시 짝이 되었습니다.',
                studentIds: [studentId, other],
                penalty: weight * past,
              });
            }
          }
        }
        break;
      }

      case 'avoidPastNeighbour': {
        for (const [seatId, studentId] of Object.entries(assignment)) {
          const neighbours = ctx.adjacency.get(seatId);
          if (!neighbours) continue;
          for (const otherSeat of neighbours.orthogonal) {
            const other = assignment[otherSeat];
            if (!other || other <= studentId) continue;
            const past = ctx.history.neighbour.get(pairKey(studentId, other)) ?? 0;
            if (past > 0) {
              record({
                constraintId: constraint.id,
                kind: constraint.kind,
                severity: constraint.severity,
                message: '전에 옆자리였던 두 학생이 다시 붙었습니다.',
                studentIds: [studentId, other],
                penalty: weight * past,
              });
            }
          }
        }
        break;
      }

      case 'genderMix': {
        // The helper only emits; `record` is what accumulates the penalty.
        scoreGenderSeating(assignment, ctx, constraint.mode, constraint.source ?? 'gender', weight, (v) =>
          record({ ...v, constraintId: constraint.id, kind: constraint.kind, severity: constraint.severity }),
        );
        break;
      }

      case 'examSpacing': {
        const entries = Object.entries(assignment);
        for (let i = 0; i < entries.length; i += 1) {
          for (let j = i + 1; j < entries.length; j += 1) {
            const [seatIdA] = entries[i] as [string, string];
            const [seatIdB] = entries[j] as [string, string];
            const a = ctx.seatsById.get(seatIdA);
            const b = ctx.seatsById.get(seatIdB);
            if (!a || !b) continue;
            if (seatDistance(a, b) < constraint.minDistance) {
              record({
                constraintId: constraint.id,
                kind: constraint.kind,
                severity: constraint.severity,
                message: `시험 자리 간격 ${constraint.minDistance}칸을 지키지 못했습니다.`,
                studentIds: [(entries[i] as [string, string])[1], (entries[j] as [string, string])[1]],
                penalty: weight,
              });
            }
          }
        }
        break;
      }

      // Grouping-only constraints contribute nothing to a seating score.
      case 'fixedGroup':
      case 'avoidPastGroupmate':
      case 'spreadTag':
      case 'tagBalance':
        break;
    }

    if (penalty === before) satisfied.push(constraint.id);
  }

  return { penalty, hardViolations, softViolations, byConstraint, satisfiedConstraintIds: satisfied };
}

export type MixSource = 'gender' | 'division';

/**
 * Which side of a two-way split a student is on, or `null` when they are on
 * neither.
 *
 * `'unset'`, `'other'` and `'undisclosed'` all return `null`, which is what
 * lets a mixing rule run harmlessly on a class whose gender column is empty:
 * there is simply nothing to interleave, so the score is zero rather than an
 * error.
 */
export function mixSideOf(
  student: Student | undefined,
  source: MixSource,
): 'first' | 'second' | null {
  if (!student) return null;
  if (source === 'division') {
    if (student.division === 'a') return 'first';
    if (student.division === 'b') return 'second';
    return null;
  }
  if (student.gender === 'male') return 'first';
  if (student.gender === 'female') return 'second';
  return null;
}

/** How many students actually carry a side, for diagnostics. */
export function countMixSides(
  students: readonly Student[],
  source: MixSource,
): { first: number; second: number; unknown: number } {
  let first = 0;
  let second = 0;
  let unknown = 0;
  for (const student of students) {
    const side = mixSideOf(student, source);
    if (side === 'first') first += 1;
    else if (side === 'second') second += 1;
    else unknown += 1;
  }
  return { first, second, unknown };
}

/**
 * Interleaving two groups across the seats.
 *
 * Works the same whether the two groups are 남/여 or 구분1/구분2 — the rule
 * only ever asks "are these two students on the same side?", never what the
 * sides mean.
 */
function scoreGenderSeating(
  assignment: SeatAssignment,
  ctx: EvaluationContext,
  mode: 'alternate' | 'balance',
  source: MixSource,
  weight: number,
  emit: (violation: Omit<Violation, 'constraintId' | 'kind' | 'severity'>) => void,
): void {
  const genderOf = (studentId: string | undefined): 'first' | 'second' | null =>
    studentId ? mixSideOf(ctx.studentsById.get(studentId), source) : null;

  if (mode === 'alternate') {
    for (const [seatId, studentId] of Object.entries(assignment)) {
      const mine = genderOf(studentId);
      if (!mine) continue;
      const neighbours = ctx.adjacency.get(seatId);
      if (!neighbours) continue;
      for (const otherSeat of neighbours.desk.length > 0 ? neighbours.desk : neighbours.orthogonal) {
        const other = assignment[otherSeat];
        if (!other || other <= studentId) continue;
        const theirs = genderOf(other);
        if (theirs && theirs === mine) {
          emit({
            message:
              source === 'division'
                ? '같은 구분끼리 나란히 앉은 자리가 있습니다.'
                : '남녀를 번갈아 앉히지 못한 자리가 있습니다.',
            studentIds: [studentId, other],
            penalty: weight,
          });
        }
      }
    }
    return;
  }

  // 'balance': even out male/female counts across the left and right halves.
  const midpoint = (ctx.classroom.cols - 1) / 2;
  let leftMale = 0;
  let leftFemale = 0;
  let rightMale = 0;
  let rightFemale = 0;
  for (const [seatId, studentId] of Object.entries(assignment)) {
    const gender = genderOf(studentId);
    if (!gender) continue;
    const seat = ctx.seatsById.get(seatId);
    if (!seat) continue;
    const isLeft = seat.col < midpoint;
    if (gender === 'first') isLeft ? (leftMale += 1) : (rightMale += 1);
    else isLeft ? (leftFemale += 1) : (rightFemale += 1);
  }
  const skew = Math.abs(leftMale - rightMale) + Math.abs(leftFemale - rightFemale);
  if (skew > 1) {
    emit({
      message:
        source === 'division'
          ? '교실 좌우의 구분1·구분2 비율이 고르지 않습니다.'
          : '교실 좌우의 남녀 비율이 고르지 않습니다.',
      studentIds: [],
      penalty: weight * (skew - 1),
    });
  }
}

// ---------------------------------------------------------------------------
// Grouping evaluation
// ---------------------------------------------------------------------------

export function evaluateGrouping(
  grouping: Grouping,
  constraints: readonly Constraint[],
  ctx: EvaluationContext,
): Evaluation {
  const groupOf = new Map<string, number>();
  for (const group of grouping.groups) {
    for (const memberId of group.memberIds) groupOf.set(memberId, group.index);
  }

  const hardViolations: Violation[] = [];
  const softViolations: Violation[] = [];
  const byConstraint: Record<string, number> = {};
  const satisfied: string[] = [];
  let penalty = 0;

  const record = (violation: Violation) => {
    penalty += violation.penalty;
    byConstraint[violation.constraintId] =
      (byConstraint[violation.constraintId] ?? 0) + violation.penalty;
    if (violation.severity === 'hard') hardViolations.push(violation);
    else softViolations.push(violation);
  };

  const sameGroup = (a: string, b: string) => {
    const ga = groupOf.get(a);
    const gb = groupOf.get(b);
    return ga !== undefined && ga === gb;
  };

  for (const constraint of activeConstraints(constraints)) {
    const before = penalty;
    const weight = SEVERITY_WEIGHT[constraint.severity];

    switch (constraint.kind) {
      case 'fixedGroup': {
        const actual = groupOf.get(constraint.studentId);
        if (actual !== undefined && actual !== constraint.groupIndex) {
          record({
            constraintId: constraint.id,
            kind: constraint.kind,
            severity: constraint.severity,
            message: `지정한 ${constraint.groupIndex}모둠에 넣지 못했습니다.`,
            studentIds: [constraint.studentId],
            penalty: weight,
          });
        }
        break;
      }

      case 'separate': {
        if (constraint.scope !== 'sameGroup' && constraint.scope !== 'adjacent') break;
        for (const [a, b] of pairsOf(constraint.studentIds)) {
          if (sameGroup(a, b)) {
            record({
              constraintId: constraint.id,
              kind: constraint.kind,
              severity: constraint.severity,
              message: '다른 모둠이어야 할 두 학생이 같은 모둠입니다.',
              studentIds: [a, b],
              penalty: weight,
            });
          }
        }
        break;
      }

      case 'together': {
        for (const [a, b] of pairsOf(constraint.studentIds)) {
          if (groupOf.has(a) && groupOf.has(b) && !sameGroup(a, b)) {
            record({
              constraintId: constraint.id,
              kind: constraint.kind,
              severity: constraint.severity,
              message: '같은 모둠이어야 할 두 학생이 갈라졌습니다.',
              studentIds: [a, b],
              penalty: weight,
            });
          }
        }
        break;
      }

      case 'avoidPastGroupmate': {
        for (const group of grouping.groups) {
          for (const [a, b] of pairsOf(group.memberIds)) {
            const past = ctx.history.groupmate.get(pairKey(a, b)) ?? 0;
            if (past > 0) {
              record({
                constraintId: constraint.id,
                kind: constraint.kind,
                severity: constraint.severity,
                message: '전에 같은 모둠이었던 두 학생이 다시 같은 모둠입니다.',
                studentIds: [a, b],
                penalty: weight * past,
              });
            }
          }
        }
        break;
      }

      case 'spreadTag': {
        for (const group of grouping.groups) {
          const holders = group.memberIds.filter((id) =>
            ctx.studentsById.get(id)?.tags.includes(constraint.tag),
          );
          if (holders.length > 1) {
            record({
              constraintId: constraint.id,
              kind: constraint.kind,
              severity: constraint.severity,
              message: `«${constraint.tag}» 학생이 ${group.index}모둠에 ${holders.length}명 몰려 있습니다.`,
              studentIds: holders,
              penalty: weight * (holders.length - 1),
            });
          }
        }
        break;
      }

      case 'tagBalance': {
        scoreTagBalance(grouping, ctx, constraint.tag, weight, (v) =>
          record({ ...v, constraintId: constraint.id, kind: constraint.kind, severity: constraint.severity }),
        );
        break;
      }

      case 'genderMix': {
        scoreGenderGrouping(grouping, ctx, constraint.source ?? 'gender', weight, (v) =>
          record({ ...v, constraintId: constraint.id, kind: constraint.kind, severity: constraint.severity }),
        );
        break;
      }

      case 'fixedSeat':
      case 'zone':
      case 'avoidPastPartner':
      case 'avoidPastNeighbour':
      case 'examSpacing':
        break;
    }

    if (penalty === before) satisfied.push(constraint.id);
  }

  return { penalty, hardViolations, softViolations, byConstraint, satisfiedConstraintIds: satisfied };
}

/** Even distribution of a tag across groups, measured against the ideal share. */
function scoreTagBalance(
  grouping: Grouping,
  ctx: EvaluationContext,
  tag: string,
  weight: number,
  emit: (violation: Omit<Violation, 'constraintId' | 'kind' | 'severity'>) => void,
): void {
  const counts = grouping.groups.map(
    (group) => group.memberIds.filter((id) => ctx.studentsById.get(id)?.tags.includes(tag)).length,
  );
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0 || grouping.groups.length === 0) return;

  const ideal = total / grouping.groups.length;
  const deviation = counts.reduce((sum, count) => sum + Math.abs(count - ideal), 0);
  if (deviation <= 1) return;

  emit({
    message: `«${tag}» 학생이 모둠별로 고르게 나뉘지 않았습니다.`,
    studentIds: [],
    penalty: Math.round(weight * (deviation - 1)),
  });
}

function scoreGenderGrouping(
  grouping: Grouping,
  ctx: EvaluationContext,
  source: MixSource,
  weight: number,
  emit: (violation: Omit<Violation, 'constraintId' | 'kind' | 'severity'>) => void,
): void {
  // Only students who carry a side participate, so an empty column yields no
  // penalty rather than an error.
  const known = grouping.groups.flatMap((group) =>
    group.memberIds.filter((id) => mixSideOf(ctx.studentsById.get(id), source) !== null),
  );
  if (known.length === 0) return;

  const label = source === 'division' ? '구분1·구분2' : '남녀';

  for (const group of grouping.groups) {
    let first = 0;
    let second = 0;
    for (const id of group.memberIds) {
      const side = mixSideOf(ctx.studentsById.get(id), source);
      if (side === 'first') first += 1;
      else if (side === 'second') second += 1;
    }
    if (first + second === 0) continue;
    const skew = Math.abs(first - second);
    // A difference of one is unavoidable in odd-sized groups and is not a fault.
    if (skew > 1) {
      emit({
        message: `${group.index}모둠의 ${label} 인원이 ${skew}명 차이 납니다.`,
        studentIds: [],
        penalty: weight * (skew - 1),
      });
    }
  }
}
