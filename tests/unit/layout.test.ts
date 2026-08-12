import { describe, expect, it } from 'vitest';

import { buildAdjacency, partnerPairs, seatDistance } from '@/core/layout/adjacency';
import { addColumn, addRow, createClassroom, seatAt, seatsOf } from '@/core/layout/grid';
import {
  boardPlacement,
  fromDisplay,
  otherViewpoint,
  seatsInDisplayOrder,
  toDisplay,
  windowPlacement,
} from '@/core/layout/viewpoint';
import type { SeatAssignment } from '@/core/model/types';

describe('viewpoint', () => {
  const rows = 5;
  const cols = 6;

  it('leaves the student view unchanged', () => {
    expect(toDisplay({ row: 0, col: 0 }, rows, cols, 'student')).toEqual({ row: 0, col: 0 });
    expect(toDisplay({ row: 3, col: 4 }, rows, cols, 'student')).toEqual({ row: 3, col: 4 });
  });

  it('rotates the teacher view by 180 degrees', () => {
    // The front-left seat as a student sees it is the back-right of what the
    // teacher sees, which is what "facing the class" means.
    expect(toDisplay({ row: 0, col: 0 }, rows, cols, 'teacher')).toEqual({ row: 4, col: 5 });
    expect(toDisplay({ row: 4, col: 5 }, rows, cols, 'teacher')).toEqual({ row: 0, col: 0 });
    expect(toDisplay({ row: 2, col: 2 }, rows, cols, 'teacher')).toEqual({ row: 2, col: 3 });
  });

  it('is its own inverse, so no coordinate can drift', () => {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const there = toDisplay({ row, col }, rows, cols, 'teacher');
        expect(fromDisplay(there, rows, cols, 'teacher')).toEqual({ row, col });
      }
    }
  });

  it('draws the two views in exactly reverse order', () => {
    const classroom = createClassroom({ rows, cols });
    const flatten = (viewpoint: 'student' | 'teacher') =>
      seatsInDisplayOrder(classroom, viewpoint)
        .flat()
        .map((seat) => seat.id);

    expect(flatten('teacher')).toEqual([...flatten('student')].reverse());
    // Same seats, every one of them, in both views.
    expect([...flatten('teacher')].sort()).toEqual([...flatten('student')].sort());
  });

  it('puts the board above the class for students and below it for the teacher', () => {
    expect(boardPlacement('student')).toBe('top');
    expect(boardPlacement('teacher')).toBe('bottom');
  });

  it('mirrors the window side for the teacher', () => {
    expect(windowPlacement('left', 'student')).toBe('left');
    expect(windowPlacement('left', 'teacher')).toBe('right');
    expect(windowPlacement('right', 'teacher')).toBe('left');
    expect(windowPlacement('none', 'teacher')).toBe('none');
  });

  it('toggles between the two viewpoints', () => {
    expect(otherViewpoint('student')).toBe('teacher');
    expect(otherViewpoint('teacher')).toBe('student');
  });
});

describe('classroom grid', () => {
  it('tags the front row, back row, window and corridor', () => {
    const classroom = createClassroom({ rows: 4, cols: 5, windowSide: 'left' });
    expect(seatAt(classroom, 0, 2)?.zones).toContain('frontRow');
    expect(seatAt(classroom, 3, 2)?.zones).toContain('backRow');
    expect(seatAt(classroom, 1, 0)?.zones).toContain('window');
    expect(seatAt(classroom, 1, 4)?.zones).toContain('corridor');
  });

  it('turns aisle columns into gaps rather than seats', () => {
    const classroom = createClassroom({ rows: 3, cols: 5, aisleCols: [2] });
    expect(seatAt(classroom, 0, 2)?.kind).toBe('aisle');
    expect(seatsOf(classroom)).toHaveLength(12);
  });

  it('pairs neighbouring seats into two-person desks', () => {
    const classroom = createClassroom({ rows: 1, cols: 4, pairDesks: true });
    const seats = seatsOf(classroom).sort((a, b) => a.col - b.col);
    expect(seats[0]?.deskId).toBe(seats[1]?.deskId);
    expect(seats[2]?.deskId).toBe(seats[3]?.deskId);
    expect(seats[0]?.deskId).not.toBe(seats[2]?.deskId);
  });

  it('does not pair across an aisle', () => {
    const classroom = createClassroom({ rows: 1, cols: 5, aisleCols: [2], pairDesks: true });
    const left = seatAt(classroom, 0, 1);
    const right = seatAt(classroom, 0, 3);
    expect(left?.deskId).not.toBe(right?.deskId);
  });

  it('adds rows and columns without reusing a seat id', () => {
    let classroom = createClassroom({ rows: 2, cols: 3 });
    classroom = addRow(classroom);
    classroom = addColumn(classroom);
    const ids = classroom.seats.map((seat) => seat.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(classroom.rows).toBe(3);
    expect(classroom.cols).toBe(4);
  });

  it('clamps absurd sizes instead of freezing', () => {
    expect(createClassroom({ rows: 0, cols: 0 }).rows).toBe(1);
    expect(createClassroom({ rows: 999, cols: 999 }).rows).toBeLessThanOrEqual(20);
  });
});

describe('adjacency', () => {
  const classroom = createClassroom({ rows: 3, cols: 3, pairDesks: false });

  it('finds the four orthogonal neighbours of a middle seat', () => {
    const middle = seatAt(classroom, 1, 1);
    const neighbours = buildAdjacency(classroom).get((middle as { id: string }).id);
    expect(neighbours?.orthogonal).toHaveLength(4);
    expect(neighbours?.diagonal).toHaveLength(4);
  });

  it('gives a corner seat two orthogonal neighbours', () => {
    const corner = seatAt(classroom, 0, 0);
    const neighbours = buildAdjacency(classroom).get((corner as { id: string }).id);
    expect(neighbours?.orthogonal).toHaveLength(2);
    expect(neighbours?.diagonal).toHaveLength(1);
  });

  it('measures distance so "keep them apart" can be checked', () => {
    const a = seatAt(classroom, 0, 0);
    const b = seatAt(classroom, 2, 2);
    expect(seatDistance(a as never, b as never)).toBe(2);
  });

  it('reports deskmates symmetrically', () => {
    const paired = createClassroom({ rows: 1, cols: 2, pairDesks: true });
    const seats = seatsOf(paired);
    const assignment: SeatAssignment = {
      [(seats[0] as { id: string }).id]: 'a',
      [(seats[1] as { id: string }).id]: 'b',
    };
    const partners = partnerPairs(paired, assignment);
    expect(partners['a']).toBe('b');
    expect(partners['b']).toBe('a');
  });
});
