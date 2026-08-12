/**
 * Step 3 — shape the room.
 *
 * The viewpoint toggle lives here as well as on the result screen, so the
 * teacher can build the layout while looking at it the way they will see it.
 */

import { createClassroom, MAX_COLS, MAX_ROWS, seatsOf } from '@/core/layout/grid';
import { otherViewpoint } from '@/core/layout/viewpoint';
import { VIEWPOINT_LABELS } from '@/core/model/types';
import { useAppStore } from '@/store/useAppStore';
import { SeatMap } from '../components/SeatMap';
import { FlipIcon, GridIcon, WarningIcon } from '../components/Icons';

interface Template {
  key: string;
  name: string;
  description: string;
  rows: number;
  cols: number;
  pairDesks: boolean;
  aisleCols?: number[];
}

const TEMPLATES: Template[] = [
  {
    key: 'pairs',
    name: '2인 책상 3분단',
    description: '가장 흔한 교실. 두 명씩 앉고 분단 사이에 통로가 있습니다.',
    rows: 5,
    cols: 7,
    pairDesks: true,
    aisleCols: [2, 5],
  },
  {
    key: 'plain',
    name: '한 명씩 5줄 6칸',
    description: '시험이나 개별 활동에 쓰기 좋은 단순한 격자입니다.',
    rows: 5,
    cols: 6,
    pairDesks: false,
  },
  {
    key: 'group',
    name: '모둠 6개 (4인)',
    description: '네 명이 마주 보는 섬 모양으로 배치합니다.',
    rows: 4,
    cols: 7,
    pairDesks: true,
    aisleCols: [3],
  },
  {
    key: 'wide',
    name: '넓은 교실 6줄 7칸',
    description: '인원이 많은 학급용입니다.',
    rows: 6,
    cols: 7,
    pairDesks: true,
  },
];

export function ClassroomScreen() {
  const classroom = useAppStore((s) => s.classroom);
  const setClassroom = useAppStore((s) => s.setClassroom);
  const resizeClassroom = useAppStore((s) => s.resizeClassroom);
  const toggleSeatKind = useAppStore((s) => s.toggleSeatKind);
  const students = useAppStore((s) => s.students);
  const assignment = useAppStore((s) => s.assignment);
  const viewpoint = useAppStore((s) => s.settings.viewpoint);
  const setViewpoint = useAppStore((s) => s.setViewpoint);
  const setStep = useAppStore((s) => s.setStep);

  const activeCount = students.filter((s) => s.status === 'active').length;
  const seatCount = seatsOf(classroom).length;
  const hasPairDesks = classroom.seats.some((seat) => seat.deskId !== undefined);
  const shortfall = activeCount - seatCount;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">교실 만들기</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            좌석 {seatCount}석 · 배치할 학생 {activeCount}명
            {shortfall > 0 && (
              <strong className="ml-1 text-red-600 dark:text-red-400">({shortfall}석 부족)</strong>
            )}
            {shortfall < 0 && <span className="ml-1 text-slate-500">(빈자리 {-shortfall}석)</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setViewpoint(otherViewpoint(viewpoint))}
          >
            <FlipIcon />
            {VIEWPOINT_LABELS[otherViewpoint(viewpoint)]}으로 보기
          </button>
          <button type="button" className="btn-primary" onClick={() => setStep('rules')}>
            조건 정하기로
          </button>
        </div>
      </div>

      {shortfall > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            좌석이 {shortfall}석 모자랍니다. 줄이나 칸을 늘리거나, «사용 안 함»으로 꺼 둔 자리를 다시 켜 주세요.
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <div className="card space-y-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <GridIcon className="h-4 w-4" />
              교실 모양 고르기
            </h2>
            <div className="space-y-2">
              {TEMPLATES.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  className="w-full rounded-lg border border-slate-200 p-2.5 text-left text-xs hover:border-blue-400 dark:border-slate-700"
                  onClick={() =>
                    setClassroom(
                      createClassroom({
                        rows: template.rows,
                        cols: template.cols,
                        pairDesks: template.pairDesks,
                        aisleCols: template.aisleCols,
                        windowSide: classroom.windowSide,
                      }),
                    )
                  }
                >
                  <span className="block font-semibold text-sm">{template.name}</span>
                  <span className="mt-0.5 block text-slate-500">{template.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="card space-y-3">
            <h2 className="text-sm font-semibold">직접 조절</h2>

            <div>
              <label className="label" htmlFor="rows">
                줄 수 (앞뒤) — {classroom.rows}줄
              </label>
              <input
                id="rows"
                type="range"
                min={1}
                max={MAX_ROWS}
                value={classroom.rows}
                className="w-full"
                onChange={(e) => resizeClassroom(Number(e.target.value), classroom.cols, hasPairDesks)}
              />
            </div>

            <div>
              <label className="label" htmlFor="cols">
                칸 수 (좌우) — {classroom.cols}칸
              </label>
              <input
                id="cols"
                type="range"
                min={1}
                max={MAX_COLS}
                value={classroom.cols}
                className="w-full"
                onChange={(e) => resizeClassroom(classroom.rows, Number(e.target.value), hasPairDesks)}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasPairDesks}
                onChange={(e) => resizeClassroom(classroom.rows, classroom.cols, e.target.checked)}
              />
              두 명씩 앉는 책상으로 묶기
            </label>

            <div>
              <label className="label" htmlFor="window">창가 위치 (학생 기준)</label>
              <select
                id="window"
                className="input"
                value={classroom.windowSide}
                onChange={(e) =>
                  setClassroom(
                    createClassroom({
                      rows: classroom.rows,
                      cols: classroom.cols,
                      pairDesks: hasPairDesks,
                      windowSide: e.target.value as typeof classroom.windowSide,
                    }),
                  )
                }
              >
                <option value="left">왼쪽</option>
                <option value="right">오른쪽</option>
                <option value="none">표시 안 함</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                창가·복도 쪽 자리를 희망 조건으로 쓸 때 기준이 됩니다.
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <p className="mb-3 text-xs text-slate-500">
            자리를 누르면 «사용 안 함»으로 껐다 켤 수 있습니다. 통로나 비워 둘 자리를 만들 때 쓰세요.
          </p>
          <SeatMap
            classroom={classroom}
            assignment={assignment}
            students={students}
            viewpoint={viewpoint}
            onSeatClick={(seat) => toggleSeatKind(seat.id)}
          />
        </div>
      </div>
    </div>
  );
}
