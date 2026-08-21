/**
 * Application state.
 *
 * Everything student-related lives here, in memory only. Nothing is written to
 * disk unless the teacher switches saving on and presses the save button, and
 * nothing is ever sent anywhere.
 */

import { create } from 'zustand';

import type { Constraint } from '@/core/constraints/kinds';
import { mergeRecords } from '@/core/history';
import { buildRecord, sameArrangement } from '@/core/history/record';
import { createClassroom, retagZones, seatsOf } from '@/core/layout/grid';
import { regroupFromSeats } from '@/core/layout/groupIslands';
import { uuid } from '@/core/model/ids';
import type {
  ArrangementRecord,
  Classroom,
  Grouping,
  RosterMeta,
  SeatAssignment,
  Student,
  StudentStatus,
  Viewpoint,
} from '@/core/model/types';
import { isPlaceable } from '@/core/model/types';
import type { Effort } from '@/core/solver/seating';
import { randomSeed } from '@/core/solver/rng';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/lib/storage';

export type Step = 'import' | 'roster' | 'classroom' | 'rules' | 'generate' | 'result';

export const STEP_ORDER: Step[] = ['import', 'roster', 'classroom', 'rules', 'generate', 'result'];

export const STEP_LABELS: Record<Step, string> = {
  import: '명렬표 불러오기',
  roster: '학생 명단',
  classroom: '교실 만들기',
  rules: '조건 정하기',
  generate: '자리 만들기',
  result: '결과 보기',
};

export type GenerateMode = 'seats' | 'pairs' | 'groups' | 'groupSeats';

/**
 * Choices made on the «자리 만들기» screen.
 *
 * These live in the store rather than in the screen's own state so that going
 * back to fix a student's name does not silently throw away the group settings
 * the teacher just entered.
 */
export interface GenerateOptions {
  mode: GenerateMode;
  sizeMode: 'byCount' | 'bySize';
  groupCount: number;
  targetSize: number;
  minSize: number;
  maxSize: number;
  /** Explicit group sizes chosen from the alternatives, if any. */
  chosenPlan: number[] | null;
  oddStrategy: 'alone' | 'trio' | 'teacherPicks';
  keepLocked: boolean;
  /**
   * Rebuild the classroom as one island of desks per group before seating.
   * On by default: choosing «모둠 + 자리 배치» and getting groups scattered
   * across a plain grid is never what a teacher meant.
   */
  autoGroupRoom: boolean;
  /** Empty seats between islands — how far apart the groups sit. */
  groupGap: number;
}

const DEFAULT_GENERATE: GenerateOptions = {
  mode: 'seats',
  sizeMode: 'byCount',
  groupCount: 6,
  targetSize: 4,
  minSize: 3,
  maxSize: 5,
  chosenPlan: null,
  oddStrategy: 'alone',
  keepLocked: true,
  autoGroupRoom: true,
  groupGap: 1,
};

/** The slice of state that undo/redo restores. */
interface Snapshot {
  students: Student[];
  classroom: Classroom;
  constraints: Constraint[];
  assignment: SeatAssignment;
  grouping: Grouping | null;
}

interface AppState extends Snapshot {
  step: Step;
  meta: RosterMeta | null;
  history: ArrangementRecord[];
  seed: number;
  effort: Effort;
  settings: Settings;
  generate: GenerateOptions;
  /** Seats the teacher has pinned before a re-generation. */
  lockedSeatIds: string[];
  dirty: boolean;

  past: Snapshot[];
  future: Snapshot[];

  // --- navigation -------------------------------------------------------
  setStep: (step: Step) => void;

  // --- roster -----------------------------------------------------------
  loadRoster: (students: Student[], meta: RosterMeta | null) => void;
  addStudent: () => void;
  updateStudent: (id: string, patch: Partial<Student>) => void;
  removeStudent: (id: string) => void;
  setStatus: (id: string, status: StudentStatus, note?: string) => void;
  restoreStudent: (id: string) => void;
  /** Applies a whole-class 구분1/구분2 split as one undoable step. */
  applyDivisions: (divisions: Record<string, 'a' | 'b'>) => void;
  swapDivisions: () => void;
  clearDivisions: () => void;

  // --- classroom --------------------------------------------------------
  setClassroom: (classroom: Classroom) => void;
  resizeClassroom: (rows: number, cols: number, pairDesks: boolean) => void;
  toggleSeatKind: (seatId: string) => void;
  toggleSeatLock: (seatId: string) => void;

  // --- rules ------------------------------------------------------------
  addConstraint: (constraint: Constraint) => void;
  updateConstraint: (id: string, patch: Partial<Constraint>) => void;
  removeConstraint: (id: string) => void;

