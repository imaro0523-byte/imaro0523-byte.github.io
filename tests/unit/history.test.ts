import { describe, expect, it } from 'vitest';

import { buildHistoryIndex, groupmateCount, partnerCount, seatFairness } from '@/core/history';
import { buildRecord, matchRecordToRoster, remapRecord } from '@/core/history/record';
import { BackupParseError, buildBackup, parseBackup } from '@/core/exportData/toJson';
import { buildWorkbook, readHistorySheet, workbookToBytes } from '@/core/exportData/toXlsx';
import { TEACHER_FACING } from '@/core/exportData/redact';
import { createClassroom, seatsOf } from '@/core/layout/grid';
import type { ArrangementRecord, SeatAssignment, Student } from '@/core/model/types';
import { makeStudents } from '../support/students';
import { mergeRecords } from '@/core/history';

const classroom = createClassroom({ rows: 3, cols: 4, pairDesks: true });

function seatEveryone(students: readonly Student[]): SeatAssignment {
  const assignment: SeatAssignment = {};
  seatsOf(classroom).forEach((seat, i) => {
    const student = students[i];
    if (student) assignment[seat.id] = student.id;
  });
  return assignment;
}

describe('history index', () => {
  const students = makeStudents(12);
  const assignment = seatEveryone(students);
  const record = buildRecord({
    classroom,
    students,
    assignment,
    grouping: {
      excludedIds: [],
      groups: [
        { id: 'g1', index: 1, colorIndex: 1, memberIds: ['s01', 's02', 's03'], roles: {}, locked: false },
        { id: 'g2', index: 2, colorIndex: 2, memberIds: ['s04', 's05', 's06'], roles: {}, locked: false },
      ],
    },
    seed: 1,
    date: '2026-08-01',
  });

  it('captures partners, neighbours and groups from a live arrangement', () => {
    expect(Object.keys(record.partners).length).toBeGreaterThan(0);
    expect(Object.keys(record.neighbors).length).toBe(12);
    expect(record.groupOf['s01']).toBe(1);
    expect(record.groupOf['s04']).toBe(2);
  });

  it('does not store names unless asked', () => {
    expect(record.students.every((entry) => entry.name === undefined)).toBe(true);
    const named = buildRecord({
      classroom,
      students,
      assignment,
      grouping: null,
      seed: 1,
      includeNames: true,
    });
    expect(named.students[0]?.name).toBe('학생01');
  });

  it('counts how often two students have been partners or groupmates', () => {
    const index = buildHistoryIndex([record, record]);
    const [a, b] = Object.entries(record.partners)[0] as [string, string];
    expect(partnerCount(index, a, b)).toBe(2);
    expect(groupmateCount(index, 's01', 's02')).toBe(2);
    expect(groupmateCount(index, 's01', 's04')).toBe(0);
  });

  it('weights recent arrangements more heavily than old ones', () => {
    const older: ArrangementRecord = { ...record, id: 'old', date: '2026-01-01' };
    const index = buildHistoryIndex([record, older]);
    const key = [...index.groupmate.keys()].find((k) => k.includes('s01') && k.includes('s02'));
    // 1 (newest) + 1/2 (previous) = 1.5, so recency is doing something.
    expect(index.groupmate.get(key as string)).toBeCloseTo(1.5, 5);
  });

  it('respects the "only look back N times" limit', () => {
    const index = buildHistoryIndex(
      [record, { ...record, id: 'r2', date: '2026-07-01' }, { ...record, id: 'r3', date: '2026-06-01' }],
      1,
    );
    expect(index.recordCount).toBe(1);
  });

  it('scores how often a student ends up at the back of the room', () => {
    const index = buildHistoryIndex([record]);
    const rowOf = (seatId: string) => classroom.seats.find((s) => s.id === seatId)?.row;
    const fairness = seatFairness(index, rowOf, classroom.rows);
    // The first student sat in row 0, so their score is the lowest possible.
    expect(fairness.get('s01')).toBe(0);
    expect(fairness.get('s12')).toBe(1);
  });
});

describe('matching an old record to a re-imported roster', () => {
  const students = makeStudents(5);
  const record = buildRecord({
    classroom,
    students,
    assignment: seatEveryone(students),
    grouping: null,
    seed: 1,
    includeNames: true,
  });

  it('matches by UUID inside the same project', () => {
    const report = matchRecordToRoster(record, students);
    expect(report.matchedById).toBe(5);
    expect(report.unmatched).toEqual([]);
  });

  it('falls back to the attendance number after a re-import', () => {
    // Same class, freshly imported, so every id is new.
    const reimported = students.map((student, i) => ({ ...student, id: `new-${i}` }));
    const report = matchRecordToRoster(record, reimported);
    expect(report.matchedById).toBe(0);
    expect(report.matchedByNumber).toBe(5);
    expect(report.mapping['s01']).toBe('new-0');
  });

  it('refuses to match two students who share a name', () => {
    const ambiguous: Student[] = [
      { ...makeStudents(1)[0]!, id: 'x1', number: null, name: '학생01' },
      { ...makeStudents(1)[0]!, id: 'x2', number: null, name: '학생01' },
    ];
    const report = matchRecordToRoster(record, ambiguous, { allowNameMatch: true });
    // Neither candidate can be chosen, so the entry is left for the teacher.
    expect(report.mapping['s01']).toBeUndefined();
    expect(report.unmatched).toContain('s01');
  });

  it('rewrites a record through the mapping', () => {
    const reimported = students.map((student, i) => ({ ...student, id: `new-${i}` }));
    const { mapping } = matchRecordToRoster(record, reimported);
    const remapped = remapRecord(record, mapping);
    expect(Object.values(remapped.seatAssignment)).toContain('new-0');
    expect(Object.values(remapped.seatAssignment)).not.toContain('s01');
  });
});

