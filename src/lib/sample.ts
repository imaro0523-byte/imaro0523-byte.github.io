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
