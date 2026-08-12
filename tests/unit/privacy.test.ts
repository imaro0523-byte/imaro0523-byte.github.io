/**
 * Privacy guarantees that are checked mechanically rather than promised.
 *
 * The source scan is the important one: it fails the build the moment somebody
 * adds a `fetch` or an external URL to the application source, which is exactly
 * the kind of change that would otherwise slip in unnoticed months later.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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
import { buildWorkbook, workbookToBytes } from '@/core/exportData/toXlsx';
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

  /**
   * Every way a browser can be made to send bytes somewhere.
   *
   * The first version of this test checked only fetch, XHR, WebSocket and
   * sendBeacon. An audit showed that was the short list: an image `src`, a CSS
   * `url()`, an iframe or a prefetch link will all carry a query string to a
   * server just as effectively, and none of them were being looked for.
   */
  it('uses no egress mechanism of any kind', () => {
    const patterns: Array<[RegExp, string]> = [
      [/\bfetch\s*\(/, 'fetch()'],
      [/XMLHttpRequest/, 'XMLHttpRequest'],
      [/sendBeacon/, 'navigator.sendBeacon'],
      [/new\s+WebSocket/, 'WebSocket'],
      [/\bEventSource\b/, 'EventSource'],
      [/navigator\.geolocation/, 'geolocation'],
      [/navigator\.share\b/, 'navigator.share'],
      [/ReportingObserver/, 'ReportingObserver'],
      [/importScripts/, 'importScripts'],
      [/\bwindow\.open\s*\(/, 'window.open'],
      [/\blocation\s*\.\s*(href|assign|replace)\s*=?/, 'location navigation'],
      [/\.\s*submit\s*\(\s*\)/, 'form.submit()'],
      [/createElement\s*\(\s*['"](?:img|script|iframe|link|form|object|embed)['"]/i, 'element injection'],
      [/\bnew\s+Image\s*\(/, 'new Image()'],
      [/rel\s*=\s*['"](?:prefetch|preconnect|dns-prefetch|preload)['"]/, 'link prefetch'],
    ];

    const offenders: string[] = [];
    for (const file of files) {
      // Comments are stripped so prose describing a rule cannot trip it.
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const [pattern, label] of patterns) {
        if (pattern.test(text)) offenders.push(`${relative(process.cwd(), file)}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('creates only the anchor used to save a local blob', () => {
    // `download.ts` builds an <a download href="blob:…"> and clicks it. That is
    // the one element this app injects, and it must stay the only one.
    const creators: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of text.matchAll(/createElement\s*\(\s*['"]([a-z]+)['"]/gi)) {
        creators.push(`${relative(process.cwd(), file)}: ${match[1]}`);
      }
    }
    expect(creators).toEqual(['src\\ui\\export\\download.ts: a'.replace(/\\/g, sep)]);
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

  /**
   * A distinct marker per field.
   *
   * Checking field *names* catches a whole object being serialised, but not a
   * value that has been copied somewhere else — a memo concatenated into a
   * label, a tag folded into a note. Distinct values make the leak traceable
   * to the field it escaped from.
   */
  const MARKS = {
    memo: 'MARKMEMO001',
    care: 'MARKCARE002',
    rule: 'MARKRULE003',
    exclude: 'MARKEXCL004',
    tag: 'MARKTAG005',
    name: 'MARKNAME006',
  } as const;

  const marked: Student[] = makeStudents(4).map((student, i) => ({
    ...student,
    name: i === 0 ? MARKS.name : student.name,
    gender: 'female',
    division: 'b',
    tags: [MARKS.tag],
    teacherMemo: MARKS.memo,
    accessibilityNeeds: MARKS.care,
    excludeNote: MARKS.exclude,
  }));

  const markedConstraints: Constraint[] = [
    {
      id: 'c-mark',
      kind: 'separate',
      severity: 'hard',
      enabled: true,
      studentIds: [(marked[0] as Student).id, (marked[1] as Student).id],
      scope: 'adjacent',
      note: MARKS.rule,
    },
  ];

  const markedAssignment: SeatAssignment = {};
  seatsOf(classroom).slice(0, 4).forEach((seat, i) => {
    markedAssignment[seat.id] = (marked[i] as Student).id;
  });

  it('lets no teacher-only value into a student-facing JSON backup', () => {
    const text = JSON.stringify(
      buildBackup(
        {
          meta: null,
          students: marked,
          classroom,
          constraints: markedConstraints,
          assignment: markedAssignment,
          grouping: null,
          history: [],
          seed: 1,
        },
        STUDENT_FACING,
      ),
    );

    for (const [field, mark] of Object.entries(MARKS)) {
      if (field === 'name') continue; // names are the point of the export
      expect(text, `${field} 값이 학생용 백업에 새어 나갔습니다`).not.toContain(mark);
    }
    expect(text).toContain(MARKS.name);
  });

  it('lets no teacher-only value into a student-facing workbook', () => {
    const workbook = buildWorkbook(
      {
        meta: null,
        students: marked,
        classroom,
        assignment: markedAssignment,
        grouping: null,
        constraints: markedConstraints,
        seed: 1,
        viewpointLabel: '학생 관점',
      },
      STUDENT_FACING,
    );

    // Every sheet, not just the roster: a value can escape through any of them.
    const text = JSON.stringify(workbook.Sheets);
    for (const [field, mark] of Object.entries(MARKS)) {
      if (field === 'name') continue;
      expect(text, `${field} 값이 학생용 엑셀에 새어 나갔습니다`).not.toContain(mark);
    }
    expect(text).toContain(MARKS.name);
  });

  it('keeps the constraint note out even of the teacher copy', () => {
    const text = JSON.stringify(
      buildBackup(
        {
          meta: null,
          students: marked,
          classroom,
          constraints: markedConstraints,
          assignment: markedAssignment,
          grouping: null,
          history: [],
          seed: 1,
        },
        TEACHER_FACING,
      ),
    );
    expect(text).toContain(MARKS.memo);
    // The free-text note on a rule is where wording about a student's
    // circumstances collects, so it never travels — not even here.
    expect(text).not.toContain(MARKS.rule);
  });

  /**
   * Locks in the behaviour an audit verified: SheetJS writes these as string
   * cells, so Excel shows them as text instead of evaluating them.
   *
   * No apostrophe-prefix defence is applied, deliberately. `.xlsx` carries an
   * explicit type per cell, unlike CSV, so the injection does not land — and
   * prefixing would put a stray quote in front of an ordinary memo such as
   * «-지각 잦음». This test exists so that if the export ever changes to a
   * format without cell types, the omission is caught rather than inherited.
   */
  it('writes spreadsheet-formula-looking input as text, never as a formula', () => {
    const dangerous = ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '=HYPERLINK("http://x/","c")'];
    const students: Student[] = dangerous.map((value, i) => ({
      ...(makeStudents(1)[0] as Student),
      id: `f${i}`,
      number: i + 1,
      name: value,
      tags: [value],
      teacherMemo: value,
    }));

    const workbook = buildWorkbook(
      {
        meta: null,
        students,
        classroom,
        assignment: {},
        grouping: null,
        constraints: [],
        seed: 1,
        viewpointLabel: '학생 관점',
      },
      TEACHER_FACING,
    );

    for (const sheet of Object.values(workbook.Sheets)) {
      for (const [address, cell] of Object.entries(sheet)) {
        if (address.startsWith('!')) continue;
        const entry = cell as { t?: string; v?: unknown; f?: unknown };
        if (typeof entry.v === 'string' && /^[=+\-@]/.test(entry.v)) {
          expect(entry.t, `${address} 가 문자열 셀이 아닙니다`).toBe('s');
          expect(entry.f, `${address} 에 수식이 붙었습니다`).toBeUndefined();
        }
      }
    }

    // And the written file contains no formula element at all.
    const bytes = new Uint8Array(workbookToBytes(workbook));
    const text = new TextDecoder('utf-8').decode(bytes.slice(0, bytes.length));
    expect(text.includes('<f>')).toBe(false);
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
