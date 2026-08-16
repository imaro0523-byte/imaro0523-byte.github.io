/**
 * Step 1 — bring the roster in.
 *
 * The file is read with `FileReader`/`arrayBuffer()` and parsed in this tab.
 * Nothing is uploaded, and the buffer is released as soon as parsing finishes.
 */

import { useCallback, useRef, useState } from 'react';

import { findRosters, parseWithManualMapping, type RosterCandidate } from '@/core/excel/importRoster';
import type { SheetGrid } from '@/core/excel/grid';
import { readCsvGrid, readWorkbookGrids, WorkbookReadError } from '@/core/excel/readWorkbook';
import { normalizeCell } from '@/core/model/normalize';
import { buildDividedSample, buildNeisSample } from '@/lib/sample';
import { safeErrorMessage } from '@/lib/log';
import { useAppStore } from '@/store/useAppStore';
import { PrivacyNotice } from '../components/PrivacyNotice';
import { UploadIcon, WarningIcon } from '../components/Icons';

type Phase = 'idle' | 'choosing' | 'manual';

export function ImportScreen() {
  const loadRoster = useAppStore((s) => s.loadRoster);
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grids, setGrids] = useState<SheetGrid[]>([]);
  const [candidates, setCandidates] = useState<RosterCandidate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Manual mapping state
  const [manualSheet, setManualSheet] = useState(0);
  const [manualHeaderRow, setManualHeaderRow] = useState(0);
  const [manualNumberCol, setManualNumberCol] = useState(0);
  const [manualNameCol, setManualNameCol] = useState(1);

  const reset = () => {
    setPhase('idle');
    setGrids([]);
    setCandidates([]);
    setSelectedKey(null);
    setError(null);
  };

  const ingest = useCallback((sheets: SheetGrid[]) => {
    setGrids(sheets);
    const found = findRosters(sheets);
    setCandidates(found);
    if (found.length === 0) {
      setError(
        '학생 표를 자동으로 찾지 못했습니다. 아래에서 헤더가 있는 줄과 번호·이름 열을 직접 지정해 주세요.',
      );
      setPhase('manual');
    } else {
      setSelectedKey(found[0]?.key ?? null);
      setPhase('choosing');
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        // `arrayBuffer()` keeps the bytes in this tab; there is no upload path.
        let buffer = await file.arrayBuffer();
        const isCsv = /\.csv$/i.test(file.name);
        const sheets = isCsv ? [readCsvGrid(buffer, file.name)] : readWorkbookGrids(buffer);
        // Drop the reference so the raw file is not held on to.
        buffer = new ArrayBuffer(0);
        ingest(sheets);
      } catch (caught) {
        if (caught instanceof WorkbookReadError) setError(caught.message);
        else setError(safeErrorMessage(caught, '파일을 읽지 못했습니다.'));
        setPhase('idle');
      } finally {
        // Resetting lets the same file be chosen again after a correction.
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [ingest],
  );

  const confirm = () => {
    const chosen = candidates.find((c) => c.key === selectedKey);
    if (!chosen) return;
    loadRoster(chosen.students, chosen.meta);
  };

  const confirmManual = () => {
    const grid = grids[manualSheet];
    if (!grid) return;
    const roster = parseWithManualMapping(grid, manualSheet, manualHeaderRow, {
      number: manualNumberCol,
      name: manualNameCol,
    });
    if (roster.students.length === 0) {
      setError('그 위치에서는 학생을 찾지 못했습니다. 줄 번호와 열을 다시 확인해 주세요.');
      return;
    }
    loadRoster(roster.students, roster.meta);
  };

  const selected = candidates.find((c) => c.key === selectedKey);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">명렬표 불러오기</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          나이스에서 내려받은 엑셀 파일을 그대로 올리면 됩니다. 파일을 고쳐 둘 필요는 없습니다.
        </p>
      </div>

      <PrivacyNotice />

      {phase === 'idle' && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) void handleFile(file);
            }}
            className={`rounded-2xl border-2 border-dashed p-10 text-center transition ${
              dragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                : 'border-slate-300 dark:border-slate-600'
            }`}
          >
            <UploadIcon className="mx-auto h-10 w-10 text-slate-400" />
            <p className="mt-3 text-base font-semibold">엑셀 파일을 여기로 끌어다 놓으세요</p>
            <p className="mt-1 text-xs text-slate-500">.xlsx · .xls · .csv</p>
            <button type="button" className="btn-primary mt-4" onClick={() => inputRef.current?.click()}>
              <UploadIcon />
              파일 선택
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              data-testid="file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>

          <div className="text-center">
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const sample = buildNeisSample();
                  loadRoster(sample.students, sample.meta);
                }}
              >
                샘플 명단으로 먼저 체험해 보기
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  const sample = buildDividedSample();
                  loadRoster(sample.students, sample.meta);
                }}
              >
                구분이 나뉘는 예시 명단
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              «학생01»~«학생25»로 만든 가짜 명단입니다. 실제 학생 정보가 아닙니다.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              두 번째 명단은 이름이 가나다순으로 두 번 도는 실제 명렬표 모양이라,
              «이름 순서로 구분 나누기»가 어떻게 동작하는지 볼 수 있습니다.
            </p>
          </div>
        </>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {phase === 'choosing' && (
        <div className="card space-y-4">
          <h2 className="text-lg font-semibold">불러올 반을 확인해 주세요</h2>

          <div className="space-y-2">
            {candidates.map((candidate) => (
              <label
                key={candidate.key}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                  selectedKey === candidate.key
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="roster"
                  className="mt-1"
                  checked={selectedKey === candidate.key}
                  onChange={() => setSelectedKey(candidate.key)}
                />
                <span className="text-sm">
                  <span className="font-semibold">{candidate.label}</span>
                  {candidate.sheetHidden && (
                    <span className="ml-1.5 rounded bg-slate-200 px-1.5 text-[10px] dark:bg-slate-700">
                      숨김 시트
                    </span>
                  )}
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {candidate.header.rowIndex + 1}번째 줄에서 «번호»와 «성명»을 찾았습니다
                    {candidate.meta.teacherName ? ` · 담당 ${candidate.meta.teacherName}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {selected && selected.issues.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                확인이 필요한 항목 {selected.issues.length}건
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-800 dark:text-amber-300">
                {selected.issues.slice(0, 6).map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}

          {selected && (
            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs dark:bg-slate-800">
                  <tr>
                    <th className="px-2 py-1.5 text-left">번호</th>
                    <th className="px-2 py-1.5 text-left">이름</th>
                    <th className="px-2 py-1.5 text-left">학년</th>
                    <th className="px-2 py-1.5 text-left">반</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.students.map((student) => (
                    <tr key={student.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-1">{student.number ?? '—'}</td>
                      <td className="px-2 py-1 font-medium">{student.name}</td>
                      <td className="px-2 py-1 text-slate-500">{student.grade ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-500">{student.classNumber ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={confirm} disabled={!selected}>
              이 명단으로 시작하기 ({selected?.students.length ?? 0}명)
            </button>
            <button type="button" className="btn-secondary" onClick={() => setPhase('manual')}>
              직접 지정하기
            </button>
            <button type="button" className="btn-ghost" onClick={reset}>
              다른 파일 선택
            </button>
          </div>
        </div>
      )}

      {phase === 'manual' && grids.length > 0 && (
        <ManualMapping
          grids={grids}
          sheetIndex={manualSheet}
          headerRow={manualHeaderRow}
          numberCol={manualNumberCol}
          nameCol={manualNameCol}
          onSheet={setManualSheet}
          onHeaderRow={setManualHeaderRow}
          onNumberCol={setManualNumberCol}
          onNameCol={setManualNameCol}
          onConfirm={confirmManual}
          onCancel={reset}
        />
      )}
    </div>
  );
}

interface ManualProps {
  grids: SheetGrid[];
  sheetIndex: number;
  headerRow: number;
  numberCol: number;
  nameCol: number;
  onSheet: (value: number) => void;
  onHeaderRow: (value: number) => void;
  onNumberCol: (value: number) => void;
  onNameCol: (value: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Fallback when detection fails or picks the wrong table. */
function ManualMapping(props: ManualProps) {
  const grid = props.grids[props.sheetIndex];
  const preview = (grid?.cells ?? []).slice(0, 20);
  const width = Math.min(preview.reduce((w, row) => Math.max(w, row?.length ?? 0), 0), 15);

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-lg font-semibold">직접 지정하기</h2>
        <p className="mt-1 text-xs text-slate-500">
          아래 표에서 «번호»와 «이름»이 적힌 줄을 찾아 그 줄 번호와 열을 골라 주세요.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor="sheet">시트</label>
          <select
            id="sheet"
            className="input"
            value={props.sheetIndex}
            onChange={(e) => props.onSheet(Number(e.target.value))}
          >
            {props.grids.map((g, i) => (
              <option key={i} value={i}>
                {g.name}{g.hidden ? ' (숨김)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="hrow">헤더 줄</label>
          <input
            id="hrow"
            type="number"
            min={1}
            className="input"
            value={props.headerRow + 1}
            onChange={(e) => props.onHeaderRow(Math.max(0, Number(e.target.value) - 1))}
          />
        </div>
        <div>
          <label className="label" htmlFor="ncol">번호 열</label>
          <input
            id="ncol"
            type="number"
            min={1}
            className="input"
            value={props.numberCol + 1}
            onChange={(e) => props.onNumberCol(Math.max(0, Number(e.target.value) - 1))}
          />
        </div>
        <div>
          <label className="label" htmlFor="namecol">이름 열</label>
          <input
            id="namecol"
            type="number"
            min={1}
            className="input"
            value={props.nameCol + 1}
            onChange={(e) => props.onNameCol(Math.max(0, Number(e.target.value) - 1))}
          />
        </div>
      </div>

      <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="text-xs">
          <thead className="bg-slate-100 dark:bg-slate-800">
            <tr>
              <th className="px-2 py-1">줄</th>
              {Array.from({ length: width }, (_, col) => (
                <th
                  key={col}
                  className={`px-2 py-1 ${
                    col === props.numberCol || col === props.nameCol ? 'bg-blue-200 dark:bg-blue-900' : ''
                  }`}
                >
                  {col + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={`border-t border-slate-100 dark:border-slate-800 ${
                  rowIndex === props.headerRow ? 'bg-blue-50 font-semibold dark:bg-blue-950' : ''
                }`}
              >
                <td className="px-2 py-1 text-slate-400">{rowIndex + 1}</td>
                {Array.from({ length: width }, (_, col) => (
                  <td key={col} className="max-w-[8rem] truncate px-2 py-1">
                    {normalizeCell(row?.[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button type="button" className="btn-primary" onClick={props.onConfirm}>
          이 설정으로 불러오기
        </button>
        <button type="button" className="btn-ghost" onClick={props.onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
