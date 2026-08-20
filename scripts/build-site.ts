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
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// Build-time only. This never enters the application bundle, so it has no
// bearing on the privacy invariants, which are rules about `src/`.
import { marked } from 'marked';

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

// Before anything is copied, not after: a guard that runs once the files are
// already in the published folder is a guard that has already failed.
refuseUnmaskedOriginals(SITE);

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
 * Everything under `site/` is published verbatim. A screenshot of an
 * administrative system routinely carries a school name, a teacher's name and
 * an account id, and the masked copy is easy to mistake for the only copy —
 * so an unmasked original left in that folder would ship without anyone
 * noticing. Keep originals in `private/`, which git ignores and the build
 * never reads.
 */
function refuseUnmaskedOriginals(dir: string, shown = 'site'): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const where = `${shown}/${entry.name}`;
    if (entry.isDirectory()) {
      refuseUnmaskedOriginals(join(dir, entry.name), where);
    } else if (/-raw\.[a-z0-9]+$/i.test(entry.name)) {
      console.error(
        `${where} 는 가리기 전 원본으로 보입니다. 배포 폴더에 들어가면 그대로 공개됩니다.\n` +
          `private/ 로 옮기십시오. (git 이 무시하고 빌드도 읽지 않는 위치입니다.)`,
      );
      process.exit(1);
    }
  }
}

// ─── Articles ────────────────────────────────────────────────────────────
//
// Sources live in `content/guide/*.md`, outside `site/`, so that markdown never
// lands in the published folder. Each file carries a small front matter block
// and the build supplies everything else: the head, the preview tags, the
// breadcrumb, the structured data and the entry in the listing. An author who
// forgets one of those cannot ship a page missing it, because they never write
// them in the first place.

interface Article {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  bodyHtml: string;
}

const CONTENT = join(ROOT, 'content', 'guide');
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readArticles(): Article[] {
  if (!existsSync(CONTENT)) return [];

  const articles: Article[] = [];

  for (const name of readdirSync(CONTENT)) {
    if (!name.endsWith('.md')) continue;

    // Strip a byte order mark before anything looks at the first character.
    // Windows editors add one routinely, and without this the front matter
    // silently fails to match — the article just vanishes from the build.
    const raw = readFileSync(join(CONTENT, name), 'utf8').replace(/^﻿/, '');
    const matched = FRONT_MATTER.exec(raw);
    if (!matched) {
      console.error(`${name}: 앞머리(---)가 없습니다. 건너뜁니다.`);
      continue;
    }

    const fields: Record<string, string> = {};
    for (const line of (matched[1] ?? '').split(/\r?\n/)) {
      const at = line.indexOf(':');
      if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }

    // A draft stays out of the published folder entirely, which also keeps it
    // out of the listing and the sitemap. Nothing half-written gets indexed.
    if (fields.draft === 'true') continue;

    const missing = ['title', 'description', 'date'].filter((key) => !fields[key]);
    if (missing.length > 0) {
      console.error(`${name}: ${missing.join(', ')} 가 없습니다. 건너뜁니다.`);
      continue;
    }

    articles.push({
      slug: name.replace(/\.md$/, ''),
      title: fields.title as string,
      description: fields.description as string,
      date: fields.date as string,
      updated: fields.updated,
      bodyHtml: marked.parse(raw.slice(matched[0].length), { async: false }),
    });
  }

  // Newest first, which is also the order the listing wants.
  return articles.sort((a, b) => b.date.localeCompare(a.date));
}

/** One article page. `up` is the relative path back to the site root. */
function articlePage(article: Article): string {
  const url = `${ORIGIN}/guide/${article.slug}/`;
  const title = escapeHtml(article.title);
  const description = escapeHtml(article.description);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    datePublished: article.date,
    dateModified: article.updated ?? article.date,
    inLanguage: 'ko',
    mainEntityOfPage: url,
    image: `${ORIGIN}/og-image.png`,
    // Deliberately not a personal name: the author's identity is kept out of
    // the public repository, and the same choice applies to the pages.
    author: { '@type': 'Organization', name: '자리배치 도우미' },
    publisher: { '@type': 'Organization', name: '자리배치 도우미' },
  };

  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '자리배치 도우미', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: '읽을거리', item: `${ORIGIN}/guide/` },
      { '@type': 'ListItem', position: 3, name: article.title, item: url },
    ],
  };

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} — 자리배치 도우미</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${url}" />
    <link rel="stylesheet" href="../../style.css" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="자리배치 도우미" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${ORIGIN}/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${ORIGIN}/og-image.png" />
    <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
    </script>
    <script type="application/ld+json">
${JSON.stringify(crumbs, null, 2)}
    </script>
  </head>
  <body>
    <div class="wrap">
      <p class="crumbs">
        <a href="../../">자리배치 도우미</a> · <a href="../">읽을거리</a>
      </p>

      <h1>${title}</h1>
      <p class="dateline">${article.date}${
        article.updated ? ` 작성 · ${article.updated} 수정` : ''
      }</p>

      <div class="ad-slot"></div>

      <article>
