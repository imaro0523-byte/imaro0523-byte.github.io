/**
 * Seat assignment search.
 *
 * A single `shuffle()` cannot honour rules, so this is a proper local search:
 * multi-start, then simulated annealing over a swap neighbourhood, keeping the
 * best distinct candidates found.
 *
 * Three properties are guaranteed and are the reason this is not "just random":
 *
 *  1. **It always terminates.** The loop is bounded by a wall-clock budget and
 *     an iteration cap, so contradictory rules produce a diagnosis rather than
 *     a frozen tab.
 *  2. **It is reproducible.** Every random choice comes from a seeded RNG, so
 *     the same roster + settings + seed give the same seats, every time.
 *  3. **Hard rules are structural where possible.** Fixed and locked seats are
 *     placed first and never moved, rather than being penalised after the fact.
 */

import {
  buildContext,
  evaluateSeating,
  type Evaluation,
  type EvaluationContext,
} from '../constraints/evaluate';
import { activeConstraints, type Constraint } from '../constraints/kinds';
import { seatsOf } from '../layout/grid';
import { emptyHistoryIndex, type HistoryIndex } from '../history';
import type { Classroom, Grouping, SeatAssignment, Student } from '../model/types';
import { isPlaceable } from '../model/types';
import { createRng, deriveSeed, type Rng } from './rng';

export type Effort = 'fast' | 'balanced' | 'thorough';

export const EFFORT_LABELS: Record<Effort, string> = {
  fast: '빠른 생성',
  balanced: '균형 생성',
  thorough: '정밀 생성',
};

interface Budget {
  /** Wall-clock milliseconds. The hard stop. */
  timeMs: number;
  /** Number of independent restarts. */
  restarts: number;
  /** Annealing steps per restart. */
  steps: number;
}

export const EFFORT_BUDGETS: Record<Effort, Budget> = {
  fast: { timeMs: 150, restarts: 4, steps: 1500 },
  balanced: { timeMs: 800, restarts: 12, steps: 8000 },
  thorough: { timeMs: 3000, restarts: 30, steps: 30000 },
};

export interface SeatingRequest {
  classroom: Classroom;
  students: readonly Student[];
  constraints: readonly Constraint[];
  seed: number;
  effort: Effort;
  /** How many distinct candidates to return. */
  candidateCount: number;
  history?: HistoryIndex;
  grouping?: Grouping;
  /**
   * Seats whose occupant must not change. Used for "re-shuffle everyone except
   * these" and for keeping an existing arrangement partially intact.
   */
  keepSeats?: SeatAssignment;
  /** Ordering strategy for the initial solution of the first restart. */
  strategy?: 'random' | 'byNumber' | 'byName';
}

export interface SeatingCandidate {
  assignment: SeatAssignment;
  evaluation: Evaluation;
  seed: number;
}

export interface SeatingResult {
  candidates: SeatingCandidate[];
  /** True when no candidate satisfied every hard rule. */
  unsatisfiable: boolean;
  iterations: number;
  elapsedMs: number;
  seed: number;
}

/** Milliseconds, monotonic where available. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

interface Prepared {
  ctx: EvaluationContext;
  /** Seats the search may move students between. */
  freeSeatIds: string[];
  /** Students the search may move. */
  movableIds: string[];
  /** seatId → studentId for everything pinned in place. */
  pinned: SeatAssignment;
}

function prepare(request: SeatingRequest): Prepared {
  const { classroom, students, constraints } = request;
  const ctx = buildContext(classroom, students, request.history ?? emptyHistoryIndex(), request.grouping);

  const placeable = students.filter(isPlaceable);
  const placeableIds = new Set(placeable.map((s) => s.id));

  const usable = seatsOf(classroom);
  const pinned: SeatAssignment = {};

  // Locked seats keep whoever the teacher put there.
  for (const [seatId, studentId] of Object.entries(request.keepSeats ?? {})) {
    if (!placeableIds.has(studentId)) continue;
    const seat = usable.find((s) => s.id === seatId);
    if (seat) pinned[seatId] = studentId;
  }

  // Fixed-seat rules pin as well. A clash is caught by `diagnoseSeating`
  // beforehand; here the first claim simply wins so the search still runs.
  for (const constraint of activeConstraints(constraints)) {
    if (constraint.kind !== 'fixedSeat') continue;
    if (!placeableIds.has(constraint.studentId)) continue;
    if (pinned[constraint.seatId] !== undefined) continue;
    if (Object.values(pinned).includes(constraint.studentId)) continue;
    if (!usable.some((s) => s.id === constraint.seatId)) continue;
    pinned[constraint.seatId] = constraint.studentId;
  }

  const pinnedStudents = new Set(Object.values(pinned));
  const pinnedSeats = new Set(Object.keys(pinned));

  return {
    ctx,
    freeSeatIds: usable.filter((s) => !pinnedSeats.has(s.id)).map((s) => s.id),
    movableIds: placeable.filter((s) => !pinnedStudents.has(s.id)).map((s) => s.id),
    pinned,
  };
}

