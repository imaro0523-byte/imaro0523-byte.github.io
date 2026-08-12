/**
 * Solver worker.
 *
 * Search runs off the main thread so the interface stays responsive while a
 * thorough run is in progress. The worker is bundled from local source; it
 * loads nothing over the network.
 */

import { solveGrouping, type GroupingRequest, type GroupingResult } from '@/core/solver/grouping';
import { solveSeating, type SeatingRequest, type SeatingResult } from '@/core/solver/seating';
import { buildHistoryIndex } from '@/core/history';
import type { ArrangementRecord } from '@/core/model/types';

export type WorkerRequest =
  | {
      id: number;
      type: 'seating';
      payload: Omit<SeatingRequest, 'history'> & { records: ArrangementRecord[]; withinLast: number };
    }
  | {
      id: number;
      type: 'grouping';
      payload: Omit<GroupingRequest, 'history'> & { records: ArrangementRecord[]; withinLast: number };
    };

export type WorkerResponse =
  | { id: number; type: 'seating'; result: SeatingResult }
  | { id: number; type: 'grouping'; result: GroupingResult }
  | { id: number; type: 'error'; message: string };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'seating') {
      const { records, withinLast, ...rest } = request.payload;
      const result = solveSeating({ ...rest, history: buildHistoryIndex(records, withinLast) });
      const response: WorkerResponse = { id: request.id, type: 'seating', result };
      self.postMessage(response);
      return;
    }
    const { records, withinLast, ...rest } = request.payload;
    const result = solveGrouping({ ...rest, history: buildHistoryIndex(records, withinLast) });
    const response: WorkerResponse = { id: request.id, type: 'grouping', result };
    self.postMessage(response);
  } catch (error) {
    // Only the message is forwarded; no payload, so no student data can travel
    // back inside an error object.
    const response: WorkerResponse = {
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : '계산 중 문제가 발생했습니다.',
    };
    self.postMessage(response);
  }
};
