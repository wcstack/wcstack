import { test, expect } from "@playwright/test";

// 誰も読まない失敗（[wcs/io-error-unobserved]、stamp-rally、docs/seam-apps.md、4.25）の、実ブラウザでの回帰テスト。
//
// I/O ノードは投げない: 失敗したコマンドは要素の error / errorInfo に入って終わり、どちらも束ねていない
// ページは元のまま、何も言わなかった。diagnostics の後付けが、状態が束ねる要素で、その data-wcs が
// error・errorInfo・status・connected のどれも読まないものを、タグと code ごとに 1 回挙げる。
test.describe("e2e/fixtures/io-error-unobserved", () => {
  test("失敗の出力をどれも束ねていない要素の失敗は 1 回知らされ、errorInfo を束ねた要素の失敗は知らされない", async ({ page }) => {
    const messages: string[] = [];
    page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") messages.push(m.text()); });
    page.on("pageerror", (e) => messages.push(`pageerror: ${e.message}`));
    await page.goto("/e2e/fixtures/io-error-unobserved.html");

    // errorInfo を束ねた要素: ページが読んでいるので、何も言わない
    await page.click("#readGo");
    await expect(page.locator("#readCode")).toHaveText("invalid-argument");
    expect(messages).toEqual([]);

    // どの失敗の出力も束ねていない要素
    await page.click("#lostGo");
    await expect.poll(() => messages.length).toBe(1);
    expect(messages).toEqual([
      `[@wcstack/state] [wcs/io-error-unobserved] <wcs-fullscreen> reported a failure (invalid-argument): "Fullscreen target could not be resolved." — and nothing reads it: its data-wcs binds none of error, errorInfo, status and connected, and no event token. Bind errorInfo (errorInfo: path) and show it.`,
    ]);

    // もう一度失敗しても、同じタグと code は言い直さない
    await page.click("#lostGo");
    await page.waitForTimeout(200);
    expect(messages).toHaveLength(1);
  });
});