function initialAssignment(
  prepared: Prepared,
  students: readonly Student[],
  rng: Rng,
  strategy: SeatingRequest['strategy'],
): SeatAssignment {
  const byId = new Map(students.map((s) => [s.id, s]));
  let order: string[];

  if (strategy === 'byNumber') {
    order = [...prepared.movableIds].sort(
      (a, b) => (byId.get(a)?.number ?? 1e9) - (byId.get(b)?.number ?? 1e9),
    );
  } else if (strategy === 'byName') {
    order = [...prepared.movableIds].sort((a, b) =>
      (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? '', 'ko'),
    );
  } else {
    order = rng.shuffle(prepared.movableIds);
  }

  const assignment: SeatAssignment = { ...prepared.pinned };
  order.forEach((studentId, index) => {
    const seatId = prepared.freeSeatIds[index];
    if (seatId !== undefined) assignment[seatId] = studentId;
  });
  return assignment;
}

/** Swaps the occupants of two seats, or moves one student into an empty seat. */
function applySwap(assignment: SeatAssignment, seatA: string, seatB: string): void {
  const a = assignment[seatA];
  const b = assignment[seatB];
  if (a === undefined && b === undefined) return;
  if (a === undefined) {
    assignment[seatA] = b as string;
    delete assignment[seatB];
    return;
  }
  if (b === undefined) {
    assignment[seatB] = a;
    delete assignment[seatA];
    return;
  }
  assignment[seatA] = b;
  assignment[seatB] = a;
}

function signature(assignment: SeatAssignment): string {
  return Object.entries(assignment)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([seatId, studentId]) => `${seatId}=${studentId}`)
    .join(',');
}

export function solveSeating(request: SeatingRequest): SeatingResult {
  const started = now();
  const budget = EFFORT_BUDGETS[request.effort];
  const prepared = prepare(request);
  const constraints = request.constraints;

  const best: SeatingCandidate[] = [];
  const seen = new Set<string>();
  let iterations = 0;
  /**
   * Best penalty recorded so far. Candidates are only snapshotted when they
   * improve on it, or once at the end of each restart. Without this guard an
   * unconstrained run — where every swap scores zero and is therefore accepted
   * — would serialise and sort a candidate on every one of tens of thousands
   * of steps, for no gain.
   */
  let bestPenalty = Number.POSITIVE_INFINITY;

  const consider = (assignment: SeatAssignment, evaluation: Evaluation, seed: number) => {
    const key = signature(assignment);
    if (seen.has(key)) return;
    seen.add(key);
    best.push({ assignment: { ...assignment }, evaluation, seed });
    best.sort((a, b) => a.evaluation.penalty - b.evaluation.penalty);
    const limit = Math.max(1, request.candidateCount) * 3;
    if (best.length > limit) best.length = limit;
    if (evaluation.penalty < bestPenalty) bestPenalty = evaluation.penalty;
  };

  // Nothing to shuffle: return the single arrangement that exists.
  if (prepared.freeSeatIds.length === 0 || prepared.movableIds.length === 0) {
    const assignment = { ...prepared.pinned };
    consider(assignment, evaluateSeating(assignment, constraints, prepared.ctx), request.seed);
  } else {
    for (let restart = 0; restart < budget.restarts; restart += 1) {
      if (now() - started > budget.timeMs) break;

      const restartSeed = deriveSeed(request.seed, restart);
      const rng = createRng(restartSeed);
      // The first restart honours the requested ordering; later ones randomise
      // so that "출석번호순" still gets refined rather than being the only answer.
      const strategy = restart === 0 ? request.strategy : 'random';

      let current = initialAssignment(prepared, request.students, rng, strategy);
      const startEvaluation = evaluateSeating(current, constraints, prepared.ctx);
      let currentScore = startEvaluation.penalty;
      consider(current, startEvaluation, restartSeed);

      const seatPool = prepared.freeSeatIds;
      for (let step = 0; step < budget.steps; step += 1) {
        iterations += 1;
        // Checking the clock every 128 steps keeps the timing overhead low
        // while still bounding the worst case tightly.
        if ((step & 127) === 0 && now() - started > budget.timeMs) break;

        const seatA = seatPool[rng.int(seatPool.length)];
        const seatB = seatPool[rng.int(seatPool.length)];
        if (seatA === undefined || seatB === undefined || seatA === seatB) continue;

        applySwap(current, seatA, seatB);
        const evaluation = evaluateSeating(current, constraints, prepared.ctx);
        const delta = evaluation.penalty - currentScore;

        // Temperature falls from 1 to 0 across the restart, so early steps
        // explore and later ones settle.
        const temperature = 1 - step / budget.steps;
        const accept = delta <= 0 || rng.next() < Math.exp(-delta / (temperature * 40 + 0.001));

        if (accept) {
          currentScore = evaluation.penalty;
          if (evaluation.hardViolations.length === 0 && evaluation.penalty < bestPenalty) {
            consider(current, evaluation, restartSeed);
          }
        } else {
          applySwap(current, seatA, seatB); // undo
        }
      }

      // Keep where this restart ended up even if it never beat the running
      // best, so the teacher is offered genuinely different candidates rather
      // than several near-copies of one solution.
      const endEvaluation = evaluateSeating(current, constraints, prepared.ctx);
      consider(current, endEvaluation, restartSeed);
    }
  }

  const feasible = best.filter((candidate) => candidate.evaluation.hardViolations.length === 0);
  const chosen = (feasible.length > 0 ? feasible : best).slice(
    0,
    Math.max(1, request.candidateCount),
  );

  return {
    candidates: chosen,
    unsatisfiable: feasible.length === 0,
    iterations,
    elapsedMs: Math.round(now() - started),
    seed: request.seed,
  };
}
