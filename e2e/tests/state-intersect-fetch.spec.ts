import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// state + intersection + fetch: 互いを知らない 2 つの I/O ノードを、state が event token と
// command token でつなぐ無限スクロールを実ブラウザで検証する。
//
// - page 1 はセンチネルを待たずに $connectedCallback から読む（センチネルの最初の通知は
//   state のバインドより前に来て失われうる）。
// - 読み込み中の交差 edge は無視する（<wcs-fetch> は `latest` で、新しい fetch() が進行中の
//   要求を中断するので、同じページを取り直すことになる）。
// - ページが着地したら reobserve() で現在の可視性を通知し直させる（変化しか通知しない）。
// - 失敗の後はスクロールで取り直さず、Retry ボタンで同じページを取り直す。

const PAGE_SIZE = 20;

// 87件 = 20*4 + 7。最後のページが部分ページ（= 終端シグナル）になる examples/ と同じ形状。
const catalog = Array.from({ length: 87 }, (_, i) => ({
  id: i + 1,
  name: `Item #${i + 1}`,
  category: "peripherals",
  price: 1000 + i,
}));

// 注入した 503 に対して Chromium 自身が出す "Failed to load resource" は想定内のノイズ。
function appErrors(errors: string[]): string[] {
  return errors.filter((e) => !/Failed to load resource/.test(e));
}

/** /api/items をテストごとに横取りし、届いた page を到着順に記録する。`failPage` は 1 回だけ 503。 */
async function routeItems(page: Page, failPage?: number): Promise<() => string[]> {
  const seen: string[] = [];
  let failed = false;
  await page.route("**/api/items*", async (route) => {
    const url = new URL(route.request().url());
    const p = Math.max(1, Number(url.searchParams.get("page")) || 1);
    if (p === failPage && !failed) {
      failed = true;
      seen.push(`${p}:503`);
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"injected"}' });
      return;
    }
    seen.push(`${p}:200`);
    const limit = Math.max(1, Number(url.searchParams.get("limit")) || PAGE_SIZE);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(catalog.slice((p - 1) * limit, p * limit)),
    });
  });
  return () => [...seen];
}

const scrollToBottom = (page: Page) => page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

test.describe("examples/state-intersect-fetch", () => {
  test("page 1 はスクロールせずに読み、スクロールのたびに次のページを 1 回ずつ読んで終端で止まる", async ({ page }) => {
    const errors = collectErrors(page);
    const requests = await routeItems(page);

    await page.goto("/examples/state-intersect-fetch/");
    await expect(page.locator(".item")).toHaveCount(PAGE_SIZE);

    for (let n = 2; n <= 5; n++) {
      await scrollToBottom(page);
      await expect(page.locator(".item")).toHaveCount(Math.min(n * PAGE_SIZE, catalog.length));
    }
    await expect(page.locator(".end-msg", { hasText: "End of list" })).toBeVisible();
    await expect(page.locator(".meter b").nth(1)).toHaveText("5");

    // 終端の後にスクロールしても、もう読まない。各ページはちょうど 1 回。
    await scrollToBottom(page);
    await page.waitForTimeout(300);
    expect(requests()).toEqual(["1:200", "2:200", "3:200", "4:200", "5:200"]);
    expect(appErrors(errors)).toEqual([]);
  });

  test("背の高い画面では、着地のたびの reobserve() でスクロールせずに画面が埋まるまで読む", async ({ page }) => {
    const errors = collectErrors(page);
    const requests = await routeItems(page);
    await page.setViewportSize({ width: 800, height: 2400 });

    await page.goto("/examples/state-intersect-fetch/");
    // 1 ページ（20 行）では画面が埋まらないので、センチネルは見えたまま。変化の通知は来ないが、
    // 着地後の reobserve() が現在の可視性を通知し直すので、次のページへ進む。
    await expect.poll(async () => page.locator(".item").count()).toBeGreaterThan(PAGE_SIZE);
    await page.waitForTimeout(800);

    const loaded = requests();
    expect(loaded.length).toBeGreaterThan(1);
    // 同じページを 2 度読まない（読み込み中の edge は無視される）。
    expect(new Set(loaded).size).toBe(loaded.length);
    expect(appErrors(errors)).toEqual([]);
  });

  test("ページの取得に失敗すると Retry が出て、スクロールでは取り直さず、押すと同じページを読む", async ({ page }) => {
    const errors = collectErrors(page);
    const requests = await routeItems(page, 2);

    await page.goto("/examples/state-intersect-fetch/");
    await expect(page.locator(".item")).toHaveCount(PAGE_SIZE);

    await scrollToBottom(page);
    const retry = page.locator(".retry-btn");
    await expect(retry).toBeVisible();

    // エラーの間は、センチネルの出入りで取り直さない。
    await page.evaluate(() => window.scrollTo(0, 0));
    await scrollToBottom(page);
    await page.waitForTimeout(300);
    expect(requests()).toEqual(["1:200", "2:503"]);

    await retry.click();
    await expect(page.locator(".item")).toHaveCount(2 * PAGE_SIZE);
    await expect(retry).toHaveCount(0);
    expect(requests()).toEqual(["1:200", "2:503", "2:200"]);
    expect(appErrors(errors)).toEqual([]);
  });
});
