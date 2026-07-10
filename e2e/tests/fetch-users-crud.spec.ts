import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// state + fetch: 一覧(auto-fetch)・詳細(computed url)・作成(manual POST +
// command-token での一覧リロード)の一連を実ブラウザで検証する。
test.describe("packages/fetch/examples/users-crud", () => {
  test("ユーザー一覧の描画・詳細表示・POST 作成が動作する", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/fetch/examples/users-crud/");

    // 一覧フェッチの結果が for バインディングで描画される
    await expect(page.locator(".user-name").first()).toHaveText("Alice Johnson");

    // 行クリック → selectedUserId → computed url → 詳細フェッチ → 詳細カード
    await page.locator(".user-item").first().click();
    await expect(page.locator(".detail-card")).toContainText("alice@example.com");

    // POST 作成 → 成功バナー → command-token 経由の一覧リロードに新規行が現れる
    // (名前は retry でもモックの残留データと衝突しないよう毎回一意にする)
    const name = `E2E User ${Date.now()}`;
    await page.locator("#create-name").fill(name);
    await page.locator("#create-email").fill("e2e@example.com");
    await page.locator(".submit-btn").click();
    await expect(page.locator(".status-msg.success")).toContainText(name);
    await expect(page.locator(".user-list")).toContainText(name);

    expect(errors).toEqual([]);
  });
});
