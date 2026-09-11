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
 * Seats = 2 × rows + (cols − 2). The default is 26, which covers a class of
 * twenty-five with one spare; a teacher who needs more adds a row or a column
 * on this same screen.
 */
export function createHorseshoeClassroom(
  { rows = 7, cols = 14, windowSide }: ShapeOptions & { rows?: number; cols?: number } = {},
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
 * 원형 — a closed ring around all four walls.
 *
 * The horseshoe leaves the board side open so the teacher can stand in the
 * gap. A ring does not: the class closes the circle and everyone, the teacher
 * included, is part of it. It is the shape for a whole-class discussion where
 * nobody is at the head of the table, and it is worth keeping separate from
 * the horseshoe rather than treating one as a variant of the other, because
 * the difference is the point.
 *
 * Seats = 2 × rows + 2 × cols − 4 (the corners belong to both sides once).
 * The default is 26.
 */
export function createRingClassroom(
  { rows = 6, cols = 9, windowSide }: ShapeOptions & { rows?: number; cols?: number } = {},
): Classroom {
  const classroom = createClassroom({ rows, cols, name: '원형 교실', windowSide });

  carve(classroom, (row, col) => {
    // Corners resolve to the row's direction; either answer is equally true of
    // a corner seat, and picking one keeps the rule short.
    if (row === 0) return 'back'; // 칠판 쪽 줄 — 교실 안쪽(뒤)을 본다
    if (row === rows - 1) return 'front'; // 뒷줄 — 안쪽(앞)을 본다
    if (col === 0) return 'right';
    if (col === cols - 1) return 'left';
    return null;
  });

  return classroom;
}
