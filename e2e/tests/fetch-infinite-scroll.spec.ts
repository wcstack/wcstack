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

interface Served {
  /** The page numbers asked for, in order. */
  pages: number[];
  /** The same with the filter: "<q>:<page>". */
  requests: string[];
  /** Lets the held answer go. */
  release: () => void;
}

/**
 * Answers /api/users?page=&limit=&q= with that page of 95 users (named after `q`), and keeps what was asked.
 * `fail`: pages to answer 500 once. `hold`: a page of the unfiltered list whose answer waits for `release()`.
 */
async function serveUsers(page: Page, fail: number[] = [], hold = 0): Promise<Served> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const served: Served = { pages: [], requests: [], release };
  const failing = new Set(fail);
  await page.route("**/api/users?**", async (route) => {
    const url = new URL(route.request().url());
    const n = Number(url.searchParams.get("page"));
    const limit = Number(url.searchParams.get("limit"));
    const q = url.searchParams.get("q") ?? "";
    served.pages.push(n);
    served.requests.push(`${q}:${n}`);
    if (n === hold && q === "") await held;
    if (failing.delete(n)) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    const users = [];
    for (let i = (n - 1) * limit; i < Math.min(TOTAL, n * limit); i++) users.push({ id: i + 1, name: `${q || "user"} ${i + 1}` });
    // (an aborted request has nobody to answer)
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(users) }).catch(() => {});
  });
  return served;
}

const toEnd = (page: Page) => page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));

test("README の書き方（url は state から）で最初のページが出て、スクロールで最後まで 1 ページずつ読み込む @browsers", async ({ page }) => {
  const served = await serveUsers(page);
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto(FIXTURE);
  // (20 rows are 600 px: the sentinel is within its margin of a 500 px window, so page 2 follows at once — "exactly
  // 20 rows" holds for a moment only)
  await expect.poll(() => page.locator("#list li").count()).toBeGreaterThanOrEqual(20);
  for (let i = 0; i < 12 && (await page.locator("#end").count()) === 0; i++) {
    await toEnd(page);
    await page.waitForTimeout(150);
  }
  await expect(page.locator("#end")).toBeVisible();
  await expect(page.locator("#list li")).toHaveCount(TOTAL);
  expect(served.pages).toEqual([1, 2, 3, 4, 5]);
});

