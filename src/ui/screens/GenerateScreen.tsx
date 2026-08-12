/**
 * Step 5 — make the arrangement.
 *
 * Group sizing is the part teachers care most about, so the alternatives are
 * shown as cards with the trade-off of each written out, rather than the app
 * silently picking one.
 */

import { useMemo, useState } from 'react';

import { diagnoseGrouping, diagnoseSeating } from '@/core/constraints/diagnose';
import {
  alternativesForSize,
  partitionByCount,
  PartitionError,
  planPairs,
  type OddStudentStrategy,
  type SizePlan,
} from '@/core/solver/partition';
import { createGroupClassroom, islandsMatchSizes } from '@/core/layout/groupIslands';
import { EFFORT_LABELS, type Effort, type SeatingCandidate } from '@/core/solver/seating';
import type { GroupingCandidate } from '@/core/solver/grouping';
import { runGrouping, runSeating } from '@/lib/solverClient';
import { safeErrorMessage } from '@/lib/log';
import { useAppStore, type GenerateMode } from '@/store/useAppStore';
import { CheckIcon, ShuffleIcon, WarningIcon } from '../components/Icons';

type Mode = GenerateMode;

const MODE_LABELS: Record<Mode, { title: string; description: string }> = {
  seats: { title: '일반 자리 배치', description: '교실 좌석에 학생을 배치합니다.' },
  pairs: { title: '2인 짝꿍 배치', description: '두 명씩 앉는 책상에 짝을 지어 배치합니다.' },
  groups: { title: '모둠 편성만', description: '자리는 그대로 두고 모둠만 나눕니다.' },
  groupSeats: { title: '모둠 + 자리 배치', description: '모둠을 나누고 좌석에도 배치합니다.' },
};

type SizeMode = 'byCount' | 'bySize';

