/**
 * Step 5 — make the arrangement.
 *
 * Group sizing is the part teachers care most about, so the alternatives are
 * shown as cards with the trade-off of each written out, rather than the app
 * silently picking one.
 */

import { useMemo, useState } from 'react';

import { diagnoseGrouping, diagnoseSeating } from '@/core/constraints/diagnose';
import { planPairs, type OddStudentStrategy, type SizePlan } from '@/core/solver/partition';
import { planGroupSizes } from '@/core/solver/planning';
import {
  createGroupClassroom,
  islandCapacityList,
  sameSizeMultiset,
} from '@/core/layout/groupIslands';
import { assignInNumberOrder } from '@/core/layout/numberOrder';
import { EFFORT_LABELS, type Effort, type SeatingCandidate } from '@/core/solver/seating';
import type { GroupingCandidate } from '@/core/solver/grouping';
import { runGrouping, runSeating } from '@/lib/solverClient';
import { safeErrorMessage } from '@/lib/log';
import { useAppStore, type GenerateMode } from '@/store/useAppStore';
import { ShuffleIcon, WarningIcon } from '../components/Icons';

type Mode = GenerateMode;

const MODE_LABELS: Record<Mode, { title: string; description: string }> = {
  seats: { title: '일반 자리 배치', description: '교실 좌석에 학생을 배치합니다.' },
  pairs: { title: '2인 짝꿍 배치', description: '두 명씩 앉는 책상에 짝을 지어 배치합니다.' },
  groups: { title: '모둠 편성만', description: '자리는 그대로 두고 모둠만 나눕니다.' },
  groupSeats: { title: '모둠 + 자리 배치', description: '모둠을 나누고 좌석에도 배치합니다.' },
};

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
    plan,
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


  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seatCandidates, setSeatCandidates] = useState<SeatingCandidate[]>([]);
  const [groupCandidates, setGroupCandidates] = useState<GroupingCandidate[]>([]);

  /**
   * Exam seating: attendance order, no constraints, no seed. Kept out of
   * `generate()` because it shares nothing with it — no worker, no candidates,
   * no scoring. It writes an arrangement and moves on.
   */
  const seatInNumberOrder = () => {
    const { assignment: seated, unseated } = assignInNumberOrder(classroom, students);
    setAssignment(seated);
    setError(
      unseated.length === 0
        ? null
        : `자리가 모자라 ${unseated.length}명이 앉지 못했습니다. 교실 크기를 늘려 주세요.`,
    );
    setStep('result');
  };


  /**
   * The four old modes, worked out rather than asked for.
   *
   * «모둠» always means groups seated as groups — grouping without seating was
   * a separate button nobody chose deliberately. And a room of two-person
   * desks seats pairs: the desks decide that, not a radio button.
   */
  const hasPairDesks = classroom.seats.some((seat) => seat.deskId !== undefined);
  const mode: Mode = plan === 'groups' ? 'groupSeats' : hasPairDesks ? 'pairs' : 'seats';

  const active = students.filter((s) => s.status === 'active');
  const total = active.length;

  const usesGroups = plan === 'groups';

  // --- size planning ------------------------------------------------------
  const { plans } = useMemo(() => {
    if (!usesGroups) return { plans: [] as SizePlan[], planError: null as string | null };
    const result = planGroupSizes({ total, sizeMode, groupCount, targetSize, minSize, maxSize });
    return { plans: result.plans, planError: result.error };
  }, [usesGroups, total, sizeMode, groupCount, targetSize, minSize, maxSize]);

  const plannedSizes = chosenPlan ?? plans[0]?.sizes ?? [];

  /**
   * An island room the teacher already built wins over the default ordering.
   *
   * The sizes have to match as a multiset, not slot by slot, so that moving
   * the 5-person island to a different corner on the 교실 screen is respected
   * instead of being rebuilt back to «biggest group first».
   */
  const roomSizes = useMemo(() => islandCapacityList(classroom), [classroom]);
  const roomMatchesPlan =
    usesGroups && roomSizes.length > 0 && sameSizeMultiset(roomSizes, plannedSizes);
  const effectiveSizes = roomMatchesPlan ? roomSizes : plannedSizes;

  const pairPlan = useMemo(
    () => (mode === 'pairs' && total > 0 ? planPairs(total, oddStrategy) : null),
    [mode, total, oddStrategy],
  );

  // --- diagnosis ----------------------------------------------------------
  const diagnoses = useMemo(() => {
    const rebuildsRoom = mode === 'groupSeats' && autoGroupRoom;
    let list = diagnoseSeating({ classroom, students, constraints });
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

      {
        // For a group seating, rebuild the room as one island per group unless
        // the teacher has turned that off. The islands carry the group number
        // on each seat, which is what actually keeps a group sitting together.
        let room = classroom;
        if (mode === 'groupSeats' && autoGroupRoom && nextGrouping && !roomMatchesPlan) {
          const sizes = nextGrouping.groups.map((group) => group.memberIds.length);
          room = createGroupClassroom({
            sizes,
            gap: groupGap,
            windowSide: classroom.windowSide,
          });
          setClassroom(room);
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

      {/*
        What was decided on the 교실 screen, shown rather than asked again. The
        link goes back there instead of duplicating the control, so there is
        exactly one place the answer lives.
      */}
      <div className="card flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-semibold">{MODE_LABELS[mode].title}</span>
          {plan === 'groups' && effectiveSizes.length > 0 && (
            <span className="ml-2 text-slate-600 dark:text-slate-300">
              {effectiveSizes.length}모둠 ({effectiveSizes.join('·')}명)
            </span>
          )}
          <span className="mt-0.5 block text-xs text-slate-500">{MODE_LABELS[mode].description}</span>
        </div>
        <button type="button" className="btn-secondary shrink-0" onClick={() => setStep('classroom')}>
          교실 만들기에서 바꾸기
        </button>
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
        {/*
          Deliberately not disabled by `blocking`. Those diagnoses are about
          constraints the solver cannot satisfy, and this path satisfies no
          constraints by design — an exam room is meant to be predictable, not
          optimal. Refusing it because «떼어놓기» is impossible would withhold
          the one arrangement that never needed it.
        */}
        <button
          type="button"
          className="btn-secondary"
          onClick={seatInNumberOrder}
          disabled={running || total === 0}
          title="조건을 적용하지 않고 출석번호 순서대로 앉힙니다."
        >
          번호순으로 앉히기
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
