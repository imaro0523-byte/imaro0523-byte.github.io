/**
 * Controls for revealing seats in front of the class.
 *
 * The starting state is "everything hidden", and revealing is a deliberate
 * action, so a refresh in the middle of a lesson cannot accidentally show the
 * whole arrangement before the teacher means it to.
 */

import { useState } from 'react';

import type { SeatAssignment, Student } from '@/core/model/types';
import { EyeIcon, EyeOffIcon, ShuffleIcon } from './Icons';

interface RevealBarProps {
  assignment: SeatAssignment;
  students: readonly Student[];
  hiddenSeatIds: Set<string>;
  onChange: (next: Set<string>) => void;
  onHideAll: () => void;
  onShowAll: () => void;
  reduceMotion: boolean;
}

export function RevealBar({
  assignment,
  students,
  hiddenSeatIds,
  onChange,
  onHideAll,
  onShowAll,
  reduceMotion,
}: RevealBarProps) {
  const [countdown, setCountdown] = useState<number | null>(null);

  const seatIds = Object.keys(assignment);
  const revealedCount = seatIds.length - hiddenSeatIds.size;

  const revealOne = (seatId: string) => {
    const next = new Set(hiddenSeatIds);
    next.delete(seatId);
    onChange(next);
  };

  const revealRandom = () => {
    const remaining = [...hiddenSeatIds];
    if (remaining.length === 0) return;
    const pick = remaining[Math.floor(Math.random() * remaining.length)];
    if (pick) revealOne(pick);
  };

  const revealByNumber = () => {
    const byNumber = new Map<string, number>();
    for (const [seatId, studentId] of Object.entries(assignment)) {
      const student = students.find((s) => s.id === studentId);
      byNumber.set(seatId, student?.number ?? Number.POSITIVE_INFINITY);
    }
    const next = [...hiddenSeatIds].sort(
      (a, b) => (byNumber.get(a) ?? 0) - (byNumber.get(b) ?? 0),
    )[0];
    if (next) revealOne(next);
  };

  const revealWithCountdown = () => {
    if (reduceMotion) {
      revealRandom();
      return;
    }
    setCountdown(3);
    const tick = (value: number) => {
      if (value === 0) {
        setCountdown(null);
        revealRandom();
        return;
      }
      setCountdown(value);
      setTimeout(() => tick(value - 1), 800);
    };
    tick(3);
  };

  return (
    <div className="no-print rounded-xl border border-indigo-300 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-950">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
          공개 {revealedCount} / {seatIds.length}
        </span>
        <button type="button" className="btn-secondary" onClick={onHideAll}>
          <EyeOffIcon />
          전체 숨기기
        </button>
        <button type="button" className="btn-secondary" onClick={onShowAll}>
          <EyeIcon />
          전체 공개
        </button>
        <button type="button" className="btn-secondary" onClick={revealRandom} disabled={hiddenSeatIds.size === 0}>
          <ShuffleIcon />
          무작위 한 명
        </button>
        <button type="button" className="btn-secondary" onClick={revealByNumber} disabled={hiddenSeatIds.size === 0}>
          번호순 한 명
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={revealWithCountdown}
          disabled={hiddenSeatIds.size === 0}
        >
          카운트다운 후 공개
        </button>
      </div>

      <p className="mt-1.5 text-xs text-indigo-800 dark:text-indigo-300">
        교사 메모와 조건은 이 화면에 표시되지 않습니다. 자리를 직접 눌러도 공개됩니다.
      </p>

      {countdown !== null && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <span className="text-[10rem] font-black text-white">{countdown}</span>
        </div>
      )}
    </div>
  );
}
