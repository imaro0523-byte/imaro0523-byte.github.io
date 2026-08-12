import { Component, type ErrorInfo, type ReactNode } from 'react';

import { log } from '@/lib/log';

interface State {
  failed: boolean;
}

/**
 * Catches render failures.
 *
 * Only the error's own message is shown, never the component tree or props: a
 * React error boundary that dumps props onto the screen would put the whole
 * roster on a projector.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    // The component stack is discarded on purpose; only a short label is kept.
    log.error('render failed', error.name);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-bold">화면을 그리는 중 문제가 생겼습니다</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          학생 정보는 이 브라우저 밖으로 나가지 않았습니다. 페이지를 새로고침하면 처음 화면으로
          돌아갑니다. 저장을 켜 두지 않았다면 명단은 다시 불러와야 합니다.
        </p>
        <button type="button" className="btn-primary mt-4" onClick={() => window.location.reload()}>
          새로고침
        </button>
      </div>
    );
  }
}
