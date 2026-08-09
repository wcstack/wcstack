import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// bind-component の子スコープが親スコープのリストを `for:` で回せるか。
// docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.8。
//
// 判別子は Shadow 内の #list-view（#host-view は親自身のバインディングなので
// 断線していても動く）。行の同一性は data-row-id で見る — 全再描画に落ちていれば
// テキストではなく id の並びが崩れる。
test.describe("e2e/fixtures/bind-component-list", () => {
  const shadowRows = "list-view >>> #list-view li";

  test("子スコープの for が親のリストを描画すること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-list.html");

    await expect(page.locator("#host-view li")).toHaveText(["Alice", "Bob"]);
    await expect(page.locator(shadowRows)).toHaveText(["Alice", "Bob"]);

    expect(errors).toEqual([]);
  });

  test("親の行フィールド書き込みが子の行に届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-list.html");
    await expect(page.locator(shadowRows)).toHaveText(["Alice", "Bob"]);

    await page.locator("#rename").click();

    await expect(page.locator("#host-view li")).toHaveText(["Carol", "Bob"]);
    await expect(page.locator(shadowRows)).toHaveText(["Carol", "Bob"]);
    // 行は作り直されていない
    expect(await page.locator(shadowRows).evaluateAll(
      (els) => els.map((el) => el.getAttribute("data-row-id")),
    )).toEqual(["r1", "r2"]);

    expect(errors).toEqual([]);
  });

  test("親のリスト置換に子の描画が追随すること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-list.html");
    await expect(page.locator(shadowRows)).toHaveText(["Alice", "Bob"]);

    await page.locator("#replace").click();

    await expect(page.locator("#host-view li")).toHaveText(["Dave", "Erin", "Frank"]);
    await expect(page.locator(shadowRows)).toHaveText(["Dave", "Erin", "Frank"]);

    expect(errors).toEqual([]);
  });

  test("行オブジェクトを保った並べ替えで行の同一性が保たれること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-list.html");
    await expect(page.locator(shadowRows)).toHaveText(["Alice", "Bob"]);

    await page.locator("#swap").click();

    await expect(page.locator(shadowRows)).toHaveText(["Bob", "Alice"]);
    expect(await page.locator(shadowRows).evaluateAll(
      (els) => els.map((el) => el.getAttribute("data-row-id")),
    )).toEqual(["r2", "r1"]);

    expect(errors).toEqual([]);
  });
});
