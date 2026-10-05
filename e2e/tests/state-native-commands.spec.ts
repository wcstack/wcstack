import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// ネイティブ要素の `command.<method>:`（native-commands 機能。docs/state-engine-rewrite/native-commands.ja.md）を、
// メソッドが本当の効果を持つ実ブラウザで確かめる。happy-dom の単体テスト（packages/state の
// coverage-addons-native-commands.test.ts）では top layer・:modal・フォーカス・popover の状態を見られない。

const FIXTURE = "/e2e/fixtures/native-commands.html";

async function open(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await expect(page.locator("html[data-ready=true]")).toBeAttached();
}

test.describe("e2e/fixtures/native-commands — ネイティブ要素の command.", () => {
  test("onclick: $command で <dialog> をモーダルで開き、state の emit の引数で閉じる", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    const dialog = page.locator("#dlg");
    await page.click("#open");
    await expect(dialog).toHaveJSProperty("open", true);
    expect(await dialog.evaluate((d) => d.matches(":modal"))).toBe(true);
    await page.click("#save");
    await expect(dialog).toHaveJSProperty("open", false);
    expect(await dialog.evaluate((d) => (d as HTMLDialogElement).returnValue)).toBe("saved");
    expect(errors).toEqual([]);
  });

  test("if: で表示した入力欄に、$renderedCallback からの emit でフォーカスが移る", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    await expect(page.locator("#title")).toHaveCount(0);
    await page.click("#edit");
    await expect(page.locator("#title")).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("onclick: $command で popover を開閉する（クリックのイベントは togglePopover に渡さない）", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    const tip = page.locator("#tip");
    const shown = () => tip.evaluate((el) => el.matches(":popover-open"));
    await page.click("#pop");
    expect(await shown()).toBe(true);
    await page.click("#pop");
    expect(await shown()).toBe(false);
    expect(errors).toEqual([]);
  });
});
