import { describe, expect, it } from 'vitest';

import { diagnoseGrouping, diagnoseSeating, hasBlocking } from '@/core/constraints/diagnose';
import { buildContext, evaluateSeating, invertAssignment } from '@/core/constraints/evaluate';
import type { Constraint } from '@/core/constraints/kinds';
import { buildAdjacency } from '@/core/layout/adjacency';
import { createClassroom, seatsOf } from '@/core/layout/grid';
import { buildHistoryIndex } from '@/core/history';
import type { ArrangementRecord, SeatAssignment } from '@/core/model/types';
import { solveGroupingByCount } from '@/core/solver/grouping';
import { solveSeating, type SeatingRequest } from '@/core/solver/seating';
import { makeStudents, withAlternatingGender } from '../support/students';

const room = () => createClassroom({ rows: 5, cols: 6, pairDesks: true });

function baseRequest(overrides: Partial<SeatingRequest> = {}): SeatingRequest {
  return {
    classroom: room(),
    students: makeStudents(25),
    constraints: [],
    seed: 42,
    effort: 'fast',
    candidateCount: 3,
    ...overrides,
  };
}

function seatOfStudent(assignment: SeatAssignment, studentId: string): string | undefined {
  return invertAssignment(assignment).get(studentId);
}

describe('seating solver', () => {
  it('seats every active student exactly once', () => {
    const request = baseRequest();
    const result = solveSeating(request);
    const assignment = result.candidates[0]?.assignment ?? {};

    const seated = Object.values(assignment);
    expect(seated).toHaveLength(25);
    expect(new Set(seated).size).toBe(25);
    expect(new Set(Object.keys(assignment)).size).toBe(25);
  });

  it('produces an identical result for the same seed and settings', () => {
    const first = solveSeating(baseRequest({ seed: 777 }));
    const second = solveSeating(baseRequest({ seed: 777 }));
    expect(first.candidates[0]?.assignment).toEqual(second.candidates[0]?.assignment);
  });

  it('produces a different result for a different seed', () => {
    const first = solveSeating(baseRequest({ seed: 1 }));
    const second = solveSeating(baseRequest({ seed: 2 }));
    expect(first.candidates[0]?.assignment).not.toEqual(second.candidates[0]?.assignment);
  });

  it('keeps a fixed seat', () => {
    const classroom = room();
    const target = seatsOf(classroom)[11];
    const students = makeStudents(25);
    const constraint: Constraint = {
      id: 'c1',
      kind: 'fixedSeat',
      severity: 'hard',
      enabled: true,
      studentId: (students[4] as { id: string }).id,
      seatId: (target as { id: string }).id,
    };

    const result = solveSeating(baseRequest({ classroom, students, constraints: [constraint] }));
    for (const candidate of result.candidates) {
      expect(seatOfStudent(candidate.assignment, (students[4] as { id: string }).id)).toBe(
        (target as { id: string }).id,
      );
      expect(candidate.evaluation.hardViolations).toHaveLength(0);
    }
  });

  it('honours two fixed seats at once', () => {
    const classroom = room();
    const seats = seatsOf(classroom);
    const students = makeStudents(25);
    const constraints: Constraint[] = [
      { id: 'a', kind: 'fixedSeat', severity: 'hard', enabled: true, studentId: 's01', seatId: (seats[0] as { id: string }).id },
      { id: 'b', kind: 'fixedSeat', severity: 'hard', enabled: true, studentId: 's02', seatId: (seats[29] as { id: string }).id },
    ];
    const result = solveSeating(baseRequest({ classroom, students, constraints }));
    const assignment = result.candidates[0]?.assignment ?? {};
    expect(seatOfStudent(assignment, 's01')).toBe((seats[0] as { id: string }).id);
    expect(seatOfStudent(assignment, 's02')).toBe((seats[29] as { id: string }).id);
  });

  it('keeps students that must be separated apart', () => {
    const constraints: Constraint[] = [
      {
        id: 'sep',
        kind: 'separate',
        severity: 'hard',
        enabled: true,
        studentIds: ['s01', 's02'],
        scope: 'anyAdjacent',
      },
    ];
    const classroom = room();
    const result = solveSeating(baseRequest({ classroom, constraints, effort: 'balanced' }));
    const assignment = result.candidates[0]?.assignment ?? {};

    const adjacency = buildAdjacency(classroom);
    const seatA = seatOfStudent(assignment, 's01') as string;
    const seatB = seatOfStudent(assignment, 's02') as string;
    const neighbours = adjacency.get(seatA);

    expect(result.unsatisfiable).toBe(false);
    expect(neighbours?.orthogonal).not.toContain(seatB);
    expect(neighbours?.diagonal).not.toContain(seatB);
  });

  it('leaves excluded students unseated and keeps the rest valid', () => {
    const students = makeStudents(25).map((student, i) =>
      i === 3
        ? { ...student, status: 'transferOut' as const }
        : i === 7
          ? { ...student, status: 'withdrawn' as const }
          : i === 9
            ? { ...student, status: 'absentToday' as const }
            : student,
    );
    const result = solveSeating(baseRequest({ students }));
    const assignment = result.candidates[0]?.assignment ?? {};
    const seated = new Set(Object.values(assignment));

    expect(seated.size).toBe(22);
    expect(seated.has('s04')).toBe(false);
    expect(seated.has('s08')).toBe(false);
    expect(seated.has('s10')).toBe(false);
  });

  it('marks empty seats when the room is larger than the class', () => {
    const classroom = createClassroom({ rows: 6, cols: 6 });
    const result = solveSeating(baseRequest({ classroom, students: makeStudents(20) }));
    const assignment = result.candidates[0]?.assignment ?? {};
    expect(Object.keys(assignment)).toHaveLength(20);
    expect(seatsOf(classroom).length - Object.keys(assignment).length).toBe(16);
  });

  it('re-seats only the unlocked students when seats are kept', () => {
    const classroom = room();
    const seats = seatsOf(classroom);
    const students = makeStudents(25);
    const keepSeats: SeatAssignment = {
      [(seats[0] as { id: string }).id]: 's01',
      [(seats[1] as { id: string }).id]: 's02',
      [(seats[2] as { id: string }).id]: 's03',
    };

    const result = solveSeating(baseRequest({ classroom, students, keepSeats, seed: 5 }));
    const assignment = result.candidates[0]?.assignment ?? {};

    expect(assignment[(seats[0] as { id: string }).id]).toBe('s01');
    expect(assignment[(seats[1] as { id: string }).id]).toBe('s02');
    expect(assignment[(seats[2] as { id: string }).id]).toBe('s03');
    expect(Object.values(assignment)).toHaveLength(25);
  });

  it('works with no gender data and a gender rule switched on', () => {
    const constraints: Constraint[] = [
      { id: 'g', kind: 'genderMix', severity: 'weak', enabled: true, mode: 'alternate' },
    ];
    const result = solveSeating(baseRequest({ constraints }));
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.evaluation.hardViolations).toHaveLength(0);
  });

  it('interleaves genders at shared desks when the data is there', () => {
    const classroom = room();
    const students = withAlternatingGender(makeStudents(24));
    const constraints: Constraint[] = [
      { id: 'g', kind: 'genderMix', severity: 'strong', enabled: true, mode: 'alternate' },
    ];

    const withRule = solveSeating(
      baseRequest({ classroom, students, constraints, effort: 'balanced', seed: 3 }),
    );
    const without = solveSeating(baseRequest({ classroom, students, effort: 'balanced', seed: 3 }));

    const sameSexDesks = (assignment: SeatAssignment) => {
      const adjacency = buildAdjacency(classroom);
      const byId = new Map(students.map((s) => [s.id, s]));
      let count = 0;
      for (const [seatId, studentId] of Object.entries(assignment)) {
        for (const deskSeat of adjacency.get(seatId)?.desk ?? []) {
          const other = assignment[deskSeat];
          if (!other || other <= studentId) continue;
          if (byId.get(studentId)?.gender === byId.get(other)?.gender) count += 1;
        }
      }
      return count;
    };

    expect(sameSexDesks(withRule.candidates[0]?.assignment ?? {})).toBeLessThan(
      sameSexDesks(without.candidates[0]?.assignment ?? {}),
    );
  });

  it('avoids repeating last time’s deskmate', () => {
    const classroom = room();
    const students = makeStudents(24);
    const seats = seatsOf(classroom);

    // A previous arrangement in which everyone sat where they are numbered.
    const previous: SeatAssignment = {};
    students.forEach((student, i) => {
      const seat = seats[i];
      if (seat) previous[seat.id] = student.id;
    });
    const adjacency = buildAdjacency(classroom);
    const partners: Record<string, string> = {};
    for (const [seatId, studentId] of Object.entries(previous)) {
      const deskMate = adjacency.get(seatId)?.desk[0];
      const other = deskMate ? previous[deskMate] : undefined;
      if (other) partners[studentId] = other;
    }

    const record: ArrangementRecord = {
      schemaVersion: 1,
      id: 'r1',
      date: '2026-08-01',
      students: students.map((s) => ({ id: s.id, number: s.number })),
      seatAssignment: previous,
      partners,
      groupOf: {},
      neighbors: {},
      seed: 1,
    };
    const history = buildHistoryIndex([record]);

    const constraints: Constraint[] = [
      { id: 'p', kind: 'avoidPastPartner', severity: 'strong', enabled: true, withinLast: 3 },
    ];
    const result = solveSeating(
      baseRequest({ classroom, students, constraints, history, effort: 'balanced', seed: 11 }),
    );

    const assignment = result.candidates[0]?.assignment ?? {};
    let repeats = 0;
    for (const [seatId, studentId] of Object.entries(assignment)) {
      const deskMate = adjacency.get(seatId)?.desk[0];
      const other = deskMate ? assignment[deskMate] : undefined;
      if (other && partners[studentId] === other) repeats += 1;
    }
    expect(repeats).toBe(0);
  });

  it('handles a class of one and a class of zero without throwing', () => {
    expect(() => solveSeating(baseRequest({ students: makeStudents(1) }))).not.toThrow();
    expect(() => solveSeating(baseRequest({ students: [] }))).not.toThrow();
    expect(solveSeating(baseRequest({ students: [] })).candidates[0]?.assignment).toEqual({});
  });

  it('finishes within its time budget rather than looping', () => {
    const impossible: Constraint[] = [];
    // Everyone must be apart from everyone: unsatisfiable in a full room.
    const students = makeStudents(25);
    for (let i = 0; i < students.length; i += 1) {
      impossible.push({
        id: `x${i}`,
        kind: 'separate',
        severity: 'hard',
        enabled: true,
        studentIds: students.map((s) => s.id),
        scope: 'anyAdjacent',
      });
    }
    const started = Date.now();
    const result = solveSeating(baseRequest({ students, constraints: impossible, effort: 'fast' }));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.unsatisfiable).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
  });
});