test("背の高いウィンドウ: ページが番兵を押し出さなくても、スクロールせずに画面が埋まる @browsers", async ({ page }) => {
  const served = await serveUsers(page);
  await page.setViewportSize({ width: 900, height: 4000 });
  await page.goto(FIXTURE);
  // 95 rows of 30 px are 2,850 px: the whole list fits, and it is all loaded with no scroll
  await expect(page.locator("#end")).toBeVisible();
  await expect(page.locator("#list li")).toHaveCount(TOTAL);
  expect(served.pages).toEqual([1, 2, 3, 4, 5]);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

// While the user scrolls, the observer's report that a page pushed the sentinel out arrives a frame later than
// otherwise: its task waits behind the input and the frames. That is after the frames the element waits when a
// request ends, and 4.24.0 read the sentinel as still on screen then: a page the window did not need was asked for
// (docs/seam-apps.md, landing town-archive). The element now takes the reports the browser has made and not yet
// delivered before it looks.
//
// On the package's own example, not this spec's fixture: the report was late on a page with that much in it (9
// loads of 10 in Chromium, the example served by this server) and never on the fixture, whatever its rows and its
// window. Three loads, since one alone did not always show it. On 4.24.0 this fails when it runs alone (one worker);
// on a machine busy with other tests the report was not late, and it passed.
const EXAMPLE = "/packages/fetch/examples/infinite-scroll/index.html";

test("ページが届いた瞬間に利用者が少しスクロールしても、番兵が画面の外なら次のページを取りに行かない @browsers", async ({ page }) => {
  const asked: number[] = [];
  await page.route("**/api/items?**", async (route) => {
    const url = new URL(route.request().url());
    const n = Number(url.searchParams.get("page"));
    const limit = Number(url.searchParams.get("limit"));
    asked.push(n);
    const items = [];
    for (let i = (n - 1) * limit; i < Math.min(87, n * limit); i++) items.push({ id: i + 1, name: `Item #${i + 1}`, category: "audio", price: 1000 + i });
    // (an answer that takes a while: the page is at rest when it lands)
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(items) }).catch(() => {});
  });
  // 700 px + the 240 px margin reach 940 px; one page of 20 rows puts the sentinel at about 1,190 px, and two presses
  // of ↓ scroll 80 px (Chromium) or 144 px (Firefox): it stays out of reach
  await page.setViewportSize({ width: 900, height: 700 });
  for (let round = 0; round < 3; round++) {
    asked.length = 0;
    await page.goto(EXAMPLE);
    // right as the first page's rows are drawn
    await page.waitForFunction(() => document.querySelectorAll(".item").length >= 20, null, { polling: "raf" });
    for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(700);
    const reach = await page.evaluate(() => {
      const top = document.querySelector("wcs-infinite-scroll")!.getBoundingClientRect().top;
      return { scrolled: scrollY > 0, sentinelOut: top > innerHeight + 240 };
    });
    expect(reach).toEqual({ scrolled: true, sentinelOut: true });
    expect(asked).toEqual([1]);
  }
});
test("失敗した要求は繰り返さない。番兵が画面を出入りすると、同じページをもう一度取りに行く @browsers", async ({ page }) => {
  const served = await serveUsers(page, [3]);
  await page.setViewportSize({ width: 900, height: 4000 });
  await page.goto(FIXTURE);
  await expect(page.locator("#failed")).toBeVisible();
  await expect(page.locator("#list li")).toHaveCount(40);
  await page.waitForTimeout(500);
  expect(served.pages).toEqual([1, 2, 3]);
  // the user scrolls away and back: the window is made short, the sentinel leaves, then comes back
  await page.setViewportSize({ width: 900, height: 300 });
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 900, height: 4000 });
  await expect(page.locator("#end")).toBeVisible();
  expect(served.pages).toEqual([1, 2, 3, 3, 4, 5]);
});

test("終わりを見ないページ（空の応答でもページ番号を進める）でも、取りに行くのは 1 回余分なだけで止まる @browsers", async ({ page }) => {
  const served = await serveUsers(page);
  await page.setViewportSize({ width: 900, height: 4000 });
  await page.goto(FIXTURE + "?naive=1");
  await expect(page.locator("#list li")).toHaveCount(TOTAL);
  await page.waitForTimeout(1000);
  // page 5 (15 users) added rows, so page 6 was asked for; it added nothing, and that ended it
  expect(served.pages).toEqual([1, 2, 3, 4, 5, 6]);
});

test("絞り込みが変わったら取りに行っているページを中断する（command.abort）: 前の一覧のページは入らず、新しい一覧の最初のページが出る @browsers", async ({ page }) => {
  const served = await serveUsers(page, [], 2);
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto(FIXTURE);
  await expect(page.locator("#list li")).toHaveCount(20);
  // 20 rows are 600 px: the sentinel is within its 240 px margin of a 500 px window, so page 2 is asked for at once
  // — and its answer is held
  await expect.poll(() => served.requests).toEqual([":1", ":2"]);
  await page.fill("#q", "ann");
  // the new list: its first page, then its second (the first left the sentinel within the margin)
  await expect(page.locator("#list li")).toHaveCount(40);
  await expect(page.locator("#list li").first()).toHaveText("ann 1");
  served.release();
  await page.waitForTimeout(300);
  // the held answer was aborted: nothing of the old list came in
  await expect(page.locator("#list li")).toHaveCount(40);
  await expect(page.locator("#list li").last()).toHaveText("ann 40");
  expect(served.requests).toEqual([":1", ":2", "ann:1", "ann:2"]);
});
