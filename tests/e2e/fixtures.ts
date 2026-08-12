import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildNeisWorkbook, type NeisFixtureOptions } from '../support/neisFixture';

/**
 * Writes a synthetic NEIS-shaped workbook to a temporary file for upload tests.
 * The names inside are 학생01 … 학생NN — never a real student.
 */
export function writeFixtureWorkbook(name: string, options: NeisFixtureOptions = {}): string {
  const directory = join(tmpdir(), 'seat-planner-e2e');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, Buffer.from(buildNeisWorkbook(options)));
  return path;
}
