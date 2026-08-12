/**
 * The classroom drawing.
 *
 * The only place in the app where the teacher / student point of view is
 * applied. Everything it receives is in canonical coordinates; the rotation
 * happens here and nowhere else, so no result can change when the view flips.
 */

import { useMemo } from 'react';

import { boardPlacement, seatsInDisplayOrder, teacherDeskPlacement, windowPlacement } from '@/core/layout/viewpoint';
import type { Classroom, Grouping, SeatAssignment, Seat, Student, Viewpoint } from '@/core/model/types';
import { VIEWPOINT_HINTS, VIEWPOINT_LABELS } from '@/core/model/types';
import { LockIcon } from './Icons';

export interface SeatMapProps {
  classroom: Classroom;
  assignment: SeatAssignment;
  students: readonly Student[];
  viewpoint: Viewpoint;
  grouping?: Grouping | null;
  /** Seats whose occupant is pinned for the next generation. */
  lockedSeatIds?: readonly string[];
  /** Seat ids whose names are hidden in the reveal mode. */
  hiddenSeatIds?: ReadonlySet<string>;
  showNames?: boolean;
  showNumbers?: boolean;
  /** Seat currently picked for a swap. */
  selectedSeatId?: string | null;
  highlightStudentIds?: ReadonlySet<string>;
  onSeatClick?: (seat: Seat) => void;
  /** Larger cards, for the projector. */
  presentation?: boolean;
  className?: string;
}

const GROUP_COLORS = [
  '#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00',
  '#8a6ee0', '#6b7280', '#b3651e', '#0f766e', '#9d174d', '#334155',
];

/** Shrinks the font for long names so a card never breaks its layout. */
function nameSizeClass(name: string, presentation: boolean): string {
  const length = [...name].length;
  if (presentation) {
    if (length <= 3) return 'text-3xl';
    if (length <= 5) return 'text-2xl';
    return 'text-xl';
  }
  if (length <= 3) return 'text-sm';
  if (length <= 5) return 'text-xs';
  return 'text-[10px]';
}

