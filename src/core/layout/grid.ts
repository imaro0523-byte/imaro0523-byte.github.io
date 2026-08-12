/**
 * Classroom construction.
 *
 * Canonical coordinates are always the *student's* point of view:
 * `row 0` is the row closest to the board, and columns increase to the right
 * as a seated student sees the room. Every stored coordinate, every adjacency
 * calculation and every constraint works in this one system. The teacher's
 * point of view exists only at render time — see `viewpoint.ts`.
 */

import { shortId, uuid } from '../model/ids';
import type { Classroom, Facing, Seat, ZoneTag } from '../model/types';

export interface GridOptions {
  rows: number;
  cols: number;
  name?: string;
  /** Column indices (0-based) that become aisles rather than seats. */
  aisleCols?: number[];
  /** Row indices (0-based) that become aisles rather than seats. */
  aisleRows?: number[];
  windowSide?: Classroom['windowSide'];
  /** Pair horizontally adjacent seats into two-person desks. */
  pairDesks?: boolean;
}

export const MAX_ROWS = 20;
export const MAX_COLS = 20;

export function clampGridSize(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), max);
}

/**
 * Zone tags derived from a seat's position. Teachers can add more by hand, but
 * these four are always kept in sync with the geometry.
 */
export function zonesFor(
  row: number,
  col: number,
  rows: number,
  cols: number,
  windowSide: Classroom['windowSide'],
): ZoneTag[] {
  const zones: ZoneTag[] = [];
  if (row === 0) zones.push('frontRow');
  if (row === rows - 1) zones.push('backRow');
  if (windowSide === 'left') {
    if (col === 0) zones.push('window');
    if (col === cols - 1) zones.push('corridor');
  } else if (windowSide === 'right') {
    if (col === cols - 1) zones.push('window');
    if (col === 0) zones.push('corridor');
  }
  return zones;
}

export function createClassroom(options: GridOptions): Classroom {
  const rows = clampGridSize(options.rows, MAX_ROWS);
  const cols = clampGridSize(options.cols, MAX_COLS);
  const windowSide = options.windowSide ?? 'left';
  const aisleCols = new Set(options.aisleCols ?? []);
  const aisleRows = new Set(options.aisleRows ?? []);

  const seats: Seat[] = [];
  let counter = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const isAisle = aisleCols.has(col) || aisleRows.has(row);
      counter += 1;
      const seat: Seat = {
        id: shortId('seat', counter),
        row,
        col,
        kind: isAisle ? 'aisle' : 'seat',
        facing: 'front',
        zones: isAisle ? [] : zonesFor(row, col, rows, cols, windowSide),
        locked: false,
      };
      seats.push(seat);
    }
  }

  const classroom: Classroom = {
    id: uuid(),
    name: options.name ?? '교실',
    rows,
    cols,
    seats,
    windowSide,
  };

  if (options.pairDesks) applyPairDesks(classroom);
  return classroom;
}

/**
 * Groups each pair of horizontally adjacent seats into one desk, skipping aisles.
 * An odd seat at the end of a row becomes a one-person desk.
 */
export function applyPairDesks(classroom: Classroom): void {
  let deskCounter = 0;
  for (let row = 0; row < classroom.rows; row += 1) {
    const inRow = classroom.seats
      .filter((s) => s.row === row && s.kind === 'seat')
      .sort((a, b) => a.col - b.col);

    let buffer: Seat[] = [];
    const flush = () => {
      for (let i = 0; i < buffer.length; i += 2) {
        deskCounter += 1;
        const deskId = shortId('desk', deskCounter);
        const left = buffer[i];
        const right = buffer[i + 1];
        if (left) left.deskId = deskId;
        if (right && right.col === (left as Seat).col + 1) right.deskId = deskId;
        else if (right) {
          deskCounter += 1;
          right.deskId = shortId('desk', deskCounter);
        }
      }
      buffer = [];
    };

    let previousCol = -2;
    for (const seat of inRow) {
      if (seat.col !== previousCol + 1) flush();
      buffer.push(seat);
      previousCol = seat.col;
    }
    flush();
  }
}

export function seatsOf(classroom: Classroom): Seat[] {
  return classroom.seats.filter((seat) => seat.kind === 'seat');
}

export function usableSeatCount(classroom: Classroom): number {
  return seatsOf(classroom).length;
}

export function seatById(classroom: Classroom, seatId: string): Seat | undefined {
  return classroom.seats.find((seat) => seat.id === seatId);
}

export function seatAt(classroom: Classroom, row: number, col: number): Seat | undefined {
  return classroom.seats.find((seat) => seat.row === row && seat.col === col);
}

/** Next unused `seat-N` number, so added seats never collide with existing ids. */
function nextSeatCounter(classroom: Classroom): number {
  let max = 0;
  for (const seat of classroom.seats) {
    const match = /^seat-(\d+)$/.exec(seat.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

/** Adds a row of seats at the back of the room. */
export function addRow(classroom: Classroom): Classroom {
  if (classroom.rows >= MAX_ROWS) return classroom;
  const rows = classroom.rows + 1;
  const seats = classroom.seats.map((seat) => ({ ...seat }));
  let counter = nextSeatCounter(classroom);
  for (let col = 0; col < classroom.cols; col += 1) {
    seats.push({
      id: shortId('seat', counter),
      row: rows - 1,
      col,
      kind: 'seat',
      facing: 'front',
      zones: [],
      locked: false,
    });
    counter += 1;
  }
  const next: Classroom = { ...classroom, rows, seats };
  retagZones(next);
  return next;
}

/** Adds a column of seats on the right-hand side of the room. */
export function addColumn(classroom: Classroom): Classroom {
  if (classroom.cols >= MAX_COLS) return classroom;
  const cols = classroom.cols + 1;
  const seats = classroom.seats.map((seat) => ({ ...seat }));
  let counter = nextSeatCounter(classroom);
  for (let row = 0; row < classroom.rows; row += 1) {
    seats.push({
      id: shortId('seat', counter),
      row,
      col: cols - 1,
      kind: 'seat',
      facing: 'front',
      zones: [],
      locked: false,
    });
    counter += 1;
  }
  const next: Classroom = { ...classroom, cols, seats };
  retagZones(next);
  return next;
}

/** Recomputes the automatic zone tags after the grid shape changes. */
export function retagZones(classroom: Classroom): void {
  for (const seat of classroom.seats) {
    if (seat.kind !== 'seat') {
      seat.zones = [];
      continue;
    }
    const manual = seat.zones.filter((z) => z !== 'frontRow' && z !== 'backRow' && z !== 'window' && z !== 'corridor');
    seat.zones = [
      ...manual,
      ...zonesFor(seat.row, seat.col, classroom.rows, classroom.cols, classroom.windowSide),
    ];
  }
}

export function setFacing(seat: Seat, facing: Facing): void {
  seat.facing = facing;
}
