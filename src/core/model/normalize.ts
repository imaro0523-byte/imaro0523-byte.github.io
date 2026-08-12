/**
 * Cell-value normalisation shared by the importer and by identity matching.
 *
 * Real NEIS exports are inconsistent in ways that break naive parsers:
 * attendance numbers arrive as the float `1.0`, headers are written `성 명`
 * in one file and `성명` in another, and cells carry non-breaking spaces and
 * line breaks left over from print layout.
 */

/** Characters Excel and HWP leave behind that should count as plain spaces. */
const SPACE_LIKE = /[\s   -​  　﻿]+/g;

/** Fullwidth digits sometimes appear in hand-edited rosters. */
const FULLWIDTH_DIGITS = /[０-９]/g;

function foldFullwidthDigits(input: string): string {
  return input.replace(FULLWIDTH_DIGITS, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30),
  );
}

/**
 * Turns any cell value into a trimmed string with runs of whitespace collapsed
 * to a single space. Numbers that happen to be integers lose the `.0` tail that
 * spreadsheet engines add (`1.0` → `"1"`).
 */
export function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).normalize('NFC').replace(SPACE_LIKE, ' ').trim();
}

/**
 * Aggressive normalisation for header comparison: all whitespace removed, so
 * `성 명`, `성  명` and `성명` collapse to the same token.
 */
export function normalizeHeader(value: unknown): string {
  return normalizeCell(value).replace(SPACE_LIKE, '').normalize('NFC');
}

/**
 * Parses an attendance number out of anything a spreadsheet might hold.
 *
 * Accepts `1`, `1.0`, `"1"`, `"1.0"`, `"01"`, `" 3 "`, `"１２"` and `"12번"`.
 * Returns `null` when there is no sensible integer, and never throws.
 */
export function parseNumberLike(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // 1.0 from the XLSX float encoding is the integer 1; 1.5 is not a number.
    return Number.isInteger(value) ? value : null;
  }

  const text = foldFullwidthDigits(normalizeCell(value)).replace(SPACE_LIKE, '');
  if (text === '') return null;

  // Strip a trailing 번/번호 suffix that teachers sometimes type in.
  const stripped = text.replace(/번(호)?$/, '');
  if (stripped === '') return null;

  if (!/^[+-]?\d+(\.\d+)?$/.test(stripped)) return null;
  const parsed = Number(stripped);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

/**
 * Display form of a student name: NFC, internal whitespace collapsed to one
 * space, trimmed. NEIS pads short names with spaces for print alignment.
 */
export function normalizeName(value: unknown): string {
  return normalizeCell(value);
}

/** Comparison form of a name: whitespace removed entirely. */
export function normalizeNameForCompare(value: unknown): string {
  return normalizeCell(value).replace(SPACE_LIKE, '');
}

/** True when the cell holds nothing meaningful. */
export function isBlank(value: unknown): boolean {
  return normalizeCell(value) === '';
}
