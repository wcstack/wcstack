import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// state + intersection + $streams: 失敗ページの復帰経路を実ブラウザで検証する。
//
// 回帰対象: page1 が失敗するとフィードが空 → スクロールする対象が無い →
// IntersectionObserver は可視性の「変化」でしか発火しない → 復帰する手段が消える、
// というデッドロック。stream producer 内の abort 対応 delay/retry がそれを解く。
// page1 の失敗系はスクロールしない。別ケースで、既存 item 後の失敗だけが明示的な
// sentinel leave → enter により復帰し、layout だけでは retry しないことも検証する。

const PAGE_SIZE = 20;

// 87件 = 20*4 + 7。最後のページが部分ページ(=終端シグナル)になる examples/ と同じ形状。
const catalog = Array.from({ length: 87 }, (_, i) => ({
  id: i + 1,
  name: `Item #${i + 1}`,
  category: "peripherals",
  price: 1000 + i,
}));

// 注入した 503 に対して Chromium 自身が出す "Failed to load resource" は想定内のノイズ
// (アプリのエラーではない)。それ以外が残っていないことを assert する。
function appErrors(errors: string[]): string[] {
  return errors.filter((e) => !/Failed to load resource/.test(e));
}

interface ItemsRoute {
  /** /api/items に届いたリクエストの page パラメータを到着順に。 */
  readonly requests: () => string[];
  /** /api/items に届いたリクエスト総数。 */
  readonly requestCount: () => number;
  /** これ以降のリクエストを成功させる。 */
  readonly stopFailing: () => void;
}

/**
 * /api/items をテストごとに横取りする(serve.mjs にモックを足さない = 並列実行でも隔離される)。
 * `failFirst` 回だけ 503 を返し、その後は正常なページを返す。`failPage` 指定時は
 * そのページだけを失敗注入の対象にする。
 */
async function routeItems(page: Page, failFirst: number, failPage?: number): Promise<ItemsRoute> {
  const seen: string[] = [];
  let remainingFailures = failFirst;
  await page.route("**/api/items*", async (route) => {
    const url = new URL(route.request().url());
    const p = Math.max(1, Number(url.searchParams.get("page")) || 1);
    if (remainingFailures > 0 && (failPage === undefined || p === failPage)) {
      remainingFailures--;
      seen.push(`${url.searchParams.get("page")}:503`);
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"injected"}' });
      return;
    }
    seen.push(`${url.searchParams.get("page")}:200`);
    const limit = Math.max(1, Number(url.searchParams.get("limit")) || PAGE_SIZE);
    const slice = catalog.slice((p - 1) * limit, (p - 1) * limit + limit);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(slice) });
  });
  return {
    requests: () => [...seen],
    requestCount: () => seen.length,
    stopFailing: () => { remainingFailures = 0; },
  };
}

