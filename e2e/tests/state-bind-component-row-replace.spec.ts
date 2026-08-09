import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// 行に bind-component のコンポーネントを持つリストを差し替えたときの挙動。
// docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.9。
//
// 判別子は 2 つ。(1) 親スコープの行（.gid）が差し替えで消えたままにならないこと、
// (2) 各行の **Shadow 内のビュー**が新しい値になること。(2) は shadow を
// constructor で組む形（<wcs-state> が再接続で使い回される）でだけ落ちるので、
// row-by-ctor と row-by-cc の両方を見る。
test.describe("e2e/fixtures/bind-component-row-replace", () => {
  const gids = "#host-view .gid";
  const ctorViews = "row-by-ctor >>> .row-view";
  const ccViews = "row-by-cc >>> .row-view";

  test("差し替えても行が再描画され、両方のコンポーネントに値が入ること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-row-replace.html");

    await expect(page.locator(gids)).toHaveText(["g1", "g2"]);
    await expect(page.locator(ctorViews)).toHaveText(["g1", "g2"]);
    await expect(page.locator(ccViews)).toHaveText(["g1", "g2"]);

    await page.locator("#replace").click();

    await expect(page.locator(gids)).toHaveText(["g9"]);
    await expect(page.locator(ctorViews)).toHaveText(["g9"]);
    await expect(page.locator(ccViews)).toHaveText(["g9"]);

    expect(errors).toEqual([]);
  });

  test("差し替えのあとも後続の更新が通ること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-row-replace.html");
    await expect(page.locator(gids)).toHaveText(["g1", "g2"]);

    await page.locator("#replace").click();
    await expect(page.locator(gids)).toHaveText(["g9"]);

    // 行フィールドの書き込み（派生バインディングが張り直されていないと届かない）
    await page.locator("#rename").click();
    await expect(page.locator(gids)).toHaveText(["g9x"]);
    await expect(page.locator(ctorViews)).toHaveText(["g9x"]);
    await expect(page.locator(ccViews)).toHaveText(["g9x"]);

    // もう一度の差し替え（1 回目で for が死んでいると空のまま戻らない）
    await page.locator("#grow").click();
    await expect(page.locator(gids)).toHaveText(["gA", "gB", "gC"]);
    await expect(page.locator(ctorViews)).toHaveText(["gA", "gB", "gC"]);
    await expect(page.locator(ccViews)).toHaveText(["gA", "gB", "gC"]);

    expect(errors).toEqual([]);
  });

  test("空にしてから戻せること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-row-replace.html");
    await expect(page.locator(gids)).toHaveText(["g1", "g2"]);

    await page.locator("#clear").click();
    await expect(page.locator(gids)).toHaveCount(0);

    await page.locator("#grow").click();
    await expect(page.locator(gids)).toHaveText(["gA", "gB", "gC"]);
    await expect(page.locator(ctorViews)).toHaveText(["gA", "gB", "gC"]);
    await expect(page.locator(ccViews)).toHaveText(["gA", "gB", "gC"]);

    expect(errors).toEqual([]);
  });
});
