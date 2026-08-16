/**
 * The "try it first" roster.
 *
 * Entirely synthetic: 학생01 … 학생25. No real name appears in this project's
 * source, tests, fixtures or documentation.
 */

import { uuid } from '@/core/model/ids';
import type { RosterMeta, Student } from '@/core/model/types';

export function buildNeisSample(count = 25): { students: Student[]; meta: RosterMeta } {
  const students: Student[] = Array.from({ length: count }, (_, i) => ({
    id: uuid(),
    number: i + 1,
    name: `학생${String(i + 1).padStart(2, '0')}`,
    grade: 1,
    department: '일반학과',
    classNumber: '1',
    // Left unset on purpose: the app must work without gender data, and a
    // sample that pre-fills it would hide that.
    gender: 'unset',
    division: 'unset',
    status: 'active',
    tags: [],
    customFields: {},
  }));

  return {
    students,
    meta: {
      schoolName: '보기중학교',
      subject: '체험용 샘플',
      grade: 1,
      classNumber: '1-1',
      sheetName: '샘플',
    },
  };
}

/**
 * Two 가나다 runs, the shape a real NEIS roster arrives in.
 *
 * `buildNeisSample` is a single ascending run on purpose, and a test pins the
 * app's honest "there is no boundary here" answer to it. That leaves nothing to
 * demonstrate the opposite case with, so this is the second sample: thirteen
 * names in order, then the ordering jumps back to ㄱ and runs again. Pressing
 * «이름 순서로 구분 나누기» on it finds the break at 13.
 *
 * Every given name is literally 학생, which no roster would ever contain. That
 * is the point — the list has to be sortable by 초성 to show the feature, and
 * it also has to be impossible to mistake for real children. Surnames carry the
 * ordering; the given name carries the disclaimer.
 */
const DIVIDED_NAMES = [
  // 구분1 — ㄱ ㄱ ㄴ ㄷ ㄹ ㅁ ㅂ ㅅ ㅇ ㅇ ㅈ ㅊ ㅎ
  '강학생',
  '김학생',
  '노학생',
  '도학생',
  '류학생',
  '민학생',
  '박학생',
  '서학생',
  '오학생',
  '윤학생',
  '조학생',
  '최학생',
  '하학생',
  // 구분2 — 순서가 여기서 ㄱ으로 되돌아간다
  '고학생',
  '권학생',
  '나학생',
  '마학생',
  '배학생',
  '손학생',
  '송학생',
  '양학생',
  '임학생',
  '주학생',
  '채학생',
  '홍학생',
];

export function buildDividedSample(): { students: Student[]; meta: RosterMeta } {
  const students: Student[] = DIVIDED_NAMES.map((name, i) => ({
    id: uuid(),
    number: i + 1,
    name,
    grade: 1,
    department: '일반학과',
    classNumber: '2',
    // Still unset. The point of the sample is that the *ordering* carries the
    // information, not a gender column — the app never guesses one from a name.
    gender: 'unset',
    division: 'unset',
    status: 'active',
    tags: [],
    customFields: {},
  }));

  return {
    students,
    meta: {
      schoolName: '보기중학교',
      subject: '구분 나누기 예시',
      grade: 1,
      classNumber: '1-2',
      sheetName: '샘플',
    },
  };
}
