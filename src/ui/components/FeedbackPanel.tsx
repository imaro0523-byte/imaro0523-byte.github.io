/**
 * Reporting a problem without reporting a class.
 *
 * A screenshot is the single most useful thing to attach to a bug report, and
 * a screenshot of this app is a picture of a class list. Rather than asking
 * teachers to blur names themselves — which means either tedious work or, more
 * likely, a real roster landing in someone's inbox — the app renders the same
 * arrangement with the names replaced and saves that instead.
 */

import { useRef, useState } from 'react';

import {
  anonymizeGrouping,
  anonymizeStudents,
  buildFeedbackReport,
  describeForFeedback,
} from '@/core/exportData/anonymize';
import { seatsOf } from '@/core/layout/grid';
import { VIEWPOINT_LABELS } from '@/core/model/types';
import { FEEDBACK_FORM, hasFeedbackForm } from '@/config/links';
import { APP_VERSION } from '@/config/version';
import { safeErrorMessage } from '@/lib/log';
import { useAppStore, STEP_LABELS } from '@/store/useAppStore';
import { exportPng } from '../export/image';
import { safeFileName } from '../export/download';
import { SeatMap } from './SeatMap';
import { GroupList } from './GroupList';
import { CheckIcon, DownloadIcon, ShieldIcon, WarningIcon } from './Icons';

