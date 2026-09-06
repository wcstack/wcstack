import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// Light DOM の `bind-component`（v2: マウント形）。docs/state-mount-design.md。
//
// v1 では mapped 形の初期化が循環し（§1.13）、name 名前空間の分離で復旧していた。
// v2 は単一ツリーのマウントなので内側のツリーも name も無く、親 ledger への変換だけが残る。
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

  test("plain な Light DOM は廃止 — loud に落ち、ページの他の部分を巻き添えにしないこと", async ({ page }) => {
    // v2（2026-09-03 著者決定）: 共有 rootNode に独立ツリーを置けないため plain light は
    // 設定エラー。誘導＝shadow を付ける（plain Shadow 形）か、ホストから配線してマウント。
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/e2e/fixtures/bind-component-light-dom-plain-removed.html");

    // 同じページの mapped コンポーネントは無傷（ウェッジしない）
    await expect(page.locator("#mapped light-view-ok .inner")).toHaveText("Alice");
    // plain は描画されない
    await expect(page.locator("#plain light-plain .inner")).toHaveText("");
    // エラーは loud（誘導文付き）
    expect(pageErrors.some((m) => m.includes('plain (unwired) Light DOM "bind-component" is not supported'))).toBe(true);
  });
});
