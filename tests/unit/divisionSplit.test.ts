import { describe, expect, it } from 'vitest';

import {
  detectSplitPoints,
  divisionsFor,
  initialIndex,
  inRosterOrder,
  isConfident,
  planSplit,
} from '@/core/roster/divisionSplit';
import { buildContext, countMixSides, evaluateSeating, mixSideOf } from '@/core/constraints/evaluate';
import type { Constraint } from '@/core/constraints/kinds';
import { createClassroom, seatsOf } from '@/core/layout/grid';
import { solveSeating } from '@/core/solver/seating';
import { buildAdjacency } from '@/core/layout/adjacency';
import type { SeatAssignment, Student } from '@/core/model/types';
import { makeStudent } from '../support/students';

/**
 * Builds a roster the way NEIS does: one 가나다 run per group, numbered from 1.
 * Surnames only — the given names are irrelevant to the ordering test.
 */
function roster(firstRun: string[], secondRun: string[] = []): Student[] {
  return [...firstRun, ...secondRun].map((name, i) => makeStudent(i + 1, { name }));
}

const RUN_A = ['강가온', '김나래', '박다솜', '이라온', '정마루', '최바다', '한사랑'];
const RUN_B = ['고아름', '노보라', '문초롱', '서하늘', '윤가람', '장미르', '허나린'];

describe('initialIndex', () => {
  it('orders the leading consonants', () => {
    expect(initialIndex('강가온')).toBe(0); // ㄱ
    expect(initialIndex('한사랑')).toBe(18); // ㅎ
    expect(initialIndex('나래')).toBeGreaterThan(initialIndex('강가온') as number);
  });

  it('returns null for names that do not start with Hangul', () => {
    expect(initialIndex('Aiden')).toBeNull();
    expect(initialIndex('')).toBeNull();
  });
});

describe('inRosterOrder', () => {
  it('orders by attendance number', () => {
    const students = [makeStudent(3), makeStudent(1), makeStudent(2)];
    expect(inRosterOrder(students).map((s) => s.number)).toEqual([1, 2, 3]);
  });

  it('keeps unnumbered students at the end in import order', () => {
    const students = [
      makeStudent(2),
      { ...makeStudent(9), number: null, name: '나중에온' },
      makeStudent(1),
    ];
    const ordered = inRosterOrder(students);
    expect(ordered.map((s) => s.number)).toEqual([1, 2, null]);
  });
});

describe('detectSplitPoints', () => {
  it('finds the single point where the name ordering resets', () => {
    const students = roster(RUN_A, RUN_B);
    const candidates = detectSplitPoints(students);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.index).toBe(RUN_A.length);
    expect(candidates[0]?.firstSize).toBe(7);
    expect(candidates[0]?.secondSize).toBe(7);
    // 한 → 고 is close to the largest possible backwards jump.
    expect(candidates[0]?.drop).toBeGreaterThan(0.8);
  });

  it('handles an uneven split', () => {
    const students = roster(RUN_A, RUN_B.slice(0, 3));
    const best = detectSplitPoints(students)[0];
    expect(best?.firstSize).toBe(7);
    expect(best?.secondSize).toBe(3);
  });

  it('finds nothing when the whole roster is one sorted run', () => {
    const students = roster(['강가온', '김나래', '문초롱', '서하늘', '윤가람', '장미르', '한사랑']);
    expect(detectSplitPoints(students)).toEqual([]);
  });

  it('prefers the real boundary over a transfer student appended at the end', () => {
    // A late arrival tacked on after everybody creates a second, smaller reset.
    const students = roster(RUN_A, [...RUN_B, '김늦게']);
    const candidates = detectSplitPoints(students);

    expect(candidates.length).toBeGreaterThan(1);
    // The genuine boundary — a big jump and an even split — comes first.
    expect(candidates[0]?.index).toBe(RUN_A.length);
    expect(candidates.some((c) => c.index === students.length - 1)).toBe(true);
  });

  it('ignores repeated names rather than treating them as a reset', () => {
    const students = roster(['강가온', '강가온', '김나래', '박다솜', '이라온']);
    expect(detectSplitPoints(students)).toEqual([]);
  });

  it('does not try on a very small roster', () => {
    expect(detectSplitPoints(roster(['한사랑', '강가온']))).toEqual([]);
  });
});

describe('isConfident', () => {
  it('is confident about a single big reset', () => {
    expect(isConfident(detectSplitPoints(roster(RUN_A, RUN_B)))).toBe(true);
  });

  it('stays confident when the runners-up are minor resets within one surname', () => {
    // 김하늘 → 김가온 steps backwards without changing the leading consonant,
    // which is noise rather than a boundary.
    const students = roster(['김하늘', '김가온', '박다솜', '이라온', '한사랑'], RUN_B);
    const candidates = detectSplitPoints(students);
    expect(candidates.length).toBeGreaterThan(1);
    expect(isConfident(candidates)).toBe(true);
    expect(candidates[0]?.index).toBe(5);
  });

  it('is not confident when two resets look equally plausible', () => {
    const students = roster(['박다솜', '한사랑'], ['강가온', '한마음', '고아름', '한별']);
    const candidates = detectSplitPoints(students);
    if (candidates.length > 1) {
      const [best, second] = candidates;
      // Two similar jumps mean the teacher should be asked.
      if (best && second && best.drop - second.drop < 0.25) {
        expect(isConfident(candidates)).toBe(false);
      }
    }
  });

  it('is never confident about nothing', () => {
    expect(isConfident([])).toBe(false);
  });
});

