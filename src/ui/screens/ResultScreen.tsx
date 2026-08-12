/**
 * Step 6 — the result, the reveal, and the exports.
 */

import { useMemo, useRef, useState } from 'react';

import { buildContext, evaluateSeating } from '@/core/constraints/evaluate';
import { buildWorkbook, workbookToBytes } from '@/core/exportData/toXlsx';
import { buildBackup } from '@/core/exportData/toJson';
import { findLeakedFields, STUDENT_FACING, TEACHER_FACING, type ExportOptions } from '@/core/exportData/redact';
import { buildHistoryIndex } from '@/core/history';
import { otherViewpoint } from '@/core/layout/viewpoint';
import { seatsOf } from '@/core/layout/grid';
import { VIEWPOINT_LABELS } from '@/core/model/types';
import { safeErrorMessage } from '@/lib/log';
import { useAppStore } from '@/store/useAppStore';
import { SeatMap } from '../components/SeatMap';
import { RevealBar } from '../components/RevealBar';
import { GroupList } from '../components/GroupList';
import { downloadBytes, downloadText, safeFileName } from '../export/download';
import { exportJpg, exportPdf, exportPng } from '../export/image';
import {
  CheckIcon,
  DownloadIcon,
  FlipIcon,
  LockIcon,
  PrintIcon,
  ShuffleIcon,
  WarningIcon,
} from '../components/Icons';

