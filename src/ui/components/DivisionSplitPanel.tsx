/**
 * One-click 구분1 / 구분2 split.
 *
 * A NEIS roster lists one 가나다 run per group, so the point where the name
 * ordering resets marks the boundary. Finding it saves a teacher from setting
 * twenty-five dropdowns by hand at the start of every term.
 *
 * The result is never labelled 남 / 여. Which run comes first differs between
 * schools and changes from term to term, and this code reads the *ordering*,
 * not the names — it has no way to know which group is which, so it does not
 * pretend to. A teacher who wants real genders sets them in the 성별 column.
 */

import { useMemo, useState } from 'react';

import {
  describeCandidate,
  divisionsFor,
  isConfident,
  planSplit,
  type SplitCandidate,
} from '@/core/roster/divisionSplit';
import { DIVISION_LABELS, type Student } from '@/core/model/types';
import { CheckIcon, UsersIcon, WarningIcon } from './Icons';

interface Props {
  students: readonly Student[];
  onApply: (divisions: Record<string, 'a' | 'b'>) => void;
  onSwap: () => void;
  onClear: () => void;
}

export function DivisionSplitPanel({ students, onApply, onSwap, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const outcome = useMemo(() => planSplit(students), [students]);

  const counts = useMemo(() => {
    let a = 0;
    let b = 0;
    let unset = 0;
    for (const student of students) {
      if (student.division === 'a') a += 1;
      else if (student.division === 'b') b += 1;
      else unset += 1;
    }
    return { a, b, unset };
  }, [students]);

  const apply = (candidate: SplitCandidate) => {
    onApply(divisionsFor(students, candidate.index));
    setMessage(
      `구분1 ${candidate.firstSize}명 · 구분2 ${candidate.secondSize}명으로 나눴습니다. ` +
        '틀린 자리에서 나뉘었다면 다른 지점을 고르거나 아래에서 직접 고치세요.',
    );
    setOpen(false);
  };

  const applyBest = () => {
    if (!outcome.ok) {
      setMessage(outcome.message);
      return;
    }
    if (isConfident(outcome.candidates)) {
      // A clear winner, so apply it. Rosters routinely contain small resets
      // within one surname that are not boundaries; making the teacher pick
      // between those and the obvious answer would defeat the point.
      apply(outcome.candidates[0] as SplitCandidate);
      return;
    }
    // No candidate stands out, so ask rather than guess.
    setOpen(true);
  };

  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <UsersIcon className="h-4 w-4" />
          구분 나누기
        </h2>
        <span className="text-xs text-slate-500">
          {counts.unset === students.length
            ? '아직 나누지 않았습니다'
            : `구분1 ${counts.a}명 · 구분2 ${counts.b}명${counts.unset > 0 ? ` · 미지정 ${counts.unset}명` : ''}`}
        </span>
      </div>

      <p className="text-xs text-slate-500">
        명렬표는 보통 한 무리를 가나다순으로 적고 그다음 무리를 다시 가나다순으로 적습니다.
        이름 순서가 처음으로 되돌아가는 지점을 찾아 두 무리로 나눠 드립니다.
        <strong className="ml-1 text-slate-600 dark:text-slate-400">
          어느 쪽이 남학생인지는 알 수 없으므로 구분1·구분2로만 표시합니다.
        </strong>
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={applyBest}>
          이름 순서로 구분 나누기
        </button>
        {outcome.ok && outcome.candidates.length > 1 && (
          <button type="button" className="btn-secondary" onClick={() => setOpen((v) => !v)}>
            나눌 지점 고르기 ({outcome.candidates.length}곳)
          </button>
        )}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            onSwap();
            setMessage('구분1과 구분2를 서로 바꿨습니다.');
          }}
          disabled={counts.a === 0 && counts.b === 0}
        >
          구분1 ↔ 구분2 바꾸기
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            onClear();
            setMessage('구분을 모두 지웠습니다.');
          }}
          disabled={counts.a === 0 && counts.b === 0}
        >
          구분 지우기
        </button>
      </div>

      {open && outcome.ok && (
        <div className="space-y-1.5 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            이름 순서가 되돌아가는 곳이 {outcome.candidates.length}군데입니다. 어디에서 나눌까요?
          </p>
          {outcome.candidates.slice(0, 5).map((candidate) => (
            <button
              key={candidate.index}
              type="button"
              className="block w-full rounded-lg border border-slate-200 p-2 text-left text-xs hover:border-blue-400 dark:border-slate-700"
              onClick={() => apply(candidate)}
            >
              {describeCandidate(candidate, students)}
            </button>
          ))}
        </div>
      )}

      {message && (
        <p
          className={`flex items-start gap-1.5 text-xs ${
            outcome.ok
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-amber-800 dark:text-amber-300'
          }`}
        >
          {outcome.ok ? (
            <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{message}</span>
        </p>
      )}

      {counts.a > 0 && counts.b > 0 && (
        <p className="text-xs text-slate-500">
          이제 조건 화면에서 «남녀 섞기»를 추가하고 기준을 «{DIVISION_LABELS.a}·{DIVISION_LABELS.b}»로
          고르면 두 무리가 섞이도록 배치됩니다.
        </p>
      )}
    </div>
  );
}
