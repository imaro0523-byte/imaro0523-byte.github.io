/**
 * Group islands — a classroom shaped for 모둠 활동.
 *
 * Seating a group "together" cannot be left to the search. A penalty for
 * scattered members competes with every other rule and loses often enough that
 * a teacher gets a map with 6모둠 sprinkled across the room, which is not a
 * usable answer.
 *
 * So cohesion is built into the geometry instead: the room is generated as one
 * island of desks per group, separated by aisles, and every seat is stamped
 * with the group it belongs to (`groupSlot`). The solver then only ever swaps
 * students within an island. Groups are together and apart by construction,
 * and no amount of unlucky randomness can undo it.
 */

import { shortId, uuid } from '../model/ids';
import type { Classroom, Facing, Grouping, Seat, SeatAssignment } from '../model/types';
import { zonesFor } from './grid';

export interface IslandSeat {
  row: number;
  col: number;
  facing: Facing;
  /** Seats sharing a desk index sit opposite each other. */
  desk: number;
}

/**
 * Where students sit within one island.
 *
 * Everything from two upwards is two rows facing each other across the desks,
 * which is how group work actually gets arranged: the front half turns around
 * (`facing: 'back'`) and the back half faces forward, so each column is a pair
 * looking at one another.
 *
 *   4명        5명         6명
 *   ▼ ▼       ▼ ▼ ▼      ▼ ▼ ▼
 *   ▲ ▲       ▲ ▲        ▲ ▲ ▲
 */
export function islandShape(size: number): IslandSeat[] {
  if (size <= 0) return [];
  if (size === 1) return [{ row: 0, col: 0, facing: 'front', desk: 0 }];

  const topCount = Math.ceil(size / 2);
  const seats: IslandSeat[] = [];
  for (let col = 0; col < topCount; col += 1) {
    seats.push({ row: 0, col, facing: 'back', desk: col });
  }
  for (let col = 0; col < size - topCount; col += 1) {
    seats.push({ row: 1, col, facing: 'front', desk: col });
  }
  return seats;
}

/** Bounding box of an island shape. */
export function islandBox(seats: readonly IslandSeat[]): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const seat of seats) {
    rows = Math.max(rows, seat.row + 1);
    cols = Math.max(cols, seat.col + 1);
  }
  return { rows, cols };
}

/**
 * How many islands to place side by side.
 *
 * Real classrooms are wider than they are deep, and a teacher needs to walk
 * between islands, so the arrangement leans wide rather than square.
 */
export function islandsPerRowFor(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return Math.ceil(Math.sqrt(count));
}

export interface GroupRoomOptions {
  /** Group sizes, in group order. Length is the number of islands. */
  sizes: readonly number[];
  /** Empty seats between islands. 1 is a walkway, 2 is roomy. */
  gap?: number;
  islandsPerRow?: number;
  windowSide?: Classroom['windowSide'];
  name?: string;
}

export const MAX_GAP = 3;

/**
 * Builds a classroom of group islands sized to fit the given groups exactly.
 *
 * Every island holds precisely as many seats as its group has members, so
 * there are no stray empty desks inside a group and no group is short a chair.
 */
export function createGroupClassroom(options: GroupRoomOptions): Classroom {
  const sizes = options.sizes.filter((size) => size > 0);
  const gap = Math.min(Math.max(options.gap ?? 1, 1), MAX_GAP);
  const perRow = Math.max(1, options.islandsPerRow ?? islandsPerRowFor(sizes.length));
  const windowSide = options.windowSide ?? 'left';

  const shapes = sizes.map(islandShape);
  const boxes = shapes.map(islandBox);
  // A uniform cell keeps the islands on a tidy grid even when group sizes
  // differ, which they usually do (5,4,4,4,4,4).
  const cellRows = boxes.reduce((max, box) => Math.max(max, box.rows), 1);
  const cellCols = boxes.reduce((max, box) => Math.max(max, box.cols), 1);

  const islandRows = Math.max(1, Math.ceil(sizes.length / perRow));
  const rows = islandRows * cellRows + (islandRows - 1) * gap;
  const cols = perRow * cellCols + (perRow - 1) * gap;

  // Start with the whole room as walkway, then place the islands into it.
  const grid = new Map<string, Seat>();
  let counter = 0;
  const makeSeat = (row: number, col: number, extra: Partial<Seat>): Seat => {
    counter += 1;
    return {
      id: shortId('seat', counter),
      row,
      col,
      kind: 'aisle',
      facing: 'front',
      zones: [],
      locked: false,
      ...extra,
    };
  };

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      grid.set(`${row}:${col}`, makeSeat(row, col, {}));
    }
  }

  sizes.forEach((_size, index) => {
    const shape = shapes[index] ?? [];
    const box = boxes[index] ?? { rows: 1, cols: 1 };
    const islandRow = Math.floor(index / perRow);
    const islandCol = index % perRow;
    const baseRow = islandRow * (cellRows + gap);
    // Centre a smaller island inside its cell so the room stays symmetrical.
    const baseCol = islandCol * (cellCols + gap) + Math.floor((cellCols - box.cols) / 2);
    const groupSlot = index + 1;
    const islandId = shortId('island', groupSlot);

    for (const seat of shape) {
      const row = baseRow + seat.row;
      const col = baseCol + seat.col;
      const existing = grid.get(`${row}:${col}`);
      if (!existing) continue;
      grid.set(`${row}:${col}`, {
        ...existing,
        kind: 'seat',
        facing: seat.facing,
        groupSlot,
        deskId: `${islandId}-d${seat.desk}`,
        zones: zonesFor(row, col, rows, cols, windowSide),
      });
    }
  });

  return {
    id: uuid(),
    name: options.name ?? `모둠 교실 (${sizes.length}모둠)`,
    rows,
    cols,
    seats: [...grid.values()].sort((a, b) => a.row - b.row || a.col - b.col),
    windowSide,
  };
}

