/**
 * Who sits next to whom.
 *
 * Adjacency is derived from canonical geometry only, so it is identical no
 * matter which point of view the screen is showing.
 */

import type { Classroom, Seat, SeatAssignment } from '../model/types';

export type AdjacencyKind = 'orthogonal' | 'diagonal' | 'desk' | 'facing';

export interface SeatNeighbours {
  /** Directly in front, behind, left or right. */
  orthogonal: string[];
  diagonal: string[];
  /** Sharing the same physical desk. */
  desk: string[];
  /** Seated opposite each other across a desk. */
  facing: string[];
}

const ORTHOGONAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const DIAGONAL_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** Neighbour lookup for every usable seat in the room. */
export function buildAdjacency(classroom: Classroom): Map<string, SeatNeighbours> {
  const byPosition = new Map<string, Seat>();
  for (const seat of classroom.seats) {
    if (seat.kind === 'seat') byPosition.set(`${seat.row}:${seat.col}`, seat);
  }

  const byDesk = new Map<string, Seat[]>();
  for (const seat of byPosition.values()) {
    if (!seat.deskId) continue;
    const list = byDesk.get(seat.deskId) ?? [];
    list.push(seat);
    byDesk.set(seat.deskId, list);
  }

  const out = new Map<string, SeatNeighbours>();
  for (const seat of byPosition.values()) {
    const orthogonal: string[] = [];
    const diagonal: string[] = [];

    for (const [dr, dc] of ORTHOGONAL_OFFSETS) {
      const other = byPosition.get(`${seat.row + dr}:${seat.col + dc}`);
      if (other) orthogonal.push(other.id);
    }
    for (const [dr, dc] of DIAGONAL_OFFSETS) {
      const other = byPosition.get(`${seat.row + dr}:${seat.col + dc}`);
      if (other) diagonal.push(other.id);
    }

    const deskMates = (seat.deskId ? (byDesk.get(seat.deskId) ?? []) : [])
      .filter((other) => other.id !== seat.id)
      .map((other) => other.id);

    // Two seats face each other when they share a desk and look opposite ways.
    const facing = (seat.deskId ? (byDesk.get(seat.deskId) ?? []) : [])
      .filter(
        (other) =>
          other.id !== seat.id &&
          ((seat.facing === 'front' && other.facing === 'back') ||
            (seat.facing === 'back' && other.facing === 'front') ||
            (seat.facing === 'left' && other.facing === 'right') ||
            (seat.facing === 'right' && other.facing === 'left')),
      )
      .map((other) => other.id);

    out.set(seat.id, { orthogonal, diagonal, desk: deskMates, facing });
  }
  return out;
}

/** Chebyshev distance — the useful measure for "keep these two apart". */
export function seatDistance(a: Seat, b: Seat): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

/** studentId → the ids of students sitting orthogonally next to them. */
export function neighbourStudents(
  classroom: Classroom,
  assignment: SeatAssignment,
  adjacency = buildAdjacency(classroom),
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [seatId, studentId] of Object.entries(assignment)) {
    const neighbours = adjacency.get(seatId);
    if (!neighbours) continue;
    const list: string[] = [];
    for (const otherSeatId of neighbours.orthogonal) {
      const other = assignment[otherSeatId];
      if (other) list.push(other);
    }
    out[studentId] = list;
  }
  return out;
}

/** studentId → deskmate id, for two-person desks. Symmetric by construction. */
export function partnerPairs(
  classroom: Classroom,
  assignment: SeatAssignment,
  adjacency = buildAdjacency(classroom),
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [seatId, studentId] of Object.entries(assignment)) {
    const neighbours = adjacency.get(seatId);
    if (!neighbours || neighbours.desk.length !== 1) continue;
    const partnerSeat = neighbours.desk[0] as string;
    const partner = assignment[partnerSeat];
    if (partner) out[studentId] = partner;
  }
  return out;
}
