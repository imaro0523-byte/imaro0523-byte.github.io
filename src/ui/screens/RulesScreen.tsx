/**
 * Step 4 — the rules.
 *
 * Rules are built as cards. Severity is spelled out in words as well as
 * colour, because "red means required" is not something a teacher should have
 * to infer.
 */

import { useState } from 'react';

import { diagnoseSeating } from '@/core/constraints/diagnose';
import {
  CONSTRAINT_LABELS,
  SCOPE_LABELS,
  SEVERITY_DESCRIPTIONS,
  SEVERITY_LABELS,
  type Constraint,
  type ProximityScope,
  type Severity,
} from '@/core/constraints/kinds';
import { uuid } from '@/core/model/ids';
import { ZONE_LABELS, type ZoneTag } from '@/core/model/types';
import { useAppStore } from '@/store/useAppStore';
import { PlusIcon, TrashIcon, WarningIcon } from '../components/Icons';

type Draft =
  | { kind: 'separate' | 'together'; a: string; b: string; scope: ProximityScope; severity: Severity }
  | { kind: 'zone'; studentId: string; zone: ZoneTag; severity: Severity }
  | { kind: 'spreadTag' | 'tagBalance'; tag: string; severity: Severity }
  | { kind: 'genderMix'; mode: 'alternate' | 'balance'; severity: Severity }
  | { kind: 'avoidPastPartner' | 'avoidPastNeighbour' | 'avoidPastGroupmate'; withinLast: number; severity: Severity }
  | { kind: 'examSpacing'; minDistance: number; severity: Severity };

const PRESETS: Array<{ name: string; description: string; build: () => Constraint[] }> = [
  {
    name: '일반 수업',
    description: '지난 짝과 지난 옆자리를 피하고, 남녀가 있으면 섞어 앉힙니다.',
    build: () => [
      { id: uuid(), kind: 'avoidPastPartner', severity: 'strong', enabled: true, withinLast: 3 },
      { id: uuid(), kind: 'avoidPastNeighbour', severity: 'weak', enabled: true, withinLast: 2 },
      { id: uuid(), kind: 'genderMix', severity: 'weak', enabled: true, mode: 'alternate' },
    ],
  },
  {
    name: '시험 자리',
    description: '학생 사이에 두 칸 이상 간격을 둡니다.',
    build: () => [{ id: uuid(), kind: 'examSpacing', severity: 'strong', enabled: true, minDistance: 2 }],
  },
  {
    name: '실험 모둠',
    description: '지난 모둠원을 피하고 «리더» 태그를 모둠마다 한 명씩 나눕니다.',
    build: () => [
      { id: uuid(), kind: 'avoidPastGroupmate', severity: 'strong', enabled: true, withinLast: 3 },
      { id: uuid(), kind: 'spreadTag', severity: 'strong', enabled: true, tag: '리더' },
    ],
  },
  {
    name: '토론 모둠',
    description: '지난 모둠원을 피하고 모둠별 남녀 균형을 맞춥니다.',
    build: () => [
      { id: uuid(), kind: 'avoidPastGroupmate', severity: 'weak', enabled: true, withinLast: 5 },
      { id: uuid(), kind: 'genderMix', severity: 'weak', enabled: true, mode: 'balance' },
    ],
  },
];