export function FeedbackPanel({ onClose }: { onClose: () => void }) {
  const students = useAppStore((s) => s.students);
  const classroom = useAppStore((s) => s.classroom);
  const assignment = useAppStore((s) => s.assignment);
  const grouping = useAppStore((s) => s.grouping);
  const constraints = useAppStore((s) => s.constraints);
  const seed = useAppStore((s) => s.seed);
  const step = useAppStore((s) => s.step);
  const viewpoint = useAppStore((s) => s.settings.viewpoint);

  const shotRef = useRef<HTMLDivElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [situation, setSituation] = useState('');
  const [problem, setProblem] = useState('');
  const [expected, setExpected] = useState('');
  const [copied, setCopied] = useState(false);
  const reportRef = useRef<HTMLTextAreaElement>(null);

  const safeStudents = anonymizeStudents(students);
  const safeGrouping = anonymizeGrouping(grouping);
  const active = students.filter((s) => s.status === 'active');

  const diagnostics = describeForFeedback({
    appVersion: APP_VERSION,
    screen: STEP_LABELS[step],
    studentCount: active.length,
    excludedCount: students.length - active.length,
    classroom: `${classroom.rows}줄 × ${classroom.cols}칸`,
    seatCount: seatsOf(classroom).length,
    groups: grouping
      ? `${grouping.groups.length}모둠 (${grouping.groups.map((g) => g.memberIds.length).join(', ')}명)`
      : '없음',
    constraints: constraints.length,
    seed,
    viewpoint: VIEWPOINT_LABELS[viewpoint],
  });

  /**
   * Browser and screen size. A teacher's own environment, never a student's —
   * and the whole report is shown before it goes anywhere, so nothing leaves
   * without being read first.
   */
  const environment = [
    `브라우저: ${navigator.userAgent}`,
    `창 크기: ${window.innerWidth}×${window.innerHeight}`,
  ].join('\n');

  const report = buildFeedbackReport({ situation, problem, expected, diagnostics, environment });

  const copyReport = async () => {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; selecting the text is the fallback
      // every browser still allows, and Ctrl+C then does the rest.
      reportRef.current?.focus();
      reportRef.current?.select();
    }
  };

  const saveAnonymisedShot = async () => {
    setError(null);
    setSaved(false);
    setPreparing(true);
    try {
      // The hidden copy needs a frame to paint before it can be captured.
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));
      const node = shotRef.current;
      if (!node) throw new Error('화면을 만들지 못했습니다.');
      await exportPng(node, safeFileName({ kind: '피드백용_화면', extension: 'png' }), { scale: 2 });
      setSaved(true);
    } catch (caught) {
      setError(safeErrorMessage(caught, '화면을 저장하지 못했습니다.'));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600 dark:text-slate-400">
        안 되는 부분이나 있으면 좋겠는 기능을 알려 주세요. 어느 화면에서 무엇을 하려다 그랬는지
        적어 주시면 고치는 데 큰 도움이 됩니다.
      </p>

      <section className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
        <h3 className="flex items-center gap-1.5 font-semibold text-emerald-900 dark:text-emerald-200">
          <ShieldIcon className="h-4 w-4" />
          화면 사진은 이름을 가려서 보내 주세요
        </h3>
        <p className="text-xs text-emerald-800 dark:text-emerald-300">
          그냥 캡처하면 학생 이름이 그대로 찍힙니다. 아래 버튼을 누르면 배치 모양은 그대로 두고
          <strong> 이름만 학생01·학생02로 바꾼 그림</strong>을 저장해 드립니다. 교사 메모와
          모둠 역할도 빠집니다. 이 파일을 첨부해 주세요.
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void saveAnonymisedShot()}
          disabled={preparing || students.length === 0}
        >
          <DownloadIcon />
          {preparing ? '만드는 중…' : '이름 가린 화면 저장'}
        </button>
        {students.length === 0 && (
          <p className="text-xs text-emerald-800 dark:text-emerald-300">
            명단을 불러온 뒤에 쓸 수 있습니다.
          </p>
        )}
        {saved && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <CheckIcon className="h-3.5 w-3.5" />
            저장했습니다. 열어서 이름이 가려졌는지 한 번 확인한 뒤 첨부해 주세요.
          </p>
        )}
        {error && (
          <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
            <WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">무슨 일이 있었는지 적어 주세요</h3>
        <p className="text-xs text-slate-500">
          세 칸을 채우면 아래에 보낼 내용이 한 덩어리로 만들어집니다. 다 못 채우셔도 됩니다.
        </p>

        <div>
          <label className="label" htmlFor="fb-situation">
            1. 무엇을 하려고 했나요
          </label>
          <textarea
            id="fb-situation"
            className="input h-16 text-xs"
            placeholder="예: 25명을 6모둠으로 나누고 자리까지 만들려고 했습니다."
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="fb-problem">
            2. 무엇이 일어났나요
          </label>
          <textarea
            id="fb-problem"
            className="input h-16 text-xs"
            placeholder="예: 자리 만들기를 누르면 계속 «조건을 지킬 수 없습니다»가 뜹니다."
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="fb-expected">
            3. 어떻게 되기를 바랐나요
          </label>
          <textarea
            id="fb-expected"
            className="input h-16 text-xs"
            placeholder="예: 어떤 조건이 걸렸는지 알려 주면 좋겠습니다."
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">보낼 내용</h3>
        <p className="text-xs text-slate-500">
          아래를 통째로 복사해 붙여 주세요.
          <strong className="ml-1">학생 이름은 들어 있지 않습니다.</strong>
        </p>
        <textarea
          ref={reportRef}
          className="input h-56 font-mono text-xs"
          readOnly
          value={report}
          aria-label="보낼 내용"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="btn-primary" onClick={() => void copyReport()}>
          {copied ? '복사했습니다' : '전체 복사'}
        </button>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">보내기</h3>
        {hasFeedbackForm() ? (
          <>
            <a
              className="btn-primary inline-flex"
              href={FEEDBACK_FORM}
              target="_blank"
              rel="noopener noreferrer"
            >
              의견 보내기 (새 탭에서 열림)
            </a>
            <p className="text-xs text-slate-500">
              새 탭으로 이동할 뿐이며, 이 앱이 무엇을 자동으로 보내지는 않습니다.
              위의 «보낼 내용»을 붙여넣고, 이름 가린 그림이 있으면 함께 첨부해 주세요.
            </p>
          </>
        ) : (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            의견 보내는 곳이 아직 설정되지 않았습니다. 이 앱을 배포한 분이
            <code className="mx-1">src/config/links.ts</code>에 주소를 넣으면 여기에 버튼이 생깁니다.
          </p>
        )}
      </section>

      <button type="button" className="btn-ghost" onClick={onClose}>
        닫기
      </button>

      {/* The safe copy, rendered off-screen only while a capture is running. */}
      {preparing && (
        <div className="pointer-events-none fixed left-[-10000px] top-0" aria-hidden="true">
          <div ref={shotRef} className="w-[900px] bg-white p-4">
            <p className="mb-2 text-center text-sm font-bold text-slate-900">
              피드백용 화면 · 이름은 실제 이름이 아닙니다
            </p>
            <SeatMap
              classroom={classroom}
              assignment={assignment}
              students={safeStudents}
              viewpoint={viewpoint}
              grouping={safeGrouping}
            />
            {safeGrouping && <GroupList grouping={safeGrouping} students={safeStudents} />}
            <pre className="mt-3 whitespace-pre-wrap text-[10px] text-slate-600">{diagnostics}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
