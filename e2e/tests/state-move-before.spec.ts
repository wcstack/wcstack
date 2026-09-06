import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// Phase 2 (docs/a11y-impl-plan.md T2-3) — keyed swap 中のフォーカス保存 (A7)。
//
// createContent.ts の mountAfter は、接続済み・同一親のノード移動に限り
// Node.moveBefore()（取り外しを伴わない移動）を使う。happy-dom には moveBefore が
// 無いため、unit はスタブで分岐を固定し、「本当にフォーカスが生き残るか」は
// この実ブラウザ spec だけが検証する。swap の起動は programmatic click
// （el.click() はフォーカスを動かさない）で行い、入力へのフォーカスを保ったまま
// リオーダーを踏ませる。

const FIXTURE = "/e2e/fixtures/state-move-before.html";

test.describe("state-move-before — keyed swap のフォーカス保存 (A7)", () => {
  test("行内 input のフォーカス・入力値・キャレットが swap を生き残る", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator("#list li")).toHaveCount(5);
    // この spec の前提: Chromium 133+ の moveBefore
    expect(
      await page.evaluate(() => typeof Element.prototype.moveBefore === "function"),
    ).toBe(true);

    const input = page.locator('li[data-id="2"] input');
    await input.click();
    await input.fill("hello");
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__focused = document.activeElement;
    });

    // ボタンをマウスで押すとフォーカスがボタンへ移るため、programmatic click で起動
    await page.evaluate(() => (document.getElementById("swap") as HTMLButtonElement).click());

    // リオーダー自体は起きている（2 行目 ↔ 4 行目）
    await expect(page.locator("#list li").nth(1)).toHaveAttribute("data-id", "4");
    await expect(page.locator("#list li").nth(3)).toHaveAttribute("data-id", "2");

    // document.activeElement の同一性・値・所属行が生き残る
    expect(
      await page.evaluate(
        () => document.activeElement === (window as unknown as Record<string, unknown>).__focused,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => (document.activeElement as HTMLInputElement).value),
    ).toBe("hello");
    expect(
      await page.evaluate(() => (document.activeElement as HTMLElement).closest("li")?.dataset.id),
    ).toBe("2");

    expect(errors).toEqual([]);
  });
});
