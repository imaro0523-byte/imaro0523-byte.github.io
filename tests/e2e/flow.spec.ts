import { expect, test, type Page, type Request } from '@playwright/test';

import { writeFixtureWorkbook } from './fixtures';
import { TWO_RUN_NAMES } from '../support/neisFixture';

/**
 * Records every request the page makes that is not same-origin.
 *
 * This is the empirical half of the privacy claim: the CSP is what blocks
 * outbound traffic, and this is what proves nothing was even attempted.
 */
function watchNetwork(page: Page): { external: string[] } {
  const external: string[] = [];
  const origin = 'http://127.0.0.1:4173';

  const record = (request: Request) => {
    const url = request.url();
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return;
    external.push(`${request.method()} ${url}`);
  };

  page.on('request', record);
  return { external };
}

async function loadSample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '샘플 명단으로 먼저 체험해 보기' }).click();
  await expect(page.getByRole('heading', { name: '학생 명단' })).toBeVisible();
}

test.describe('자리배치 도우미 — 주요 흐름', () => {
  test('나이스 엑셀을 올려 명단을 인식한다', async ({ page }) => {
    const net = watchNetwork(page);
    const file = writeFixtureWorkbook('roster-25.xlsx', { studentCount: 25 });

    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(file);

    await expect(page.getByText('불러올 반을 확인해 주세요')).toBeVisible();
    await expect(page.getByText(/9번째 줄에서/)).toBeVisible();

    await page.getByRole('button', { name: /이 명단으로 시작하기 \(25명\)/ }).click();
    await expect(page.getByText('배치 대상 25명')).toBeVisible();
    await expect(page.getByLabel('이름').first()).toHaveValue('학생01');

    expect(net.external).toEqual([]);
  });

  test('전출 학생을 배치에서 제외하면 모둠 인원이 다시 계산된다', async ({ page }) => {
    await loadSample(page);

    // Mark the third student as having transferred out.
    await page.getByLabel('배치 여부').nth(2).selectOption('transferOut');
    await expect(page.getByText('배치 대상 24명')).toBeVisible();
    await expect(page.getByText('배치에서 제외한 학생 1명')).toBeVisible();

    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await expect(page.getByText('배치할 학생 24명')).toBeVisible();

    await page.getByRole('button', { name: /모둠 편성만/ }).click();
    await page.getByRole('button', { name: '6모둠', exact: true }).click();
    // 24 into 6 divides evenly once the excluded student is out of the count.
    await expect(page.getByText('6모둠 — 4, 4, 4, 4, 4, 4명')).toBeVisible();

    // Putting the student back changes the plan again.
    await page.getByRole('button', { name: '2. 학생 명단' }).click();
    await page.getByRole('button', { name: '되돌리기' }).click();
    await expect(page.getByText('배치 대상 25명')).toBeVisible();
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await expect(page.getByText('6모둠 — 5, 4, 4, 4, 4, 4명')).toBeVisible();
  });

  test('25명을 6모둠으로 나누고 자리에 배치한다', async ({ page }) => {
    const net = watchNetwork(page);
    await loadSample(page);

    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: /모둠 \+ 자리 배치/ }).click();
    await expect(page.getByText('6모둠 — 5, 4, 4, 4, 4, 4명')).toBeVisible();

    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    await expect(page.getByText('자리에 앉은 학생 25명')).toBeVisible();
    await expect(page.getByText('«반드시 지킴» 조건을 모두 지켰습니다.')).toBeVisible();
    await expect(page.getByText('모둠 편성 (6모둠)')).toBeVisible();

    const groupSizes = await page.locator('.group-card').allInnerTexts();
    const counts = groupSizes.map((text) => Number(/(\d+)명/.exec(text)?.[1] ?? 0));
    expect(counts.sort((a, b) => b - a)).toEqual([5, 4, 4, 4, 4, 4]);

    expect(net.external).toEqual([]);
  });

  test('이름 순서로 구분1·구분2를 한 번에 나눈다', async ({ page }) => {
    // A roster shaped the way NEIS writes one: two 가나다 runs back to back,
    // and no 성별 column anywhere — which is the situation this feature exists
    // for.
    const file = writeFixtureWorkbook('two-runs.xlsx', {
      studentCount: TWO_RUN_NAMES.length,
      names: TWO_RUN_NAMES,
    });

    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(file);
    await page.getByRole('button', { name: /이 명단으로 시작하기/ }).click();
    await expect(page.getByRole('heading', { name: '학생 명단' })).toBeVisible();

    // Nothing is split until the teacher asks.
    await expect(page.getByText('아직 나누지 않았습니다')).toBeVisible();

    await page.getByRole('button', { name: '이름 순서로 구분 나누기' }).click();
    await expect(page.getByText('구분1 7명 · 구분2 7명', { exact: true })).toBeVisible();

    // The split reads the ordering, so it must not have set anyone's gender.
    const genderValues = await page.getByLabel('성별').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLSelectElement).value),
    );
    expect(new Set(genderValues)).toEqual(new Set(['unset']));

    // First run is 구분1, second run is 구분2.
    const divisions = await page.getByLabel('구분').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLSelectElement).value),
    );
    expect(divisions.slice(0, 7)).toEqual(['a', 'a', 'a', 'a', 'a', 'a', 'a']);
    expect(divisions.slice(7)).toEqual(['b', 'b', 'b', 'b', 'b', 'b', 'b']);

    // Swapping is available because the app cannot know which run is which.
    await page.getByRole('button', { name: '구분1 ↔ 구분2 바꾸기' }).click();
    const swapped = await page.getByLabel('구분').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLSelectElement).value),
    );
    expect(swapped.slice(0, 7)).toEqual(['b', 'b', 'b', 'b', 'b', 'b', 'b']);
  });

  test('한 덩어리로 정렬된 명단에서는 나누지 않고 이유를 말한다', async ({ page }) => {
    await loadSample(page);
    // The sample is 학생01…학생25, one ascending run, so there is no boundary.
    await page.getByRole('button', { name: '이름 순서로 구분 나누기' }).click();
    await expect(page.getByText(/가나다순이라 나눌 지점을 찾지 못했습니다/)).toBeVisible();
    await expect(page.getByText('아직 나누지 않았습니다')).toBeVisible();
  });

  test('모둠 자리 배치는 모둠끼리 모여 앉고 다른 모둠과 떨어진다', async ({ page }) => {
    await loadSample(page);

    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: /모둠 \+ 자리 배치/ }).click();
    // The island layout is offered by default rather than hidden in settings.
    await expect(page.getByText('모둠 모양으로 교실 자동 만들기')).toBeVisible();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    // Read the drawn map: which group number sits at which grid position.
    const layout = await page.evaluate(() => {
      // The first .print-area is the seat map; the second is the group list.
      const map = document.querySelectorAll('.print-area')[0];
      const rows = map ? [...map.querySelectorAll('.grid')] : [];
      return rows.map((row) =>
        [...row.children].map((cell) => {
          const text = (cell as HTMLElement).innerText ?? '';
          const match = /(\d+)모둠/.exec(text);
          return match ? Number(match[1]) : null;
        }),
      );
    });

    const cells: Array<{ row: number; col: number; group: number }> = [];
    layout.forEach((row, r) =>
      row.forEach((group, c) => {
        if (group !== null) cells.push({ row: r, col: c, group });
      }),
    );

    expect(cells).toHaveLength(25);
    expect(new Set(cells.map((cell) => cell.group)).size).toBe(6);

    const distance = (a: (typeof cells)[number], b: (typeof cells)[number]) =>
      Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));

    // Each group forms its own block: no member of another group sits inside a
    // group's bounding box. This is the property that was missing before —
    // groups used to be interleaved across the whole room.
    for (const index of new Set(cells.map((cell) => cell.group))) {
      const mine = cells.filter((cell) => cell.group === index);
      const top = Math.min(...mine.map((c) => c.row));
      const bottom = Math.max(...mine.map((c) => c.row));
      const left = Math.min(...mine.map((c) => c.col));
      const right = Math.max(...mine.map((c) => c.col));

      const intruders = cells.filter(
        (cell) =>
          cell.group !== index &&
          cell.row >= top &&
          cell.row <= bottom &&
          cell.col >= left &&
          cell.col <= right,
      );
      expect(intruders).toEqual([]);
    }

    // And the person sitting closest to you is always one of your own group.
    for (const cell of cells) {
      const mates = cells.filter((o) => o.group === cell.group && o !== cell);
      const others = cells.filter((o) => o.group !== cell.group);
      const nearestMate = Math.min(...mates.map((o) => distance(cell, o)));
      const nearestOther = Math.min(...others.map((o) => distance(cell, o)));
      expect(nearestMate).toBeLessThan(nearestOther);
    }
  });

  test('교사 관점과 학생 관점을 바꾸면 배치가 뒤집힌다', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    const seatLabels = () => page.locator('.seat-card').allInnerTexts();

    await expect(page.getByText('지금 보는 화면: 교사 관점')).toBeVisible();
    const teacherOrder = await seatLabels();

    await page.getByRole('button', { name: '학생 관점으로 보기' }).click();
    await expect(page.getByText('지금 보는 화면: 학생 관점')).toBeVisible();
    const studentOrder = await seatLabels();

    // The two views hold the same seats, drawn in exactly reverse order:
    // a 180° rotation, which is what "seen from the teacher's desk" means.
    expect(studentOrder).toEqual([...teacherOrder].reverse());
    expect(studentOrder).not.toEqual(teacherOrder);

    // Flipping the view must not move a single student.
    expect([...studentOrder].sort()).toEqual([...teacherOrder].sort());
  });

  test('공개 모드에서 이름을 숨겼다가 하나씩 공개한다', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    await page.getByRole('button', { name: '공개 모드' }).click();
    await page.getByRole('button', { name: '전체 숨기기' }).click();
    await expect(page.getByText('공개 0 / 25')).toBeVisible();

    // No student name may be on screen while everything is hidden.
    const mapText = await page.locator('.print-area').first().innerText();
    expect(mapText).not.toContain('학생01');

    await page.getByRole('button', { name: '무작위 한 명' }).click();
    await expect(page.getByText('공개 1 / 25')).toBeVisible();

    await page.getByRole('button', { name: '전체 공개' }).click();
    await expect(page.getByText('공개 25 / 25')).toBeVisible();
    await expect(page.locator('.print-area').first()).toContainText('학생01');
  });

  test('학생 한 명을 고정하면 다시 만들어도 자리가 유지된다', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    await page.getByRole('button', { name: '자리 잠그기' }).click();
    const firstSeat = page.locator('.seat-card').first();
    const lockedLabel = await firstSeat.innerText();
    await firstSeat.click();
    await expect(page.getByText(/지금 1곳 잠김/)).toBeVisible();

    await page.getByRole('button', { name: '다시 만들기' }).click();
    await page.getByRole('button', { name: '시드 바꾸기' }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    await expect(page.locator('.seat-card').first()).toHaveText(lockedLabel);
  });

  test('두 자리를 직접 맞바꾼다', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    const seats = page.locator('.seat-card');
    const before0 = await seats.nth(0).innerText();
    const before1 = await seats.nth(1).innerText();

    await seats.nth(0).click();
    await seats.nth(1).click();

    await expect(seats.nth(0)).toHaveText(before1);
    await expect(seats.nth(1)).toHaveText(before0);
  });

  test('PNG와 JSON 백업을 내려받는다', async ({ page }) => {
    const net = watchNetwork(page);
    await loadSample(page);
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    const png = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PNG 이미지' }).click();
    const pngFile = await png;
    // The file name carries the class and the date, never a student's name.
    expect(pngFile.suggestedFilename()).toMatch(/^자리배치_.*\.png$/);
    expect(pngFile.suggestedFilename()).not.toContain('학생');

    const json = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON 백업' }).click();
    const jsonFile = await json;
    expect(jsonFile.suggestedFilename()).toMatch(/\.json$/);

    expect(net.external).toEqual([]);
  });

  test('학생용 백업에는 교사 메모가 들어가지 않는다', async ({ page }) => {
    const { readFileSync } = await import('node:fs');
    await loadSample(page);

    await page.getByLabel('교사용 항목 보기 (메모 · 배려 사항)').check();
    await page.getByLabel('교사 메모').first().fill('비밀 메모입니다');

    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();

    const studentCopy = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON 백업' }).click();
    const studentPath = await (await studentCopy).path();
    const studentText = readFileSync(studentPath, 'utf8');
    expect(studentText).not.toContain('비밀 메모입니다');
    expect(studentText).not.toContain('teacherMemo');
    expect(studentText).toContain('학생01');

    // With the teacher option switched on, the memo is included on purpose.
    await page.getByLabel(/교사용 정보도 함께 넣기/).check();
    const teacherCopy = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON 백업' }).click();
    const teacherPath = await (await teacherCopy).path();
    expect(readFileSync(teacherPath, 'utf8')).toContain('비밀 메모입니다');
  });

  test('모든 정보 삭제 후 아무것도 남지 않는다', async ({ page }) => {
    await loadSample(page);

    await page.getByRole('button', { name: '설정' }).click();
    await page.getByLabel(/이 브라우저에 저장하는 기능 켜기/).check();
    await page.getByRole('button', { name: '지금 로컬에 저장' }).click();
    await expect(page.getByText('이 브라우저에 저장했습니다.')).toBeVisible();

    await page.getByRole('button', { name: '모든 정보 삭제' }).click();
    await page.getByRole('button', { name: '정말 모두 삭제합니다' }).click();
    await expect(page.getByText('삭제 후 확인 완료 — 남은 학생 정보가 없습니다.')).toBeVisible();

    // Nothing left in the browser's own storage either.
    const leftovers = await page.evaluate(async () => {
      const databases = (await indexedDB.databases?.()) ?? [];
      return {
        databases: databases.map((d) => d.name).filter(Boolean),
        localKeys: Object.keys(localStorage).filter((k) => k.startsWith('seatPlanner.')),
      };
    });
    expect(leftovers.databases).not.toContain('seat-planner');

    await page.getByRole('button', { name: '닫기' }).click();
    await expect(page.getByRole('heading', { name: '명렬표 불러오기' })).toBeVisible();
  });

  test('새로고침해도 학생 정보가 자동으로 복구되지 않는다', async ({ page }) => {
    await loadSample(page);
    await expect(page.getByText('배치 대상 25명')).toBeVisible();

    await page.reload();
    // The default is to start empty, so a shared classroom PC never shows the
    // previous teacher's roster.
    await expect(page.getByRole('heading', { name: '명렬표 불러오기' })).toBeVisible();
    await expect(page.getByText('배치 대상 25명')).toHaveCount(0);
  });

  test('전체 흐름에서 외부 네트워크 요청이 한 건도 없다', async ({ page }) => {
    const net = watchNetwork(page);

    await loadSample(page);
    await page.getByRole('button', { name: '3. 교실 만들기' }).click();
    await page.getByRole('button', { name: '4. 조건 정하기' }).click();
    await page.getByRole('button', { name: /일반 수업/ }).click();
    await page.getByRole('button', { name: '5. 자리 만들기' }).click();
    await page.getByRole('button', { name: /모둠 \+ 자리 배치/ }).click();
    await page.getByRole('button', { name: '자리 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '결과 보기' })).toBeVisible();
    await page.getByRole('button', { name: '학생 관점으로 보기' }).click();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '엑셀' }).click();
    await download;

    expect(net.external).toEqual([]);
  });
});
