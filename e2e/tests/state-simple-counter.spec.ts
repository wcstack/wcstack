import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// state: カウンタ。onclick (4.0 ではルートへ委譲される) が状態のメソッドを呼び、mustache の
// 数値表示と、比較フィルタ (gt / lt) の真偽で切り替わる class.plus / class.minus を更新する。
// 正・ゼロ・負の境界をまたぐ往復でクラスが正しく付け外しされることを実ブラウザで固定する。
const PAGE = "/packages/state/examples/simple-counter/";

// 表示値・クラス・CSS の色をまとめて検証する (色はページの <style> による: plus=green, minus=red)
async function expectCount(page: Page, n: number) {
  const span = page.locator("h1 span");
  await expect(span).toHaveText(String(n));
  if (n > 0) {
    await expect(span).toHaveClass("plus");
    await expect(span).toHaveCSS("color", "rgb(0, 128, 0)");
  } else if (n < 0) {
    await expect(span).toHaveClass("minus");
    await expect(span).toHaveCSS("color", "rgb(255, 0, 0)");
  } else {
    await expect(span).toHaveClass("");
  }
}

test.describe("packages/state/examples/simple-counter", () => {
  test("初期値 0 でクラスは付かない", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    await expectCount(page, 0);
    await expect(page.locator("body")).not.toContainText("{{");

    expect(errors).toEqual([]);
  });

  test("Increment で増え、正になると class.plus が付く", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);
    await expectCount(page, 0);

    const inc = page.locator("button", { hasText: "Increment" });
    for (let n = 1; n <= 3; n++) {
      await inc.click();
      await expectCount(page, n);
    }

    expect(errors).toEqual([]);
  });

  test("Decrement で 0 をまたいで負になると class.minus に替わり、戻すとクラスが外れる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);
    await expectCount(page, 0);

    const inc = page.locator("button", { hasText: "Increment" });
    const dec = page.locator("button", { hasText: "Decrement" });

    await inc.click();
    await expectCount(page, 1);
    // 1 → 0 → -1 → -2: plus が外れ、0 では無印、負で minus
    for (const n of [0, -1, -2]) {
      await dec.click();
      await expectCount(page, n);
    }
    // -2 → -1 → 0 → 1: minus が外れ、正で plus に戻る
    for (const n of [-1, 0, 1]) {
      await inc.click();
      await expectCount(page, n);
    }

    expect(errors).toEqual([]);
  });
});