  // --- results ----------------------------------------------------------
  setAssignment: (assignment: SeatAssignment) => void;
  setGrouping: (grouping: Grouping | null) => void;
  swapSeats: (seatA: string, seatB: string) => void;
  moveStudentToSeat: (studentId: string, seatId: string) => void;
  setSeed: (seed: number) => void;
  rerollSeed: () => void;
  setEffort: (effort: Effort) => void;
  setGenerateOptions: (patch: Partial<GenerateOptions>) => void;

  // --- history ----------------------------------------------------------
  /** Returns false when this exact arrangement is already recorded. */
  recordCurrent: (label?: string) => boolean;
  addHistoryRecord: (record: ArrangementRecord) => void;
  removeHistoryRecord: (id: string) => void;

  // --- settings ---------------------------------------------------------
  updateSettings: (patch: Partial<Settings>) => void;
  setViewpoint: (viewpoint: Viewpoint) => void;
  /** Returns settings to the safe defaults without writing to disk. */
  resetSettings: () => void;

  // --- undo -------------------------------------------------------------
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // --- lifecycle --------------------------------------------------------
  clearAll: () => void;
  markSaved: () => void;
  hydrate: (payload: Partial<Snapshot> & { meta?: RosterMeta | null; history?: ArrangementRecord[]; seed?: number }) => void;
  /** Folds records from another backup in, keeping the ones already held. */
  mergeHistory: (records: readonly ArrangementRecord[]) => { added: number; duplicates: number };
}

const UNDO_LIMIT = 40;

/**
 * Keeps group membership in step with the seating after a manual move.
 *
 * Only applies to island rooms; in an ordinary grid the seats say nothing
 * about groups, so swapping two students must leave their groups alone.
 */
function regroupPatch(
  state: { classroom: Classroom; grouping: Grouping | null },
  assignment: SeatAssignment,
): { grouping?: Grouping } {
  if (!state.grouping) return {};
  const regrouped = regroupFromSeats(state.classroom, assignment, state.grouping);
  return regrouped === state.grouping ? {} : { grouping: regrouped };
}

function snapshotOf(state: Snapshot): Snapshot {
  return {
    students: state.students.map((s) => ({ ...s, tags: [...s.tags], customFields: { ...s.customFields } })),
    classroom: { ...state.classroom, seats: state.classroom.seats.map((s) => ({ ...s, zones: [...s.zones] })) },
    constraints: state.constraints.map((c) => ({ ...c })),
    assignment: { ...state.assignment },
    grouping: state.grouping
      ? {
          excludedIds: [...state.grouping.excludedIds],
          groups: state.grouping.groups.map((g) => ({ ...g, memberIds: [...g.memberIds], roles: { ...g.roles } })),
        }
      : null,
  };
}

function emptyStudent(number: number): Student {
  return {
    id: uuid(),
    number,
    name: '',
    gender: 'unset',
    division: 'unset',
    status: 'active',
    tags: [],
    customFields: {},
  };
}

