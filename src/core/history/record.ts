/**
 * Turning the current arrangement into a history record, and matching an old
 * record onto a freshly imported roster.
 */

import { neighbourStudents, partnerPairs } from '../layout/adjacency';
import { uuid } from '../model/ids';
import type {
  ArrangementRecord,
  Classroom,
  Grouping,
  SeatAssignment,
  Student,
} from '../model/types';
import { SCHEMA_VERSION } from '../model/types';

export interface RecordInput {
  classroom: Classroom;
  students: readonly Student[];
  assignment: SeatAssignment;
  grouping: Grouping | null;
  seed: number;
  date?: string;
  label?: string;
  grade?: number;
  classNumber?: string;
  /** Names are stored only when the teacher wants cross-file matching. */
  includeNames?: boolean;
}

export function buildRecord(input: RecordInput): ArrangementRecord {
  const groupOf: Record<string, number> = {};
  for (const group of input.grouping?.groups ?? []) {
    for (const memberId of group.memberIds) groupOf[memberId] = group.index;
  }

  const record: ArrangementRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: uuid(),
    date: input.date ?? new Date().toISOString().slice(0, 10),
    students: input.students.map((student) =>
      input.includeNames
        ? { id: student.id, number: student.number, name: student.name }
        : { id: student.id, number: student.number },
    ),
    seatAssignment: { ...input.assignment },
    partners: partnerPairs(input.classroom, input.assignment),
    groupOf,
    neighbors: neighbourStudents(input.classroom, input.assignment),
    seed: input.seed,
  };
  if (input.label !== undefined) record.label = input.label;
  if (input.grade !== undefined) record.grade = input.grade;
  if (input.classNumber !== undefined) record.classNumber = input.classNumber;
  return record;
}

export interface MatchReport {
  /** Old student id → current student id. */
  mapping: Record<string, string>;
  matchedById: number;
  matchedByNumber: number;
  unmatched: string[];
}

/**
 * Links a stored record to the current roster.
 *
 * Order matters and names are last on purpose: within one project the UUID is
 * authoritative; across a re-import the attendance number is the next best
 * anchor; a name is only ever a hint, because two students can share one.
 */
export function matchRecordToRoster(
  record: ArrangementRecord,
  students: readonly Student[],
  { allowNameMatch = false }: { allowNameMatch?: boolean } = {},
): MatchReport {
  const mapping: Record<string, string> = {};
  const byId = new Map(students.map((s) => [s.id, s]));
  const byNumber = new Map<number, Student[]>();
  const byName = new Map<string, Student[]>();
  for (const student of students) {
    if (student.number !== null) {
      const list = byNumber.get(student.number) ?? [];
      list.push(student);
      byNumber.set(student.number, list);
    }
    const key = student.name.replace(/\s/g, '');
    const nameList = byName.get(key) ?? [];
    nameList.push(student);
    byName.set(key, nameList);
  }

  let matchedById = 0;
  let matchedByNumber = 0;
  const unmatched: string[] = [];
  const claimed = new Set<string>();

  for (const entry of record.students) {
    if (byId.has(entry.id) && !claimed.has(entry.id)) {
      mapping[entry.id] = entry.id;
      claimed.add(entry.id);
      matchedById += 1;
      continue;
    }
    if (entry.number !== null) {
      const candidates = (byNumber.get(entry.number) ?? []).filter((s) => !claimed.has(s.id));
      if (candidates.length === 1) {
        const target = candidates[0] as Student;
        mapping[entry.id] = target.id;
        claimed.add(target.id);
        matchedByNumber += 1;
        continue;
      }
    }
    if (allowNameMatch && entry.name) {
      const candidates = (byName.get(entry.name.replace(/\s/g, '')) ?? []).filter(
        (s) => !claimed.has(s.id),
      );
      // Only an unambiguous single match is accepted; two students with the
      // same name are left for the teacher to resolve.
      if (candidates.length === 1) {
        const target = candidates[0] as Student;
        mapping[entry.id] = target.id;
        claimed.add(target.id);
        matchedByNumber += 1;
        continue;
      }
    }
    unmatched.push(entry.id);
  }

  return { mapping, matchedById, matchedByNumber, unmatched };
}

/** Rewrites a record's student ids through a mapping produced above. */
export function remapRecord(record: ArrangementRecord, mapping: Record<string, string>): ArrangementRecord {
  const map = (id: string): string | undefined => mapping[id];

  const seatAssignment: SeatAssignment = {};
  for (const [seatId, studentId] of Object.entries(record.seatAssignment)) {
    const next = map(studentId);
    if (next) seatAssignment[seatId] = next;
  }

  const partners: Record<string, string> = {};
  for (const [a, b] of Object.entries(record.partners)) {
    const na = map(a);
    const nb = map(b);
    if (na && nb) partners[na] = nb;
  }

  const groupOf: Record<string, number> = {};
  for (const [studentId, index] of Object.entries(record.groupOf)) {
    const next = map(studentId);
    if (next) groupOf[next] = index;
  }

  const neighbors: Record<string, string[]> = {};
  for (const [studentId, list] of Object.entries(record.neighbors)) {
    const next = map(studentId);
    if (!next) continue;
    neighbors[next] = list.map(map).filter((id): id is string => id !== undefined);
  }

  return {
    ...record,
    students: record.students
      .map((entry) => {
        const next = map(entry.id);
        return next ? { ...entry, id: next } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    seatAssignment,
    partners,
    groupOf,
    neighbors,
  };
}