/**
 * Rebuilds group membership from where students are actually sitting.
 *
 * In an island room the seat *is* the group: a student sitting in 3모둠's
 * island is in 3모둠. So when a teacher swaps two students between islands by
 * hand, membership has to follow them — otherwise the swapped pair keep their
 * old group colours and the map shows two students who visibly do not belong
 * where they are sitting.
 *
 * The island's own identity — its number, name, colour and lock — stays put.
 * Only the people move.
 */
export function regroupFromSeats(
  classroom: Classroom,
  assignment: SeatAssignment,
  previous: Grouping,
): Grouping {
  const slotOfSeat = new Map<string, number>();
  for (const seat of classroom.seats) {
    if (seat.kind === 'seat' && seat.groupSlot !== undefined) slotOfSeat.set(seat.id, seat.groupSlot);
  }
  if (slotOfSeat.size === 0) return previous;

  const bySlot = new Map<number, string[]>();
  const placed = new Set<string>();
  for (const [seatId, studentId] of Object.entries(assignment)) {
    const slot = slotOfSeat.get(seatId);
    if (slot === undefined) continue;
    const list = bySlot.get(slot) ?? [];
    list.push(studentId);
    bySlot.set(slot, list);
    placed.add(studentId);
  }

  // A role belongs to the person, not to the chair, so it travels with them.
  const roleOf = new Map<string, string>();
  for (const group of previous.groups) {
    for (const [studentId, role] of Object.entries(group.roles)) roleOf.set(studentId, role);
  }

  return {
    excludedIds: [...previous.excludedIds],
    groups: previous.groups.map((group) => {
      // Members who are not sitting in any island — unseated, or parked on a
      // loose seat — stay where they were rather than vanishing.
      const stragglers = group.memberIds.filter((id) => !placed.has(id));
      const memberIds = [...(bySlot.get(group.index) ?? []), ...stragglers];

      const roles: Record<string, string> = {};
      for (const memberId of memberIds) {
        const role = roleOf.get(memberId);
        if (role !== undefined) roles[memberId] = role;
      }
      return { ...group, memberIds, roles };
    }),
  };
}

/** True when this classroom was built for groups. */
export function hasGroupIslands(classroom: Classroom): boolean {
  return classroom.seats.some((seat) => seat.kind === 'seat' && seat.groupSlot !== undefined);
}

/** How many seats each island holds, by group number. */
export function islandCapacities(classroom: Classroom): Map<number, number> {
  const out = new Map<number, number>();
  for (const seat of classroom.seats) {
    if (seat.kind !== 'seat' || seat.groupSlot === undefined) continue;
    out.set(seat.groupSlot, (out.get(seat.groupSlot) ?? 0) + 1);
  }
  return out;
}

/**
 * Whether an island layout still matches a set of group sizes.
 *
 * Used to decide when the room needs rebuilding — changing from 6 groups to 7
 * invalidates the geometry.
 */
export function islandsMatchSizes(classroom: Classroom, sizes: readonly number[]): boolean {
  const capacities = islandCapacities(classroom);
  if (capacities.size !== sizes.length) return false;
  return sizes.every((size, index) => capacities.get(index + 1) === size);
}
