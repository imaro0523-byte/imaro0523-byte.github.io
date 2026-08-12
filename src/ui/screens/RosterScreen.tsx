/**
 * Step 2 — check and correct the roster, and decide who is in the arrangement.
 *
 * The exclusion controls are the point of this screen: a student who has
 * transferred out or withdrawn should disappear from seating and from group
 * sizing without being deleted, because the teacher may still need the record.
 */

import { useMemo, useState } from 'react';

import {
  EXCLUDED_STATUSES,
  GENDER_LABELS,
  STATUS_LABELS,
  type Gender,
  type Student,
  type StudentStatus,
} from '@/core/model/types';
import { useAppStore } from '@/store/useAppStore';
import { PlusIcon, TrashIcon, UsersIcon, WarningIcon } from '../components/Icons';

const GENDERS: Gender[] = ['unset', 'male', 'female', 'other', 'undisclosed'];
const EXCLUSION_CHOICES: StudentStatus[] = [
  'transferOut',
  'withdrawn',
  'absentLong',
  'absentToday',
  'excludedOther',
];

export function RosterScreen() {
  const students = useAppStore((s) => s.students);
  const meta = useAppStore((s) => s.meta);
  const updateStudent = useAppStore((s) => s.updateStudent);
  const removeStudent = useAppStore((s) => s.removeStudent);
  const addStudent = useAppStore((s) => s.addStudent);
  const setStatus = useAppStore((s) => s.setStatus);
  const restoreStudent = useAppStore((s) => s.restoreStudent);
  const setStep = useAppStore((s) => s.setStep);

  const [search, setSearch] = useState('');
  const [showTeacherFields, setShowTeacherFields] = useState(false);

  const active = students.filter((s) => s.status === 'active');
  const excluded = students.filter((s) => s.status !== 'active');

  const warnings = useMemo(() => {
    const list: string[] = [];
    const numbers = new Map<number, number>();
    for (const student of students) {
      if (student.number === null) continue;
      numbers.set(student.number, (numbers.get(student.number) ?? 0) + 1);
    }
    const duplicates = [...numbers.entries()].filter(([, count]) => count > 1);
    if (duplicates.length > 0) {
      list.push(`출석번호가 겹치는 학생이 있습니다: ${duplicates.map(([n]) => `${n}번`).join(', ')}`);
    }
    if (students.some((s) => s.name.trim() === '')) list.push('이름이 비어 있는 학생이 있습니다.');
    if (students.some((s) => s.number === null)) list.push('번호를 읽지 못한 학생이 있습니다.');

    const names = new Map<string, number>();
    for (const student of students) {
      const key = student.name.replace(/\s/g, '');
      if (key === '') continue;
      names.set(key, (names.get(key) ?? 0) + 1);
    }
    const sameName = [...names.entries()].filter(([, count]) => count > 1);
    if (sameName.length > 0) {
      list.push(
        `이름이 같은 학생이 있습니다 (${sameName.map(([n]) => n).join(', ')}). 서로 다른 학생으로 구분해 두었으니 그대로 두셔도 됩니다.`,
      );
    }
    return list;
  }, [students]);

  const visible = search.trim()
    ? students.filter(
        (s) =>
          s.name.includes(search.trim()) ||
          String(s.number ?? '').includes(search.trim()),
      )
    : students;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">학생 명단</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {meta?.classNumber ? `${meta.classNumber} · ` : ''}
            배치 대상 <strong className="text-blue-700 dark:text-blue-300">{active.length}명</strong>
            {excluded.length > 0 && ` · 제외 ${excluded.length}명`}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={addStudent}>
            <PlusIcon />
            학생 추가
          </button>
          <button type="button" className="btn-primary" onClick={() => setStep('classroom')}>
            교실 만들기로
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <WarningIcon className="h-4 w-4" />
            확인해 주세요
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="input max-w-xs"
          placeholder="이름이나 번호로 찾기"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="학생 검색"
        />
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={showTeacherFields}
            onChange={(e) => setShowTeacherFields(e.target.checked)}
          />
          교사용 항목 보기 (메모 · 배려 사항)
        </label>
        {showTeacherFields && (
          <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            이 항목들은 학생 공개 화면과 내보내기에 기본적으로 포함되지 않습니다
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="bg-slate-100 text-xs dark:bg-slate-800">
            <tr>
              <th className="px-2 py-2 text-left">번호</th>
              <th className="px-2 py-2 text-left">이름</th>
              <th className="px-2 py-2 text-left">성별</th>
              <th className="px-2 py-2 text-left">태그</th>
              <th className="px-2 py-2 text-left">배치 여부</th>
              {showTeacherFields && <th className="px-2 py-2 text-left">교사 메모</th>}
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((student) => (
              <StudentRow
                key={student.id}
                student={student}
                showTeacherFields={showTeacherFields}
                onUpdate={(patch) => updateStudent(student.id, patch)}
                onStatus={(status, note) => setStatus(student.id, status, note)}
                onRestore={() => restoreStudent(student.id)}
                onRemove={() => removeStudent(student.id)}
              />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">
                  {students.length === 0 ? '명단이 비어 있습니다.' : '검색 결과가 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {excluded.length > 0 && (
        <div className="card">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <UsersIcon className="h-4 w-4" />
            배치에서 제외한 학생 {excluded.length}명
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            이 학생들은 자리와 모둠 계산에서 빠집니다. 모둠 인원도 남은 인원 기준으로 다시 계산됩니다.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {excluded.map((student) => (
              <li
                key={student.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
              >
                <span className="font-medium">
                  {student.number ?? '—'} {student.name}
                </span>
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] dark:bg-slate-700">
                  {STATUS_LABELS[student.status]}
                </span>
                <button
                  type="button"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() => restoreStudent(student.id)}
                >
                  되돌리기
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface RowProps {
  student: Student;
  showTeacherFields: boolean;
  onUpdate: (patch: Partial<Student>) => void;
  onStatus: (status: StudentStatus, note?: string) => void;
  onRestore: () => void;
  onRemove: () => void;
}

function StudentRow({ student, showTeacherFields, onUpdate, onStatus, onRestore, onRemove }: RowProps) {
  const isExcluded = EXCLUDED_STATUSES.includes(student.status);

  return (
    <tr
      className={`border-t border-slate-100 dark:border-slate-800 ${
        isExcluded ? 'bg-slate-50 text-slate-400 dark:bg-slate-900/60' : ''
      }`}
    >
      <td className="px-2 py-1">
        <input
          type="number"
          className="input w-16"
          value={student.number ?? ''}
          onChange={(e) =>
            onUpdate({ number: e.target.value === '' ? null : Number(e.target.value) })
          }
          aria-label="출석번호"
        />
      </td>
      <td className="px-2 py-1">
        <input
          className="input w-28"
          value={student.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          aria-label="이름"
        />
      </td>
      <td className="px-2 py-1">
        <select
          className="input w-20"
          value={student.gender}
          onChange={(e) => onUpdate({ gender: e.target.value as Gender })}
          aria-label="성별"
        >
          {GENDERS.map((gender) => (
            <option key={gender} value={gender}>
              {GENDER_LABELS[gender]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1">
        <input
          className="input w-32"
          placeholder="리더, 도우미…"
          value={student.tags.join(', ')}
          onChange={(e) =>
            onUpdate({
              tags: e.target.value
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
          aria-label="태그"
        />
      </td>
      <td className="px-2 py-1">
        <select
          className="input w-28"
          value={student.status}
          onChange={(e) => {
            const next = e.target.value as StudentStatus;
            if (next === 'active') onRestore();
            else onStatus(next);
          }}
          aria-label="배치 여부"
        >
          <option value="active">{STATUS_LABELS.active}</option>
          {EXCLUSION_CHOICES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </td>
      {showTeacherFields && (
        <td className="px-2 py-1">
          <input
            className="input w-40"
            placeholder="이 기기에만 저장됩니다"
            value={student.teacherMemo ?? ''}
            onChange={(e) => onUpdate({ teacherMemo: e.target.value })}
            aria-label="교사 메모"
          />
        </td>
      )}
      <td className="px-2 py-1 text-right">
        <button
          type="button"
          className="btn-ghost px-2 text-red-600 dark:text-red-400"
          onClick={onRemove}
          aria-label={`${student.name} 삭제`}
          title="명단에서 완전히 삭제"
        >
          <TrashIcon />
        </button>
      </td>
    </tr>
  );
}
