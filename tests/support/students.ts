/** Synthetic students for tests. Never real names. */

import type { Gender, Student, StudentStatus } from '@/core/model/types';

export function makeStudent(index: number, overrides: Partial<Student> = {}): Student {
  return {
    id: `s${String(index).padStart(2, '0')}`,
    number: index,
    name: `학생${String(index).padStart(2, '0')}`,
    gender: 'unset',
    status: 'active',
    tags: [],
    customFields: {},
    ...overrides,
  };
}

export function makeStudents(count: number, overrides: Partial<Student> = {}): Student[] {
  return Array.from({ length: count }, (_, i) => makeStudent(i + 1, overrides));
}

/** Alternating male/female, for gender-balance tests. */
export function withAlternatingGender(students: Student[]): Student[] {
  return students.map((student, i) => ({
    ...student,
    gender: (i % 2 === 0 ? 'male' : 'female') as Gender,
  }));
}

export function withStatus(student: Student, status: StudentStatus): Student {
  return { ...student, status };
}
