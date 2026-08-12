/**
 * Privacy guarantees that are checked mechanically rather than promised.
 *
 * The source scan is the important one: it fails the build the moment somebody
 * adds a `fetch` or an external URL to the application source, which is exactly
 * the kind of change that would otherwise slip in unnoticed months later.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildBackup } from '@/core/exportData/toJson';
import {
  findLeakedFields,
  redactConstraints,
  redactGrouping,
  redactStudents,
  STUDENT_FACING,
  TEACHER_FACING,
} from '@/core/exportData/redact';
import { buildWorkbook } from '@/core/exportData/toXlsx';
import type { Constraint } from '@/core/constraints/kinds';
import { createClassroom, seatsOf } from '@/core/layout/grid';
import type { Grouping, SeatAssignment, Student } from '@/core/model/types';
import { makeStudents } from '../support/students';

const SRC = join(process.cwd(), 'src');

function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('no network access in application source', () => {
  const files = sourceFiles(SRC);

  it('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never calls fetch, XHR, sendBeacon or WebSocket', () => {
    const patterns: Array<[RegExp, string]> = [
      [/\bfetch\s*\(/, 'fetch()'],
      [/XMLHttpRequest/, 'XMLHttpRequest'],
      [/sendBeacon/, 'navigator.sendBeacon'],
      [/new\s+WebSocket/, 'WebSocket'],
      [/\bEventSource\b/, 'EventSource'],
      [/navigator\.geolocation/, 'geolocation'],
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const [pattern, label] of patterns) {
        if (pattern.test(text)) offenders.push(`${relative(process.cwd(), file)}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contains no external http(s) URL, not even in a comment', () => {
    // `import.meta.url` and the W3C SVG namespace are structural, not requests.
    const allowed = [/www\.w3\.org\/2000\/svg/, /schemas\.openxmlformats\.org/];
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
        const url = match[0];
        if (allowed.some((pattern) => pattern.test(url))) continue;
        // Localhost appears only in the dev-mode CSP, which never ships.
        if (/127\.0\.0\.1|localhost/.test(url)) continue;
        offenders.push(`${relative(process.cwd(), file)}: ${url}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('loads no external font or stylesheet', () => {
    const offenders: string[] = [];
    for (const file of [...files, join(process.cwd(), 'index.html'), join(process.cwd(), 'src/index.css')]) {
      // Comments are stripped first, so prose explaining the rule does not
      // trip the rule.
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/@font-face/.test(text)) offenders.push(`${relative(process.cwd(), file)}: @font-face`);
      if (/@import\s+url\(/.test(text)) offenders.push(`${relative(process.cwd(), file)}: @import url()`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps core/ free of React and DOM dependencies so it stays portable', () => {
    const coreFiles = files.filter((file) => file.includes(`${'core'}`) && /[\\/]core[\\/]/.test(file));
    expect(coreFiles.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of coreFiles) {
      const text = readFileSync(file, 'utf8');
      if (/from\s+'react'/.test(text)) offenders.push(`${relative(process.cwd(), file)}: react`);
      if (/\bdocument\.\w/.test(text)) offenders.push(`${relative(process.cwd(), file)}: document`);
      if (/\bwindow\.\w/.test(text)) offenders.push(`${relative(process.cwd(), file)}: window`);
      if (/\blocalStorage\b/.test(text)) offenders.push(`${relative(process.cwd(), file)}: localStorage`);
    }
    expect(offenders).toEqual([]);
  });

  it('routes every log through the module that is silent in production', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(join('lib', 'log.ts'))) continue;
      const text = readFileSync(file, 'utf8');
      // Strip comments so a `console.log` mentioned in prose does not trip it.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/\bconsole\.(log|info|warn|error|debug|table|dir)\s*\(/.test(code)) {
        offenders.push(relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('export redaction', () => {
  const classroom = createClassroom({ rows: 4, cols: 5, pairDesks: true });
  const students: Student[] = makeStudents(8).map((student, i) => ({
    ...student,
    gender: i % 2 === 0 ? ('male' as const) : ('female' as const),
    tags: ['리더'],
    teacherMemo: `메모${i}`,
    accessibilityNeeds: '앞자리 필요',
    excludeNote: '전학 예정',
  }));

  const assignment: SeatAssignment = {};
  seatsOf(classroom).slice(0, 8).forEach((seat, i) => {
    assignment[seat.id] = (students[i] as Student).id;
  });

  const grouping: Grouping = {
    excludedIds: [],
    groups: [
      {
        id: 'g1',
        index: 1,
        colorIndex: 1,
        memberIds: students.slice(0, 4).map((s) => s.id),
        roles: { [(students[0] as Student).id]: '발표' },
        locked: false,
      },
      {
        id: 'g2',
        index: 2,
        colorIndex: 2,
        memberIds: students.slice(4).map((s) => s.id),
        roles: {},
        locked: false,
      },
    ],
  };

  const constraints: Constraint[] = [
    {
      id: 'c1',
      kind: 'separate',
      severity: 'hard',
      enabled: true,
      studentIds: [(students[0] as Student).id, (students[1] as Student).id],
      scope: 'adjacent',
      note: '지난 학기 다툼이 있었음',
    },
  ];

  it('strips teacher-only fields from a student-facing export', () => {
    const redacted = redactStudents(students, STUDENT_FACING);
    for (const student of redacted) {
      expect(student.teacherMemo).toBeUndefined();
      expect(student.accessibilityNeeds).toBeUndefined();
      expect(student.gender).toBeUndefined();
      expect(student.tags).toBeUndefined();
      expect(student.excludeNote).toBeUndefined();
    }
    // The things students actually need are still there.
    expect(redacted[0]?.name).toBe('학생01');
    expect(redacted[0]?.number).toBe(1);
  });

  it('keeps them when the teacher opts in', () => {
    const redacted = redactStudents(students, TEACHER_FACING);
    expect(redacted[0]?.teacherMemo).toBe('메모0');
    expect(redacted[0]?.gender).toBe('male');
  });

  it('drops group roles and the rule set from a student-facing export', () => {
    expect(redactGrouping(grouping, STUDENT_FACING).groups[0]?.roles).toEqual({});
    expect(redactConstraints(constraints, STUDENT_FACING)).toEqual([]);
  });

  it('drops the free-text note even from the teacher copy', () => {
    const kept = redactConstraints(constraints, TEACHER_FACING);
    expect(kept).toHaveLength(1);
    expect(JSON.stringify(kept)).not.toContain('다툼');
  });

  it('produces a student-facing JSON backup with no leaked field', () => {
    const backup = buildBackup(
      { meta: null, students, classroom, constraints, assignment, grouping, history: [], seed: 1 },
      STUDENT_FACING,
    );
    const text = JSON.stringify(backup);

    expect(findLeakedFields(backup, STUDENT_FACING)).toEqual([]);
    expect(text).not.toContain('메모0');
    expect(text).not.toContain('앞자리 필요');
    expect(text).not.toContain('전학 예정');
    expect(text).not.toContain('다툼');
    expect(text).toContain('학생01');
  });

  it('produces a student-facing workbook with no teacher column', () => {
    const workbook = buildWorkbook(
      {
        meta: null,
        students,
        classroom,
        assignment,
        grouping,
        constraints,
        seed: 1,
        viewpointLabel: '교사 관점',
      },
      STUDENT_FACING,
    );
    const roster = JSON.stringify(workbook.Sheets['학생명단']);
    expect(roster).not.toContain('메모0');
    expect(roster).not.toContain('교사 메모');
    expect(roster).not.toContain('성별');
    expect(JSON.stringify(workbook.Sheets['설정'])).not.toContain('조건 종류');
  });

  it('includes the teacher columns when asked', () => {
    const workbook = buildWorkbook(
      {
        meta: null,
        students,
        classroom,
        assignment,
        grouping,
        constraints,
        seed: 1,
        viewpointLabel: '교사 관점',
      },
      TEACHER_FACING,
    );
    expect(JSON.stringify(workbook.Sheets['학생명단'])).toContain('메모0');
  });

  it('creates every sheet a teacher is promised', () => {
    const workbook = buildWorkbook(
      {
        meta: null,
        students,
        classroom,
        assignment,
        grouping,
        constraints,
        seed: 1,
        viewpointLabel: '학생 관점',
      },
      STUDENT_FACING,
    );
    expect(workbook.SheetNames).toEqual([
      '자리배치',
      '모둠편성',
      '학생명단',
      '설정',
      '과거배치용데이터',
    ]);
  });
});
