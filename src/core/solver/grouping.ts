/**
 * Group formation search.
 *
 * Same shape as the seating solver: sizes are fixed up front by `partition.ts`,
 * fixed-group rules are honoured by construction, and the search then swaps
 * members between groups to reduce the penalty. Group sizes therefore never
 * drift — a swap always exchanges one member for another.
 */

import { buildContext, evaluateGrouping, type Evaluation } from '../constraints/evaluate';
import { activeConstraints, type Constraint } from '../constraints/kinds';
import { emptyHistoryIndex, type HistoryIndex } from '../history';
import { shortId } from '../model/ids';
import type { Classroom, Group, Grouping, Student } from '../model/types';
import { isPlaceable } from '../model/types';
import { partitionByCount } from './partition';
import { createRng, deriveSeed } from './rng';
import { EFFORT_BUDGETS, type Effort } from './seating';

export interface GroupingRequest {
  students: readonly Student[];
  /** Sizes to produce. Length is the group count. */
  sizes: readonly number[];
  constraints: readonly Constraint[];
  seed: number;
  effort: Effort;
  candidateCount: number;
  history?: HistoryIndex;
  /** Needed only so the evaluator has a context; grouping ignores geometry. */
  classroom: Classroom;
  /** Groups whose membership must be preserved exactly. */
  lockedGroupIndices?: readonly number[];
  /** Existing grouping to start from, for "keep these, reshuffle the rest". */
  previous?: Grouping;
}

export interface GroupingCandidate {
  grouping: Grouping;
  evaluation: Evaluation;
  seed: number;
}

