import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// DCC のメソッドを command-token で起動する。
// docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.6（gate G2）。
//
// 修正前は defineDCC が wcBindable.commands を生成しなかったため、
// applyChangeToCommand が "not declared in wcBindable.commands" で必ず落ちていた。
test.describe("e2e/fixtures/dcc-command", () => {
  test("command-token が DCC のメソッドに届き、引数も渡ること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/dcc-command.html");

    // 親 state → DCC プロパティ（従来から動く方向）
    await expect(page.locator("#live .own")).toHaveText("10");
    await expect(page.locator("#mirror")).toHaveText("10");

    // 親 state → DCC メソッド（command-token）。引数 3 が素通しされる
    await page.locator("#fire").click();
    await expect(page.locator("#live .own")).toHaveText("13");

    await page.locator("#fire").click();
    await expect(page.locator("#live .own")).toHaveText("16");

    expect(errors).toEqual([]);
  });
});
