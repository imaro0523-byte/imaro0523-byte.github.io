/**
 * Step 3 — shape the room.
 *
 * The viewpoint toggle lives here as well as on the result screen, so the
 * teacher can build the layout while looking at it the way they will see it.
 */

import { useMemo, useState } from 'react';

import { createClassroom, divisionColumns, MAX_COLS, MAX_ROWS, seatsOf } from '@/core/layout/grid';
import { createHorseshoeClassroom, createRingClassroom } from '@/core/layout/shapes';
import { createGroupClassroom, MAX_GAP } from '@/core/layout/groupIslands';
import { otherViewpoint } from '@/core/layout/viewpoint';
import { VIEWPOINT_LABELS, type Classroom } from '@/core/model/types';
import { arrangeSizes, hasUnevenSizes, largerGroupCount } from '@/core/solver/partition';
import { planGroupSizes } from '@/core/solver/planning';
import { useAppStore } from '@/store/useAppStore';
import { SeatMap } from '../components/SeatMap';
import { CheckIcon, FlipIcon, GridIcon, UsersIcon, WarningIcon } from '../components/Icons';

const GROUP_COUNT_CHOICES = [2, 3, 4, 5, 6, 7, 8, 9];

interface Template {
  key: string;
  name: string;
  description: string;
  rows?: number;
  cols?: number;
  pairDesks?: boolean;
  aisleCols?: number[];
  /** Shown before the fold. The rest are one click away, not gone. */
  common?: boolean;
  /**
   * Shapes whose empty part is in the middle cannot be described by whole
   * -column aisles, so they bring their own builder instead.
   */
  build?: (windowSide: Classroom['windowSide']) => Classroom;
}

