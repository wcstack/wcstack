import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// DCC の $bindables メンバへのサブパス書き込みが変更イベントを撃つこと。
// docs/architecture-hardening/15-state-component-mechanism-consistency.md §2.1。
//
// 修正前は bindableEventMap を「書き込まれたパスの完全一致」でしか引かず、
// `$bindables: ["user"]` に対する `user.name = "..."` は無音だった。
// DCC 内側の表示は自前のバインディングで更新されるので、判別材料は外側の表示になる。
test.describe("e2e/fixtures/dcc-subpath-change", () => {
  test("サブパス書き込みが親 state まで伝わること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/dcc-subpath-change.html");

    await expect(page.locator("#outer")).toHaveText("Alice");
    await expect(page.locator("#live .inner")).toHaveText("Alice");

    await page.locator("#live .rename").click();

    await expect(page.locator("#live .inner")).toHaveText("Bob");
    // 修正前はここが "Alice" のまま（イベントが出ないので親が知らない）
    await expect(page.locator("#outer")).toHaveText("Bob");

    expect(errors).toEqual([]);
  });
});
