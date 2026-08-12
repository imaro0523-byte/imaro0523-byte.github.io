/**
 * Teacher's point of view ↔ student's point of view.
 *
 * Stored coordinates are always the student's view: row 0 is the row nearest
 * the board, and columns run left-to-right as a seated student sees them.
 *
 * A teacher standing at the front desk is facing the opposite way, so what they
 * see is the room rotated by 180°: the back row appears at the top of the
 * screen and left and right swap over. One rotation handles both axes at once,
 * which is why "the teacher's left is the student's right" comes out correct
 * without any special-casing.
 *
 * This module is deliberately the *only* place the flip happens. Adjacency,
 * constraint checking, solving, history and export all run in canonical space,
 * so switching the view can never change a result.
 */

import type { Classroom, Seat, Viewpoint } from '../model/types';

export interface DisplayPosition {
  row: number;
  col: number;
}

/** Maps a canonical (row, col) to the position it occupies on screen. */
export function toDisplay(
  position: DisplayPosition,
  rows: number,
  cols: number,
  viewpoint: Viewpoint,
): DisplayPosition {
  if (viewpoint === 'student') return { row: position.row, col: position.col };
  return { row: rows - 1 - position.row, col: cols - 1 - position.col };
}

/** Maps a screen position back to canonical space. The rotation is its own inverse. */
export function fromDisplay(
  position: DisplayPosition,
  rows: number,
  cols: number,
  viewpoint: Viewpoint,
): DisplayPosition {
  return toDisplay(position, rows, cols, viewpoint);
}

/** Seats ordered the way they should be laid out on screen, row by row. */
export function seatsInDisplayOrder(classroom: Classroom, viewpoint: Viewpoint): Seat[][] {
  const { rows, cols } = classroom;
  const byPosition = new Map<string, Seat>();
  for (const seat of classroom.seats) byPosition.set(`${seat.row}:${seat.col}`, seat);

  const out: Seat[][] = [];
  for (let displayRow = 0; displayRow < rows; displayRow += 1) {
    const line: Seat[] = [];
    for (let displayCol = 0; displayCol < cols; displayCol += 1) {
      const canonical = fromDisplay({ row: displayRow, col: displayCol }, rows, cols, viewpoint);
      const seat = byPosition.get(`${canonical.row}:${canonical.col}`);
      if (seat) line.push(seat);
    }
    out.push(line);
  }
  return out;
}

/**
 * Where the board and the teacher's desk are drawn.
 *
 * In the student's view the board is at the top of the screen, because that is
 * what a student sees. In the teacher's view it is behind them, so it is drawn
 * at the bottom. Showing this explicitly is what stops the two views from being
 * mistaken for each other.
 */
export function boardPlacement(viewpoint: Viewpoint): 'top' | 'bottom' {
  return viewpoint === 'student' ? 'top' : 'bottom';
}

/**
 * The teacher's desk alignment as drawn. The 180° rotation mirrors it, so a
 * desk on the canonical left appears on the right in the teacher's view.
 */
export function teacherDeskPlacement(
  align: Classroom['teacherDeskAlign'],
  viewpoint: Viewpoint,
): Classroom['teacherDeskAlign'] {
  if (viewpoint === 'student' || align === 'center') return align;
  return align === 'left' ? 'right' : 'left';
}

/** Which side of the drawn room the windows are on. */
export function windowPlacement(
  side: Classroom['windowSide'],
  viewpoint: Viewpoint,
): Classroom['windowSide'] {
  if (viewpoint === 'student' || side === 'none') return side;
  return side === 'left' ? 'right' : 'left';
}

export function otherViewpoint(viewpoint: Viewpoint): Viewpoint {
  return viewpoint === 'student' ? 'teacher' : 'student';
}
