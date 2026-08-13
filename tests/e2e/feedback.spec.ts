import { expect, test } from '@playwright/test';

/**
 * The feedback route, and the safeguard that makes it usable.
 *
 * Screenshots are the most useful attachment to a bug report and the most
 * dangerous: a picture of this app is a picture of a class list. The app
 * produces the anonymised version itself so nobody has to remember to.
 */
test.describe('의견 보내기', () => {
  test('이름 가린 화면을 저장하고, 파일명에 이름이 없다', async ({ page }) => {
    const external: string[] = [];
    page.context().on('request', (r) => {
      if (!r.url().startsWith('http://127.0.0.1:4173') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) {
        external.push(r.url());
      }
    });

    await page.goto('/');
    await page.getByRole('button', { name: '샘플 명단으로 먼저 체험해 보기' }).click();
    await page.getByLabel('이름').first().fill('홍길동');
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    await page.getByRole('button', { name: '의견 보내기' }).click();
    await expect(page.getByText('화면 사진은 이름을 가려서 보내 주세요')).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '이름 가린 화면 저장' }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^피드백용_화면_\d+\.png$/);
    expect(file.suggestedFilename()).not.toContain('홍길동');
    await expect(page.getByText(/저장했습니다/)).toBeVisible();

    // Producing it must not have contacted anyone.
    expect(external).toEqual([]);
  });

  test('진단 정보에 학생 이름이 들어가지 않는다', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '샘플 명단으로 먼저 체험해 보기' }).click();
    await page.getByLabel('이름').first().fill('홍길동');
    await page.getByLabel('교사용 항목 보기 (메모 · 배려 사항)').check();
    await page.getByLabel('교사 메모').first().fill('비밀메모입니다');

    await page.getByRole('button', { name: '의견 보내기' }).click();
    const text = await page.getByLabel('진단 정보').inputValue();

    expect(text).not.toContain('홍길동');
    expect(text).not.toContain('비밀메모입니다');
    // But it carries what is needed to reproduce a report.
    expect(text).toContain('학생 수: 25명');
    expect(text).toContain('랜덤 시드');
  });

  test('설정 전에는 링크 대신 안내를 보여 준다', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '의견 보내기' }).click();
    // Nothing is configured in the repository, so no dead link is shown.
    await expect(page.getByText(/의견 보내는 곳이 아직 설정되지 않았습니다/)).toBeVisible();
  });
});
