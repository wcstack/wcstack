import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// <wcs-sse> とページの離脱（timing-and-firing-contract §30、docs/seam-apps.md の lending-desk）。
//
// Firefox は、ストリームを開いたまま全体の遷移をすると「The connection to <url> was interrupted while the page was
// loading.」をコンソールに出す（console.error）。文書にあった対処 — beforeunload で close() — は WebKit で
// ライブの更新を止めた: WebKit は Navigation API で横取りされた同じ文書の遷移（<wcs-link>・ガードのリダイレクト・
// navigateUrl）でも beforeunload を出す（Chromium と Firefox は出さない）。4.26 から要素が自分で: beforeunload で閉じ、
// 文書が残れば開き直す。
//
// - @browsers の 3 つは Firefox でも走る（playwright.config.ts の firefox プロジェクト）。このリポジトリの e2e に
//   WebKit のプロジェクトは無い: WebKit では手元で、webkit のプロジェクトを足した設定で走らせて確かめた（同じ文書の
//   遷移で閉じて開き直すのは WebKit だけ）。
// - bfcache の復元は Chromium だけ（headless shell は復元しないので channel "chromium" で、Playwright の
//   --disable-back-forward-cache も外す。shift-desk と同じ）。Playwright の Firefox と WebKit は、何も無いページも
//   bfcache から戻さなかった。
// - /api/metrics（serve.mjs）は metric を 300 ms ごとに送る。開いているストリームの数（/api/metrics-connections）は
//   ほかの spec と共有なので数えない。

const FIXTURE = "/e2e/fixtures/sse-unload.html";

/** The stream is open and events keep arriving: `n` more after now. */
async function expectLive(page: Page, n = 2): Promise<void> {
  await expect(page.locator("#live")).toHaveText("true");
  const before = await page.evaluate(() => window.__got);
  await expect.poll(() => page.evaluate(() => window.__got), { timeout: 5000 }).toBeGreaterThanOrEqual(before + n);
}

declare global {
  interface Window {
    __got: number;
    __conn: boolean[];
  }
}

test.describe("sse-unload — <wcs-sse> とページの離脱", () => {
  test("@browsers router の同じ文書の遷移（<wcs-link>・ガードのリダイレクト・navigateUrl・戻る）の後もイベントが届き続ける", async ({ page, browserName }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await page.evaluate(() => sessionStorage.removeItem("signed-in"));
    await expect(page.locator("#view")).toHaveText("home");
    await expectLive(page);

    await page.getByRole("link", { name: "b", exact: true }).click();
    await expect(page.locator("#view")).toHaveText("b");
    await expectLive(page);

    // signed out: the guard redirects to /login
    await page.getByRole("link", { name: "members" }).click();
    await expect(page.locator("#view")).toHaveText("login");
    await expectLive(page);

    // a navigateUrl write
    await page.locator("#sign-in").click();
    await expect(page.locator("#view")).toHaveText("members");
    await expectLive(page);

    await page.goBack();
    await expect(page.locator("#view")).toHaveText("login");
    await expectLive(page);

    const changes = await page.evaluate(() => window.__conn);
    if (browserName === "webkit") {
      // WebKit's beforeunload on each same-document navigation (not on Back): closed, then opened again
      expect(changes.filter((c) => c === false).length).toBeGreaterThanOrEqual(3);
    } else {
      expect(changes).toEqual([true]);
    }
    expect(errors).toEqual([]);
  });

  test("@browsers 全体の遷移ではストリームを閉じてから離れる: Firefox のコンソールも静か", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expectLive(page);
    await page.locator("#away").click();
    await expect(page.locator("#away")).toHaveText("away");
    // (the message comes as the next page loads)
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("@browsers 離脱の確認に「留まる」と答えると、ストリームは開き直す", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "headless WebKit leaves without asking");
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = ""; });
    });
    const dialogs: string[] = [];
    page.on("dialog", (d) => { dialogs.push(d.type()); void d.dismiss(); });
    await page.goto(FIXTURE);
    await expectLive(page);
    await page.locator("#away").click({ noWaitAfter: true });
    await expect.poll(() => dialogs).toEqual(["beforeunload"]);
    // closed for the unload that did not happen…
    await expect.poll(() => page.evaluate(() => window.__conn)).toEqual([true, false]);
    // …and open again about a second later
    await expectLive(page);
    expect(page.url()).toContain(FIXTURE);
    expect(errors).toEqual([]);
  });

  test("別のサイトから Back で bfcache から戻ると、ストリームを開き直す（離れている間は閉じている）", async ({ playwright, browserName }) => {
    test.skip(browserName !== "chromium", "bfcache restores only in full Chromium here");
    const browser = await playwright.chromium.launch({ channel: "chromium", ignoreDefaultArgs: ["--disable-back-forward-cache"] });
    try {
      const page = await (await browser.newContext({ baseURL: test.info().project.use.baseURL })).newPage();
      const errors = collectErrors(page);
      // serve.mjs answers `Cache-Control: no-store`, which keeps a page out of Chromium's bfcache: this page's own
      // document is answered without it
      await page.route(`**${FIXTURE}`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), "cache-control": "no-cache" } });
      });
      await page.goto(FIXTURE);
      await expectLive(page);
      await page.locator("#away").click();
      await expect(page.locator("#away")).toHaveText("away");
      await page.waitForTimeout(1500); // past the reopen delay: a page still around would have opened it again
      await page.goBack({ waitUntil: "commit" });
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("__persisted"))).toBe("true");
      await expectLive(page);
      // closed on the way out (beforeunload), open again on the way back
      expect(await page.evaluate(() => window.__conn)).toEqual([true, false, true]);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