test.describe("examples/state-intersect-scroll", () => {
  test("依存更新が in-flight page を abort し、最新の stream run だけを commit する", async ({ page }) => {
    const errors = collectErrors(page);
    let requestCount = 0;
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve; });

    await page.route("**/api/items*", async (route) => {
      requestCount++;
      if (requestCount === 1) {
        // 最初の fetch を parked にし、その間に retryNonce を変更して
        // $streams の dependency-driven restart を起こす。
        await holdFirst;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            catalog.slice(0, PAGE_SIZE).map((item) => ({ ...item, id: item.id + 900 })),
          ),
        }).catch(() => { /* AbortController が既に request を閉じていれば正常。 */ });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(catalog.slice(0, PAGE_SIZE)),
      });
    });

    try {
      await page.goto("/examples/state-intersect-scroll/");
      await expect.poll(() => requestCount).toBe(1);

      await page.evaluate(() => {
        const stateElement = document.querySelector("wcs-state") as unknown as {
          createState: (mutability: "writable", callback: (state: { retryNonce: number }) => void) => void;
        };
        stateElement.createState("writable", (state) => {
          state.retryNonce++;
        });
      });

      await expect.poll(() => requestCount).toBe(2);
      await expect(page.locator(".item")).toHaveCount(PAGE_SIZE);
      await expect(page.locator(".item-id").first()).toHaveText("1");

      // 旧 run を解放しても stale な 901..920 は反映されない。
      releaseFirst();
      await page.waitForTimeout(100);
      await expect(page.locator(".item")).toHaveCount(PAGE_SIZE);
      await expect(page.locator(".item-id").first()).toHaveText("1");
      expect(appErrors(errors)).toEqual([]);
    } finally {
      releaseFirst();
    }
  });

  test("page1 が失敗しても stream の有界リトライがスクロール無しでフィードを復帰させる", async ({ page }) => {
    const errors = collectErrors(page);
    const items = await routeItems(page, 2);   // maxRetries(3) の予算内で回復する

    await page.goto("/examples/state-intersect-scroll/");

    // 失敗が確定すると、予算が残っている間は "retrying…" が出る(Retry ボタンではない)。
    await expect(page.locator(".end-msg", { hasText: "retrying" })).toBeVisible();
    await expect(page.locator(".retry-btn")).toHaveCount(0);

    // ここから **一切スクロールしない**。stream producer だけで page1 が着地すること。
    await expect(page.locator(".item")).toHaveCount(PAGE_SIZE, { timeout: 15_000 });
    await expect(page.locator(".meter b").first()).toHaveText(String(PAGE_SIZE));
    await expect(page.locator(".end-msg", { hasText: "retrying" })).toHaveCount(0);

    // page1 は正確に3回(初回 + リトライ2回)。交差 edge からの予算外 retry は無い。
    expect(items.requests().filter((entry) => entry.startsWith("1:")))
      .toEqual(["1:503", "1:503", "1:200"]);

    expect(appErrors(errors)).toEqual([]);
  });

  test("リトライ予算を使い切ると Retry ボタンに引き継がれ、押せば復帰する", async ({ page }) => {
    const errors = collectErrors(page);
    const items = await routeItems(page, Number.MAX_SAFE_INTEGER);

    await page.goto("/examples/state-intersect-scroll/");

    // maxRetries=3 * interval=1500ms を消化すると自動リトライは止まり、
    // スケジュールが人間(ボタン)に渡る。
    const retryButton = page.locator(".retry-btn");
    await expect(retryButton).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".end-msg", { hasText: "retrying" })).toHaveCount(0);

    // 初回 1 + maxRetries(3) = 4 でちょうど止まること。ボタンが出た時点で保留中の
    // tick が残っていない(= 予算は「発射済みリトライ数」で数えている)ことも含む。
    const settled = items.requestCount();
    expect(items.requests()).toEqual(["1:503", "1:503", "1:503", "1:503"]);
    // 予算切れ後は自動リクエストが止まっていること(無限リトライの禁止 —
    // docs/async-execution-model.md §8 の `max` は有限であることが MUST)。
    await page.waitForTimeout(3_000);
    expect(items.requestCount()).toBe(settled);

    // 人間がスケジューラになる: ボタンで予算が戻り、同じ url が再実行される。
    items.stopFailing();
    await retryButton.click();
    await expect(page.locator(".item")).toHaveCount(PAGE_SIZE, { timeout: 15_000 });
    expect(items.requestCount()).toBeGreaterThan(settled);

    expect(appErrors(errors)).toEqual([]);
  });

  test("正常系: 初期ページが描画され、末尾までスクロールすると全87件で終端する", async ({ page }) => {
    const errors = collectErrors(page);
    const items = await routeItems(page, 0);

    await page.goto("/examples/state-intersect-scroll/");
    await expect(page.locator(".item")).toHaveCount(PAGE_SIZE);

    // 5ページ(20*4 + 7)。短いページが来ると noMore が立ちセンチネルが停止する。
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 20_000);
      await page.waitForTimeout(400);
    }
    await expect(page.locator(".item")).toHaveCount(catalog.length, { timeout: 15_000 });
    await expect(page.locator(".end-msg", { hasText: "End of list" })).toBeVisible();

    // loading/error guard を外しても、commit 済み件数から page を導出するため
    // switchMap restart がページを飛ばさず、各ページをちょうど1回ずつ要求する。
    expect(items.requests()).toEqual(["1:200", "2:200", "3:200", "4:200", "5:200"]);

    expect(appErrors(errors)).toEqual([]);
  });

  test("既存 item 後の失敗は自動再試行せず、sentinel を離れて戻ると同じ page を再試行する", async ({ page }) => {
    const errors = collectErrors(page);
    const items = await routeItems(page, Number.MAX_SAFE_INTEGER, 3);

    await page.goto("/examples/state-intersect-scroll/");
    await expect(page.locator(".item")).toHaveCount(PAGE_SIZE);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator(".item")).toHaveCount(PAGE_SIZE * 2, { timeout: 15_000 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    const retryButton = page.locator(".retry-btn");
    await expect(retryButton).toBeVisible({ timeout: 20_000 });
    expect(items.requests().filter((entry) => entry.startsWith("3:")))
      .toEqual(["3:503", "3:503", "3:503", "3:503"]);

    // Error rendering or an observer callback alone must not create an unbounded
    // retry loop while the sentinel is still visible.
    const settled = items.requestCount();
    await page.waitForTimeout(3_000);
    expect(items.requestCount()).toBe(settled);

    // A deliberate leave after the settled error arms one scroll retry. Re-entering
    // changes retryNonce (not page), so page 3 receives a fresh bounded stream run.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => {
      let armed = false;
      const stateElement = document.querySelector("wcs-state") as unknown as {
        createState: (
          mutability: "readonly",
          callback: (state: { scrollRetryArmed: boolean }) => void,
        ) => void;
      };
      stateElement.createState("readonly", (state) => { armed = state.scrollRetryArmed; });
      return armed;
    })).toBe(true);

    items.stopFailing();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator(".item")).toHaveCount(PAGE_SIZE * 3, { timeout: 15_000 });
    expect(items.requests().filter((entry) => entry.startsWith("3:")))
      .toEqual(["3:503", "3:503", "3:503", "3:503", "3:200"]);
    await expect(page.locator(".stream-status")).toHaveText("done");

    expect(appErrors(errors)).toEqual([]);
  });
});
