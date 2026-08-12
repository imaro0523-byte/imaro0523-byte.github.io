import { describe, expect, it } from 'vitest';

import { buildAdjacency, seatDistance } from '@/core/layout/adjacency';
import { createClassroom, seatsOf } from '@/core/layout/grid';
import {
  createGroupClassroom,
  hasGroupIslands,
  islandCapacities,
  islandShape,
  islandsMatchSizes,
  islandsPerRowFor,
  regroupFromSeats,
} from '@/core/layout/groupIslands';
import { partitionByCount } from '@/core/solver/partition';
import { solveGroupingByCount } from '@/core/solver/grouping';
import { solveSeating } from '@/core/solver/seating';
import type { Classroom, Grouping, SeatAssignment } from '@/core/model/types';
import { makeStudents } from '../support/students';

describe('island shapes', () => {
  it('sits four students as two facing pairs', () => {
    const shape = islandShape(4);
    expect(shape).toHaveLength(4);
    // Two rows of two, the front row turned around to face the back row.
    expect(shape.filter((s) => s.row === 0).map((s) => s.facing)).toEqual(['back', 'back']);
    expect(shape.filter((s) => s.row === 1).map((s) => s.facing)).toEqual(['front', 'front']);
    // Each column is one desk shared by two students looking at each other.
    expect(new Set(shape.map((s) => s.desk)).size).toBe(2);
  });

  it('sits five as three facing two', () => {
    const shape = islandShape(5);
    expect(shape.filter((s) => s.row === 0)).toHaveLength(3);
    expect(shape.filter((s) => s.row === 1)).toHaveLength(2);
  });

  it('sits six as three facing three', () => {
    const shape = islandShape(6);
    expect(shape.filter((s) => s.row === 0)).toHaveLength(3);
    expect(shape.filter((s) => s.row === 1)).toHaveLength(3);
  });

  it('handles one, two and three without gaps', () => {
    expect(islandShape(1)).toHaveLength(1);
    expect(islandShape(2)).toHaveLength(2);
    expect(islandShape(3)).toHaveLength(3);
    expect(islandShape(0)).toEqual([]);
  });

  it('lays six islands out three across', () => {
    expect(islandsPerRowFor(6)).toBe(3);
    expect(islandsPerRowFor(4)).toBe(2);
    expect(islandsPerRowFor(1)).toBe(1);
  });
});

describe('group classroom', () => {
  it('gives every group exactly as many seats as it has members', () => {
    const sizes = partitionByCount(25, 6); // [5,4,4,4,4,4]
    const classroom = createGroupClassroom({ sizes });

    expect(hasGroupIslands(classroom)).toBe(true);
    expect(seatsOf(classroom)).toHaveLength(25);

    const capacities = islandCapacities(classroom);
    expect(capacities.size).toBe(6);
    sizes.forEach((size, index) => {
      expect(capacities.get(index + 1)).toBe(size);
    });
  });

  it('separates the islands with walkways', () => {
    const classroom = createGroupClassroom({ sizes: [4, 4, 4, 4, 4, 4], gap: 1 });

    // Every seat of one group must be strictly further from every seat of
    // another group than it is from its own group mates.
    const seats = seatsOf(classroom);
    for (const seat of seats) {
      const sameGroup = seats.filter((s) => s.groupSlot === seat.groupSlot && s.id !== seat.id);
      const otherGroup = seats.filter((s) => s.groupSlot !== seat.groupSlot);
      const nearestOwn = Math.min(...sameGroup.map((s) => seatDistance(seat, s)));
      const nearestOther = Math.min(...otherGroup.map((s) => seatDistance(seat, s)));
      expect(nearestOther).toBeGreaterThan(nearestOwn);
    }
  });

  it('puts a wider gap between islands when asked', () => {
    const near = createGroupClassroom({ sizes: [4, 4, 4, 4, 4, 4], gap: 1 });
    const far = createGroupClassroom({ sizes: [4, 4, 4, 4, 4, 4], gap: 3 });
    expect(far.cols).toBeGreaterThan(near.cols);
    expect(far.rows).toBeGreaterThan(near.rows);
    // Same number of actual seats either way.
    expect(seatsOf(far)).toHaveLength(seatsOf(near).length);
  });

  it('makes the space between islands walkable rather than seats', () => {
    const classroom = createGroupClassroom({ sizes: [4, 4, 4, 4] });
    const aisles = classroom.seats.filter((seat) => seat.kind === 'aisle');
    expect(aisles.length).toBeGreaterThan(0);
    expect(aisles.every((seat) => seat.groupSlot === undefined)).toBe(true);
  });

  it('pairs students across a desk so they face each other', () => {
    const classroom = createGroupClassroom({ sizes: [4] });
    const adjacency = buildAdjacency(classroom);
    const seats = seatsOf(classroom);
    // Every seat in a four-person island looks at exactly one other student.
    for (const seat of seats) {
      expect(adjacency.get(seat.id)?.facing).toHaveLength(1);
    }
  });

  it('recognises when the layout no longer matches the groups', () => {
    const classroom = createGroupClassroom({ sizes: [5, 4, 4, 4, 4, 4] });
    expect(islandsMatchSizes(classroom, [5, 4, 4, 4, 4, 4])).toBe(true);
    expect(islandsMatchSizes(classroom, [4, 4, 4, 4, 4, 4])).toBe(false);
    expect(islandsMatchSizes(classroom, partitionByCount(25, 7))).toBe(false);
  });
});