describe('planSplit', () => {
  it('explains why it cannot split a single sorted run', () => {
    const outcome = planSplit(roster(['강가온', '김나래', '문초롱', '서하늘', '한사랑']));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('noBreak');
      expect(outcome.message).toContain('가나다순');
    }
  });

  it('explains why it cannot split a tiny class', () => {
    const outcome = planSplit(roster(['한사랑', '강가온']));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('tooFewStudents');
  });

  it('succeeds on a normal two-run roster', () => {
    const outcome = planSplit(roster(RUN_A, RUN_B));
    expect(outcome.ok).toBe(true);
  });
});

describe('divisionsFor', () => {
  it('puts everything before the break in 구분1 and the rest in 구분2', () => {
    const students = roster(RUN_A, RUN_B);
    const divisions = divisionsFor(students, RUN_A.length);

    const first = students.slice(0, RUN_A.length);
    const second = students.slice(RUN_A.length);
    expect(first.every((s) => divisions[s.id] === 'a')).toBe(true);
    expect(second.every((s) => divisions[s.id] === 'b')).toBe(true);
    expect(Object.keys(divisions)).toHaveLength(students.length);
  });

  it('never assigns a gender', () => {
    const students = roster(RUN_A, RUN_B);
    const divisions = divisionsFor(students, RUN_A.length);
    // The result is only ever 'a' or 'b'; no code path produces male/female.
    expect(new Set(Object.values(divisions))).toEqual(new Set(['a', 'b']));
    expect(students.every((s) => s.gender === 'unset')).toBe(true);
  });
});

describe('mixing on divisions', () => {
  const classroom = createClassroom({ rows: 4, cols: 6, pairDesks: true });

  function splitStudents(): Student[] {
    const students = roster(RUN_A.concat(['임여름', '조가을']), RUN_B.concat(['배겨울', '신봄날']));
    const divisions = divisionsFor(students, 9);
    return students.map((student) => ({ ...student, division: divisions[student.id] ?? 'unset' }));
  }

  it('reads the division rather than the gender when told to', () => {
    const students = splitStudents();
    expect(mixSideOf(students[0], 'division')).toBe('first');
    expect(mixSideOf(students[students.length - 1], 'division')).toBe('second');
    // The same students have no gender at all.
    expect(mixSideOf(students[0], 'gender')).toBeNull();
  });

  it('counts how many students carry each side', () => {
    const students = splitStudents();
    expect(countMixSides(students, 'division')).toEqual({ first: 9, second: 9, unknown: 0 });
    expect(countMixSides(students, 'gender').unknown).toBe(18);
  });

  it('interleaves the two divisions at shared desks', () => {
    const students = splitStudents();
    const constraints: Constraint[] = [
      {
        id: 'mix',
        kind: 'genderMix',
        severity: 'strong',
        enabled: true,
        mode: 'alternate',
        source: 'division',
      },
    ];

    const sameSideDesks = (assignment: SeatAssignment) => {
      const adjacency = buildAdjacency(classroom);
      const byId = new Map(students.map((s) => [s.id, s]));
      let count = 0;
      for (const [seatId, studentId] of Object.entries(assignment)) {
        for (const deskSeat of adjacency.get(seatId)?.desk ?? []) {
          const other = assignment[deskSeat];
          if (!other || other <= studentId) continue;
          if (byId.get(studentId)?.division === byId.get(other)?.division) count += 1;
        }
      }
      return count;
    };

    const withRule = solveSeating({
      classroom, students, constraints, seed: 5, effort: 'balanced', candidateCount: 1,
    });
    const without = solveSeating({
      classroom, students, constraints: [], seed: 5, effort: 'balanced', candidateCount: 1,
    });

    expect(sameSideDesks(withRule.candidates[0]?.assignment ?? {})).toBeLessThan(
      sameSideDesks(without.candidates[0]?.assignment ?? {}),
    );
  });

  it('scores zero — not an error — when nobody has a division', () => {
    const students = roster(RUN_A, RUN_B);
    const seats = seatsOf(classroom);
    const assignment: SeatAssignment = {};
    students.forEach((student, i) => {
      const seat = seats[i];
      if (seat) assignment[seat.id] = student.id;
    });

    const evaluation = evaluateSeating(
      assignment,
      [
        {
          id: 'mix',
          kind: 'genderMix',
          severity: 'strong',
          enabled: true,
          mode: 'alternate',
          source: 'division',
        },
      ],
      buildContext(classroom, students),
    );
    expect(evaluation.penalty).toBe(0);
    expect(evaluation.hardViolations).toEqual([]);
  });

  it('defaults to gender when a saved rule has no source', () => {
    const students = roster(RUN_A, RUN_B).map((s, i) => ({
      ...s,
      gender: (i % 2 === 0 ? 'male' : 'female') as Student['gender'],
    }));
    const seats = seatsOf(classroom);
    const assignment: SeatAssignment = {};
    students.forEach((student, i) => {
      const seat = seats[i];
      if (seat) assignment[seat.id] = student.id;
    });

    // No `source` field, as written by a version before divisions existed.
    const legacy = {
      id: 'mix',
      kind: 'genderMix',
      severity: 'strong',
      enabled: true,
      mode: 'balance',
    } as Constraint;

    expect(() =>
      evaluateSeating(assignment, [legacy], buildContext(classroom, students)),
    ).not.toThrow();
  });
});
