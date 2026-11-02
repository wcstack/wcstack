import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// keyed swap 中のフォーカス保存 (A7, docs/a11y-design.md §4)。
//
// 4.0 のエンジンは行を Block.insertBefore（packages/state/src/dom/view.ts）で動かし、
// 文書につながった親で Node.moveBefore() があればそれを使う（取り外しを伴わない移動）。
// happy-dom には moveBefore が無いため、unit はスタブで分岐を固定し、「本当にフォーカスが
// 生き残るか」はこの実ブラウザ spec だけが検証する。swap の起動は programmatic click
// （el.click() はフォーカスを動かさない）で行い、入力へのフォーカスを保ったまま
// リオーダーを踏ませる。
//
// fixture は 5 行の 2 行目と 4 行目を入れ替える。リスト差分は 2 行目をその場に残し、
// 3 行目と 4 行目を動かす: 2 行目のフォーカスは移動が無くても残り、4 行目のフォーカスは
// moveBefore でだけ残る（4.13 までは insertBefore で失われた）。

const FIXTURE = "/e2e/fixtures/state-move-before.html";

test.describe("state-move-before — keyed swap のフォーカス保存 (A7)", () => {
  for (const [id, label] of [
    ["2", "その場に残る行"],
    ["4", "動かされる行"],
  ] as const) {
    test(`行内 input のフォーカス・入力値・キャレットが swap を生き残る（${label}）`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(FIXTURE);
      await expect(page.locator("#list li")).toHaveCount(5);
      // この spec の前提: Chromium 133+ の moveBefore
      expect(
        await page.evaluate(() => typeof Element.prototype.moveBefore === "function"),
      ).toBe(true);

      const input = page.locator(`li[data-id="${id}"] input`);
      await input.click();
      await input.fill("hello");
      await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
      await page.evaluate(() => {
        (window as unknown as Record<string, unknown>).__focused = document.activeElement;
      });

      // ボタンをマウスで押すとフォーカスがボタンへ移るため、programmatic click で起動
      await page.evaluate(() => (document.getElementById("swap") as HTMLButtonElement).click());

      // リオーダー自体は起きている（2 行目 ↔ 4 行目）
      await expect(page.locator("#list li").nth(1)).toHaveAttribute("data-id", "4");
      await expect(page.locator("#list li").nth(3)).toHaveAttribute("data-id", "2");

      // document.activeElement の同一性・値・キャレット・所属行が生き残る
      expect(
        await page.evaluate(
          () => document.activeElement === (window as unknown as Record<string, unknown>).__focused,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(() => (document.activeElement as HTMLInputElement).value),
      ).toBe("hello");
      expect(
        await page.evaluate(() => (document.activeElement as HTMLInputElement).selectionStart),
      ).toBe(2);
      expect(
        await page.evaluate(() => (document.activeElement as HTMLElement).closest("li")?.dataset.id),
      ).toBe(id);

      expect(errors).toEqual([]);
    });
  }
});
