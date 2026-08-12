import { expect, test } from '@playwright/test';

/**
 * Offline support, verified rather than claimed.
 *
 * An audit found the service worker was being built and never registered: the
 * README promised offline use that had never once worked. These tests exist so
 * that promise cannot quietly become false again.
 */
test.describe('오프라인 사용', () => {
  test('기본값은 꺼짐이며, 켜야 서비스워커가 등록된다', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '명렬표 불러오기' })).toBeVisible();

    // Nothing is registered until the teacher asks.
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(0);

    await page.getByRole('button', { name: '설정' }).click();
    await page.getByLabel('오프라인으로 쓸 수 있게 하기').check();
    await expect(page.getByText(/오프라인 사용을 켰습니다/)).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)),
      )
      .toBeGreaterThan(0);
  });

  test('켠 뒤에는 오프라인에서도 앱이 열리고, 캐시에 학생 정보가 없다', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '설정' }).click();
    await page.getByLabel('오프라인으로 쓸 수 있게 하기').check();
    await expect(page.getByText(/오프라인 사용을 켰습니다/)).toBeVisible();
    await page.waitForTimeout(1500); // let precaching finish

    // Load a roster and mark one student with a string that cannot occur in
    // the build. Searching for «학생01» would not do: the import screen's own
    // help text mentions it, so the bundle contains it as ordinary UI copy.
    const MARKER = 'ZZCACHEMARK8801';
    await page.getByRole('button', { name: '닫기' }).click();
    await page.getByRole('button', { name: '샘플 명단으로 먼저 체험해 보기' }).click();
    await expect(page.getByRole('heading', { name: '학생 명단' })).toBeVisible();
    await page.getByLabel('이름').first().fill(MARKER);
    await page.waitForTimeout(500);

    const cached = await page.evaluate(async (marker) => {
      const out: { urls: string[]; carrying: string[] } = { urls: [], carrying: [] };
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const path = new URL(request.url).pathname;
          out.urls.push(path);
          const response = await cache.match(request);
          const text = response ? await response.clone().text() : '';
          if (text.includes(marker) || request.url.includes(marker)) out.carrying.push(path);
        }
      }
      return out;
    }, MARKER);

    // Only the app shell, and no roster anywhere inside it.
    expect(cached.urls.length).toBeGreaterThan(0);
    expect(cached.carrying, '캐시에 학생 데이터가 들어갔습니다').toEqual([]);
    for (const path of cached.urls) {
      expect(path, `${path} 는 앱 셸이 아닙니다`).toMatch(
        /^\/(index\.html|icon\.svg|manifest\.webmanifest|assets\/[A-Za-z0-9._-]+\.(js|css))?$/,
      );
    }

    // Cut the network entirely and reload.
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: '명렬표 불러오기' })).toBeVisible();
    // And the app still works with no connection at all.
    await page.getByRole('button', { name: '샘플 명단으로 먼저 체험해 보기' }).click();
    await expect(page.getByText('배치 대상 25명')).toBeVisible();
    await context.setOffline(false);
  });

  test('모든 정보 삭제가 서비스워커와 캐시까지 정리한다', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '설정' }).click();
    await page.getByLabel('오프라인으로 쓸 수 있게 하기').check();
    await expect(page.getByText(/오프라인 사용을 켰습니다/)).toBeVisible();
    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: '모든 정보 삭제' }).click();
    await page.getByRole('button', { name: '정말 모두 삭제합니다' }).click();
    await expect(page.getByText(/삭제 후 확인 완료|확인하지 못했습니다/)).toBeVisible();

    const after = await page.evaluate(async () => ({
      workers: (await navigator.serviceWorker.getRegistrations()).length,
      caches: (await caches.keys()).filter((n) => n.startsWith('workbox-')).length,
    }));
    expect(after.workers).toBe(0);
    expect(after.caches).toBe(0);
  });
});
