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

import {
  anonymizeGrouping,
  anonymizeStudents,
  describeForFeedback,
} from '@/core/exportData/anonymize';
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
import {
  buildFeedbackReport,
  FEEDBACK_REPORT_FOOTER,
  FEEDBACK_REPORT_HEADER,
} from '@/core/exportData/anonymize';

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

  it('contains no external http(s) URL outside the one link file', () => {
    // `import.meta.url` and the W3C SVG namespace are structural, not requests.
    const allowed = [/www\.w3\.org\/2000\/svg/, /schemas\.openxmlformats\.org/];
    // Destinations a teacher clicks live in exactly one file, so that adding an
    // address anywhere else is a test failure rather than a quiet change.
    const linkFile = join('src', 'config', 'links.ts');
    const offenders: string[] = [];

    for (const file of files) {
      if (file.endsWith(linkFile)) continue;
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

  it('gives outward links no query string, so nothing can ride along in one', () => {
    const text = readFileSync(join(SRC, 'config', 'links.ts'), 'utf8');
    const urls = [...text.matchAll(/'(https?:\/\/[^']*)'/g)].map((m) => m[1] as string);
    for (const url of urls) {
      // A link carrying `?d=…` would be an egress channel wearing a link's
      // clothing. Bare addresses only.
      expect(url, `${url} 에 쿼리스트링이 있습니다`).not.toContain('?');
      expect(url, `${url} 에 조각 식별자가 있습니다`).not.toContain('#');
    }
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

describe('feedback screenshots', () => {
  const real: Student[] = makeStudents(5).map((student, i) => ({
    ...student,
    name: `진짜이름${i}`,
    teacherMemo: 'MEMOLEAK1',
    accessibilityNeeds: 'CARELEAK2',
    excludeNote: 'EXCLLEAK3',
    tags: ['TAGLEAK4'],
    customFields: { 비고: 'CUSTOMLEAK5' },
  }));

  it('replaces every real name and drops every teacher-only field', () => {
    const safe = anonymizeStudents(real);

    expect(safe.map((s) => s.name)).toEqual([
      '학생01',
      '학생02',
      '학생03',
      '학생04',
      '학생05',
    ]);

    const text = JSON.stringify(safe);
    for (const leak of ['진짜이름', 'MEMOLEAK1', 'CARELEAK2', 'EXCLLEAK3', 'TAGLEAK4', 'CUSTOMLEAK5']) {
      expect(text, `${leak} 가 익명화된 사본에 남아 있습니다`).not.toContain(leak);
    }
  });

  it('keeps ids, numbers and status so the layout still reproduces the bug', () => {
    const safe = anonymizeStudents(real);
    expect(safe.map((s) => s.id)).toEqual(real.map((s) => s.id));
    expect(safe.map((s) => s.number)).toEqual(real.map((s) => s.number));
    expect(safe.map((s) => s.status)).toEqual(real.map((s) => s.status));
  });

  it('strips group names and roles, which can carry a real name too', () => {
    const grouping: Grouping = {
      excludedIds: [],
      groups: [
        {
          id: 'g1',
          index: 1,
          colorIndex: 1,
          name: '진짜이름0 모둠',
          memberIds: [(real[0] as Student).id],
          roles: { [(real[0] as Student).id]: '진짜이름0 발표' },
          locked: false,
        },
      ],
    };
    const safe = anonymizeGrouping(grouping);
    expect(JSON.stringify(safe)).not.toContain('진짜이름');
    expect(safe?.groups[0]?.memberIds).toEqual(grouping.groups[0]?.memberIds);
  });

  it('puts no names into the diagnostic text', () => {
    const text = describeForFeedback({
      appVersion: '1.0.0',
      screen: '결과 보기',
      studentCount: 25,
      excludedCount: 1,
      classroom: '5줄 × 6칸',
      seatCount: 30,
      groups: '6모둠 (5, 4, 4, 4, 4, 4명)',
      constraints: 3,
      seed: 12345,
      viewpoint: '교사 관점',
    });
    for (const leak of ['진짜이름', 'MEMOLEAK1', 'CARELEAK2']) {
      expect(text).not.toContain(leak);
    }
    // The word 학생 appears in «학생 수: 25명»; what must not appear is a name,
    // real or aliased, so the check is for an individual rather than the noun.
    expect(text).not.toMatch(/학생\d{2}/);
    // But it does carry what a maintainer needs.
    expect(text).toContain('12345');
    expect(text).toContain('6모둠');
  });
});

describe('의견 보고서', () => {
  it('carries counts and settings but never a student name', () => {
    // The teacher types the first three fields, so those are theirs to fill.
    // The automatic half is the part that must be safe without them checking.
    const report = buildFeedbackReport({
      situation: '25명을 6모둠으로 나누려 했습니다',
      problem: '조건을 지킬 수 없다고 나옵니다',
      expected: '어떤 조건이 걸렸는지 알려 주면 좋겠습니다',
      diagnostics: describeForFeedback({
        appVersion: '1.0.0',
        screen: '결과 보기',
        studentCount: 25,
        excludedCount: 1,
        classroom: '5줄 × 8칸',
        seatCount: 30,
        groups: '6모둠 (5, 4, 4, 4, 4, 4명)',
        constraints: 3,
        seed: 41250,
        viewpoint: '교사 관점',
      }),
      environment: '브라우저: TestBrowser/1.0',
    });

    expect(report).toContain(FEEDBACK_REPORT_HEADER);
    expect(report).toContain(FEEDBACK_REPORT_FOOTER);
    expect(report).toContain('학생 수: 25명');
    expect(report).toContain('랜덤 시드: 41250');
    expect(report).toContain('25명을 6모둠으로 나누려 했습니다');
    // Nothing in the automatic half can name anyone.
    expect(report).not.toMatch(/학생\d\d/);
  });

  it('says so plainly when a field was left empty', () => {
    const report = buildFeedbackReport({
      situation: '',
      problem: '   ',
      expected: '이렇게요',
      diagnostics: '앱 버전: 1.0.0',
      environment: '브라우저: TestBrowser/1.0',
    });
    expect(report.match(/\(적지 않음\)/g)).toHaveLength(2);
    expect(report).toContain('이렇게요');
  });
});
