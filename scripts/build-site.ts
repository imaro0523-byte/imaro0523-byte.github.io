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

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const APP = join(DIST, 'app');
const SITE = join(ROOT, 'site');
const STAGE = join(ROOT, '.app-build');

/**
 * Where the published folder ends up. The repository is named
 * `imaro0523-byte.github.io`, so GitHub Pages serves it at the domain root
 * rather than under a project subpath — see the handoff note on why the
 * repository was renamed (ads.txt has to sit at the root of a domain).
 *
 * This is the one place in the build that needs an absolute address. Pages
 * themselves use relative links so the site keeps working when opened from a
 * different origin, but `sitemap.xml` and `robots.txt` are defined by their
 * specifications to carry absolute URLs.
 */
const ORIGIN = 'https://imaro0523-byte.github.io';

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

/**
 * Every page in the published folder, as {url, lastmod}.
 *
 * The list is discovered rather than declared. Articles will be added to this
 * site one file at a time, and a hand-maintained sitemap goes stale the first
 * time someone forgets to edit it — the failure is silent, which is the worst
 * kind. Walking the output means a page is listed by virtue of existing.
 */
function findPages(dir: string, prefix: string): Array<{ loc: string; lastmod: string }> {
  const pages: Array<{ loc: string; lastmod: string }> = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      pages.push(...findPages(full, `${prefix}${entry.name}/`));
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;

    // A directory's index.html is that directory's address, not a file in it.
    const path = entry.name === 'index.html' ? prefix : `${prefix}${entry.name}`;
    pages.push({
      // encodeURI so Korean filenames stay valid URLs if articles use them.
      loc: ORIGIN + encodeURI(path),
      lastmod: statSync(full).mtime.toISOString().slice(0, 10),
    });
  }

  return pages;
}

const pages = findPages(DIST, '/').sort((a, b) => a.loc.localeCompare(b.loc));

writeFileSync(
  join(DIST, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    pages
      .map((p) => `  <url>\n    <loc>${p.loc}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n  </url>\n`)
      .join('') +
    '</urlset>\n',
  'utf8',
);

writeFileSync(
  join(DIST, 'robots.txt'),
  ['User-agent: *', 'Allow: /', '', `Sitemap: ${ORIGIN}/sitemap.xml`, ''].join('\n'),
  'utf8',
);

console.log('배포 폴더를 만들었습니다:');
for (const entry of readdirSync(DIST)) console.log('  dist/' + entry);
console.log('  dist/app/ (앱 ' + readdirSync(APP).length + '개 항목)');
console.log(`  sitemap.xml (${pages.length}쪽): ${pages.map((p) => p.loc).join(', ')}`);
