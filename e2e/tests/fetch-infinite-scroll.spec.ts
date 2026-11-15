import { test, expect, type Page } from "@playwright/test";

// docs/timing-and-firing-contract.md §26 — <wcs-infinite-scroll> asks again while its sentinel stays on screen.
//
// Up to 4.23 the element ran its <wcs-fetch> only when the sentinel came on screen. With the fetch README's own
// example (the target's url written by state) the sentinel reported first, the request was refused, and the
// sentinel — still on screen — never reported again: no first page, Chromium 6 times of 10 and Firefox 10 of 10.
// And a page that did not push the sentinel out (a tall window) was the last one (docs/seam-apps.md, town-archive).
//
// happy-dom has no layout and no IntersectionObserver: the package's unit tests drive a fake observer and run the
// frames by hand. This spec is the element in real browsers.

const FIXTURE = "/e2e/fixtures/infinite-scroll.html";
const TOTAL = 95;

/** Answers /api/users?page=&limit= with that page of 95 users, and keeps what was asked. `fail`: pages to answer 500 once. */
async function serveUsers(page: Page, fail: number[] = []): Promise<number[]> {
  const asked: number[] = [];
  const failing = new Set(fail);
  await page.route("**/api/users?**", async (route) => {
    const url = new URL(route.request().url());
    const n = Number(url.searchParams.get("page"));
    const limit = Number(url.searchParams.get("limit"));
    asked.push(n);
    if (failing.delete(n)) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    const users = [];
    for (let i = (n - 1) * limit; i < Math.min(TOTAL, n * limit); i++) users.push({ id: i + 1, name: `user ${i + 1}` });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(users) });
  });
  return asked;
}

const toEnd = (page: Page) => page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));

test("README の書き方（url は state から）で最初のページが出て、スクロールで最後まで 1 ページずつ読み込む @browsers", async ({ page }) => {
  const asked = await serveUsers(page);
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto(FIXTURE);
  await expect(page.locator("#list li")).toHaveCount(20);
  for (let i = 0; i < 12 && (await page.locator("#end").count()) === 0; i++) {
    await toEnd(page);
    await page.waitForTimeout(150);
  }
  await expect(page.locator("#end")).toBeVisible();
  await expect(page.locator("#list li")).toHaveCount(TOTAL);
  expect(asked).toEqual([1, 2, 3, 4, 5]);
});

test("背の高いウィンドウ: ページが番兵を押し出さなくても、スクロールせずに画面が埋まる @browsers", async ({ page }) => {
  const asked = await serveUsers(page);
  await page.setViewportSize({ width: 900, height: 4000 });
  await page.goto(FIXTURE);
  // 95 rows of 30 px are 2,850 px: the whole list fits, and it is all loaded with no scroll
  await expect(page.locator("#end")).toBeVisible();
  await expect(page.locator("#list li")).toHaveCount(TOTAL);
  expect(asked).toEqual([1, 2, 3, 4, 5]);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test("失敗した要求は繰り返さない。番兵が画面を出入りすると、同じページをもう一度取りに行く @browsers", async ({ page }) => {
  const asked = await serveUsers(page, [3]);
  await page.setViewportSize({ width: 900, height: 4000 });
  await page.goto(FIXTURE);
  await expect(page.locator("#failed")).toBeVisible();
  await expect(page.locator("#list li")).toHaveCount(40);
  await page.waitForTimeout(500);
  expect(asked).toEqual([1, 2, 3]);
  // the user scrolls away and back: the window is made short, the sentinel leaves, then comes back
  await page.setViewportSize({ width: 900, height: 300 });
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 900, height: 4000 });
  await expect(page.locator("#end")).toBeVisible();
  expect(asked).toEqual([1, 2, 3, 3, 4, 5]);
});

test("終わりを見ないページ（空の応答でもページ番号を進める）でも、取りに行くのは 1 回余分なだけで止まる @browsers", async ({ page }) => {
  const asked = await serveUsers(page);
  await page.setViewportSize({ width: 900, height: 4000 });
  await page.goto(FIXTURE + "?naive=1");
  await expect(page.locator("#list li")).toHaveCount(TOTAL);
  await page.waitForTimeout(1000);
  // page 5 (15 users) added rows, so page 6 was asked for; it added nothing, and that ended it
  expect(asked).toEqual([1, 2, 3, 4, 5, 6]);
});