export function SeatMap({
  classroom,
  assignment,
  students,
  viewpoint,
  grouping = null,
  lockedSeatIds = [],
  hiddenSeatIds,
  showNames = true,
  showNumbers = true,
  selectedSeatId = null,
  highlightStudentIds,
  onSeatClick,
  presentation = false,
  className = '',
}: SeatMapProps) {
  const studentsById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const groupOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of grouping?.groups ?? []) {
      for (const memberId of group.memberIds) map.set(memberId, group.index);
    }
    return map;
  }, [grouping]);

  const rows = seatsInDisplayOrder(classroom, viewpoint);
  const locked = new Set(lockedSeatIds);
  const board = boardPlacement(viewpoint);
  const deskAlign = teacherDeskPlacement(classroom.teacherDeskAlign, viewpoint);
  const windows = windowPlacement(classroom.windowSide, viewpoint);

  const boardBar = (
    <div
      className="flex items-center gap-3 print-area"
      style={{
        justifyContent:
          deskAlign === 'left' ? 'flex-start' : deskAlign === 'right' ? 'flex-end' : 'center',
      }}
    >
      <div className="flex-1 rounded-md border-2 border-dashed border-slate-400 px-3 py-1.5 text-center text-xs font-semibold tracking-widest text-slate-600 dark:border-slate-500 dark:text-slate-300">
        칠 판
      </div>
      <div className="shrink-0 rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white dark:bg-slate-600">
        교탁
      </div>
    </div>
  );

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Saying which way round the drawing is, in words, is what keeps the two
          views from being mistaken for one another. */}
      <div className="no-print flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-blue-100 px-2.5 py-1 font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
          지금 보는 화면: {VIEWPOINT_LABELS[viewpoint]}
        </span>
        <span className="text-slate-500 dark:text-slate-400">{VIEWPOINT_HINTS[viewpoint]}</span>
      </div>
      <p className="print-only text-xs text-slate-600">
        {VIEWPOINT_LABELS[viewpoint]} — {VIEWPOINT_HINTS[viewpoint]}
      </p>

      {board === 'top' && boardBar}

      <div className="flex items-stretch gap-2">
        {windows !== 'none' && (
          <div
            className={`flex w-6 shrink-0 items-center justify-center rounded bg-sky-50 text-[10px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300 ${
              windows === 'left' ? 'order-first' : 'order-last'
            }`}
          >
            <span className="[writing-mode:vertical-rl]">창가</span>
          </div>
        )}

        <div className="flex-1 space-y-2">
          {rows.map((line, displayRow) => (
            <div
              key={displayRow}
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${classroom.cols}, minmax(0, 1fr))` }}
            >
              {line.map((seat) => {
                const studentId = assignment[seat.id];
                const student = studentId ? studentsById.get(studentId) : undefined;
                const hidden = hiddenSeatIds?.has(seat.id) ?? false;
                const groupIndex = studentId ? groupOf.get(studentId) : undefined;
                const color = groupIndex ? GROUP_COLORS[(groupIndex - 1) % GROUP_COLORS.length] : undefined;
                const isHighlighted = studentId ? (highlightStudentIds?.has(studentId) ?? false) : false;

                if (seat.kind === 'aisle') {
                  return <div key={seat.id} className="min-h-[3rem]" aria-hidden="true" />;
                }

                if (seat.kind === 'disabled') {
                  return (
                    <button
                      key={seat.id}
                      type="button"
                      onClick={() => onSeatClick?.(seat)}
                      className="seat-card min-h-[3rem] rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-900"
                    >
                      사용 안 함
                    </button>
                  );
                }

                const label = hidden
                  ? '?'
                  : student
                    ? [showNumbers && student.number !== null ? `${student.number}` : null,
                       showNames ? student.name : null]
                        .filter(Boolean)
                        .join(' ')
                    : '';

                return (
                  <button
                    key={seat.id}
                    type="button"
                    onClick={() => onSeatClick?.(seat)}
                    aria-label={
                      student
                        ? `${displayRow + 1}번째 줄 ${seat.col + 1}번 자리, ${hidden ? '아직 공개하지 않음' : student.name}`
                        : `${displayRow + 1}번째 줄 빈자리`
                    }
                    aria-pressed={selectedSeatId === seat.id}
                    className={[
                      'seat-card relative flex min-h-[3rem] flex-col items-center justify-center rounded-lg border-2 px-1 py-2 text-center transition',
                      presentation ? 'min-h-[6rem]' : '',
                      student
                        ? 'bg-white dark:bg-slate-800'
                        : 'border-dashed bg-slate-50 text-slate-400 dark:bg-slate-900',
                      selectedSeatId === seat.id
                        ? 'border-blue-600 ring-2 ring-blue-300'
                        : isHighlighted
                          ? 'border-amber-500 ring-2 ring-amber-200'
                          : 'border-slate-300 dark:border-slate-600',
                      onSeatClick ? 'cursor-pointer hover:border-blue-400' : 'cursor-default',
                    ].join(' ')}
                    style={color && !hidden ? { borderColor: color, borderWidth: 3 } : undefined}
                  >
                    {locked.has(seat.id) && (
                      <LockIcon className="absolute right-1 top-1 h-3 w-3 text-blue-600" />
                    )}
                    {student ? (
                      <span
                        className={`break-keep font-semibold leading-tight ${nameSizeClass(label, presentation)}`}
                      >
                        {label}
                      </span>
                    ) : (
                      <span className={presentation ? 'text-base' : 'text-[10px]'}>빈자리</span>
                    )}
                    {groupIndex !== undefined && !hidden && (
                      <span
                        className="mt-0.5 rounded px-1 text-[10px] font-bold text-white"
                        style={{ backgroundColor: color }}
                      >
                        {groupIndex}모둠
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {board === 'bottom' && boardBar}
    </div>
  );
}
