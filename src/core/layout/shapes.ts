/**
 * Whole-class shapes that are not grids.
 *
 * A 분단 room is a rectangle with gaps, so `createClassroom` can describe it
 * with whole-column aisles. A horseshoe and a fan cannot: the empty part is in
 * the middle, and which cells are empty changes row by row. These builders
 * start from a full grid and carve it, which keeps ids, zone tagging and every
 * other invariant of `createClassroom` intact.
 *
 * Direction matters here and nowhere else in the app. `adjacency.ts` treats two
 * seats that face each other as sharing a desk, so a horseshoe whose sides both
 * pointed «front» would be read as rows of strangers rather than a ring facing
 * inward. The carving function returns the facing along with the decision to
 * keep a cell, so the two can never drift apart.
 */

import { createClassroom, retagZones } from './grid';
import type { Classroom, Facing } from '../model/types';

/**
 * Keeps the cells `shape` returns a facing for and empties the rest.
 * Returning `null` means "no seat here".
 */
function carve(classroom: Classroom, shape: (row: number, col: number) => Facing | null): void {
  for (const seat of classroom.seats) {
    const facing = shape(seat.row, seat.col);
    if (facing === null) {
      seat.kind = 'aisle';
      delete seat.deskId;
    } else {
      seat.kind = 'seat';
      seat.facing = facing;
    }
  }
  retagZones(classroom);
}

export interface ShapeOptions {
  windowSide?: Classroom['windowSide'];
}

/**
 * ㄷ자 (horseshoe), open toward the board.
 *
 * Desks line the two side walls and the back, everyone facing the middle, and
 * the front stays clear so the teacher can stand inside the opening. This is
 * the discussion layout: every student can see every other student's face,
 * which is the whole point and the reason it is worth the floor space.
 *
 * Seats = 2 × rows + (cols − 2). The default is 24, enough for most classes;
 * a teacher who needs more adds a row or a column on this same screen.
 */
export function createHorseshoeClassroom(
  { rows = 7, cols = 12, windowSide }: ShapeOptions & { rows?: number; cols?: number } = {},
): Classroom {
  const classroom = createClassroom({ rows, cols, name: 'ㄷ자 토론 교실', windowSide });

  carve(classroom, (row, col) => {
    if (col === 0) return 'right'; // 왼쪽 벽 — 교실 안쪽을 본다
    if (col === cols - 1) return 'left'; // 오른쪽 벽 — 교실 안쪽을 본다
    if (row === rows - 1) return 'front'; // 뒷줄 — 칠판을 본다
    return null; // 가운데와 칠판 앞은 비운다
  });

  return classroom;
}

/**
 * 반원형 (fan), widening away from the board.
 *
 * Each row holds two more seats than the row in front of it, centred, so the
 * class fans out from the board. Everyone faces front — unlike the horseshoe
 * this is a presentation shape, not a discussion one, and the arcs exist so
 * that nobody sits directly behind anybody else's head.
 *
 * Seats = rows × (frontWidth + rows − 1). The default is 28.
 */
export function createFanClassroom(
  { rows = 4, frontWidth = 4, windowSide }: ShapeOptions & { rows?: number; frontWidth?: number } = {},
): Classroom {
  // Every row is two wider than the last, so the total width is fixed by the
  // deepest row. `cols - width` is always even, which is what keeps each arc
  // centred on whole cells rather than half of one.
  const cols = frontWidth + 2 * (rows - 1);
  const classroom = createClassroom({ rows, cols, name: '반원형 교실', windowSide });

  carve(classroom, (row, col) => {
    const width = frontWidth + 2 * row;
    const start = (cols - width) / 2;
    return col >= start && col < start + width ? 'front' : null;
  });

  return classroom;
}
