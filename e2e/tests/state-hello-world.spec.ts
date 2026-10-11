import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// state: 最小のデモ。インライン <script type="module"> の状態 1 キー (message) を、
// ページ直下の mustache ({{ message }}) と <input> の value 双方向バインディングで表示・編集する。
// 4.0 の /auto (enableMustache 既定 true) で mustache が描かれ、input イベントの書き戻しが
// 同じキーを読む見出しへ届くことを実ブラウザで固定する。
const PAGE = "/packages/state/examples/hello-world/";

test.describe("packages/state/examples/hello-world", () => {
  test("初期表示で見出しと入力欄の両方に状態の初期値が入る", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    const heading = page.locator(".example-container h1");
    const input = page.locator('input[type="text"]');
    await expect(heading).toHaveText("Hello World!");
    await expect(input).toHaveValue("Hello World!");
    // mustache が文字のまま残っていない
    await expect(page.locator("body")).not.toContainText("{{");

    expect(errors).toEqual([]);
  });

  test("入力欄の編集が 1 打鍵ごとに見出しへ反映され、空にすると見出しも空になる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    const heading = page.locator(".example-container h1");
    const input = page.locator('input[type="text"]');
    await expect(heading).toHaveText("Hello World!");

    // 末尾を 1 文字ずつ消す: 各 input イベントの書き戻しが見出しに届く
    await input.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace");
    await expect(heading).toHaveText("Hello World");
    await page.keyboard.press("Backspace");
    await expect(heading).toHaveText("Hello Worl");

    // 1 文字ずつ打つ
    await input.fill("");
    await expect(heading).toHaveText("");
    await input.pressSequentially("wcs");
    await expect(heading).toHaveText("wcs");

    // 非 ASCII も素通しで描かれる
    await input.fill("こんにちは、4.0");
    await expect(heading).toHaveText("こんにちは、4.0");
    await expect(input).toHaveValue("こんにちは、4.0");

    expect(errors).toEqual([]);
  });
});