describe('backup round trip', () => {
  const students = makeStudents(6).map((student, i) => ({
    ...student,
    gender: (i % 2 === 0 ? 'male' : 'female') as Student['gender'],
    teacherMemo: `메모${i}`,
    tags: ['리더'],
  }));
  const assignment = seatEveryone(students);

  it('restores everything the teacher copy carried', () => {
    const backup = buildBackup(
      { meta: null, students, classroom, constraints: [], assignment, grouping: null, history: [], seed: 77 },
      TEACHER_FACING,
    );
    const restored = parseBackup(JSON.stringify(backup));

    expect(restored.students).toHaveLength(6);
    expect(restored.students[0]?.name).toBe('학생01');
    expect(restored.students[0]?.gender).toBe('male');
    expect(restored.students[0]?.teacherMemo).toBe('메모0');
    expect(restored.seed).toBe(77);
    expect(restored.assignment).toEqual(assignment);
  });

  it('restores a student-facing backup with gender unset rather than guessed', () => {
    const backup = buildBackup(
      { meta: null, students, classroom, constraints: [], assignment, grouping: null, history: [], seed: 1 },
      { ...TEACHER_FACING, includeGender: false, includeTeacherMemo: false },
    );
    const restored = parseBackup(JSON.stringify(backup));
    expect(restored.students.every((s) => s.gender === 'unset')).toBe(true);
    expect(restored.students.every((s) => s.teacherMemo === undefined)).toBe(true);
  });

  it('rejects a file from another program with a usable message', () => {
    expect(() => parseBackup('{"hello":1}')).toThrow(BackupParseError);
    expect(() => parseBackup('not json at all')).toThrow(BackupParseError);
    try {
      parseBackup('{"app":"seat-planner","schemaVersion":999}');
    } catch (error) {
      expect((error as Error).message).toContain('새로운 버전');
    }
  });
});

describe('reading a previous arrangement back out of an exported workbook', () => {
  it('rebuilds a history record from the 과거배치용데이터 sheet', () => {
    const students = makeStudents(6);
    const assignment = seatEveryone(students);
    const grouping = {
      excludedIds: [],
      groups: [
        { id: 'g1', index: 1, colorIndex: 1, memberIds: ['s01', 's02', 's03'], roles: {}, locked: false },
        { id: 'g2', index: 2, colorIndex: 2, memberIds: ['s04', 's05', 's06'], roles: {}, locked: false },
      ],
    };

    const bytes = workbookToBytes(
      buildWorkbook(
        {
          meta: null,
          students,
          classroom,
          assignment,
          grouping,
          constraints: [],
          seed: 5,
          viewpointLabel: '교사 관점',
        },
        TEACHER_FACING,
      ),
    );

    const record = readHistorySheet(bytes, students, '2026-08-12');
    expect(record).not.toBeNull();
    expect(record?.groupOf['s01']).toBe(1);
    expect(record?.groupOf['s05']).toBe(2);
    expect(Object.keys(record?.seatAssignment ?? {})).toHaveLength(6);
  });

  it('returns null for a workbook that has no such sheet', () => {
    const bytes = workbookToBytes(
      buildWorkbook(
        {
          meta: null,
          students: [],
          classroom,
          assignment: {},
          grouping: null,
          constraints: [],
          seed: 1,
          viewpointLabel: '교사 관점',
        },
        TEACHER_FACING,
      ),
    );
    // The sheet exists but holds no student rows, so there is nothing to load.
    expect(readHistorySheet(bytes, [], '2026-08-12')).toBeNull();
  });
});

describe('mergeRecords', () => {
  const record = (id: string, date: string): ArrangementRecord => ({
    schemaVersion: 1,
    id,
    date,
    students: [],
    seatAssignment: {},
    partners: {},
    neighbors: {},
    groupOf: {},
    seed: 1,
  });

  it('keeps both sides instead of replacing one with the other', () => {
    // Restoring a backup replaces history outright, so a teacher with one file
    // per term could only ever use the newest. This is the path that lets a
    // whole year accumulate.
    const merged = mergeRecords([record('a', '2026-03-02')], [record('b', '2026-05-10')]);
    expect(merged.records.map((r) => r.id)).toEqual(['b', 'a']);
    expect(merged.added).toBe(1);
    expect(merged.duplicates).toBe(0);
  });

  it('counts the same arrangement once however often it is imported', () => {
    const first = mergeRecords([], [record('a', '2026-03-02')]);
    const again = mergeRecords(first.records, [record('a', '2026-03-02')]);

    expect(again.records).toHaveLength(1);
    expect(again.added).toBe(0);
    expect(again.duplicates).toBe(1);
  });

  it('returns records newest first, whatever order they arrived in', () => {
    const merged = mergeRecords(
      [record('old', '2025-09-01'), record('new', '2026-07-01')],
      [record('mid', '2026-01-15')],
    );
    expect(merged.records.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('makes the merged history usable by the index', () => {
    const merged = mergeRecords([record('a', '2026-03-02')], [record('b', '2026-05-10')]);
    expect(buildHistoryIndex(merged.records).recordCount).toBe(2);
  });
});