${article.bodyHtml}
      </article>

      <div class="card">
        <strong>자리배치 도우미로 해 보기</strong>
        <p style="margin:.5rem 0 0">
          나이스 명렬표를 그대로 올리면 자리·짝꿍·모둠을 만들어 줍니다.
          학생 정보는 브라우저 밖으로 나가지 않습니다.
        </p>
        <a class="cta" href="../../app/">앱 열기</a>
      </div>

      <div class="ad-slot"></div>

      <footer class="muted">
        <a href="../">읽을거리 목록</a> · <a href="../../">소개</a> ·
        <a href="../../privacy.html">개인정보 처리방침</a>
      </footer>
    </div>
  </body>
</html>
`;
}

/** The listing at /guide/. */
function guideIndexPage(articles: Article[]): string {
  const url = `${ORIGIN}/guide/`;
  const description = '교실 자리 배치와 모둠 편성에 관해 현직 교사가 쓴 글 모음입니다.';

  const items = articles
    .map(
      (a) => `        <li>
          <h2><a href="./${a.slug}/">${escapeHtml(a.title)}</a></h2>
          <p class="muted">${a.date}</p>
          <p>${escapeHtml(a.description)}</p>
        </li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>읽을거리 — 자리배치 도우미</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${url}" />
    <link rel="stylesheet" href="../style.css" />
    <link rel="alternate" type="application/rss+xml" title="자리배치 도우미 — 읽을거리" href="../rss.xml" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="자리배치 도우미" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="읽을거리 — 자리배치 도우미" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${ORIGIN}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${ORIGIN}/og-image.png" />
  </head>
  <body>
    <div class="wrap">
      <p class="crumbs"><a href="../">자리배치 도우미</a></p>

      <h1>읽을거리</h1>
      <p class="lead">${description}</p>

      <div class="ad-slot"></div>

      <ul class="posts">
${items}
      </ul>

      <footer class="muted">
        <a href="../">소개</a> · <a href="../app/">앱 열기</a> ·
        <a href="../privacy.html">개인정보 처리방침</a>
      </footer>
    </div>
  </body>
</html>
`;
}

const articles = readArticles();

if (articles.length > 0) {
  const guideDir = join(DIST, 'guide');
  mkdirSync(guideDir, { recursive: true });
  writeFileSync(join(guideDir, 'index.html'), guideIndexPage(articles), 'utf8');

  for (const article of articles) {
    const dir = join(guideDir, article.slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), articlePage(article), 'utf8');
  }

  // An RSS feed, because Naver's webmaster tools ask for one alongside the
  // sitemap and treat it as the signal that a site publishes articles rather
  // than just existing. Built from the same list as everything else, so it
  // cannot fall out of step with the pages.
  writeFileSync(
    join(DIST, 'rss.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0">\n  <channel>\n' +
      '    <title>자리배치 도우미 — 읽을거리</title>\n' +
      `    <link>${ORIGIN}/guide/</link>\n` +
      '    <description>교실 자리 배치와 모둠 편성에 관해 현직 교사가 쓴 글 모음입니다.</description>\n' +
      '    <language>ko</language>\n' +
      `    <lastBuildDate>${new Date(`${articles[0]?.date}T00:00:00+09:00`).toUTCString()}</lastBuildDate>\n` +
      articles
        .map((a) => {
          const url = `${ORIGIN}/guide/${a.slug}/`;
          const published = new Date(`${a.date}T00:00:00+09:00`).toUTCString();
          return (
            '    <item>\n' +
            `      <title>${escapeHtml(a.title)}</title>\n` +
            `      <link>${url}</link>\n` +
            `      <guid isPermaLink="true">${url}</guid>\n` +
            `      <pubDate>${published}</pubDate>\n` +
            `      <description>${escapeHtml(a.description)}</description>\n` +
            '    </item>\n'
          );
        })
        .join('') +
      '  </channel>\n</rss>\n',
    'utf8',
  );
}

// The guide is only worth linking to once something is in it. An empty section
// on the front page would be worse than no section at all.
const indexPath = join(DIST, 'index.html');
writeFileSync(
  indexPath,
  readFileSync(indexPath, 'utf8').replace(
    '<!--GUIDE_LINK-->',
    articles.length === 0
      ? ''
      : `<h2>읽을거리</h2>
      <p>자리 배치와 모둠 편성을 어떻게 정할지에 관한 글을 모았습니다.</p>
      <ul>
${articles
  .slice(0, 5)
  .map((a) => `        <li><a href="./guide/${a.slug}/">${escapeHtml(a.title)}</a></li>`)
  .join('\n')}
      </ul>
      <p><a href="./guide/">글 전체 보기 →</a></p>`,
  ),
  'utf8',
);

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