export const useAppStore = create<AppState>()((set, get) => {
  /** Wraps a mutation so it is undoable and marks the project as unsaved. */
  const mutate = (fn: (state: AppState) => Partial<AppState>) => {
    set((state) => {
      const past = [...state.past, snapshotOf(state)];
      if (past.length > UNDO_LIMIT) past.shift();
      return { ...fn(state), past, future: [], dirty: true };
    });
  };

  return {
    step: 'import',
    students: [],
    meta: null,
    classroom: createClassroom({ rows: 5, cols: 6, pairDesks: true }),
    constraints: [],
    assignment: {},
    grouping: null,
    history: [],
    seed: randomSeed(),
    effort: 'balanced',
    settings: DEFAULT_SETTINGS,
    generate: DEFAULT_GENERATE,
    lockedSeatIds: [],
    dirty: false,
    past: [],
    future: [],

    setStep: (step) => set({ step }),

    loadRoster: (students, meta) =>
      mutate(() => ({
        students,
        meta,
        assignment: {},
        grouping: null,
        constraints: [],
        step: 'roster' as Step,
      })),

    addStudent: () =>
      mutate((state) => {
        const highest = state.students.reduce((max, s) => Math.max(max, s.number ?? 0), 0);
        return { students: [...state.students, emptyStudent(highest + 1)] };
      }),

    updateStudent: (id, patch) =>
      mutate((state) => ({
        students: state.students.map((student) =>
          student.id === id ? { ...student, ...patch } : student,
        ),
      })),

    removeStudent: (id) =>
      mutate((state) => {
        const assignment = { ...state.assignment };
        for (const [seatId, studentId] of Object.entries(assignment)) {
          if (studentId === id) delete assignment[seatId];
        }
        return {
          students: state.students.filter((student) => student.id !== id),
          assignment,
          // Rules that name a removed student would otherwise linger invisibly.
          constraints: state.constraints.filter((constraint) => {
            if ('studentId' in constraint) return constraint.studentId !== id;
            if ('studentIds' in constraint) return !constraint.studentIds.includes(id);
            return true;
          }),
          grouping: state.grouping
            ? {
                ...state.grouping,
                groups: state.grouping.groups.map((group) => ({
                  ...group,
                  memberIds: group.memberIds.filter((memberId) => memberId !== id),
                })),
              }
            : null,
        };
      }),

    setStatus: (id, status, note) =>
      mutate((state) => {
        const assignment = { ...state.assignment };
        const students = state.students.map((student) => {
          if (student.id !== id) return student;
          const next: Student = { ...student, status };
          if (note !== undefined) next.excludeNote = note;

          if (status !== 'active') {
            // Remember the seat so a returning student can be put back.
            const seatId = Object.entries(assignment).find(([, sid]) => sid === id)?.[0];
            if (seatId) {
              next.lastSeatId = seatId;
              delete assignment[seatId];
            }
          }
          return next;
        });

        const grouping = state.grouping
          ? {
              ...state.grouping,
              groups: state.grouping.groups.map((group) => ({
                ...group,
                memberIds:
                  status === 'active'
                    ? group.memberIds
                    : group.memberIds.filter((memberId) => memberId !== id),
              })),
              excludedIds:
                status === 'active'
                  ? state.grouping.excludedIds.filter((memberId) => memberId !== id)
                  : [...new Set([...state.grouping.excludedIds, id])],
            }
          : null;

        return { students, assignment, grouping };
      }),

    restoreStudent: (id) =>
      mutate((state) => {
        const student = state.students.find((s) => s.id === id);
        const assignment = { ...state.assignment };
        // Put them back in their old seat, but only if nobody took it.
        if (student?.lastSeatId && assignment[student.lastSeatId] === undefined) {
          assignment[student.lastSeatId] = id;
        }
        return {
          students: state.students.map((s) =>
            s.id === id ? { ...s, status: 'active' as StudentStatus, excludeNote: undefined } : s,
          ),
          assignment,
        };
      }),

    applyDivisions: (divisions) =>
      mutate((state) => ({
        students: state.students.map((student) => {
          const side = divisions[student.id];
          return side === undefined ? student : { ...student, division: side };
        }),
      })),

    swapDivisions: () =>
      mutate((state) => ({
        students: state.students.map((student) =>
          student.division === 'a'
            ? { ...student, division: 'b' as const }
            : student.division === 'b'
              ? { ...student, division: 'a' as const }
              : student,
        ),
      })),

    clearDivisions: () =>
      mutate((state) => ({
        students: state.students.map((student) => ({ ...student, division: 'unset' as const })),
      })),

    setClassroom: (classroom) => mutate(() => ({ classroom })),

    resizeClassroom: (rows, cols, pairDesks) =>
      mutate((state) => {
        const classroom = createClassroom({
          rows,
          cols,
          pairDesks,
          windowSide: state.classroom.windowSide,
          name: state.classroom.name,
        });
        // Seat ids change, so any arrangement referring to the old ones goes.
        return { classroom, assignment: {}, lockedSeatIds: [] };
      }),

    toggleSeatKind: (seatId) =>
      mutate((state) => {
        const classroom = {
          ...state.classroom,
          seats: state.classroom.seats.map((seat) =>
            seat.id === seatId
              ? { ...seat, kind: seat.kind === 'seat' ? ('disabled' as const) : ('seat' as const) }
              : seat,
          ),
        };
        retagZones(classroom);
        const assignment = { ...state.assignment };
        delete assignment[seatId];
        return { classroom, assignment };
      }),

    toggleSeatLock: (seatId) =>
      set((state) => ({
        lockedSeatIds: state.lockedSeatIds.includes(seatId)
          ? state.lockedSeatIds.filter((id) => id !== seatId)
          : [...state.lockedSeatIds, seatId],
      })),

    addConstraint: (constraint) =>
      mutate((state) => ({ constraints: [...state.constraints, constraint] })),

    updateConstraint: (id, patch) =>
      mutate((state) => ({
        constraints: state.constraints.map((constraint) =>
          constraint.id === id ? ({ ...constraint, ...patch } as Constraint) : constraint,
        ),
      })),

    removeConstraint: (id) =>
      mutate((state) => ({ constraints: state.constraints.filter((c) => c.id !== id) })),

    setAssignment: (assignment) => mutate(() => ({ assignment })),
    setGrouping: (grouping) => mutate(() => ({ grouping })),

    swapSeats: (seatA, seatB) =>
      mutate((state) => {
        const assignment = { ...state.assignment };
        const a = assignment[seatA];
        const b = assignment[seatB];
        if (a === undefined && b === undefined) return {};
        if (a === undefined) {
          assignment[seatA] = b as string;
          delete assignment[seatB];
        } else if (b === undefined) {
          assignment[seatB] = a;
          delete assignment[seatA];
        } else {
          assignment[seatA] = b;
          assignment[seatB] = a;
        }
        // In an island room the seat decides the group, so membership follows
        // the move. Otherwise a swapped pair keeps its old colours and the map
        // shows two students sitting where they visibly do not belong.
        return { assignment, ...regroupPatch(state, assignment) };
      }),

    moveStudentToSeat: (studentId, seatId) =>
      mutate((state) => {
        const assignment = { ...state.assignment };
        const from = Object.entries(assignment).find(([, sid]) => sid === studentId)?.[0];
        const displaced = assignment[seatId];
        assignment[seatId] = studentId;
        if (from && from !== seatId) {
          if (displaced) assignment[from] = displaced;
          else delete assignment[from];
        }
        return { assignment, ...regroupPatch(state, assignment) };
      }),

    setSeed: (seed) => set({ seed }),
    rerollSeed: () => set({ seed: randomSeed() }),
    setEffort: (effort) => set({ effort }),
    setGenerateOptions: (patch) =>
      set((state) => ({ generate: { ...state.generate, ...patch } })),

    recordCurrent: (label) => {
      const state = get();
      const record = buildRecord({
        classroom: state.classroom,
        students: state.students,
        assignment: state.assignment,
        grouping: state.grouping,
        seed: state.seed,
        label,
        grade: state.meta?.grade,
        classNumber: state.meta?.classNumber,
      });

      // Recording the same arrangement twice would make it weigh twice in the
      // next «지난 짝 피하기», which is worse than the duplicate itself.
      if (state.history.some((existing) => sameArrangement(existing, record))) return false;

      set({ history: [...state.history, record] });
      return true;
    },

    addHistoryRecord: (record) => set((state) => ({ history: [...state.history, record] })),
    removeHistoryRecord: (id) =>
      set((state) => ({ history: state.history.filter((record) => record.id !== id) })),

    updateSettings: (patch) =>
      set((state) => {
        const settings = { ...state.settings, ...patch };
        saveSettings(settings);
        return { settings };
      }),

    setViewpoint: (viewpoint) => {
      const settings = { ...get().settings, viewpoint };
      saveSettings(settings);
      set({ settings });
    },

    // Deliberately does not persist: this runs right after «모든 정보 삭제»,
    // and writing the settings back would recreate a key that was just wiped.
    resetSettings: () => set({ settings: DEFAULT_SETTINGS }),

    undo: () =>
      set((state) => {
        const previous = state.past[state.past.length - 1];
        if (!previous) return {};
        return {
          ...previous,
          past: state.past.slice(0, -1),
          future: [snapshotOf(state), ...state.future].slice(0, UNDO_LIMIT),
          dirty: true,
        };
      }),

    redo: () =>
      set((state) => {
        const next = state.future[0];
        if (!next) return {};
        return {
          ...next,
          past: [...state.past, snapshotOf(state)],
          future: state.future.slice(1),
          dirty: true,
        };
      }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    clearAll: () =>
      set({
        step: 'import',
        students: [],
        meta: null,
        classroom: createClassroom({ rows: 5, cols: 6, pairDesks: true }),
        constraints: [],
        assignment: {},
        grouping: null,
        history: [],
        lockedSeatIds: [],
        generate: DEFAULT_GENERATE,
        past: [],
        future: [],
        dirty: false,
        seed: randomSeed(),
      }),

    markSaved: () => set({ dirty: false }),

    mergeHistory: (records) => {
      const merged = mergeRecords(get().history, records);
      mutate(() => ({ history: merged.records }));
      return { added: merged.added, duplicates: merged.duplicates };
    },

    hydrate: (payload) =>
      set((state) => ({
        students: payload.students ?? state.students,
        classroom: payload.classroom ?? state.classroom,
        constraints: payload.constraints ?? state.constraints,
        assignment: payload.assignment ?? state.assignment,
        grouping: payload.grouping ?? state.grouping,
        meta: payload.meta !== undefined ? payload.meta : state.meta,
        history: payload.history ?? state.history,
        seed: payload.seed ?? state.seed,
        past: [],
        future: [],
        dirty: false,
      })),
  };
});

/** Settings are read once at start-up; they contain no personal data. */
export function initSettings(): void {
  useAppStore.setState({ settings: loadSettings() });
}

// --- selectors -------------------------------------------------------------

export const selectPlaceable = (state: AppState): Student[] => state.students.filter(isPlaceable);
export const selectExcluded = (state: AppState): Student[] =>
  state.students.filter((student) => !isPlaceable(student));
export const selectSeatCount = (state: AppState): number => seatsOf(state.classroom).length;
