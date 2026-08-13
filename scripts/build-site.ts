/**
 * Assembles the published folder: guide site at the root, app in `/app/`.
 *
 *   dist/            소개·사용법 (광고 O, 학생 데이터 없음)
 *   dist/app/        실제 앱     (광고 X, 엄격한 CSP)
 *
 * The separation is the point. An advertising script loaded on the guide page
 * has no way to reach the app, because it is a different document — and the
 * app's own policy forbids third-party scripts outright. Funding the project
 * therefore cannot compromise the thing being funded.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const APP = join(DIST, 'app');
const SITE = join(ROOT, 'site');
const STAGE = join(ROOT, '.app-build');

if (!existsSync(DIST)) {
  console.error('dist/ 가 없습니다. 먼저 vite build 를 실행하세요.');
  process.exit(1);
}

// Move the freshly built app aside, clear dist, then reassemble.
if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
renameSync(DIST, STAGE);
mkdirSync(DIST, { recursive: true });

cpSync(SITE, DIST, { recursive: true });
cpSync(STAGE, APP, { recursive: true });
rmSync(STAGE, { recursive: true, force: true });

// `_headers` belongs at the root of the published folder, not inside the app,
// so hosts that read it apply the policy to every path.
const appHeaders = join(APP, '_headers');
if (existsSync(appHeaders)) rmSync(appHeaders);

console.log('배포 폴더를 만들었습니다:');
for (const entry of readdirSync(DIST)) console.log('  dist/' + entry);
console.log('  dist/app/ (앱 ' + readdirSync(APP).length + '개 항목)');