describe('seating diagnosis', () => {
  it('reports a shortfall of seats before searching', () => {
    const diagnoses = diagnoseSeating({
      classroom: createClassroom({ rows: 2, cols: 3 }),
      students: makeStudents(25),
      constraints: [],
    });
    expect(hasBlocking(diagnoses)).toBe(true);
    expect(diagnoses[0]?.code).toBe('notEnoughSeats');
    expect(diagnoses[0]?.message).toContain('19석이 모자랍니다');
  });

  it('detects two students claiming the same fixed seat', () => {
    const classroom = room();
    const seatId = (seatsOf(classroom)[0] as { id: string }).id;
    const diagnoses = diagnoseSeating({
      classroom,
      students: makeStudents(25),
      constraints: [
        { id: 'a', kind: 'fixedSeat', severity: 'hard', enabled: true, studentId: 's01', seatId },
        { id: 'b', kind: 'fixedSeat', severity: 'hard', enabled: true, studentId: 's02', seatId },
      ],
    });
    expect(diagnoses.some((d) => d.code === 'fixedSeatClash' && d.level === 'blocking')).toBe(true);
  });

  it('detects a together/separate contradiction', () => {
    const diagnoses = diagnoseSeating({
      classroom: room(),
      students: makeStudents(25),
      constraints: [
        { id: 'a', kind: 'together', severity: 'hard', enabled: true, studentIds: ['s01', 's02'], scope: 'adjacent' },
        { id: 'b', kind: 'separate', severity: 'hard', enabled: true, studentIds: ['s01', 's02'], scope: 'adjacent' },
      ],
    });
    expect(diagnoses.some((d) => d.code === 'togetherSeparateClash')).toBe(true);
  });

  it('warns when a gender rule is on but nobody has a gender', () => {
    const diagnoses = diagnoseSeating({
      classroom: room(),
      students: makeStudents(25),
      constraints: [{ id: 'g', kind: 'genderMix', severity: 'weak', enabled: true, mode: 'balance' }],
    });
    const warning = diagnoses.find((d) => d.code === 'genderUnknown');
    expect(warning?.level).toBe('warning');
    expect(warning?.suggestion).toContain('효과가 없습니다');
  });

  it('says an exam spacing is impossible instead of trying', () => {
    const diagnoses = diagnoseSeating({
      classroom: createClassroom({ rows: 5, cols: 6 }),
      students: makeStudents(25),
      constraints: [{ id: 'e', kind: 'examSpacing', severity: 'hard', enabled: true, minDistance: 3 }],
    });
    expect(diagnoses.some((d) => d.code === 'examSpacingImpossible')).toBe(true);
  });
});