describe('regrouping after a manual seat move', () => {
  /** Two islands of two, seated in order. */
  function setup() {
    const classroom = createGroupClassroom({ sizes: [2, 2] });
    const seats = seatsOf(classroom).sort(
      (a, b) => (a.groupSlot ?? 0) - (b.groupSlot ?? 0) || a.row - b.row || a.col - b.col,
    );
    const assignment: SeatAssignment = {};
    ['s01', 's02', 's03', 's04'].forEach((id, i) => {
      const seat = seats[i];
      if (seat) assignment[seat.id] = id;
    });
    const grouping: Grouping = {
      excludedIds: [],
      groups: [
        { id: 'g1', index: 1, colorIndex: 1, memberIds: ['s01', 's02'], roles: { s01: '발표' }, locked: false },
        { id: 'g2', index: 2, colorIndex: 2, memberIds: ['s03', 's04'], roles: {}, locked: false },
      ],
    };
    return { classroom, seats, assignment, grouping };
  }

  it('moves a student into the group whose island they now sit in', () => {
    const { classroom, seats, assignment, grouping } = setup();

    // Swap one member of group 1 with one member of group 2.
    const seatA = (seats[0] as { id: string }).id;
    const seatB = (seats[2] as { id: string }).id;
    const swapped: SeatAssignment = { ...assignment, [seatA]: 's03', [seatB]: 's01' };

    const next = regroupFromSeats(classroom, swapped, grouping);
    const groupOf = (id: string) =>
      next.groups.find((group) => group.memberIds.includes(id))?.index;

    expect(groupOf('s03')).toBe(1);
    expect(groupOf('s01')).toBe(2);
    expect(groupOf('s02')).toBe(1);
    expect(groupOf('s04')).toBe(2);
  });

  it('keeps group sizes intact after a swap', () => {
    const { classroom, seats, assignment, grouping } = setup();
    const swapped: SeatAssignment = {
      ...assignment,
      [(seats[0] as { id: string }).id]: 's03',
      [(seats[2] as { id: string }).id]: 's01',
    };
    const next = regroupFromSeats(classroom, swapped, grouping);
    expect(next.groups.map((g) => g.memberIds.length)).toEqual([2, 2]);
  });

  it('keeps the island’s own number, colour and lock', () => {
    const { classroom, assignment, grouping } = setup();
    const next = regroupFromSeats(classroom, assignment, grouping);
    expect(next.groups.map((g) => g.index)).toEqual([1, 2]);
    expect(next.groups.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(next.groups.map((g) => g.colorIndex)).toEqual([1, 2]);
  });

  it('carries a student’s role with them to the new group', () => {
    const { classroom, seats, assignment, grouping } = setup();
    const swapped: SeatAssignment = {
      ...assignment,
      [(seats[0] as { id: string }).id]: 's03',
      [(seats[2] as { id: string }).id]: 's01',
    };
    const next = regroupFromSeats(classroom, swapped, grouping);
    // s01 had 발표 and is now in group 2, so the role goes with them.
    expect(next.groups[1]?.roles['s01']).toBe('발표');
    expect(next.groups[0]?.roles['s01']).toBeUndefined();
  });

  it('leaves an ordinary classroom’s groups untouched', () => {
    const plain = createClassroom({ rows: 2, cols: 4 });
    const seats = seatsOf(plain);
    const assignment: SeatAssignment = {};
    ['s01', 's02', 's03', 's04'].forEach((id, i) => {
      const seat = seats[i];
      if (seat) assignment[seat.id] = id;
    });
    const grouping: Grouping = {
      excludedIds: [],
      groups: [
        { id: 'g1', index: 1, colorIndex: 1, memberIds: ['s01', 's02'], roles: {}, locked: false },
        { id: 'g2', index: 2, colorIndex: 2, memberIds: ['s03', 's04'], roles: {}, locked: false },
      ],
    };
    // Seats carry no group information here, so membership must not change.
    expect(regroupFromSeats(plain, assignment, grouping)).toBe(grouping);
  });

  it('does not lose a student who has no seat', () => {
    const { classroom, seats, grouping } = setup();
    const partial: SeatAssignment = {
      [(seats[0] as { id: string }).id]: 's01',
      [(seats[2] as { id: string }).id]: 's03',
    };
    const next = regroupFromSeats(classroom, partial, grouping);
    const all = next.groups.flatMap((g) => g.memberIds);
    expect(all.sort()).toEqual(['s01', 's02', 's03', 's04']);
  });
});

describe('seating inside group islands', () => {
  /** Seats 24 students in 6 groups of 4 using an island classroom. */
  function seatGroups(seed: number, total = 24, groupCount = 6) {
    const students = makeStudents(total);
    const sizes = partitionByCount(total, groupCount);
    const classroom = createGroupClassroom({ sizes });

    const grouped = solveGroupingByCount({
      students,
      constraints: [],
      seed,
      effort: 'fast',
      candidateCount: 1,
      classroom,
      groupCount,
    });
    const grouping = grouped.candidates[0]?.grouping as Grouping;

    const seated = solveSeating({
      classroom,
      students,
      constraints: [],
      seed,
      effort: 'fast',
      candidateCount: 1,
      grouping,
    });

    return {
      classroom,
      grouping,
      assignment: seated.candidates[0]?.assignment ?? ({} as SeatAssignment),
    };
  }

  function groupOfSeat(classroom: Classroom, seatId: string): number | undefined {
    return classroom.seats.find((seat) => seat.id === seatId)?.groupSlot;
  }

  it('seats every student inside their own group island', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const { classroom, grouping, assignment } = seatGroups(seed);
      const groupOfStudent = new Map<string, number>();
      for (const group of grouping.groups) {
        for (const memberId of group.memberIds) groupOfStudent.set(memberId, group.index);
      }

      expect(Object.keys(assignment)).toHaveLength(24);
      for (const [seatId, studentId] of Object.entries(assignment)) {
        expect(groupOfSeat(classroom, seatId)).toBe(groupOfStudent.get(studentId));
      }
    }
  });

  it('leaves no empty desk inside an island', () => {
    const { classroom, assignment } = seatGroups(7);
    for (const seat of seatsOf(classroom)) {
      expect(assignment[seat.id]).toBeDefined();
    }
  });

  it('keeps group mates closer to each other than to any other group', () => {
    const { classroom, grouping, assignment } = seatGroups(11);
    const seatOf = new Map<string, string>();
    for (const [seatId, studentId] of Object.entries(assignment)) seatOf.set(studentId, seatId);
    const seatById = new Map(classroom.seats.map((seat) => [seat.id, seat]));

    for (const group of grouping.groups) {
      for (const memberId of group.memberIds) {
        const mine = seatById.get(seatOf.get(memberId) as string);
        if (!mine) continue;

        const mateDistances = group.memberIds
          .filter((id) => id !== memberId)
          .map((id) => seatDistance(mine, seatById.get(seatOf.get(id) as string) as never));

        const outsiderDistances = grouping.groups
          .filter((other) => other.index !== group.index)
          .flatMap((other) => other.memberIds)
          .map((id) => seatDistance(mine, seatById.get(seatOf.get(id) as string) as never));

        expect(Math.max(...mateDistances)).toBeLessThan(Math.min(...outsiderDistances));
      }
    }
  });

  it('still works for uneven groups such as 25 into 6', () => {
    const { classroom, grouping, assignment } = seatGroups(5, 25, 6);
    expect(Object.keys(assignment)).toHaveLength(25);
    expect(grouping.groups.map((g) => g.memberIds.length).sort((a, b) => b - a)).toEqual([
      5, 4, 4, 4, 4, 4,
    ]);
    for (const [seatId, studentId] of Object.entries(assignment)) {
      const group = grouping.groups.find((g) => g.memberIds.includes(studentId));
      expect(groupOfSeat(classroom, seatId)).toBe(group?.index);
    }
  });

  it('shuffles who sits where inside an island between seeds', () => {
    const first = seatGroups(100);
    const second = seatGroups(200);
    expect(first.assignment).not.toEqual(second.assignment);
  });

  it('is still reproducible for a given seed', () => {
    expect(seatGroups(31).assignment).toEqual(seatGroups(31).assignment);
  });

  it('does not force islands on an ordinary classroom', () => {
    // A plain grid has no groupSlot, so seating behaves as before.
    const students = makeStudents(12);
    const result = solveSeating({
      classroom: createGroupClassroom({ sizes: [12] }),
      students,
      constraints: [],
      seed: 1,
      effort: 'fast',
      candidateCount: 1,
    });
    expect(Object.keys(result.candidates[0]?.assignment ?? {})).toHaveLength(12);
  });
});
