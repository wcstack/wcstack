import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// bind-component の公開プロパティ (`element.state`) の read/write 意味論。
// docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.1 / gate G1。
//
// 修正前、親から data-wcs でバインドされた (mapped) コンポーネントでは
// `element.state` が「read = 最後に観測した値のキャッシュ / write = 値を捨てて通知のみ」
// という内部チャネル用 proxy そのものだった。同じコンポーネント実装が、親ページが
// data-wcs を書いたかどうかで挙動を変えてしまうため、実ブラウザで両方向を固定する。
test.describe("e2e/fixtures/bind-component-write", () => {
  test("mapped なコンポーネントでも state の read/write が素通しすること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-write.html");

    // 親 → 子の初期配送
    await expect(page.locator("#host-view")).toHaveText("Alice");
    await expect(page.locator("#inner-view")).toHaveText("Alice");

    // 公開プロパティの read がライブであること（キャッシュではない）
    await expect
      .poll(() => page.evaluate(() => (document.querySelector("my-editor") as any).state.name))
      .toBe("Alice");

    // 公開プロパティへの write が親 state に届くこと
    await page.evaluate(() => {
      (document.querySelector("my-editor") as any).state.name = "Bob";
    });
    await expect(page.locator("#host-view")).toHaveText("Bob");
    await expect(page.locator("#inner-view")).toHaveText("Bob");
    await expect
      .poll(() => page.evaluate(() => (document.querySelector("my-editor") as any).state.name))
      .toBe("Bob");

    expect(errors).toEqual([]);
  });
});
