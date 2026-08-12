/**
 * Splitting a roster into two divisions by where the name ordering resets.
 *
 * NEIS lists a class as one 가나다 run per group — typically every boy sorted
 * by name, then every girl sorted by name — so the roster contains exactly one
 * point where the alphabetical order jumps backwards. That break is a
 * structural property of the list, and finding it lets a teacher split a class
 * in one click instead of twenty-five.
 *
 * The two sides are deliberately called 구분1 and 구분2, never 남 and 여.
 * Which run comes first varies by school and by term, and this module has no
 * way to know: it reads the ordering, not the names. Labelling the result as a
 * gender would be a guess dressed up as a fact, and it would be wrong roughly
 * half the time. A teacher who wants real 남/여 sets it themselves.
 */

import type { Student } from '../model/types';

/** 초성 order, used to measure how far the ordering jumped back. */
const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/**
 * Position of a name's leading consonant, 0–18. Returns `null` for names that
 * do not start with a Hangul syllable.
 */
export function initialIndex(name: string): number | null {
  const first = name.replace(/\s/g, '').charAt(0);
  if (first === '') return null;
  const code = first.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return null;
  return Math.floor((code - HANGUL_BASE) / 588);
}

function comparableName(student: Student): string {
  return student.name.replace(/\s/g, '').normalize('NFC');
}

/**
 * Roster order: by attendance number, with unnumbered students kept in the
 * order they were imported so the list still reads sensibly.
 */
export function inRosterOrder(students: readonly Student[]): Student[] {
  return [...students]
    .map((student, index) => ({ student, index }))
    .sort((a, b) => {
      const an = a.student.number;
      const bn = b.student.number;
      if (an === null && bn === null) return a.index - b.index;
      if (an === null) return 1;
      if (bn === null) return -1;
      if (an !== bn) return an - bn;
      return a.index - b.index;
    })
    .map((entry) => entry.student);
}

export interface SplitCandidate {
  /** Index in roster order at which 구분2 begins. */
  index: number;
  /** Attendance number of the first student of 구분2, for display. */
  startNumber: number | null;
  firstSize: number;
  secondSize: number;
  /**
   * How far the ordering jumped backwards, 0–1.
   *
   * A real division boundary usually resets from a late consonant to an early
   * one (ㅎ → ㄱ scores 1). A roster that is merely a little out of order, or a
   * transfer student appended at the end, gives a much smaller jump.
   */
  drop: number;
}

/**
 * Every point where the name ordering goes backwards, best candidate first.
 *
 * More than one break is normal in a real roster — a student who transferred in
 * mid-term is often appended after everybody else — so this returns all of them
 * and lets the teacher choose rather than silently picking.
 */
export function detectSplitPoints(students: readonly Student[]): SplitCandidate[] {
  const ordered = inRosterOrder(students);
  if (ordered.length < 4) return [];

  const candidates: SplitCandidate[] = [];

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1] as Student;
    const current = ordered[i] as Student;
    const before = comparableName(previous);
    const after = comparableName(current);
    if (before === '' || after === '') continue;

    // Only a strict step backwards counts; equal names are not a boundary.
    if (before.localeCompare(after, 'ko') <= 0) continue;

    const beforeInitial = initialIndex(before);
    const afterInitial = initialIndex(after);
    const drop =
      beforeInitial === null || afterInitial === null
        ? 0.5
        : Math.max(0, beforeInitial - afterInitial) / (INITIALS.length - 1);

    candidates.push({
      index: i,
      startNumber: current.number,
      firstSize: i,
      secondSize: ordered.length - i,
      drop,
    });
  }

  return candidates.sort((a, b) => {
    // A bigger backwards jump is the stronger signal…
    if (Math.abs(a.drop - b.drop) > 0.05) return b.drop - a.drop;
    // …and between similar jumps, the more even split is the likelier one.
    const balanceA = Math.abs(a.firstSize - a.secondSize);
    const balanceB = Math.abs(b.firstSize - b.secondSize);
    if (balanceA !== balanceB) return balanceA - balanceB;
    return a.index - b.index;
  });
}

/**
 * Whether the top candidate is clearly the real boundary.
 *
 * A roster usually contains several small resets that are not group
 * boundaries: `김가람` after `김하늘` steps backwards without changing the
 * leading consonant at all. Those score a drop near zero. A genuine boundary
 * jumps a long way back — ㅎ to ㄱ scores 1 — so when the best candidate
 * stands well clear of the next one, it can simply be applied instead of
 * making the teacher choose from a list of near-identical options.
 */
export function isConfident(candidates: readonly SplitCandidate[]): boolean {
  const best = candidates[0];
  if (!best) return false;
  if (best.drop < 0.4) return false;
  const runnerUp = candidates[1];
  if (!runnerUp) return true;
  return best.drop - runnerUp.drop >= 0.25;
}

export type SplitOutcome =
  | { ok: true; candidates: SplitCandidate[] }
  | { ok: false; reason: 'tooFewStudents' | 'noBreak'; message: string };

/** Detection plus a plain explanation when it cannot be done. */
export function planSplit(students: readonly Student[]): SplitOutcome {
  if (students.length < 4) {
    return {
      ok: false,
      reason: 'tooFewStudents',
      message: '학생이 너무 적어 이름 순서만으로는 나눌 수 없습니다. 구분을 직접 지정해 주세요.',
    };
  }
  const candidates = detectSplitPoints(students);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'noBreak',
      message:
        '이름이 처음부터 끝까지 가나다순이라 나눌 지점을 찾지 못했습니다. 명단이 한 덩어리로 정렬되어 있으면 이 기능은 쓸 수 없습니다.',
    };
  }
  return { ok: true, candidates };
}

/**
 * Returns studentId → division for a chosen split point.
 *
 * Everything before the break becomes 구분1 and everything from it onwards
 * becomes 구분2. The caller decides whether to apply it.
 */
export function divisionsFor(
  students: readonly Student[],
  splitIndex: number,
): Record<string, 'a' | 'b'> {
  const ordered = inRosterOrder(students);
  const out: Record<string, 'a' | 'b'> = {};
  ordered.forEach((student, index) => {
    out[student.id] = index < splitIndex ? 'a' : 'b';
  });
  return out;
}

/** Sentence describing what a candidate would do, for the confirmation UI. */
export function describeCandidate(
  candidate: SplitCandidate,
  students: readonly Student[],
): string {
  const ordered = inRosterOrder(students);
  const first = ordered[candidate.index];
  const last = ordered[candidate.index - 1];
  const from = last ? `${last.number ?? '?'}번 ${last.name}` : '';
  const to = first ? `${first.number ?? '?'}번 ${first.name}` : '';
  return `${from} 다음 ${to}에서 이름 순서가 처음으로 되돌아갑니다 · 구분1 ${candidate.firstSize}명 · 구분2 ${candidate.secondSize}명`;
}