describe('grouping solver', () => {
  const groupRequest = (overrides: Partial<Parameters<typeof solveGroupingByCount>[0]> = {}) => ({
    students: makeStudents(25),
    constraints: [] as Constraint[],
    seed: 9,
    effort: 'fast' as const,
    candidateCount: 2,
    classroom: room(),
    groupCount: 6,
    ...overrides,
  });

  it('splits 25 students into 6 groups of 5,4,4,4,4,4', () => {
    const result = solveGroupingByCount(groupRequest());
    const sizes = result.candidates[0]?.grouping.groups.map((g) => g.memberIds.length) ?? [];
    expect([...sizes].sort((a, b) => b - a)).toEqual([5, 4, 4, 4, 4, 4]);

    const all = result.candidates[0]?.grouping.groups.flatMap((g) => g.memberIds) ?? [];
    expect(new Set(all).size).toBe(25);
  });

  it('splits 25 students into 7 groups with a difference of at most 1', () => {
    const result = solveGroupingByCount(groupRequest({ groupCount: 7 }));
    const sizes = result.candidates[0]?.grouping.groups.map((g) => g.memberIds.length) ?? [];
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(25);
  });

  it('leaves excluded students out and rebalances the rest', () => {
    const students = makeStudents(25).map((s, i) =>
      i < 3 ? { ...s, status: 'transferOut' as const } : s,
    );
    const result = solveGroupingByCount(groupRequest({ students }));
    const grouping = result.candidates[0]?.grouping;
    const sizes = grouping?.groups.map((g) => g.memberIds.length) ?? [];

    expect(sizes.reduce((a, b) => a + b, 0)).toBe(22);
    expect(grouping?.excludedIds).toHaveLength(3);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('keeps a student in their fixed group', () => {
    const constraints: Constraint[] = [
      { id: 'f', kind: 'fixedGroup', severity: 'hard', enabled: true, studentId: 's07', groupIndex: 3 },
    ];
    const result = solveGroupingByCount(groupRequest({ constraints }));
    const group = result.candidates[0]?.grouping.groups.find((g) => g.memberIds.includes('s07'));
    expect(group?.index).toBe(3);
  });

  it('keeps students that must not share a group apart', () => {
    const constraints: Constraint[] = [
      {
        id: 'sep',
        kind: 'separate',
        severity: 'hard',
        enabled: true,
        studentIds: ['s01', 's02', 's03'],
        scope: 'sameGroup',
      },
    ];
    const result = solveGroupingByCount(groupRequest({ constraints, effort: 'balanced' }));
    const groups = result.candidates[0]?.grouping.groups ?? [];
    const indexOf = (id: string) => groups.find((g) => g.memberIds.includes(id))?.index;
    expect(new Set([indexOf('s01'), indexOf('s02'), indexOf('s03')]).size).toBe(3);
  });

  it('is reproducible for a given seed', () => {
    const a = solveGroupingByCount(groupRequest({ seed: 2024 }));
    const b = solveGroupingByCount(groupRequest({ seed: 2024 }));
    const key = (r: typeof a) =>
      r.candidates[0]?.grouping.groups.map((g) => [...g.memberIds].sort().join(',')).join('|');
    expect(key(a)).toBe(key(b));
  });

  it('reduces repeats of previous groupmates', () => {
    const students = makeStudents(24);
    const groupOf: Record<string, number> = {};
    students.forEach((s, i) => {
      groupOf[s.id] = Math.floor(i / 4) + 1;
    });
    const record: ArrangementRecord = {
      schemaVersion: 1,
      id: 'g1',
      date: '2026-08-01',
      students: students.map((s) => ({ id: s.id, number: s.number })),
      seatAssignment: {},
      partners: {},
      groupOf,
      neighbors: {},
      seed: 1,
    };
    const history = buildHistoryIndex([record]);
    const constraints: Constraint[] = [
      { id: 'a', kind: 'avoidPastGroupmate', severity: 'strong', enabled: true, withinLast: 3 },
    ];

    const result = solveGroupingByCount(
      groupRequest({ students, constraints, history, groupCount: 6, effort: 'balanced', seed: 4 }),
    );
    const groups = result.candidates[0]?.grouping.groups ?? [];

    let repeats = 0;
    for (const group of groups) {
      for (let i = 0; i < group.memberIds.length; i += 1) {
        for (let j = i + 1; j < group.memberIds.length; j += 1) {
          const a = group.memberIds[i] as string;
          const b = group.memberIds[j] as string;
          if (groupOf[a] === groupOf[b]) repeats += 1;
        }
      }
    }
    // 6 groups of 4 from a previous 6-group split: a perfect result is 0 repeats.
    expect(repeats).toBeLessThanOrEqual(2);
  });
});

describe('grouping diagnosis', () => {
  it('reports a fixed group that is over its capacity', () => {
    const constraints: Constraint[] = [1, 2, 3, 4, 5, 6].map((i) => ({
      id: `f${i}`,
      kind: 'fixedGroup',
      severity: 'hard',
      enabled: true,
      studentId: `s0${i}`,
      groupIndex: 1,
    }));
    const diagnoses = diagnoseGrouping({
      students: makeStudents(25),
      groupCount: 6,
      groupSizes: [5, 4, 4, 4, 4, 4],
      constraints,
    });
    expect(diagnoses.some((d) => d.code === 'fixedGroupOverflow' && d.level === 'blocking')).toBe(true);
  });

  it('reports a group number that no longer exists', () => {
    const diagnoses = diagnoseGrouping({
      students: makeStudents(25),
      groupCount: 4,
      groupSizes: [7, 6, 6, 6],
      constraints: [
        { id: 'f', kind: 'fixedGroup', severity: 'hard', enabled: true, studentId: 's01', groupIndex: 6 },
      ],
    });
    expect(diagnoses.some((d) => d.code === 'fixedGroupOutOfRange')).toBe(true);
  });

  it('reports that there are fewer leaders than groups', () => {
    const students = makeStudents(25).map((s, i) => (i < 3 ? { ...s, tags: ['리더'] } : s));
    const diagnoses = diagnoseGrouping({
      students,
      groupCount: 6,
      groupSizes: [5, 4, 4, 4, 4, 4],
      constraints: [{ id: 'l', kind: 'spreadTag', severity: 'strong', enabled: true, tag: '리더' }],
    });
    const shortage = diagnoses.find((d) => d.code === 'spreadTagShortage');
    expect(shortage?.message).toContain('3명인데 모둠은 6개');
  });
});

describe('evaluation', () => {
  it('reports a hard violation rather than silently allowing it', () => {
    const classroom = room();
    const students = makeStudents(4);
    const seats = seatsOf(classroom);
    const assignment: SeatAssignment = {
      [(seats[0] as { id: string }).id]: 's01',
      [(seats[1] as { id: string }).id]: 's02',
    };
    const ctx = buildContext(classroom, students);
    const evaluation = evaluateSeating(
      assignment,
      [
        {
          id: 'sep',
          kind: 'separate',
          severity: 'hard',
          enabled: true,
          studentIds: ['s01', 's02'],
          scope: 'adjacent',
        },
      ],
      ctx,
    );
    expect(evaluation.hardViolations).toHaveLength(1);
    expect(evaluation.penalty).toBeGreaterThan(1000);
  });

  it('ignores disabled constraints', () => {
    const classroom = room();
    const students = makeStudents(4);
    const seats = seatsOf(classroom);
    const assignment: SeatAssignment = {
      [(seats[0] as { id: string }).id]: 's01',
      [(seats[1] as { id: string }).id]: 's02',
    };
    const ctx = buildContext(classroom, students);
    const evaluation = evaluateSeating(
      assignment,
      [
        {
          id: 'sep',
          kind: 'separate',
          severity: 'hard',
          enabled: false,
          studentIds: ['s01', 's02'],
          scope: 'adjacent',
        },
      ],
      ctx,
    );
    expect(evaluation.penalty).toBe(0);
  });
});
