import { test, expect } from "@playwright/test";

// 定義をファイルに置いた Declarative Custom Component を autoloader が読む（docs/seam-apps.md、garden-plots）。
// DCC の定義はマークアップで、ブラウザが shadow root にするのはページを解析している間だけ。autoloader の
// `dcc` の loader がファイルから定義を持ってくるので、1 つのファイルを複数のページが使える。
// happy-dom には setHTMLUnsafe() も宣言的 Shadow DOM も無いので、仕組みそのものはここでしか確かめられない。
test.describe("e2e/fixtures/autoloader-dcc", () => {
  test("拡張子で選ぶ eager・キーで名指しする eager・行の中の lazy のどれも定義され、ページと結び付く", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    const consoleErrors: string[] = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    await page.goto("/e2e/fixtures/autoloader-dcc/index.html");

    // an eager key mapped to an .html file: the loader comes from the extension
    await expect(page.locator("#pager x-pager .info")).toHaveText("2 / 6");
    // an eager key that names the loader; the page's own text stays in the slot
    await expect(page.locator("#badge x-badge .box")).toHaveText("[warn]");
    await expect(page.locator("#badge x-badge")).toContainText("text of the page");
    // a namespace: the file is fetched when the tag is met, in each row
    await expect(page.locator("#notes lazy-note .t")).toHaveText(["first", "second"]);

    // the definitions are in the page once each, out of sight
    const definitions = page.locator("#wcs-autoloader-definitions > [data-wc-definition]");
    await expect(definitions).toHaveCount(3);
    expect(await page.locator("#wcs-autoloader-definitions").evaluate((e) => (e as HTMLElement).checkVisibility())).toBe(false);

    // both ways: the page writes the part, the part writes the page
    await page.locator("#next").click();
    await expect(page.locator("#pager x-pager .info")).toHaveText("3 / 6");
    await page.locator("#pager x-pager .own-next").click();
    await expect(page.locator("#page")).toHaveText("4");

    // the file that is not there is reported, naming its URL, and nothing else failed
    expect(errors).toEqual([]);
    expect(consoleErrors.some((e) => e.includes("Failed to eager load component 'x-missing'") && e.includes("parts/missing.html: HTTP 404"))).toBe(true);
    expect(consoleErrors.filter((e) => !e.includes("x-missing") && !e.includes("404"))).toEqual([]);
  });
});
