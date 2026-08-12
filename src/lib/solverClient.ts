/**
 * Talks to the solver worker, and falls back to running in-thread if workers
 * are unavailable (older browsers, some locked-down school setups).
 */

import { buildHistoryIndex } from '@/core/history';
import type { ArrangementRecord } from '@/core/model/types';
import { solveGrouping, type GroupingRequest, type GroupingResult } from '@/core/solver/grouping';
import { solveSeating, type SeatingRequest, type SeatingResult } from '@/core/solver/seating';
import type { WorkerRequest, WorkerResponse } from '@/workers/solver.worker';
import { log } from './log';

type SeatingPayload = Omit<SeatingRequest, 'history'> & {
  records: ArrangementRecord[];
  withinLast: number;
};
type GroupingPayload = Omit<GroupingRequest, 'history'> & {
  records: ArrangementRecord[];
  withinLast: number;
};

let worker: Worker | null = null;
let nextId = 1;
let workerBroken = false;

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/solver.worker.ts', import.meta.url), { type: 'module' });
    worker.onerror = () => {
      workerBroken = true;
      worker = null;
      log.warn('worker unavailable, falling back to main thread');
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function call<T>(request: WorkerRequest, inline: () => T): Promise<T> {
  const active = getWorker();
  if (!active) return Promise.resolve(inline());

  return new Promise<T>((resolve) => {
    const timeout = setTimeout(() => {
      // A worker that never answers must not leave the button spinning.
      active.removeEventListener('message', onMessage);
      log.warn('worker timed out, computing on the main thread');
      resolve(inline());
    }, 20000);

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== request.id) return;
      clearTimeout(timeout);
      active.removeEventListener('message', onMessage);
      if (event.data.type === 'error') {
        log.warn('worker reported a failure, computing on the main thread');
        resolve(inline());
        return;
      }
      resolve(event.data.result as T);
    };

    active.addEventListener('message', onMessage);
    active.postMessage(request);
  });
}

export function runSeating(payload: SeatingPayload): Promise<SeatingResult> {
  const id = nextId++;
  return call<SeatingResult>({ id, type: 'seating', payload }, () => {
    const { records, withinLast, ...rest } = payload;
    return solveSeating({ ...rest, history: buildHistoryIndex(records, withinLast) });
  });
}

export function runGrouping(payload: GroupingPayload): Promise<GroupingResult> {
  const id = nextId++;
  return call<GroupingResult>({ id, type: 'grouping', payload }, () => {
    const { records, withinLast, ...rest } = payload;
    return solveGrouping({ ...rest, history: buildHistoryIndex(records, withinLast) });
  });
}

/** Releases the worker, e.g. after «모든 정보 삭제». */
export function disposeSolver(): void {
  worker?.terminate();
  worker = null;
  workerBroken = false;
}