export interface GroupingResult {
  candidates: GroupingCandidate[];
  unsatisfiable: boolean;
  elapsedMs: number;
  seed: number;
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Builds `Group` records from a membership matrix. */
function toGrouping(members: string[][], excludedIds: string[], previous?: Grouping): Grouping {
  const groups: Group[] = members.map((memberIds, i) => {
    const before = previous?.groups[i];
    return {
      id: before?.id ?? shortId('group', i + 1),
      index: i + 1,
      name: before?.name,
      colorIndex: (i % 12) + 1,
      memberIds: [...memberIds],
      roles: before?.roles ?? {},
      locked: before?.locked ?? false,
    };
  });
  return { groups, excludedIds };
}

export function solveGrouping(request: GroupingRequest): GroupingResult {
  const started = now();
  const budget = EFFORT_BUDGETS[request.effort];
  const history = request.history ?? emptyHistoryIndex();
  const ctx = buildContext(request.classroom, request.students, history);

  const placeable = request.students.filter(isPlaceable);
  const excludedIds = request.students.filter((s) => !isPlaceable(s)).map((s) => s.id);
  const sizes = [...request.sizes];
  const groupCount = sizes.length;

  const locked = new Set(request.lockedGroupIndices ?? []);

  // --- seed the membership matrix ----------------------------------------
  const assignedIds = new Set<string>();
  const members: string[][] = sizes.map(() => []);

  // 1. Locked groups keep exactly who they had.
  if (request.previous) {
    for (const group of request.previous.groups) {
      if (!locked.has(group.index) && !group.locked) continue;
      const slot = group.index - 1;
      if (slot < 0 || slot >= groupCount) continue;
      for (const memberId of group.memberIds) {
        if (assignedIds.has(memberId)) continue;
        const student = request.students.find((s) => s.id === memberId);
        if (!student || !isPlaceable(student)) continue;
        (members[slot] as string[]).push(memberId);
        assignedIds.add(memberId);
      }
    }
  }

  // 2. Fixed-group rules. Overflow is reported by `diagnoseGrouping`; here the
  //    group simply takes as many as it has room for.
  for (const constraint of activeConstraints(request.constraints)) {
    if (constraint.kind !== 'fixedGroup') continue;
    if (assignedIds.has(constraint.studentId)) continue;
    const student = request.students.find((s) => s.id === constraint.studentId);
    if (!student || !isPlaceable(student)) continue;
    const slot = constraint.groupIndex - 1;
    if (slot < 0 || slot >= groupCount) continue;
    if ((members[slot] as string[]).length >= (sizes[slot] as number)) continue;
    (members[slot] as string[]).push(constraint.studentId);
    assignedIds.add(constraint.studentId);
  }

  const freeIds = placeable.filter((s) => !assignedIds.has(s.id)).map((s) => s.id);
  const movableSlots: number[] = [];
  members.forEach((list, slot) => {
    if (locked.has(slot + 1)) return;
    const room = (sizes[slot] as number) - list.length;
    for (let i = 0; i < room; i += 1) movableSlots.push(slot);
  });

  const candidates: GroupingCandidate[] = [];
  const seen = new Set<string>();

  const consider = (matrix: string[][], seed: number) => {
    const key = matrix.map((list) => [...list].sort().join('+')).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const grouping = toGrouping(matrix, excludedIds, request.previous);
    const evaluation = evaluateGrouping(grouping, request.constraints, ctx);
    candidates.push({ grouping, evaluation, seed });
    candidates.sort((a, b) => a.evaluation.penalty - b.evaluation.penalty);
    if (candidates.length > request.candidateCount * 3) {
      candidates.length = request.candidateCount * 3;
    }
  };

  for (let restart = 0; restart < budget.restarts; restart += 1) {
    if (now() - started > budget.timeMs) break;
    const restartSeed = deriveSeed(request.seed, restart);
    const rng = createRng(restartSeed);

    const matrix = members.map((list) => [...list]);
    const shuffled = rng.shuffle(freeIds);
    shuffled.forEach((studentId, i) => {
      const slot = movableSlots[i];
      if (slot !== undefined) (matrix[slot] as string[]).push(studentId);
    });

    let currentPenalty = evaluateGrouping(
      toGrouping(matrix, excludedIds, request.previous),
      request.constraints,
      ctx,
    ).penalty;
    consider(matrix, restartSeed);

    // Positions that may move: everything except locked groups and pinned members.
    const swappable: Array<[number, number]> = [];
    matrix.forEach((list, slot) => {
      if (locked.has(slot + 1)) return;
      const pinnedCount = (members[slot] as string[]).length;
      for (let i = pinnedCount; i < list.length; i += 1) swappable.push([slot, i]);
    });
    if (swappable.length < 2) continue;

    for (let step = 0; step < budget.steps; step += 1) {
      if ((step & 127) === 0 && now() - started > budget.timeMs) break;

      const first = swappable[rng.int(swappable.length)];
      const second = swappable[rng.int(swappable.length)];
      if (!first || !second) continue;
      const [slotA, indexA] = first;
      const [slotB, indexB] = second;
      if (slotA === slotB) continue;

      const listA = matrix[slotA] as string[];
      const listB = matrix[slotB] as string[];
      const a = listA[indexA];
      const b = listB[indexB];
      if (a === undefined || b === undefined) continue;

      // Exchanging members keeps both group sizes exactly as planned.
      listA[indexA] = b;
      listB[indexB] = a;

      const evaluation = evaluateGrouping(
        toGrouping(matrix, excludedIds, request.previous),
        request.constraints,
        ctx,
      );
      const delta = evaluation.penalty - currentPenalty;
      const temperature = 1 - step / budget.steps;
      const accept = delta <= 0 || rng.next() < Math.exp(-delta / (temperature * 40 + 0.001));

      if (accept) {
        currentPenalty = evaluation.penalty;
        if (evaluation.hardViolations.length === 0) consider(matrix, restartSeed);
      } else {
        listA[indexA] = a;
        listB[indexB] = b;
      }
    }
  }

  const feasible = candidates.filter((c) => c.evaluation.hardViolations.length === 0);
  const chosen = (feasible.length > 0 ? feasible : candidates).slice(
    0,
    Math.max(1, request.candidateCount),
  );

  return {
    candidates: chosen,
    unsatisfiable: feasible.length === 0 && candidates.length > 0,
    elapsedMs: Math.round(now() - started),
    seed: request.seed,
  };
}

/** Convenience wrapper for "just give me N groups". */
export function solveGroupingByCount(
  request: Omit<GroupingRequest, 'sizes'> & { groupCount: number },
): GroupingResult {
  const placeable = request.students.filter(isPlaceable).length;
  const sizes = partitionByCount(placeable, request.groupCount);
  return solveGrouping({ ...request, sizes });
}
