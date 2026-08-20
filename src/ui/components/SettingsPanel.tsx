/**
 * Settings, including the two controls that matter most for privacy:
 * whether anything may be written to this browser at all, and the button that
 * removes everything and then checks that it really is gone.
 */

import { useEffect, useState } from 'react';

import { parseBackup } from '@/core/exportData/toJson';
import type { ArrangementRecord } from '@/core/model/types';
import { safeErrorMessage } from '@/lib/log';
import { disableOffline, enableOffline, isOfflineReady, serviceWorkerSupported } from '@/lib/pwa';
import { disposeSolver } from '@/lib/solverClient';
import {
  deleteProject,
  listProjects,
  saveProject,
  wipeEverything,
  type StoredProject,
  type WipeReport,
} from '@/lib/storage';
import { useAppStore } from '@/store/useAppStore';
import { uuid } from '@/core/model/ids';
import { TrashIcon, WarningIcon } from './Icons';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const state = useAppStore();
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [offlineReady, setOfflineReady] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [report, setReport] = useState<WipeReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    if (!state.settings.storageEnabled) {
      setProjects([]);
      return;
    }
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  };

  useEffect(refresh, [state.settings.storageEnabled]);
  useEffect(() => {
    void isOfflineReady().then(setOfflineReady);
  }, []);

  const save = async () => {
    setError(null);
    try {
      await saveProject({
        id: uuid(),
        title: state.meta?.classNumber ?? '이름 없는 배치',
        meta: state.meta,
        students: state.students,
        classroom: state.classroom,
        constraints: state.constraints,
        assignment: state.assignment,
        grouping: state.grouping,
        history: state.history,
        seed: state.seed,
      });
      state.markSaved();
      setMessage('이 브라우저에 저장했습니다.');
      refresh();
    } catch (caught) {
      setError(safeErrorMessage(caught, '저장하지 못했습니다.'));
    }
  };

  const restoreFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const backup = parseBackup(text);
      state.hydrate(backup);
      setMessage('백업 파일을 불러왔습니다.');
      onClose();
    } catch (caught) {
      setError(safeErrorMessage(caught, '백업 파일을 읽지 못했습니다.'));
    }
  };

  /**
   * Reads history out of one or more backups and adds it to what is already
   * held, leaving the current roster, room and constraints untouched.
   *
   * Restoring a backup replaces everything, which means a teacher with one
   * file per term could only ever use the newest. Terms are exactly the thing
   * worth accumulating: avoiding last month's seats is easy, avoiding every
   * seat a class has had all year is the part that needs records.
   */
  const mergeHistoryFiles = async (files: FileList) => {
    setError(null);
    try {
      const incoming: ArrangementRecord[] = [];
      for (const file of Array.from(files)) {
        incoming.push(...parseBackup(await file.text()).history);
      }
      const { added, duplicates } = state.mergeHistory(incoming);
      setMessage(
        added === 0
          ? '새로 추가된 기록이 없습니다. 이미 가지고 있는 배치입니다.'
          : `배치 기록 ${added}개를 더했습니다. 이제 ${state.history.length + added}개입니다.` +
            (duplicates > 0 ? ` (겹치는 ${duplicates}개는 건너뛰었습니다.)` : ''),
      );
    } catch (caught) {
      setError(safeErrorMessage(caught, '배치 기록을 읽지 못했습니다.'));
    }
  };

  const wipe = async () => {
    const result = await wipeEverything();
    state.clearAll();
    // Back to «saving off», which also stops the panel from reopening — and
    // therefore recreating — the database it has just deleted.
    state.resetSettings();
    disposeSolver();
    setOfflineReady(false);
    setReport(result);
    setConfirmingWipe(false);
    setProjects([]);
  };

  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-2">
        <h3 className="font-semibold">화면</h3>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.settings.reduceMotion}
            onChange={(e) => state.updateSettings({ reduceMotion: e.target.checked })}
          />
          움직임 줄이기 (카드 뒤집기·카운트다운 애니메이션 끄기)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.settings.showNames}
            onChange={(e) => state.updateSettings({ showNames: e.target.checked })}
          />
          자리 카드에 이름 표시
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.settings.showNumbers}
            onChange={(e) => state.updateSettings({ showNumbers: e.target.checked })}
          />
          자리 카드에 번호 표시
        </label>
        <div>
          <label className="label" htmlFor="theme">화면 밝기</label>
          <select
            id="theme"
            className="input max-w-[10rem]"
            value={state.settings.theme}
            onChange={(e) => state.updateSettings({ theme: e.target.value as 'light' | 'dark' | 'system' })}
          >
            <option value="system">시스템 설정 따르기</option>
            <option value="light">밝게</option>
            <option value="dark">어둡게</option>
          </select>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h3 className="font-semibold">이 브라우저에 저장하기</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          기본값은 «저장하지 않음»입니다. 새로고침하면 학생 정보가 사라지므로, 여러 사람이 함께 쓰는
          컴퓨터에서도 안전합니다.
        </p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={state.settings.storageEnabled}
            onChange={(e) => state.updateSettings({ storageEnabled: e.target.checked })}
          />
          <span>
            <span className="font-medium">이 브라우저에 저장하는 기능 켜기</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              켜면 «저장» 버튼이 생깁니다. 버튼을 눌렀을 때만, 이 컴퓨터의 이 브라우저 안(IndexedDB)에
              학생 명단·자리·모둠·조건·과거 기록이 저장됩니다. 저장된 내용은 이 컴퓨터를 벗어나지 않으며,
              다른 브라우저나 다른 기기에서는 보이지 않습니다.
            </span>
          </span>
        </label>

        {state.settings.storageEnabled && (
          <>
            <button type="button" className="btn-secondary" onClick={() => void save()}>
              지금 로컬에 저장
            </button>
            {projects.length > 0 && (
              <ul className="space-y-1 text-xs">
                {projects.map((project) => (
                  <li key={project.id} className="flex items-center gap-2 rounded border border-slate-200 p-2 dark:border-slate-700">
                    <span className="flex-1">
                      {project.title} · {project.students.length}명 ·{' '}
                      {new Date(project.savedAt).toLocaleString('ko-KR')}
                    </span>
                    <button
                      type="button"
                      className="text-blue-600 hover:underline"
                      onClick={() => {
                        state.hydrate(project);
                        onClose();
                      }}
                    >
                      불러오기
                    </button>
                    <button
                      type="button"
                      className="text-red-600 hover:underline"
                      onClick={() => void deleteProject(project.id).then(refresh)}
                    >
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h3 className="font-semibold">인터넷 없이 쓰기 (오프라인)</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          켜면 앱 파일이 이 브라우저에 저장되어 인터넷이 끊겨도 열립니다.
          <strong className="ml-1">저장되는 것은 앱 화면을 그리는 파일뿐이고 학생 정보는 들어가지 않습니다.</strong>
          이 앱은 학생 정보를 네트워크로 주고받지 않으므로 오프라인 저장소가 가로챌 학생 데이터 자체가 없습니다.
        </p>
        {serviceWorkerSupported() ? (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={offlineReady}
              onChange={(e) => {
                const wanted = e.target.checked;
                setError(null);
                // Flip immediately. A controlled checkbox whose state only
                // moves after an await snaps back under the user's finger,
                // because React re-renders with the old value first.
                setOfflineReady(wanted);
                void (async () => {
                  if (wanted) {
                    const result = await enableOffline();
                    if (result.ok) {
                      setMessage(result.message);
                    } else {
                      setOfflineReady(false); // undo the optimistic flip
                      setError(result.message);
                    }
                  } else {
                    await disableOffline();
                    setMessage('오프라인 사용을 껐습니다. 저장해 둔 앱 파일을 지웠습니다.');
                  }
                })();
              }}
            />
            <span>오프라인으로 쓸 수 있게 하기</span>
          </label>
        ) : (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            이 브라우저에서는 오프라인 기능을 쓸 수 없습니다.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">백업 파일에서 불러오기</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          명단·교실·조건·기록을 전부 그 파일의 것으로 바꿉니다. 지금 작업 중인 내용은 사라집니다.
        </p>
        <input
          type="file"
          accept=".json,application/json"
          className="text-xs"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void restoreFile(file);
            e.target.value = '';
          }}
        />
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">지난 배치 기록만 더하기</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          백업 파일에서 <strong>배치 기록만</strong> 꺼내 지금 것에 더합니다. 명단과 교실은
          그대로 둡니다. <strong>여러 개를 한 번에 고를 수 있습니다</strong> — 학기마다 백업해 두셨다면
          전부 고르세요. 같은 배치는 두 번 세지 않습니다.
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          더한 뒤 «조건 정하기»에서 «지난 짝 피하기»의 «최근 몇 회»를 늘리면 그만큼 거슬러 올라가 피합니다.
        </p>
        <input
          type="file"
          multiple
          accept=".json,application/json"
          className="text-xs"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) void mergeHistoryFiles(files);
            e.target.value = '';
          }}
        />
        <p className="text-xs text-slate-500">지금 가지고 있는 기록 {state.history.length}개</p>
      </section>

      <section className="space-y-2 rounded-lg border border-red-300 p-3 dark:border-red-800">
        <h3 className="flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-400">
          <WarningIcon className="h-4 w-4" />
          모든 학생 정보 삭제
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          화면에 있는 명단과 배치, 이 브라우저에 저장한 내용, 오프라인 캐시를 모두 지웁니다.
          지운 뒤 실제로 남은 것이 없는지 다시 확인해서 결과를 알려 드립니다. 이미 내보낸 파일은
          지워지지 않으니 직접 삭제해 주세요.
        </p>
        {confirmingWipe ? (
          <div className="flex gap-2">
            <button type="button" className="btn-danger" onClick={() => void wipe()}>
              <TrashIcon />
              정말 모두 삭제합니다
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirmingWipe(false)}>
              취소
            </button>
          </div>
        ) : (
          <button type="button" className="btn-danger" onClick={() => setConfirmingWipe(true)}>
            <TrashIcon />
            모든 정보 삭제
          </button>
        )}

        {report && (
          <div
            className={`rounded border p-2 text-xs ${
              report.verification === 'verifiedEmpty'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
            }`}
          >
            {/* Three distinct outcomes, because "we could not check" is a
                different thing from "we checked and it is clean". */}
            <p className="font-semibold">
              {report.verification === 'verifiedEmpty'
                ? '삭제 후 확인 완료 — 남은 학생 정보가 없습니다.'
                : report.verification === 'unverifiable'
                  ? '삭제했지만 이 브라우저에서는 확인하지 못했습니다.'
                  : '일부가 남아 있을 수 있습니다.'}
            </p>
            <ul className="mt-1 list-disc pl-4">
              <li>
                저장소(IndexedDB):{' '}
                {report.database === 'deleted'
                  ? '삭제됨'
                  : report.database === 'blocked'
                    ? '다른 탭이 사용 중이라 삭제하지 못함'
                    : '삭제하지 못함'}
              </li>
              <li>브라우저 설정값: {report.localStorageKeysRemoved}개 삭제</li>
              <li>
                오프라인 캐시: {report.cachesDeleted}개 삭제
                {report.cachesSkipped > 0 && ` (이 앱 것이 아닌 ${report.cachesSkipped}개는 건드리지 않음)`}
              </li>
              {report.serviceWorkerRemoved && <li>오프라인 기능: 해제됨</li>}
            </ul>
            {report.problems.map((problem, i) => (
              <p key={i} className="mt-1">
                · {problem}
              </p>
            ))}
          </div>
        )}
      </section>

      {(message || error) && (
        <p className={error ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>
          {error ?? message}
        </p>
      )}
    </div>
  );
}
