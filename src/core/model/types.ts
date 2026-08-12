/**
 * Domain types for the seat planner.
 *
 * Everything in `src/core` is pure TypeScript: no React, no DOM, no browser
 * globals. That keeps the logic unit-testable in Node and directly runnable
 * inside a Web Worker.
 */

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

/**
 * Gender is **never inferred from a name**. It stays `'unset'` unless a teacher
 * types it in or maps a spreadsheet column to it. Every feature that uses
 * gender has to work correctly when most students are `'unset'`.
 */
export type Gender = 'male' | 'female' | 'other' | 'undisclosed' | 'unset';

export const GENDER_LABELS: Record<Gender, string> = {
  male: '남',
  female: '여',
  other: '기타',
  undisclosed: '비공개',
  unset: '미지정',
};

/**
 * Why a student is or is not part of the current arrangement.
 *
 * Only `'active'` students receive seats and are counted when group sizes are
 * calculated. `'absentToday'` is the one status that remembers the previous
 * seat, so a returning student can be put back where they were.
 */
export type StudentStatus =
  | 'active'
  | 'transferOut'
  | 'withdrawn'
  | 'absentLong'
  | 'absentToday'
  | 'excludedOther';

export const STATUS_LABELS: Record<StudentStatus, string> = {
  active: '배치 대상',
  transferOut: '전출',
  withdrawn: '자퇴',
  absentLong: '장기결석',
  absentToday: '오늘 결석',
  excludedOther: '기타 제외',
};

/** Statuses that keep a student out of seating and group-size calculations. */
export const EXCLUDED_STATUSES: readonly StudentStatus[] = [
  'transferOut',
  'withdrawn',
  'absentLong',
  'absentToday',
  'excludedOther',
];

export interface Student {
  /** Stable UUID. The only identity key — names are display data and may repeat. */
  id: string;
  /** Attendance number. `null` when the source cell was empty or unparseable. */
  number: number | null;
  name: string;
  grade?: number;
  department?: string;
  classNumber?: string;
  gender: Gender;
  status: StudentStatus;
  /** Teacher-only note about why the student is excluded. Never exported by default. */
  excludeNote?: string;
  /** Seat held before the student was excluded, so it can be restored on return. */
  lastSeatId?: string;
  tags: string[];
  /** Teacher-only. Excluded from every export unless explicitly opted in. */
  teacherMemo?: string;
  /** Teacher-only. Excluded from every export unless explicitly opted in. */
  accessibilityNeeds?: string;
  customFields: Record<string, string>;
}

export function isPlaceable(student: Student): boolean {
  return student.status === 'active';
}

// ---------------------------------------------------------------------------
// Classroom geometry
// ---------------------------------------------------------------------------

/**
 * Which way a seated student faces, in canonical coordinates.
 * `'front'` means facing the board (row 0 side).
 */
export type Facing = 'front' | 'back' | 'left' | 'right';

export type SeatKind = 'seat' | 'aisle' | 'disabled';

export type ZoneTag = 'window' | 'corridor' | 'frontRow' | 'backRow';

export const ZONE_LABELS: Record<ZoneTag, string> = {
  window: '창가',
  corridor: '복도',
  frontRow: '앞자리',
  backRow: '뒷자리',
};

/**
 * A cell of the classroom grid.
 *
 * Canonical coordinates are always **the student's point of view**:
 * `row 0` is the row nearest the board / teacher's desk, and columns run
 * left-to-right as a student sitting in the room would see them. The teacher's
 * point of view is produced at render time by a 180° rotation and never
 * changes stored data. See `core/layout/viewpoint.ts`.
 */
export interface Seat {
  id: string;
  row: number;
  col: number;
  kind: SeatKind;
  /** Groups two or more seats into one physical desk (짝꿍 책상). */
  deskId?: string;
  /** Assigns the seat to a 모둠 island. */
  groupSlot?: number;
  facing: Facing;
  zones: ZoneTag[];
  /** A locked seat keeps its occupant through re-generation. */
  locked: boolean;
  /** Free-form label shown to the teacher only. */
  label?: string;
}

export type BoardSide = 'front';

export interface Classroom {
  id: string;
  name: string;
  rows: number;
  cols: number;
  seats: Seat[];
  /**
   * Which side of the room has windows.
   *
   * Unlike a decorative marker this earns its place: it drives the
   * window / corridor zone tags that «창가에 앉히기» rules depend on.
   */
  windowSide: 'left' | 'right' | 'none';
}

/** Rendering-only preference. Does not affect any stored coordinate. */
export type Viewpoint = 'student' | 'teacher';

export const VIEWPOINT_LABELS: Record<Viewpoint, string> = {
  student: '학생 관점',
  teacher: '교사 관점',
};

export const VIEWPOINT_HINTS: Record<Viewpoint, string> = {
  student: '학생이 자기 자리에 앉아 칠판을 바라본 모습입니다. 칠판이 화면 위쪽에 있습니다.',
  teacher: '교사가 교탁에서 학생들을 바라본 모습입니다. 칠판이 화면 아래쪽에 있고 좌우가 뒤집힙니다.',
};

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/** seatId → studentId. Seats missing from the map are empty. */
export type SeatAssignment = Record<string, string>;

export interface Group {
  id: string;
  /** 1-based number shown to students. */
  index: number;
  name?: string;
  colorIndex: number;
  memberIds: string[];
  /** studentId → role label (발표, 기록 …). Teacher decides whether to publish. */
  roles: Record<string, string>;
  locked: boolean;
}

export interface Grouping {
  groups: Group[];
  /** Students left out because they are not `'active'`. */
  excludedIds: string[];
}

// ---------------------------------------------------------------------------
// Arrangement history
// ---------------------------------------------------------------------------

export interface ArrangementRecord {
  schemaVersion: number;
  id: string;
  /** ISO date, no time — a date is enough and leaks less. */
  date: string;
  label?: string;
  grade?: number;
  classNumber?: string;
  /** Identity anchors so a record can be matched to a freshly imported roster. */
  students: Array<{
    id: string;
    number: number | null;
    /** Stored only when the teacher opts into name-based matching. */
    name?: string;
  }>;
  seatAssignment: SeatAssignment;
  /** studentId → studentId, symmetric. */
  partners: Record<string, string>;
  /** studentId → group index. */
  groupOf: Record<string, number>;
  /** studentId → list of studentIds that sat orthogonally adjacent. */
  neighbors: Record<string, string[]>;
  seed: number;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1;

export interface RosterMeta {
  schoolName?: string;
  subject?: string;
  grade?: number;
  classNumber?: string;
  teacherName?: string;
  createdOn?: string;
  periods?: string;
  sheetName?: string;
}
