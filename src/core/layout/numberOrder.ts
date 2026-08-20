/**
 * Seating by attendance number, with nothing random about it.
 *
 * Every other path in this app deliberately shuffles: the point of a seating
 * tool is usually that the teacher does not decide who sits where. An exam is
 * the exception. There the room has to be reproducible — a teacher walking the
 * aisles with a roster needs to find 17번 without searching, and a student who
 * asks where to sit needs an answer that does not depend on a seed.
 *
 * So this ignores every constraint, every weight and every random source. It
 * fills seats in canonical order (row 0 first, which is the row nearest the
 * board, then left to right as a seated student sees the room) with students
 * in roster order. Excluded students are skipped, exactly as elsewhere: a
 * transferred-out student is absent from the room, not sitting in it.
 */

import { isPlaceable, type Classroom, type SeatAssignment, type Student } from '../model/types';
import { inRosterOrder } from '../roster/divisionSplit';

export interface NumberOrderResult {
  assignment: SeatAssignment;
  /** Students that had no seat left. Empty when the room is big enough. */
  unseated: Student[];
}

export function assignInNumberOrder(
  classroom: Classroom,
  students: readonly Student[],
): NumberOrderResult {
  const seats = classroom.seats
    .filter((seat) => seat.kind === 'seat')
    .sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col));

  const ordered = inRosterOrder(students.filter(isPlaceable));

  const assignment: SeatAssignment = {};
  const seatable = Math.min(seats.length, ordered.length);
  for (let i = 0; i < seatable; i += 1) {
    assignment[(seats[i] as (typeof seats)[number]).id] = (ordered[i] as Student).id;
  }

  return { assignment, unseated: ordered.slice(seatable) };
}
