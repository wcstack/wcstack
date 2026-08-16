import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// Light DOM の `bind-component`。
// docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.13。
//
// mapped 形（ホストから data-wcs で束ねる）は初期化が循環して永久に解決していなかった。
// Shadow DOM 形が成立していたのは内側の state が別 rootNode にいるからで、rootNode による
// 名前空間の分離が初期化順序の分離も担っていた。修正はその 2 つを明示的に復元している。
//
// Light DOM は Shadow の内側を覗く `>>>` が要らない代わりに、custom element の upgrade
// タイミングが happy-dom と実ブラウザで最も食い違う場所なので、実機で確かめる価値がある。
test.describe("e2e/fixtures/bind-component-light-dom", () => {
  const rowIds = async (locator: import("@playwright/test").Locator) =>
    locator.evaluateAll((els) => els.map((el) => el.getAttribute("data-row-id")));

  test("mapped な Light DOM が初期配送を受けること（デッドロックしない）", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-light-dom.html");

    await expect(page.locator("#mapped light-view .inner")).toHaveText("Alice");

    expect(errors).toEqual([]);
  });

  test("親 state 起点の書き込みが Light DOM の子に届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-light-dom.html");
    await expect(page.locator("#mapped light-view .inner")).toHaveText("Alice");

    await page.locator("#rename").click();

    await expect(page.locator("#mapped light-view .inner")).toHaveText("Carol");

    expect(errors).toEqual([]);
  });

  test("Light DOM の子スコープが親のリストを for で回せること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-light-dom.html");

    await expect(page.locator("#mapped-list .leaf-view li")).toHaveText(["Anna", "Ben"]);

    expect(errors).toEqual([]);
  });

  test("親の行フィールド書き込みが Light DOM の子の行に届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-light-dom.html");
    await expect(page.locator("#mapped-list .leaf-view li")).toHaveText(["Anna", "Ben"]);

    await page.locator("#rename-row").click();

    await expect(page.locator("#mapped-list .leaf-view li")).toHaveText(["Anna", "Bennett"]);
    // 行は作り直されていない ＝ 全再描画に落ちていない
    expect(await rowIds(page.locator("#mapped-list .leaf-view li"))).toEqual(["a", "b"]);

    expect(errors).toEqual([]);
  });

  test("親のリスト置換が Light DOM の子に届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-light-dom.html");
    await expect(page.locator("#mapped-list .leaf-view li")).toHaveText(["Anna", "Ben"]);

    await page.locator("#replace-rows").click();

    await expect(page.locator("#mapped-list .leaf-view li")).toHaveText(["Xena", "Yuri"]);

    expect(errors).toEqual([]);
  });

  test("plain な Light DOM（state 注入）が引き続き成立すること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-light-dom.html");

    await expect(page.locator("#plain light-plain .inner")).toHaveText("injected");

    expect(errors).toEqual([]);
  });
});
