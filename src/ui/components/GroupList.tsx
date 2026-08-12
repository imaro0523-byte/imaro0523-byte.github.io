import type { Grouping, Student } from '@/core/model/types';

const GROUP_COLORS = [
  '#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00',
  '#8a6ee0', '#6b7280', '#b3651e', '#0f766e', '#9d174d', '#334155',
];

/** Group membership as a printable list, alongside the seat map. */
export function GroupList({
  grouping,
  students,
}: {
  grouping: Grouping;
  students: readonly Student[];
}) {
  const byId = new Map(students.map((s) => [s.id, s]));

  return (
    <div className="card print-area">
      <h2 className="text-sm font-semibold">모둠 편성 ({grouping.groups.length}모둠)</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {grouping.groups.map((group) => {
          const color = GROUP_COLORS[(group.index - 1) % GROUP_COLORS.length];
          return (
            <div
              key={group.id}
              className="group-card rounded-lg border-l-4 border border-slate-200 p-2.5 dark:border-slate-700"
              style={{ borderLeftColor: color }}
            >
              <p className="text-sm font-bold" style={{ color }}>
                {group.name ?? `${group.index}모둠`}
                <span className="ml-1.5 text-xs font-normal text-slate-500">
                  {group.memberIds.length}명
                </span>
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {group.memberIds.map((memberId) => {
                  const student = byId.get(memberId);
                  const role = group.roles[memberId];
                  return (
                    <li key={memberId} className="break-keep">
                      {student?.number ?? '—'} {student?.name ?? ''}
                      {role && <span className="ml-1 text-slate-500">({role})</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {grouping.excludedIds.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          배치에서 제외한 학생 {grouping.excludedIds.length}명은 모둠에 포함하지 않았습니다.
        </p>
      )}
    </div>
  );
}
