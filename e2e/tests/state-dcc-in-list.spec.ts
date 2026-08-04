import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// DCC を for / if の中に置いたときのライフサイクル。
// docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.3 / §1.4（gate G4）。
//
// 既存の __e2e__/dcc は常時接続の単発インスタンスしか描かないため、
// 「未接続のまま bind される」「同一ノードが再マウントされる」の 2 つが素通りしていた。
test.describe("e2e/fixtures/dcc-in-list", () => {
  test("fragment 内で bind された行にも初期値が入り、if の再マウントでも壊れないこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/dcc-in-list.html");

    // §1.4: 行は fragment 上でバインドされる。shadow を connectedCallback まで作らないと
    // stateElement が null で書き込みが捨てられ、ここが 0 / 0 / 0 になる。
    await expect(page.locator("#list .cell")).toHaveText(["1", "2", "3"]);

    // §1.3: unmount → mount で同一ノードが再接続される。
    await page.locator("#toggle").click();
    await expect(page.locator("#list")).toHaveCount(0);

    await page.locator("#toggle").click();
    await expect(page.locator("#list .cell")).toHaveText(["1", "2", "3"]);

    expect(errors).toEqual([]);
  });
});
