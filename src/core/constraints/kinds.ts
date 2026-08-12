/**
 * Constraint definitions.
 *
 * Constraints are plain serialisable data, never closures. That is what lets
 * the same rule set travel into a Web Worker, into a JSON backup and into a
 * history record, and it is what makes a run reproducible from a seed.
 *
 * Three severities, and the difference between them is deliberate:
 *
 *   hard   — a candidate that violates one is discarded. Never quietly ignored.
 *   strong — heavily penalised, but a solution may still use it if nothing else
 *            works. This is where "don't repeat last week's partner" belongs.
 *   weak   — nudges the search. Gender balance and seat preferences live here.
 */

import type { ZoneTag } from '../model/types';

export type Severity = 'hard' | 'strong' | 'weak';

export const SEVERITY_LABELS: Record<Severity, string> = {
  hard: '반드시 지킴',
  strong: '가능하면 꼭 지킴',
  weak: '되도록 지킴',
};

export const SEVERITY_DESCRIPTIONS: Record<Severity, string> = {
  hard: '이 조건을 어긴 배치는 결과로 내놓지 않습니다.',
  strong: '큰 감점을 주지만, 다른 방법이 없으면 어길 수 있습니다.',
  weak: '전체 균형을 위해 일부 어길 수 있습니다.',
};

/** Penalty weight applied per violation, before the constraint's own scaling. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  hard: 100000,
  strong: 200,
  weak: 20,
};

/** How two students are considered "next to" each other. */
export type ProximityScope =
  | 'adjacent' // orthogonally next to each other
  | 'anyAdjacent' // orthogonally or diagonally
  | 'sameDesk' // sharing one physical desk
  | 'sameGroup' // in the same 모둠
  | 'distance'; // within `minDistance` seats

export const SCOPE_LABELS: Record<ProximityScope, string> = {
  adjacent: '앞뒤·좌우로 붙는 것',
  anyAdjacent: '앞뒤·좌우·대각선으로 붙는 것',
  sameDesk: '같은 책상에 앉는 것',
  sameGroup: '같은 모둠이 되는 것',
  distance: '가까이 앉는 것',
};

interface Base {
  id: string;
  severity: Severity;
  /** Teacher-authored note. Never leaves the device in a student-facing export. */
  note?: string;
  enabled: boolean;
}

export interface FixedSeat extends Base {
  kind: 'fixedSeat';
  studentId: string;
  seatId: string;
}

export interface FixedGroup extends Base {
  kind: 'fixedGroup';
  studentId: string;
  /** 1-based group number. */
  groupIndex: number;
}

export interface Separate extends Base {
  kind: 'separate';
  studentIds: string[];
  scope: ProximityScope;
  /** Only meaningful when `scope === 'distance'`. */
  minDistance?: number;
}

export interface Together extends Base {
  kind: 'together';
  studentIds: string[];
  scope: ProximityScope;
}

export interface ZonePreference extends Base {
  kind: 'zone';
  studentId: string;
  zone: ZoneTag;
}

export interface AvoidPast extends Base {
  kind: 'avoidPastPartner' | 'avoidPastNeighbour' | 'avoidPastGroupmate';
  /** How many past arrangements to look back over. */
  withinLast: number;
}

export interface GenderMix extends Base {
  kind: 'genderMix';
  /** `alternate` tries to interleave; `balance` only evens out the counts. */
  mode: 'alternate' | 'balance';
}

export interface TagBalance extends Base {
  kind: 'tagBalance';
  tag: string;
}

/** Puts at most one holder of the tag in each group — leaders, for instance. */
export interface SpreadTag extends Base {
  kind: 'spreadTag';
  tag: string;
}

/** Exam seating: keep everyone at least `minDistance` seats apart. */
export interface ExamSpacing extends Base {
  kind: 'examSpacing';
  minDistance: number;
}

export type Constraint =
  | FixedSeat
  | FixedGroup
  | Separate
  | Together
  | ZonePreference
  | AvoidPast
  | GenderMix
  | TagBalance
  | SpreadTag
  | ExamSpacing;

export type ConstraintKind = Constraint['kind'];

export const CONSTRAINT_LABELS: Record<ConstraintKind, string> = {
  fixedSeat: '자리 고정',
  fixedGroup: '모둠 고정',
  separate: '떨어뜨리기',
  together: '가까이 앉히기',
  zone: '자리 위치 희망',
  avoidPastPartner: '지난 짝 피하기',
  avoidPastNeighbour: '지난 옆자리 피하기',
  avoidPastGroupmate: '지난 모둠원 피하기',
  genderMix: '남녀 섞기',
  tagBalance: '태그 균형',
  spreadTag: '태그 분산',
  examSpacing: '시험 자리 간격',
};

/** Constraints that only make sense for seating, not for grouping. */
export const SEATING_ONLY: ReadonlySet<ConstraintKind> = new Set<ConstraintKind>([
  'fixedSeat',
  'zone',
  'avoidPastPartner',
  'avoidPastNeighbour',
  'examSpacing',
]);

/** Constraints that only make sense for grouping. */
export const GROUPING_ONLY: ReadonlySet<ConstraintKind> = new Set<ConstraintKind>([
  'fixedGroup',
  'avoidPastGroupmate',
  'spreadTag',
]);

export function activeConstraints(constraints: readonly Constraint[]): Constraint[] {
  return constraints.filter((c) => c.enabled);
}
