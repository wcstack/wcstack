import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// Phase 0 (docs/a11y-impl-plan.md T0-3 / T0-4) — router のアクセシビリティ契約。
//
// Navigation API 経路の scroll / focusReset は intercept のオプション省略時の
// 仕様既定（"after-transition"）で既に正しい（docs/a11y-design.md §0-2 訂正 3）。
// この spec はその既定挙動を Chromium で固定し、後から `scroll: "manual"` を
// 足すような変更が黙って契約を壊すことを防ぐ（A1 / A2）。
//
// あわせて T0-4: `getNavigation()` は呼び出しごとに window.navigation を動的参照
// する（Navigation.ts）ため、addInitScript で window.navigation を undefined に
// 潰せば Chromium のままフォールバック経路（wcs-link click → pushState / popstate）
// を実ブラウザで踏める。この成立を固定し、Phase 1 の A3 の土台にする。

const FIXTURE = "/e2e/fixtures/router-a11y.html";

test.describe("router-a11y — Navigation API 経路の仕様既定 (A1/A2)", () => {
  test("push 遷移後にスクロールがトップへ戻り、フォーカスが body へリセットされる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator("#view")).toHaveText("home");
    // この suite の前提: Navigation API 経路を踏んでいる
    expect(await page.evaluate(() => "navigation" in window)).toBe(true);

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    // A5: 初期状態では home リンクが active + aria-current
    await expect(page.getByRole("link", { name: "home" })).toHaveAttribute("aria-current", "page");

    const aboutLink = page.getByRole("link", { name: "about" });
    await aboutLink.focus();
    await aboutLink.click();
    await expect(page.locator("#view")).toHaveText("about");

    // A5: aria-current が active class と同時に移る
    await expect(aboutLink).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "home" })).not.toHaveAttribute("aria-current", "page");

    // scroll: "after-transition"（仕様既定）— push はトップへ
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    // focusReset: "after-transition"（仕様既定）— [autofocus] が無いので body へ
    await expect
      .poll(() => page.evaluate(() => document.activeElement === document.body))
      .toBe(true);
    expect(errors).toEqual([]);
  });

  test("traverse（back）ではスクロール位置が復元される", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator("#view")).toHaveText("home");

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await page.getByRole("link", { name: "about" }).click();
    await expect(page.locator("#view")).toHaveText("about");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    // traverse は復元（push のトップリセットとの対）
    await page.goBack();
    await expect(page.locator("#view")).toHaveText("home");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  });
});

test.describe("router-a11y — フォールバック経路の強制 (T0-4)", () => {
  test("window.navigation を消すと wcs-link click → pushState / popstate で SPA 遷移する", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    // ページスクリプトより前に Window の accessor を own property で影にする。
    // getNavigation() は毎回 window.navigation を読むので、これだけで
    // router / wcs-link の両方がフォールバック分岐に入る。
    await context.addInitScript(() => {
      Object.defineProperty(window, "navigation", { value: undefined, configurable: true });
    });
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator("#view")).toHaveText("home");
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).navigation === undefined),
    ).toBe(true);

    // 同一ドキュメントのままであることの目印（フルナビゲーションで消える）
    await page.evaluate(() => {
      (window as unknown as Record<string, string>).__marker = "same-document";
    });
    await page.getByRole("link", { name: "about" }).click();
    await expect(page.locator("#view")).toHaveText("about");
    expect(page.url()).toContain("/e2e/fixtures/about");
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__marker),
    ).toBe("same-document");

    // back は popstate リスナ経由で SPA のまま戻る
    await page.goBack();
    await expect(page.locator("#view")).toHaveText("home");
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__marker),
    ).toBe("same-document");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("A3: フォールバック push 遷移後に scrollY=0、popstate ではブラウザ復元に任せる", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    await context.addInitScript(() => {
      Object.defineProperty(window, "navigation", { value: undefined, configurable: true });
    });
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator("#view")).toHaveText("home");

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await page.getByRole("link", { name: "about" }).click();
    await expect(page.locator("#view")).toHaveText("about");
    // 修理・既定オン（docs/a11y-design.md §3-2）: フォールバック push もトップへ
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    // back では router はスクロールせず、ブラウザの scrollRestoration が復元する
    await page.goBack();
    await expect(page.locator("#view")).toHaveText("home");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
    await context.close();
  });
});