const TEMPLATES: Template[] = [
  {
    key: 'pairs3',
    common: true,
    name: '2인 책상 3분단',
    description: '가장 흔한 교실. 두 명씩 앉고 분단 사이에 통로가 있습니다. 30자리',
    rows: 5,
    pairDesks: true,
    ...divisionColumns(3),
  },
  {
    key: 'pairs2',
    name: '2인 책상 2분단',
    description: '인원이 적은 학급이나 좁은 교실. 20자리',
    rows: 5,
    pairDesks: true,
    ...divisionColumns(2),
  },
  {
    key: 'pairs4',
    name: '2인 책상 4분단',
    description: '인원이 많은 학급. 40자리',
    rows: 5,
    pairDesks: true,
    ...divisionColumns(4),
  },
  {
    key: 'exam',
    common: true,
    // Desks pulled apart, one student each, with an aisle between every column
    // so nobody sits within reach of a neighbour. Pair it with «번호순으로
    // 앉히기» on the next screen for a room a teacher can walk with a roster.
    name: '시험 대형',
    description: '책상을 하나씩 띄워 놓습니다. 번호순으로 앉히기와 함께 쓰세요. 30자리',
    rows: 5,
    pairDesks: false,
    cols: 11,
    aisleCols: [1, 3, 5, 7, 9],
  },
  {
    key: 'horseshoe',
    name: 'ㄷ자 토론 대형',
    description: '벽을 따라 둘러앉아 서로의 얼굴을 봅니다. 칠판 쪽이 열려 있습니다. 26자리',
    build: (windowSide) => createHorseshoeClassroom({ windowSide }),
  },
  {
    key: 'ring',
    name: '원형 (둘러앉기)',
    description: '사방을 빙 둘러앉아 가운데를 봅니다. 머리 자리가 없는 학급 전체 토의용. 26자리',
    build: (windowSide) => createRingClassroom({ windowSide }),
  },
  {
    key: 'plain',
    common: true,
    name: '한 명씩 5줄 6칸',
    description: '통로 없이 한 명씩 앉는 단순한 격자입니다. 30자리',
    rows: 5,
    cols: 6,
    pairDesks: false,
  },
  // Group rooms are not in this list: a plain grid with an aisle in it cannot
  // represent 모둠 islands honestly. They get their own builder below, which
  // produces real islands sized to the class.
  {
    key: 'wide',
    name: '넓은 교실 6줄 8칸',
    // Eight, not seven: with pairing an odd column count always leaves one
    // student at a single desk on the end of every row.
    description: '줄이 하나 더 있는 넓은 교실. 48자리',
    rows: 6,
    cols: 8,
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

  const plan = useAppStore((s) => s.generate.plan);
  const setOptions = useAppStore((s) => s.setGenerateOptions);
  const [showAllShapes, setShowAllShapes] = useState(false);

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
          {/*
            One question, asked once. The «자리 만들기» screen reads this answer
            instead of asking its own version of it.
          */}
          <div className="card space-y-2">
            <h2 className="text-sm font-semibold">무엇을 만들까요</h2>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['seats', '일반 자리 배치', '짝꿍 · 시험 등 줄 배치'],
                  ['groups', '모둠 배치', '모둠끼리 모여 앉기'],
                ] as const
              ).map(([value, title, note]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOptions({ plan: value })}
                  className={`rounded-lg border p-2.5 text-left ${
                    plan === value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{note}</span>
                </button>
              ))}
            </div>
          </div>

          {plan === 'seats' && (
          <div className="card space-y-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <GridIcon className="h-4 w-4" />
              교실 모양 고르기
            </h2>
            <div className="space-y-2">
              {TEMPLATES.filter((t) => showAllShapes || t.common).map((template) => (
                <button
                  key={template.key}
                  type="button"
                  className="w-full rounded-lg border border-slate-200 p-2.5 text-left text-xs hover:border-blue-400 dark:border-slate-700"
                  onClick={() =>
                    setClassroom(
                      template.build
                        ? template.build(classroom.windowSide)
                        : createClassroom({
                            rows: template.rows ?? 5,
                            cols: template.cols ?? 6,
                            pairDesks: template.pairDesks ?? false,
                            aisleCols: template.aisleCols,
                            windowSide: classroom.windowSide,
                            // The room carries its shape's name so a saved
                            // arrangement can say «시험 대형» rather than just
                            // «자리 배치», which is the difference between a
                            // 담임's two saves being tellable apart or not.
                            name: template.name,
                          }),
                    )
                  }
                >
                  <span className="block font-semibold text-sm">{template.name}</span>
                  <span className="mt-0.5 block text-slate-500">{template.description}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn-ghost w-full text-xs"
              onClick={() => setShowAllShapes((open) => !open)}
            >
              {showAllShapes ? '흔한 모양만 보기' : '다른 모양 더 보기 (분단 · ㄷ자 · 원형 …)'}
            </button>
          </div>
          )}

          {plan === 'groups' && <GroupRoomBuilder />}

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

/**
 * Builds a room of real 모둠 islands.
 *
 * This replaced a "모둠 6개" template that was really just a grid with an
 * aisle down the middle — pressing it produced something that looked like two
 * blocks of twelve, which said one thing and showed another.
 *
 * Island sizes come from the actual class size, so choosing 6모둠 for 25
 * students builds 5·4·4·4·4·4 rather than pretending everyone fits in fours.
 */
function GroupRoomBuilder() {
  const students = useAppStore((s) => s.students);
  const classroom = useAppStore((s) => s.classroom);
  const setClassroom = useAppStore((s) => s.setClassroom);

  /**
   * The group count lives in the store, not here.
   *
   * It used to be local state, and «자리 만들기» kept its own copy — so the
   * teacher answered «몇 모둠» twice and the second answer rebuilt the room
   * the first had shaped. One value, read by both screens.
   */
  const { groupCount, sizeMode, targetSize, minSize, maxSize, chosenPlan } = useAppStore(
    (s) => s.generate,
  );
  const setOptions = useAppStore((s) => s.setGenerateOptions);
  const setGroupCount = (count: number) => {
    setOptions({ groupCount: count, chosenPlan: null });
    // Slot numbers only mean something for a given island count.
    setBigSlots([]);
  };
  const setSizeMode = (value: 'byCount' | 'bySize') =>
    setOptions({ sizeMode: value, chosenPlan: null });
  const setChosenPlan = (value: number[] | null) => setOptions({ chosenPlan: value });

  const [gap, setGap] = useState(1);
  /** Islands the teacher wants the larger groups to sit in, 0-based. */
  const [bigSlots, setBigSlots] = useState<number[]>([]);

  const activeCount = students.filter((s) => s.status === 'active').length;

  // With no roster yet, fall back to four per group so the preview is still
  // meaningful rather than empty.
  const total = activeCount > 0 ? activeCount : groupCount * 4;

  const { plans, planError } = useMemo(() => {
    const result = planGroupSizes({ total, sizeMode, groupCount, targetSize, minSize, maxSize });
    return { plans: result.plans, planError: result.error };
  }, [total, sizeMode, groupCount, targetSize, minSize, maxSize]);

  const plannedSizes = chosenPlan ?? plans[0]?.sizes ?? [];

  const plan = useMemo(
    () => ({
      sizes: plannedSizes.length > 0 ? arrangeSizes(plannedSizes, bigSlots) : [],
      total,
      error: planError,
    }),
    [plannedSizes, bigSlots, total, planError],
  );

  const build = () => {
    if (plan.sizes.length === 0) return;
    setClassroom(
      createGroupClassroom({
        sizes: plan.sizes,
        gap,
        windowSide: classroom.windowSide,
      }),
    );
  };

  /**
   * 지식시장 (knowledge market): the same islands, arranged as a street.
   *
   * In this model two of each four keep the stall and explain, while the other
   * two walk to the next group, three times at five-minute intervals. That
   * only works if «the next group» is obvious and the walk is short, so the
   * islands go in two facing rows with the widest aisle the builder allows —
   * stalls down both sides of a market street — instead of the tidy block a
   * normal group room uses.
   */
  const buildMarket = () => {
    if (plan.sizes.length === 0) return;
    setClassroom(
      createGroupClassroom({
        sizes: plan.sizes,
        gap: MAX_GAP,
        islandsPerRow: Math.ceil(plan.sizes.length / 2),
        windowSide: classroom.windowSide,
      }),
    );
  };

  return (
    <div className="card space-y-3">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold">
        <UsersIcon className="h-4 w-4" />
        모둠 교실 만들기
      </h2>
      <p className="text-xs text-slate-500">
        모둠마다 책상 섬을 만들고 사이를 통로로 비웁니다. 같은 모둠은 마주 보고 모여 앉습니다.
      </p>

        <div className="card space-y-3">
          <h2 className="text-sm font-semibold">모둠 인원 정하기</h2>

          <div className="flex flex-wrap gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={sizeMode === 'byCount'} onChange={() => { setSizeMode('byCount'); setChosenPlan(null); }} />
              모둠 수로 정하기
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={sizeMode === 'bySize'} onChange={() => { setSizeMode('bySize'); setChosenPlan(null); }} />
              모둠당 인원으로 정하기
            </label>
          </div>

          {sizeMode === 'byCount' ? (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="gc">모둠 수</label>
                <input
                  id="gc"
                  type="number"
                  min={1}
                  max={Math.max(1, total)}
                  className="input w-24"
                  value={groupCount}
                  onChange={(e) => setGroupCount(Math.max(1, Number(e.target.value)))}
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {GROUP_COUNT_CHOICES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`rounded-lg border px-2.5 py-1 text-xs ${
                      groupCount === n
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                    onClick={() => setGroupCount(n)}
                  >
                    {n}모둠
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="ts">모둠당 인원</label>
                <input id="ts" type="number" min={1} className="input w-20" value={targetSize}
                  onChange={(e) => setOptions({ targetSize: Math.max(1, Number(e.target.value)), chosenPlan: null })} />
              </div>
              <div>
                <label className="label" htmlFor="mn">최소</label>
                <input id="mn" type="number" min={1} className="input w-20" value={minSize}
                  onChange={(e) => setOptions({ minSize: Math.max(1, Number(e.target.value)), chosenPlan: null })} />
              </div>
              <div>
                <label className="label" htmlFor="mx">최대</label>
                <input id="mx" type="number" min={1} className="input w-20" value={maxSize}
                  onChange={(e) => setOptions({ maxSize: Math.max(1, Number(e.target.value)), chosenPlan: null })} />
              </div>
            </div>
          )}

          {planError && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {planError}
            </p>
          )}



          {plans.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                {total}명을 나눌 수 있는 방법입니다. 원하는 것을 고르세요.
              </p>
              {plans.map((plan) => {
                const selected = (chosenPlan ?? plans[0]?.sizes ?? []).join(',') === plan.sizes.join(',');
                return (
                  <button
                    key={plan.groupCount}
                    type="button"
                    onClick={() => setChosenPlan(plan.sizes)}
                    className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left ${
                      selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {selected && <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />}
                    <span className="text-sm">
                      <span className="font-semibold">
                        {plan.groupCount}모둠 — {plan.sizes.join(', ')}명
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {plan.note} 최대 인원 차이 {plan.maxDifference}명.
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>


      <div>
        <span className="label">모둠 사이 간격</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {[
            { value: 1, label: '보통' },
            { value: 2, label: '넓게' },
            { value: MAX_GAP, label: '아주 넓게' },
          ].map((choice) => (
            <button
              key={choice.value}
              type="button"
              onClick={() => setGap(choice.value)}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                gap === choice.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      {hasUnevenSizes(plan.sizes) && (
        <div>
          <span className="label">
            인원이 많은 모둠 자리
            {largerGroupCount(plan.sizes) > 1 && ` (${largerGroupCount(plan.sizes)}곳)`}
          </span>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {Math.max(...plan.sizes)}명 모둠을 어디에 둘지 고르세요. 고르지 않으면 앞쪽부터 채웁니다.
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {plan.sizes.map((size, index) => {
              const isBig = size === Math.max(...plan.sizes);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() =>
                    setBigSlots((current) => {
                      const without = current.filter((slot) => slot !== index);
                      if (without.length !== current.length) return without;
                      // Keep only as many picks as there are larger groups,
                      // dropping the oldest so a click always does something.
                      return [...without, index].slice(-largerGroupCount(plan.sizes));
                    })
                  }
                  className={`rounded-lg border px-2 py-1 text-xs ${
                    isBig
                      ? 'border-blue-500 bg-blue-50 font-semibold dark:bg-blue-950'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                  aria-pressed={isBig}
                >
                  {index + 1}모둠 {size}명
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/*
        The plan card above says which sizes; this says which island gets
        which, which is the thing the slot buttons change and the only place
        that order is visible. Phrased differently on purpose — the two lines
        used to be word for word identical.
      */}
      {plan.error === null && plan.sizes.length > 0 && (
        <p className="text-xs text-slate-600 dark:text-slate-400">
          섬 순서 {plan.sizes.join(' · ')}명 · 좌석{' '}
          {plan.sizes.reduce((a, b) => a + b, 0)}석
          {activeCount === 0 && ' (명단이 없어 한 모둠 4명으로 가정)'}
        </p>
      )}

      <button
        type="button"
        className="btn-primary w-full"
        onClick={build}
        disabled={plan.sizes.length === 0}
      >
        이 모양으로 교실 만들기
      </button>

      <button
        type="button"
        className="btn-secondary w-full"
        onClick={buildMarket}
        disabled={plan.sizes.length === 0}
      >
        지식시장 대형으로 만들기
      </button>
      <p className="text-[11px] text-slate-500">
        같은 모둠 수로, 섬을 마주 보는 두 줄로 놓고 가운데를 넓게 비웁니다. 모둠마다 두 명은
        남아 설명하고 두 명이 옆 모둠으로 옮겨 다니는 수업에 맞춘 배치입니다.
      </p>

      <p className="text-[11px] text-slate-500">
        «자리 만들기»에서 «모둠 + 자리 배치»를 고르면 이 과정이 자동으로 이루어지므로, 여기서
        미리 만들지 않아도 됩니다.
      </p>
    </div>
  );
}