export function RulesScreen() {
  const students = useAppStore((s) => s.students);
  const classroom = useAppStore((s) => s.classroom);
  const constraints = useAppStore((s) => s.constraints);
  const addConstraint = useAppStore((s) => s.addConstraint);
  const updateConstraint = useAppStore((s) => s.updateConstraint);
  const removeConstraint = useAppStore((s) => s.removeConstraint);
  const setStep = useAppStore((s) => s.setStep);

  const active = students.filter((s) => s.status === 'active');
  const [draft, setDraft] = useState<Draft>({
    kind: 'separate',
    a: active[0]?.id ?? '',
    b: active[1]?.id ?? '',
    scope: 'anyAdjacent',
    severity: 'hard',
  });

  const diagnoses = diagnoseSeating({ classroom, students, constraints });
  const nameOf = (id: string) => {
    const student = students.find((s) => s.id === id);
    return student ? `${student.number ?? ''} ${student.name}`.trim() : '(삭제된 학생)';
  };

  const describe = (constraint: Constraint): string => {
    switch (constraint.kind) {
      case 'fixedSeat':
        return `${nameOf(constraint.studentId)} — 지정한 자리에 앉히기`;
      case 'fixedGroup':
        return `${nameOf(constraint.studentId)} — ${constraint.groupIndex}모둠에 넣기`;
      case 'separate':
        return `${constraint.studentIds.map(nameOf).join(' · ')} — ${SCOPE_LABELS[constraint.scope]} 피하기`;
      case 'together':
        return `${constraint.studentIds.map(nameOf).join(' · ')} — ${SCOPE_LABELS[constraint.scope]}`;
      case 'zone':
        return `${nameOf(constraint.studentId)} — ${ZONE_LABELS[constraint.zone]} 쪽에 앉히기`;
      case 'avoidPastPartner':
        return `최근 ${constraint.withinLast}회 안에 짝이었던 학생끼리 다시 짝이 되지 않기`;
      case 'avoidPastNeighbour':
        return `최근 ${constraint.withinLast}회 안에 옆자리였던 학생끼리 다시 붙지 않기`;
      case 'avoidPastGroupmate':
        return `최근 ${constraint.withinLast}회 안에 같은 모둠이었던 학생끼리 다시 만나지 않기`;
      case 'genderMix':
        return constraint.mode === 'alternate' ? '남녀를 번갈아 앉히기' : '남녀 인원을 고르게 나누기';
      case 'tagBalance':
        return `«${constraint.tag}» 학생을 모둠마다 고르게 나누기`;
      case 'spreadTag':
        return `«${constraint.tag}» 학생을 모둠마다 한 명씩 나누기`;
      case 'examSpacing':
        return `학생 사이를 ${constraint.minDistance}칸 이상 띄우기`;
    }
  };

  const addFromDraft = () => {
    const id = uuid();
    let constraint: Constraint | null = null;
    switch (draft.kind) {
      case 'separate':
      case 'together':
        if (!draft.a || !draft.b || draft.a === draft.b) return;
        constraint = {
          id,
          kind: draft.kind,
          severity: draft.severity,
          enabled: true,
          studentIds: [draft.a, draft.b],
          scope: draft.scope,
        };
        break;
      case 'zone':
        if (!draft.studentId) return;
        constraint = { id, kind: 'zone', severity: draft.severity, enabled: true, studentId: draft.studentId, zone: draft.zone };
        break;
      case 'spreadTag':
      case 'tagBalance':
        if (!draft.tag.trim()) return;
        constraint = { id, kind: draft.kind, severity: draft.severity, enabled: true, tag: draft.tag.trim() };
        break;
      case 'genderMix':
        constraint = { id, kind: 'genderMix', severity: draft.severity, enabled: true, mode: draft.mode };
        break;
      case 'avoidPastPartner':
      case 'avoidPastNeighbour':
      case 'avoidPastGroupmate':
        constraint = { id, kind: draft.kind, severity: draft.severity, enabled: true, withinLast: draft.withinLast };
        break;
      case 'examSpacing':
        constraint = { id, kind: 'examSpacing', severity: draft.severity, enabled: true, minDistance: draft.minDistance };
        break;
    }
    if (constraint) addConstraint(constraint);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">조건 정하기</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            조건 없이 바로 만들어도 됩니다. 필요한 것만 골라 추가하세요.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setStep('generate')}>
          자리 만들기로
        </button>
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
                <p className="font-semibold">
                  {diagnosis.level === 'blocking' ? '해결해야 만들 수 있습니다' : '참고하세요'} — {diagnosis.message}
                </p>
                <p className="mt-0.5 text-xs opacity-90">{diagnosis.suggestion}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2 className="text-sm font-semibold">자주 쓰는 묶음</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="rounded-lg border border-slate-200 p-2.5 text-left text-xs hover:border-blue-400 dark:border-slate-700"
              onClick={() => preset.build().forEach(addConstraint)}
            >
              <span className="block text-sm font-semibold">{preset.name}</span>
              <span className="mt-0.5 block text-slate-500">{preset.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold">조건 하나 추가하기</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="kind">무엇을 정할까요</label>
            <select
              id="kind"
              className="input"
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as Draft['kind'];
                if (kind === 'separate' || kind === 'together') {
                  setDraft({ kind, a: active[0]?.id ?? '', b: active[1]?.id ?? '', scope: 'anyAdjacent', severity: 'hard' });
                } else if (kind === 'zone') {
                  setDraft({ kind, studentId: active[0]?.id ?? '', zone: 'frontRow', severity: 'weak' });
                } else if (kind === 'spreadTag' || kind === 'tagBalance') {
                  setDraft({ kind, tag: '리더', severity: 'strong' });
                } else if (kind === 'genderMix') {
                  setDraft({ kind, mode: 'alternate', severity: 'weak' });
                } else if (kind === 'examSpacing') {
                  setDraft({ kind, minDistance: 2, severity: 'strong' });
                } else {
                  setDraft({ kind, withinLast: 3, severity: 'strong' });
                }
              }}
            >
              <option value="separate">떨어뜨리기</option>
              <option value="together">가까이 앉히기</option>
              <option value="zone">자리 위치 희망</option>
              <option value="avoidPastPartner">지난 짝 피하기</option>
              <option value="avoidPastNeighbour">지난 옆자리 피하기</option>
              <option value="avoidPastGroupmate">지난 모둠원 피하기</option>
              <option value="genderMix">남녀 섞기</option>
              <option value="spreadTag">태그 분산 (모둠마다 한 명)</option>
              <option value="tagBalance">태그 균형</option>
              <option value="examSpacing">시험 자리 간격</option>
            </select>
          </div>

          <div>
            <label className="label" htmlFor="severity">얼마나 꼭 지킬까요</label>
            <select
              id="severity"
              className="input"
              value={draft.severity}
              onChange={(e) => setDraft({ ...draft, severity: e.target.value as Severity })}
            >
              {(['hard', 'strong', 'weak'] as Severity[]).map((severity) => (
                <option key={severity} value={severity}>
                  {SEVERITY_LABELS[severity]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">{SEVERITY_DESCRIPTIONS[draft.severity]}</p>
          </div>

          {(draft.kind === 'separate' || draft.kind === 'together') && (
            <>
              <div>
                <label className="label" htmlFor="sa">학생 1</label>
                <select id="sa" className="input" value={draft.a} onChange={(e) => setDraft({ ...draft, a: e.target.value })}>
                  {active.map((s) => (
                    <option key={s.id} value={s.id}>{s.number} {s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="sb">학생 2</label>
                <select id="sb" className="input" value={draft.b} onChange={(e) => setDraft({ ...draft, b: e.target.value })}>
                  {active.map((s) => (
                    <option key={s.id} value={s.id}>{s.number} {s.name}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="scope">어떤 관계를</label>
                <select
                  id="scope"
                  className="input"
                  value={draft.scope}
                  onChange={(e) => setDraft({ ...draft, scope: e.target.value as ProximityScope })}
                >
                  {(['anyAdjacent', 'adjacent', 'sameDesk', 'sameGroup'] as ProximityScope[]).map((scope) => (
                    <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {draft.kind === 'zone' && (
            <>
              <div>
                <label className="label" htmlFor="zs">학생</label>
                <select id="zs" className="input" value={draft.studentId} onChange={(e) => setDraft({ ...draft, studentId: e.target.value })}>
                  {active.map((s) => (
                    <option key={s.id} value={s.id}>{s.number} {s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="zz">어디에</label>
                <select id="zz" className="input" value={draft.zone} onChange={(e) => setDraft({ ...draft, zone: e.target.value as ZoneTag })}>
                  {(Object.keys(ZONE_LABELS) as ZoneTag[]).map((zone) => (
                    <option key={zone} value={zone}>{ZONE_LABELS[zone]}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {(draft.kind === 'spreadTag' || draft.kind === 'tagBalance') && (
            <div>
              <label className="label" htmlFor="tag">태그 이름</label>
              <input id="tag" className="input" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} />
              <p className="mt-1 text-[11px] text-slate-500">명단 화면의 «태그» 칸에 적은 것과 같아야 합니다.</p>
            </div>
          )}

          {draft.kind === 'genderMix' && (
            <div>
              <label className="label" htmlFor="mode">방식</label>
              <select id="mode" className="input" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as 'alternate' | 'balance' })}>
                <option value="alternate">번갈아 앉히기</option>
                <option value="balance">인원만 고르게</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                성별을 입력한 학생끼리만 적용됩니다. 미지정 학생이 있어도 오류 없이 동작합니다.
              </p>
            </div>
          )}

          {(draft.kind === 'avoidPastPartner' || draft.kind === 'avoidPastNeighbour' || draft.kind === 'avoidPastGroupmate') && (
            <div>
              <label className="label" htmlFor="within">최근 몇 회까지 볼까요</label>
              <input id="within" type="number" min={1} max={20} className="input" value={draft.withinLast}
                onChange={(e) => setDraft({ ...draft, withinLast: Math.max(1, Number(e.target.value)) })} />
            </div>
          )}

          {draft.kind === 'examSpacing' && (
            <div>
              <label className="label" htmlFor="dist">최소 간격 (칸)</label>
              <input id="dist" type="number" min={1} max={5} className="input" value={draft.minDistance}
                onChange={(e) => setDraft({ ...draft, minDistance: Math.max(1, Number(e.target.value)) })} />
            </div>
          )}
        </div>

        <button type="button" className="btn-primary" onClick={addFromDraft}>
          <PlusIcon />
          조건 추가
        </button>
      </div>

      <div className="card">
        <h2 className="text-sm font-semibold">지금 걸려 있는 조건 {constraints.length}개</h2>
        {constraints.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">아직 없습니다. 이대로 만들면 완전 무작위로 섞습니다.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {constraints.map((constraint) => (
              <li
                key={constraint.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-700"
              >
                <input
                  type="checkbox"
                  checked={constraint.enabled}
                  onChange={(e) => updateConstraint(constraint.id, { enabled: e.target.checked })}
                  aria-label="조건 사용"
                />
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                    constraint.severity === 'hard'
                      ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
                      : constraint.severity === 'strong'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                  }`}
                >
                  {SEVERITY_LABELS[constraint.severity]}
                </span>
                <span className="text-[11px] text-slate-500">{CONSTRAINT_LABELS[constraint.kind]}</span>
                <span className={constraint.enabled ? '' : 'text-slate-400 line-through'}>
                  {describe(constraint)}
                </span>
                <button
                  type="button"
                  className="btn-ghost ml-auto px-2 text-red-600 dark:text-red-400"
                  onClick={() => removeConstraint(constraint.id)}
                  aria-label="조건 삭제"
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