export function GenerateScreen() {
  const students = useAppStore((s) => s.students);
  const classroom = useAppStore((s) => s.classroom);
  const constraints = useAppStore((s) => s.constraints);
  const history = useAppStore((s) => s.history);
  const seed = useAppStore((s) => s.seed);
  const effort = useAppStore((s) => s.effort);
  const lockedSeatIds = useAppStore((s) => s.lockedSeatIds);
  const assignment = useAppStore((s) => s.assignment);
  const grouping = useAppStore((s) => s.grouping);
  const setSeed = useAppStore((s) => s.setSeed);
  const rerollSeed = useAppStore((s) => s.rerollSeed);
  const setEffort = useAppStore((s) => s.setEffort);
  const setAssignment = useAppStore((s) => s.setAssignment);
  const setGrouping = useAppStore((s) => s.setGrouping);
  const setStep = useAppStore((s) => s.setStep);
  const setClassroom = useAppStore((s) => s.setClassroom);

  // Kept in the store so stepping back to the roster does not discard them.
  const options = useAppStore((s) => s.generate);
  const setOptions = useAppStore((s) => s.setGenerateOptions);
  const {
    mode,
    sizeMode,
    groupCount,
    targetSize,
    minSize,
    maxSize,
    chosenPlan,
    oddStrategy,
    keepLocked,
    autoGroupRoom,
    groupGap,
  } = options;

  const setMode = (value: Mode) => setOptions({ mode: value });
  const setSizeMode = (value: SizeMode) => setOptions({ sizeMode: value, chosenPlan: null });
  const setChosenPlan = (value: number[] | null) => setOptions({ chosenPlan: value });

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seatCandidates, setSeatCandidates] = useState<SeatingCandidate[]>([]);
  const [groupCandidates, setGroupCandidates] = useState<GroupingCandidate[]>([]);

  const active = students.filter((s) => s.status === 'active');
  const total = active.length;

  const usesGroups = mode === 'groups' || mode === 'groupSeats';

  // --- size planning ------------------------------------------------------
  const { plans, planError } = useMemo(() => {
    if (!usesGroups || total === 0) return { plans: [] as SizePlan[], planError: null as string | null };
    try {
      if (sizeMode === 'byCount') {
        const sizes = partitionByCount(total, groupCount);
        const max = Math.max(...sizes);
        const min = Math.min(...sizes);
        return {
          plans: [
            {
              groupCount,
              sizes,
              maxDifference: max - min,
              deviationFromTarget: 0,
              offTargetGroups: 0,
              note:
                max === min
                  ? `${total}명이 ${groupCount}모둠으로 정확히 나누어떨어집니다.`
                  : `${max}명 모둠 ${sizes.filter((s) => s === max).length}개와 ${min}명 모둠 ${sizes.filter((s) => s === min).length}개로 나뉩니다. 인원 차이는 1명입니다.`,
            },
          ],
          planError: null,
        };
      }
      return { plans: alternativesForSize(total, { target: targetSize, min: minSize, max: maxSize }), planError: null };
    } catch (caught) {
      return {
        plans: [] as SizePlan[],
        planError: caught instanceof PartitionError ? caught.message : safeErrorMessage(caught),
      };
    }
  }, [usesGroups, total, sizeMode, groupCount, targetSize, minSize, maxSize]);

  const effectiveSizes = chosenPlan ?? plans[0]?.sizes ?? [];

  const pairPlan = useMemo(
    () => (mode === 'pairs' && total > 0 ? planPairs(total, oddStrategy) : null),
    [mode, total, oddStrategy],
  );

  // --- diagnosis ----------------------------------------------------------
  const diagnoses = useMemo(() => {
    const rebuildsRoom = mode === 'groupSeats' && autoGroupRoom;
    let list = mode === 'groups' ? [] : diagnoseSeating({ classroom, students, constraints });
    // The room is about to be rebuilt to fit the groups exactly, so a shortage
    // in the current layout is not something the teacher has to fix.
    if (rebuildsRoom) {
      list = list.filter((d) => d.code !== 'notEnoughSeats' && d.code !== 'fixedSeatUnusable');
    }
    if (usesGroups && effectiveSizes.length > 0) {
      list.push(
        ...diagnoseGrouping({
          students,
          groupCount: effectiveSizes.length,
          groupSizes: effectiveSizes,
          constraints,
        }),
      );
    }
    return list;
  }, [mode, usesGroups, autoGroupRoom, classroom, students, constraints, effectiveSizes]);

  const blocking = diagnoses.filter((d) => d.level === 'blocking');

  // --- run ----------------------------------------------------------------
  const generate = async () => {
    setRunning(true);
    setError(null);
    try {
      const withinLast = Math.max(
        1,
        ...constraints
          .filter((c) => c.kind.startsWith('avoidPast'))
          .map((c) => ('withinLast' in c ? c.withinLast : 1)),
      );

      let nextGrouping = grouping;
      if (usesGroups) {
        const result = await runGrouping({
          students,
          sizes: effectiveSizes,
          constraints,
          seed,
          effort,
          candidateCount: 3,
          classroom,
          records: history,
          withinLast,
          previous: grouping ?? undefined,
        });
        setGroupCandidates(result.candidates);
        nextGrouping = result.candidates[0]?.grouping ?? null;
        if (nextGrouping) setGrouping(nextGrouping);
      }

      if (mode !== 'groups') {
        // For a group seating, rebuild the room as one island per group unless
        // the teacher has turned that off. The islands carry the group number
        // on each seat, which is what actually keeps a group sitting together.
        let room = classroom;
        if (mode === 'groupSeats' && autoGroupRoom && nextGrouping) {
          const sizes = nextGrouping.groups.map((group) => group.memberIds.length);
          if (!islandsMatchSizes(room, sizes)) {
            room = createGroupClassroom({
              sizes,
              gap: groupGap,
              windowSide: classroom.windowSide,
              teacherDeskAlign: classroom.teacherDeskAlign,
            });
            setClassroom(room);
          }
        }

        // Seat ids change when the room is rebuilt, so locks from the old
        // layout no longer refer to anything.
        const keepSeats =
          keepLocked && room === classroom
            ? Object.fromEntries(
                Object.entries(assignment).filter(([seatId]) => lockedSeatIds.includes(seatId)),
              )
            : {};

        const result = await runSeating({
          classroom: room,
          students,
          constraints,
          seed,
          effort,
          candidateCount: 3,
          records: history,
          withinLast,
          keepSeats,
          grouping: nextGrouping ?? undefined,
        });
        setSeatCandidates(result.candidates);
        const best = result.candidates[0];
        if (best) setAssignment(best.assignment);
        if (result.unsatisfiable) {
          setError(
            '«반드시 지킴» 조건을 모두 만족하는 배치를 찾지 못했습니다. 아래 결과는 가장 가까운 것이며, 위반한 조건이 함께 표시됩니다. 조건 몇 개의 강도를 낮춰 보세요.',
          );
        }
      }

      setStep('result');
    } catch (caught) {
      setError(safeErrorMessage(caught, '자리를 만드는 중 문제가 발생했습니다.'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">자리 만들기</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          배치할 학생 {total}명
          {students.length !== total && ` (제외 ${students.length - total}명)`}
        </p>
      </div>

      <div className="card space-y-2">
        <h2 className="text-sm font-semibold">무엇을 만들까요</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(MODE_LABELS) as Mode[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`rounded-lg border p-2.5 text-left text-xs ${
                mode === key
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <span className="block text-sm font-semibold">{MODE_LABELS[key].title}</span>
              <span className="mt-0.5 block text-slate-500">{MODE_LABELS[key].description}</span>
            </button>
          ))}
        </div>
      </div>

      {mode === 'pairs' && pairPlan && (
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold">짝 편성</h2>
          <p className="text-sm">{pairPlan.note}</p>
          {total % 2 === 1 && (
            <div>
              <label className="label" htmlFor="odd">남는 한 명을 어떻게 할까요</label>
              <select
                id="odd"
                className="input max-w-xs"
                value={oddStrategy}
                onChange={(e) => setOptions({ oddStrategy: e.target.value as OddStudentStrategy })}
              >
                <option value="alone">한 자리에 혼자 앉히기</option>
                <option value="trio">한 책상만 3인으로 만들기</option>
                <option value="teacherPicks">혼자 앉을 학생을 내가 고르기</option>
              </select>
            </div>
          )}
        </div>
      )}

      {usesGroups && (
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
                  onChange={(e) => setOptions({ groupCount: Math.max(1, Number(e.target.value)), chosenPlan: null })}
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {[4, 5, 6, 7, 8].map((n) => (
                  <button key={n} type="button" className="btn-secondary px-2 py-1 text-xs"
                    onClick={() => setOptions({ groupCount: n, chosenPlan: null })}>
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

          {mode === 'groupSeats' && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={autoGroupRoom}
                  onChange={(e) => setOptions({ autoGroupRoom: e.target.checked })}
                />
                <span>
                  <span className="font-medium">모둠 모양으로 교실 자동 만들기</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    모둠마다 책상 섬을 만들고 사이에 통로를 둡니다. 같은 모둠은 마주 보고 모여 앉고,
                    다른 모둠과는 떨어집니다. <strong>교실 설정에서 만든 자리 배치는 새로 만들어집니다.</strong>
                  </span>
                </span>
              </label>

              {autoGroupRoom && (
                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <span className="text-xs text-slate-600 dark:text-slate-400">모둠 사이 간격</span>
                  {[
                    { value: 1, label: '보통 (한 칸)' },
                    { value: 2, label: '넓게 (두 칸)' },
                    { value: 3, label: '아주 넓게 (세 칸)' },
                  ].map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      onClick={() => setOptions({ groupGap: choice.value })}
                      className={`rounded-lg border px-2.5 py-1 text-xs ${
                        groupGap === choice.value
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
      )}

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold">계산 방법</h2>
        <div className="flex flex-wrap gap-2">
          {(['fast', 'balanced', 'thorough'] as Effort[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setEffort(value)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                effort === value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              {EFFORT_LABELS[value]}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          조건이 많을수록 «정밀 생성»이 유리합니다. 어떤 설정이든 몇 초 안에 반드시 끝납니다.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="seed">랜덤 시드</label>
            <input
              id="seed"
              type="number"
              className="input w-36"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) >>> 0)}
            />
          </div>
          <button type="button" className="btn-secondary" onClick={rerollSeed}>
            <ShuffleIcon />
            시드 바꾸기
          </button>
          <p className="text-xs text-slate-500">
            같은 명단·같은 조건·같은 시드면 항상 같은 결과가 나옵니다.
          </p>
        </div>

        {lockedSeatIds.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={keepLocked} onChange={(e) => setOptions({ keepLocked: e.target.checked })} />
            잠근 자리 {lockedSeatIds.length}곳은 그대로 두고 나머지만 다시 배치하기
          </label>
        )}
      </div>

      {diagnoses.length > 0 && (
        <div className="space-y-2">
          {diagnoses.map((diagnosis, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                diagnosis.level === 'blocking'
                  ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
                  : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
              }`}
            >
              <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">{diagnosis.message}</p>
                <p className="mt-0.5 text-xs opacity-90">{diagnosis.suggestion}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary px-5 py-2.5 text-base"
          onClick={() => void generate()}
          disabled={running || total === 0 || blocking.length > 0}
        >
          <ShuffleIcon />
          {running ? '만드는 중…' : '자리 만들기'}
        </button>
        {blocking.length > 0 && (
          <span className="text-xs text-red-600 dark:text-red-400">
            위의 빨간 항목을 해결해야 만들 수 있습니다.
          </span>
        )}
        {(seatCandidates.length > 0 || groupCandidates.length > 0) && (
          <button type="button" className="btn-secondary" onClick={() => setStep('result')}>
            결과 보기
          </button>
        )}
      </div>
    </div>
  );
}
