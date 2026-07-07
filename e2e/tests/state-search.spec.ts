import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// state + fetch + debounce: 初期の全件フェッチ描画と、入力→デバウンス→再フェッチの
// パイプライン(eventToken のリクエストカウンタ含む)を実ブラウザで検証する。
test.describe("examples/state-search", () => {
  test("初期ロードで全件が描画され、入力でデバウンス検索が実行される", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/examples/state-search/");

    // 初期の全件フェッチ結果が for バインディングで描画される(モックは5件)
    await expect(page.locator(".status-pill")).toHaveText("5 hits");
    await expect(page.locator(".result-item")).toHaveCount(5);
    // filter パイプライン(locale)を通った価格表示
    await expect(page.locator(".price").first()).toHaveText("¥12,800");
    // eventToken 経由のリクエストカウンタ(初期ロードで1)
    await expect(page.locator(".meter b")).toHaveText("1");

    // 入力 → 300ms デバウンス → 再フェッチ → 絞り込み結果
    await page.locator("input[type=search]").fill("keyboard");
    await expect(page.locator(".status-pill")).toHaveText("1 hits");
    await expect(page.locator(".result-name")).toHaveText("Mechanical Keyboard");
    await expect(page.locator(".meter b")).toHaveText("2");

    expect(errors).toEqual([]);
  });
});
