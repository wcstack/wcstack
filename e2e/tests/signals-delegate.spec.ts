import { test, expect, type Page } from "@playwright/test";

// @wcstack/signals の delegateEvents（4.19、opt-in）: h() の on… のハンドラを要素のリスナーでなく、種類ごとに
// 1 本の root のリスナーから呼ぶ。委譲は composedPath() と currentTarget の上書きに頼るので、happy-dom の単体試験の
// ほかに本物のブラウザで確かめる（@browsers: Firefox でも）。

declare global {
  interface Window {
    __log: string[];
    __ready: boolean;
    __clickClosed(): void;
    __clickDetached(): void;
  }
}

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
  await page.goto("/e2e/fixtures/signals-delegate/index.html");
  await page.waitForFunction(() => window.__ready === true);
  return errors;
}
const log = (page: Page) => page.evaluate(() => window.__log.splice(0));

test.describe("e2e/fixtures/signals-delegate", () => {
  test("内側から外側へ、要素を currentTarget と this にして呼び、stopPropagation で外側を止める @browsers", async ({ page }) => {
    const errors = await open(page);
    await page.locator("#label").click(); // ボタンの中の span を押す
    expect(await log(page)).toEqual(["go:go:go:click", "outer:outer:outer:click"]);
    await page.locator("#stop").click();
    expect(await log(page)).toEqual(["stop:stop:stop:click"]);
    await page.locator("#row-2").click();
    expect(await log(page)).toEqual(["row:row-2:row-2:click", "outer:outer:outer:click"]);
    expect(errors).toEqual([]);
  });

  test("開いた shadow root の中は文書のリスナーが見つけ、閉じた shadow root は自分の root で 1 回だけ @browsers", async ({ page }) => {
    const errors = await open(page);
    await page.locator("#open-host").locator("#open-button").click();
    expect(await log(page)).toEqual(["open:open-button:open-button:click"]);
    await page.evaluate(() => window.__clickClosed());
    expect(await log(page)).toEqual(["closed:closed-button:closed-button:click"]);
    expect(errors).toEqual([]);
  });

  test("委譲していること: 文書の外の要素の click() では呼ばない（要素のリスナーなら呼ばれる） @browsers", async ({ page }) => {
    const errors = await open(page);
    await page.evaluate(() => window.__clickDetached());
    expect(await log(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("キー入力の keydown と input も委譲で呼ぶ @browsers", async ({ page }) => {
    const errors = await open(page);
    await page.locator("#field").focus();
    await page.keyboard.type("a");
    expect(await log(page)).toEqual(["key:field:field:keydown", "input:field:field:input"]);
    expect(errors).toEqual([]);
  });
});
