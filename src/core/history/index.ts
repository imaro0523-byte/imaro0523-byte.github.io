/**
 * Past arrangements, folded into cheap lookups.
 *
 * The solver asks "have these two been partners recently?" thousands of times
 * per second, so the records are indexed once up front. Recency matters: being
 * partners last week counts for more than being partners last term.
 */

import type { ArrangementRecord } from '../model/types';

/** Order-independent key for a pair of students. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface HistoryIndex {
  /** How many records were folded in. */
  recordCount: number;
  /** Recency-weighted count of shared desks. */
  partner: Map<string, number>;
  /** Recency-weighted count of orthogonal adjacency. */
  neighbour: Map<string, number>;
  /** Recency-weighted count of shared groups. */
  groupmate: Map<string, number>;
  /** Raw counts, for the "같은 짝 N번" display. */
  partnerRaw: Map<string, number>;
  neighbourRaw: Map<string, number>;
  groupmateRaw: Map<string, number>;
  /** Pairs that were together in the single most recent record. */
  lastPartner: Set<string>;
  lastGroupmate: Set<string>;
  /** studentId → seat ids held, most recent first. */
  seats: Map<string, string[]>;
  /** studentId → how often they sat in the front / back third of the room. */
  frontCount: Map<string, number>;
  backCount: Map<string, number>;
}

export function emptyHistoryIndex(): HistoryIndex {
  return {
    recordCount: 0,
    partner: new Map(),
    neighbour: new Map(),
    groupmate: new Map(),
    partnerRaw: new Map(),
    neighbourRaw: new Map(),
    groupmateRaw: new Map(),
    lastPartner: new Set(),
    lastGroupmate: new Set(),
    seats: new Map(),
    frontCount: new Map(),
    backCount: new Map(),
  };
}

function bump(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

/**
 * Builds the index from records, newest first.
 *
 * @param withinLast only the newest N records are considered; older ones are a
 *   deliberate blind spot so a class is not permanently constrained by
 *   arrangements from months ago.
 */
export function buildHistoryIndex(
  records: readonly ArrangementRecord[],
  withinLast = Number.POSITIVE_INFINITY,
): HistoryIndex {
  const index = emptyHistoryIndex();

  const sorted = [...records].sort((a, b) => b.date.localeCompare(a.date));
  const considered = sorted.slice(0, Math.max(0, Math.min(sorted.length, withinLast)));
  index.recordCount = considered.length;

  considered.forEach((record, age) => {
    // The newest record weighs 1, the next 1/2, then 1/3 … so recent history
    // dominates without older history being ignored outright.
    const weight = 1 / (age + 1);

    for (const [studentId, partnerId] of Object.entries(record.partners)) {
      const key = pairKey(studentId, partnerId);
      bump(index.partner, key, weight);
      // partners is symmetric, so each pair is seen twice; halve the raw count.
      bump(index.partnerRaw, key, 0.5);
      if (age === 0) index.lastPartner.add(key);
    }

    for (const [studentId, neighbours] of Object.entries(record.neighbors)) {
      for (const other of neighbours) {
        const key = pairKey(studentId, other);
        bump(index.neighbour, key, weight * 0.5);
        bump(index.neighbourRaw, key, 0.5);
      }
    }

    const byGroup = new Map<number, string[]>();
    for (const [studentId, groupIndex] of Object.entries(record.groupOf)) {
      const list = byGroup.get(groupIndex) ?? [];
      list.push(studentId);
      byGroup.set(groupIndex, list);
    }
    for (const members of byGroup.values()) {
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) {
          const key = pairKey(members[i] as string, members[j] as string);
          bump(index.groupmate, key, weight);
          bump(index.groupmateRaw, key, 1);
          if (age === 0) index.lastGroupmate.add(key);
        }
      }
    }

    for (const [seatId, studentId] of Object.entries(record.seatAssignment)) {
      const list = index.seats.get(studentId) ?? [];
      list.push(seatId);
      index.seats.set(studentId, list);
    }
  });

  // Round the raw counts, which were accumulated in halves.
  for (const map of [index.partnerRaw, index.neighbourRaw, index.groupmateRaw]) {
    for (const [key, value] of map) map.set(key, Math.round(value));
  }

  return index;
}

export function partnerCount(index: HistoryIndex, a: string, b: string): number {
  return index.partnerRaw.get(pairKey(a, b)) ?? 0;
}

export function groupmateCount(index: HistoryIndex, a: string, b: string): number {
  return index.groupmateRaw.get(pairKey(a, b)) ?? 0;
}

export function neighbourCount(index: HistoryIndex, a: string, b: string): number {
  return index.neighbourRaw.get(pairKey(a, b)) ?? 0;
}

/**
 * Fairness score per student: how often they have ended up at the back of the
 * room. A teacher can use this to check nobody is repeatedly parked out of the
 * way. Higher means further back, on average.
 */
export function seatFairness(
  index: HistoryIndex,
  seatRowOf: (seatId: string) => number | undefined,
  totalRows: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (totalRows <= 1) return out;
  for (const [studentId, seatIds] of index.seats) {
    let sum = 0;
    let seen = 0;
    for (const seatId of seatIds) {
      const row = seatRowOf(seatId);
      if (row === undefined) continue;
      sum += row / (totalRows - 1);
      seen += 1;
    }
    if (seen > 0) out.set(studentId, sum / seen);
  }
  return out;
}