export function ResultScreen() {
  const students = useAppStore((s) => s.students);
  const classroom = useAppStore((s) => s.classroom);
  const assignment = useAppStore((s) => s.assignment);
  const grouping = useAppStore((s) => s.grouping);
  const constraints = useAppStore((s) => s.constraints);
  const meta = useAppStore((s) => s.meta);
  const history = useAppStore((s) => s.history);
  const seed = useAppStore((s) => s.seed);
  const settings = useAppStore((s) => s.settings);
  const lockedSeatIds = useAppStore((s) => s.lockedSeatIds);
  const setViewpoint = useAppStore((s) => s.setViewpoint);
  const toggleSeatLock = useAppStore((s) => s.toggleSeatLock);
  const swapSeats = useAppStore((s) => s.swapSeats);
  const recordCurrent = useAppStore((s) => s.recordCurrent);
  const setStep = useAppStore((s) => s.setStep);

  const mapRef = useRef<HTMLDivElement>(null);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'lock' | 'reveal'>('edit');
  const [hiddenSeatIds, setHiddenSeatIds] = useState<Set<string>>(new Set());
  const [presentation, setPresentation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeTeacherData, setIncludeTeacherData] = useState(false);

  const viewpoint = settings.viewpoint;
  const seatedIds = new Set(Object.values(assignment));
  const unseated = students.filter((s) => s.status === 'active' && !seatedIds.has(s.id));
  const excluded = students.filter((s) => s.status !== 'active');

  const evaluation = useMemo(() => {
    const ctx = buildContext(
      classroom,
      students,
      buildHistoryIndex(history),
      grouping ?? undefined,
    );
    return evaluateSeating(assignment, constraints, ctx);
  }, [classroom, students, history, grouping, assignment, constraints]);

  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? '';

  const exportOptions: ExportOptions = includeTeacherData ? TEACHER_FACING : STUDENT_FACING;

  const fileBase = {
    classNumber: meta?.classNumber,
    date: new Date().toISOString().slice(0, 10),
  };

  const withBusy = async (label: string, work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      setMessage(`${label} 저장했습니다.`);
    } catch (caught) {
      setError(safeErrorMessage(caught, `${label} 저장에 실패했습니다.`));
    } finally {
      setBusy(false);
    }
  };

  const handleSeatClick = (seatId: string) => {
    if (mode === 'lock') {
      toggleSeatLock(seatId);
      return;
    }
    if (mode === 'reveal') {
      setHiddenSeatIds((prev) => {
        const next = new Set(prev);
        next.delete(seatId);
        return next;
      });
      return;
    }
    if (selectedSeat === null) {
      setSelectedSeat(seatId);
      return;
    }
    if (selectedSeat === seatId) {
      setSelectedSeat(null);
      return;
    }
    swapSeats(selectedSeat, seatId);
    setSelectedSeat(null);
  };

  const hideAll = () => setHiddenSeatIds(new Set(Object.keys(assignment)));
  const showAll = () => setHiddenSeatIds(new Set());

  const exportJson = () => {
    const backup = buildBackup(
      { meta, students, classroom, constraints, assignment, grouping, history, seed },
      exportOptions,
    );
    // Belt and braces: verify no teacher-only field survived the redaction.
    const leaked = findLeakedFields(backup, exportOptions);
    if (leaked.length > 0) {
      throw new Error(`내보내기를 중단했습니다. 포함되면 안 되는 항목이 발견되었습니다: ${leaked.join(', ')}`);
    }
    downloadText(
      JSON.stringify(backup, null, 2),
      safeFileName({ kind: '자리배치_백업', ...fileBase, extension: 'json' }),
    );
  };

  const exportXlsx = () => {
    const workbook = buildWorkbook(
      {
        meta,
        students,
        classroom,
        assignment,
        grouping,
        constraints,
        seed,
        viewpointLabel: VIEWPOINT_LABELS[viewpoint],
      },
      exportOptions,
    );
    downloadBytes(
      workbookToBytes(workbook),
      safeFileName({ kind: '자리배치', ...fileBase, extension: 'xlsx' }),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  };

  return (
    <div className={presentation ? 'fixed inset-0 z-50 overflow-auto bg-white p-6 dark:bg-slate-950' : 'mx-auto max-w-6xl space-y-4'}>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">결과 보기</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            자리에 앉은 학생 {Object.keys(assignment).length}명
            {unseated.length > 0 && ` · 자리 없는 학생 ${unseated.length}명`}
            {excluded.length > 0 && ` · 배치 제외 ${excluded.length}명`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setViewpoint(otherViewpoint(viewpoint))}>
            <FlipIcon />
            {VIEWPOINT_LABELS[otherViewpoint(viewpoint)]}으로 보기
          </button>
          <button type="button" className="btn-secondary" onClick={() => setStep('generate')}>
            <ShuffleIcon />
            다시 만들기
          </button>
          <button type="button" className="btn-secondary" onClick={() => setPresentation((v) => !v)}>
            {presentation ? '작게 보기' : '발표용 크게 보기'}
          </button>
        </div>
      </div>

      {(message || error) && (
        <div
          role="status"
          className={`no-print rounded-lg border p-3 text-sm ${
            error
              ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
              : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
          }`}
        >
          {error ?? message}
        </div>
      )}

      <div className={presentation ? '' : 'grid gap-4 lg:grid-cols-[1fr_20rem]'}>
        <div className="space-y-3">
          <div className="no-print flex flex-wrap gap-2">
            {(['edit', 'lock', 'reveal'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => { setMode(value); setSelectedSeat(null); }}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  mode === value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {value === 'edit' ? '자리 바꾸기' : value === 'lock' ? '자리 잠그기' : '공개 모드'}
              </button>
            ))}
            <span className="self-center text-xs text-slate-500">
              {mode === 'edit'
                ? '자리 두 곳을 차례로 누르면 서로 바뀝니다.'
                : mode === 'lock'
                  ? `누른 자리는 다시 만들기를 해도 그대로 유지됩니다. 지금 ${lockedSeatIds.length}곳 잠김.`
                  : '자리를 누르면 그 학생만 공개됩니다.'}
            </span>
          </div>

          {mode === 'reveal' && (
            <RevealBar
              assignment={assignment}
              students={students}
              hiddenSeatIds={hiddenSeatIds}
              onChange={setHiddenSeatIds}
              onHideAll={hideAll}
              onShowAll={showAll}
              reduceMotion={settings.reduceMotion}
            />
          )}

          <div ref={mapRef} className="card print-area">
            <div className="mb-2 text-center">
              <p className="text-base font-bold">
                {meta?.classNumber ? `${meta.classNumber} ` : ''}자리 배치도
              </p>
              <p className="text-xs text-slate-500">
                {new Date().toLocaleDateString('ko-KR')} · {VIEWPOINT_LABELS[viewpoint]}
              </p>
            </div>
            <SeatMap
              classroom={classroom}
              assignment={assignment}
              students={students}
              viewpoint={viewpoint}
              grouping={grouping}
              lockedSeatIds={lockedSeatIds}
              hiddenSeatIds={mode === 'reveal' ? hiddenSeatIds : undefined}
              showNames={settings.showNames}
              showNumbers={settings.showNumbers}
              selectedSeatId={selectedSeat}
              onSeatClick={(seat) => handleSeatClick(seat.id)}
              presentation={presentation}
            />
          </div>

          {grouping && <GroupList grouping={grouping} students={students} />}
        </div>

        {!presentation && (
          <div className="no-print space-y-4">
            <div className="card space-y-2">
              <h2 className="text-sm font-semibold">조건 충족 정도</h2>
              {evaluation.hardViolations.length === 0 ? (
                <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                  <CheckIcon className="h-4 w-4" />
                  «반드시 지킴» 조건을 모두 지켰습니다.
                </p>
              ) : (
                <div className="space-y-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-red-700 dark:text-red-400">
                    <WarningIcon className="h-4 w-4" />
                    지키지 못한 필수 조건 {evaluation.hardViolations.length}건
                  </p>
                  <ul className="list-disc pl-5 text-xs text-red-700 dark:text-red-300">
                    {evaluation.hardViolations.slice(0, 5).map((violation, i) => (
                      <li key={i}>
                        {violation.message}
                        {violation.studentIds.length > 0 && ` (${violation.studentIds.map(nameOf).join(', ')})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {evaluation.softViolations.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-slate-600 dark:text-slate-400">
                    아쉬운 점 {evaluation.softViolations.length}건 보기
                  </summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-500">
                    {evaluation.softViolations.slice(0, 8).map((violation, i) => (
                      <li key={i}>
                        {violation.message}
                        {violation.studentIds.length > 0 && ` (${violation.studentIds.map(nameOf).join(', ')})`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="text-[11px] text-slate-400">시드 {seed} · 총점 {Math.round(evaluation.penalty)}</p>
            </div>

            {unseated.length > 0 && (
              <div className="card">
                <h2 className="text-sm font-semibold">자리를 못 받은 학생</h2>
                <p className="mt-1 text-xs text-slate-500">좌석이 모자랍니다. 교실을 넓혀 주세요.</p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                  {unseated.map((student) => (
                    <li key={student.id} className="rounded bg-slate-200 px-2 py-1 dark:bg-slate-700">
                      {student.number} {student.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="card space-y-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <DownloadIcon className="h-4 w-4" />
                내보내기
              </h2>

              <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={includeTeacherData}
                  onChange={(e) => setIncludeTeacherData(e.target.checked)}
                />
                <span>
                  <span className="font-semibold">교사용 정보도 함께 넣기</span>
                  <span className="mt-0.5 block text-slate-500">
                    교사 메모·성별·태그·배려 사항·조건 목록이 포함됩니다. 학생에게 나눠 줄 파일에는 켜지 마세요.
                    <strong className="ml-1">기본은 꺼짐입니다.</strong>
                  </span>
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    void withBusy('PNG를', async () => {
                      if (!mapRef.current) throw new Error('화면을 찾지 못했습니다.');
                      await exportPng(
                        mapRef.current,
                        safeFileName({ kind: '자리배치', ...fileBase, extension: 'png' }),
                        { scale: 2 },
                      );
                    })
                  }
                >
                  PNG 이미지
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    void withBusy('JPG를', async () => {
                      if (!mapRef.current) throw new Error('화면을 찾지 못했습니다.');
                      await exportJpg(
                        mapRef.current,
                        safeFileName({ kind: '자리배치', ...fileBase, extension: 'jpg' }),
                      );
                    })
                  }
                >
                  JPG 이미지
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    void withBusy('PDF를', async () => {
                      if (!mapRef.current) throw new Error('화면을 찾지 못했습니다.');
                      await exportPdf(
                        mapRef.current,
                        safeFileName({ kind: '자리배치', ...fileBase, extension: 'pdf' }),
                        {
                          orientation: 'landscape',
                          margin: 10,
                          title: '자리 배치도',
                          subtitle: `${meta?.classNumber ?? ''} ${new Date().toISOString().slice(0, 10)}`,
                        },
                      );
                    })
                  }
                >
                  PDF
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void withBusy('엑셀을', async () => exportXlsx())}
                >
                  엑셀
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void withBusy('백업을', async () => exportJson())}
                >
                  JSON 백업
                </button>
                <button type="button" className="btn-secondary" onClick={() => window.print()}>
                  <PrintIcon />
                  인쇄
                </button>
              </div>

              <p className="text-[11px] text-slate-500">
                내보낸 파일은 암호가 걸려 있지 않습니다. 학생 이름이 들어 있으니 저장 위치에 주의해 주세요.
                파일 이름에는 학생 이름이 들어가지 않습니다.
              </p>
            </div>

            <div className="card space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <LockIcon className="h-4 w-4" />
                이번 배치 기록해 두기
              </h2>
              <p className="text-xs text-slate-500">
                기록해 두면 다음에 «지난 짝 피하기»와 «지난 모둠원 피하기»가 이 결과를 참고합니다.
                기록은 이 브라우저 메모리에만 남고, 저장을 켜지 않으면 새로고침 시 사라집니다.
              </p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  recordCurrent();
                  setMessage('이번 배치를 기록했습니다.');
                }}
              >
                기록에 추가 (지금 {history.length}개)
              </button>
            </div>
          </div>
        )}
      </div>

      {presentation && (
        <button
          type="button"
          className="no-print btn-secondary fixed right-4 top-4"
          onClick={() => setPresentation(false)}
        >
          닫기
        </button>
      )}

      <p className="hidden">{seatsOf(classroom).length}</p>
    </div>
  );
}
