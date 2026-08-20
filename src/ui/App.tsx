import { useEffect, useState } from 'react';

import { useAppStore, STEP_LABELS, STEP_ORDER, type Step } from '@/store/useAppStore';
import { ImportScreen } from './screens/ImportScreen';
import { RosterScreen } from './screens/RosterScreen';
import { ClassroomScreen } from './screens/ClassroomScreen';
import { RulesScreen } from './screens/RulesScreen';
import { GenerateScreen } from './screens/GenerateScreen';
import { ResultScreen } from './screens/ResultScreen';
import { SettingsPanel } from './components/SettingsPanel';
import { FeedbackPanel } from './components/FeedbackPanel';
import { PrivacyNotice } from './components/PrivacyNotice';
import { RedoIcon, SettingsIcon, UndoIcon } from './components/Icons';

const SCREENS: Record<Step, () => JSX.Element> = {
  import: ImportScreen,
  roster: RosterScreen,
  classroom: ClassroomScreen,
  rules: RulesScreen,
  generate: GenerateScreen,
  result: ResultScreen,
};

export function App() {
  const step = useAppStore((s) => s.step);
  const setStep = useAppStore((s) => s.setStep);
  const students = useAppStore((s) => s.students);
  const dirty = useAppStore((s) => s.dirty);
  const settings = useAppStore((s) => s.settings);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const pastLength = useAppStore((s) => s.past.length);
  const futureLength = useAppStore((s) => s.future.length);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Theme is a display preference, so it is applied straight to the document.
  useEffect(() => {
    const root = document.documentElement;
    const dark =
      settings.theme === 'dark' ||
      (settings.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('dark', Boolean(dark));
    root.classList.toggle('reduce-motion', settings.reduceMotion);
  }, [settings.theme, settings.reduceMotion]);

  // Warn before losing unsaved work — a class roster is tedious to re-enter.
  useEffect(() => {
    if (!dirty || students.length === 0) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, students.length]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (event.key === 'y' || (event.key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  const Screen = SCREENS[step];
  const hasRoster = students.length > 0;

  return (
    <div className="flex min-h-full flex-col">
      <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            className="text-lg font-bold tracking-tight"
            onClick={() => setStep('import')}
          >
            자리배치 도우미
          </button>

          <nav aria-label="단계" className="flex flex-wrap gap-1">
            {STEP_ORDER.map((value, index) => {
              const locked = value !== 'import' && !hasRoster;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={locked}
                  onClick={() => setStep(value)}
                  aria-current={step === value ? 'step' : undefined}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    step === value
                      ? 'bg-blue-600 text-white'
                      : locked
                        ? 'text-slate-300 dark:text-slate-600'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {index + 1}. {STEP_LABELS[value]}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="btn-ghost px-2"
              onClick={undo}
              disabled={pastLength === 0}
              aria-label="실행 취소"
              title="실행 취소 (Ctrl+Z)"
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              className="btn-ghost px-2"
              onClick={redo}
              disabled={futureLength === 0}
              aria-label="다시 실행"
              title="다시 실행 (Ctrl+Y)"
            >
              <RedoIcon />
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setFeedbackOpen(true)}
            >
              의견 보내기
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSettingsOpen(true)}
              aria-label="설정"
            >
              <SettingsIcon />
              설정
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-5">
        <Screen />
      </main>

      <footer className="no-print border-t border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <PrivacyNotice compact />
          {/*
            Back to the guide site, which sits one level up from /app/.

            A relative path, never an absolute address: the app has to keep
            working from a domain root, a project subpath or a local preview,
            and only a relative link does all three. It lives in the footer
            rather than the header on purpose — a misclick up there would throw
            away a roster that, by design, is not saved anywhere.
          */}
          <a href="../" className="btn-secondary shrink-0">
            ← 소개 페이지로
          </a>
        </div>
      </footer>

      {feedbackOpen && (
        <div
          className="no-print fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => setFeedbackOpen(false)}
        >
          <div
            role="dialog"
            aria-label="의견 보내기"
            aria-modal="true"
            className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">의견 보내기</h2>
              <button type="button" className="btn-ghost" onClick={() => setFeedbackOpen(false)}>
                닫기
              </button>
            </div>
            <FeedbackPanel onClose={() => setFeedbackOpen(false)} />
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          className="no-print fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            role="dialog"
            aria-label="설정"
            aria-modal="true"
            className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">설정</h2>
              <button type="button" className="btn-ghost" onClick={() => setSettingsOpen(false)}>
                닫기
              </button>
            </div>
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
