import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// 未 define カスタム要素への初期 apply の whenDefined 再適用
// (docs/state-binding-init-races.md §2、packages/state の scheduleDeferredApply)。
// happy-dom は define 時に既存ノードを差し替えるため happy path を unit で
// 検証できず、実ブラウザのここが唯一の end-to-end 回帰テストになる。
// fixture は state を先に初期化し、<wcs-sse> の define を 800ms 遅らせて
// 「state のバインド確立が要素の define より先に完了する」構成を再現する。
test.describe("e2e/fixtures/deferred-apply", () => {
  test("後から define された要素にも初期バインド値が適用される", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/deferred-apply.html");

    // define 前: 適用は保留されている(own property を書いて accessor を隠さない)
    const before = await page
      .locator("wcs-sse")
      .evaluate((el) => el.getAttribute("url"));
    expect(before).toBeNull();

    // define(~800ms 後)を経て、whenDefined 再適用で url が書かれる
    await expect(page.locator("wcs-sse")).toHaveAttribute("url", "/api/never?x=1");

    expect(errors).toEqual([]);
  });
});
