import { test, expect, type Page } from "@playwright/test";
import { contactPicker, iphoneSensors } from "./io-screen-sensors-stubs";

// 画面とセンサーの I/O ノード（stamp-rally、docs/seam-apps.md、4.25）の、実ブラウザでの回帰テスト。
//
// - 全画面・カーソルの捕捉の要素が、働いている最中に文書から外れる（if: の枝、ルートの中身）と、
//   ブラウザは解くのに state の active は true のままだった。切断は active: false を出す。
// - Firefox は断ったカーソルの捕捉を文書の pointerlockerror で知らせ、Promise は拒否しない:
//   error が立たなかった。
// - <wcs-tilt>: タップなしの問いは、ブラウザが問いを出さずに断るだけなのに "denied" になった。
//   heading（北）。<wcs-accelerometer> / <wcs-gyroscope> はセンサーのクラスが無ければ devicemotion を読む。
// - <wcs-contacts>: 選ばずに閉じたピッカーは空の配列で解決する — それが cancelled。
//
// 「タップなし」はページ自身のタイマーから（?auto=）: Playwright のクリックも evaluate() もユーザーの操作に数えられる。
// expect() の待ち受けも evaluate なので、タイマーが切れるまではページに触らずに待つ（untouched）。

/** ページのタイマー（600 ms）が切れるまで、ページに何も問い合わせずに待つ。 */
const untouched = (page: Page) => page.waitForTimeout(1200);

function watchConsole(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") messages.push(m.text()); });
  page.on("pageerror", (e) => messages.push(`pageerror: ${e.message}`));
  return messages;
}
/** Firefox's own lines for a refused request and for a deprecated sensor event are the browser's, not the page's. */
const ours = (messages: string[]) => messages.filter((m) => !/^\[JavaScript Warning|Request for (pointer lock|fullscreen) was denied|is deprecated|API can only be initiated by a user gesture/.test(m));

test.describe("e2e/fixtures/io-screen — 全画面とカーソルの捕捉", () => {
  test("全画面の最中に要素が if: ごと外れると、state の active は false になる。戻した後も全画面にできる @browsers", async ({ page }) => {
    const messages = watchConsole(page);
    await page.goto("/e2e/fixtures/io-screen.html");
    await expect(page.locator("#fsOk")).toHaveText("true");
    await page.click("#fsGo");
    await expect(page.locator("#fs")).toHaveText("true");
    expect(await page.evaluate(() => document.fullscreenElement?.id)).toBe("box");

    // (全画面の外のボタンは押せないので、ページのスクリプトとして押す)
    await page.evaluate(() => (document.querySelector("#hide") as HTMLElement).click());
    await expect(page.locator("#fs")).toHaveText("false");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);

    await page.click("#unhide");
    await expect(page.locator("#box")).toBeVisible();
    await page.click("#fsGo");
    await expect(page.locator("#fs")).toHaveText("true");
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.locator("#fs")).toHaveText("false");
    expect(ours(messages)).toEqual([]);
  });

  test("カーソルの捕捉の最中に要素が外れると active は false になる @browsers", async ({ page }) => {
    await page.goto("/e2e/fixtures/io-screen.html");
    await page.click("#plGo");
    await expect(page.locator("#pl")).toHaveText("true");
    await page.evaluate(() => (document.querySelector("#hide") as HTMLElement).click());
    await expect(page.locator("#pl")).toHaveText("false");
    await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  });

  test("タップなしのカーソルの捕捉は断られ、errorInfo は not-allowed になる（Firefox は pointerlockerror で知らせる） @browsers", async ({ page }) => {
    await page.goto("/e2e/fixtures/io-screen.html?auto=plGo");
    await untouched(page);
    await expect(page.locator("#plCode")).toHaveText("not-allowed");
    await expect(page.locator("#pl")).toHaveText("false");
  });

  test("タップなしの全画面は断られ、errorInfo は not-allowed になる @browsers", async ({ page }) => {
    await page.goto("/e2e/fixtures/io-screen.html?auto=fsGo");
    await untouched(page);
    await expect(page.locator("#fsCode")).toHaveText("not-allowed");
    await expect(page.locator("#fs")).toHaveText("false");
  });
});

test.describe("e2e/fixtures/io-sensors — iPhone の問い、北、devicemotion、連絡先、unsupported の理由", () => {
  test("タップなしの問いは断られるだけで permissionState は変わらない。タップ 1 回で 3 つの要素が許可され、北と加速度と回転が届く @browsers", async ({ page }) => {
    const messages = watchConsole(page);
    await page.addInitScript(iphoneSensors);
    await page.goto("/e2e/fixtures/io-sensors.html?auto=ask");
    await untouched(page);

    // ページのタイマーからの問い: ブラウザは問いを出さずに断る。断られたのは利用者ではない
    await expect(page.locator("#tiltCode")).toHaveText("not-allowed");
    await expect(page.locator("#tiltRecoverable")).toHaveText("true");
    await expect(page.locator("#tiltPerm")).toHaveText("unknown");
    await expect(page.locator("#accelPerm")).toHaveText("unknown");
    expect(await page.evaluate(() => (window as any).__ios.asked)).toBe(0);
    await expect(page.locator("#tiltOk")).toHaveText("true");
    await expect(page.locator("#accelOk")).toHaveText("true");

    // タップ: 問いが 1 回出て、3 つとも許可される
    await page.click("#allow");
    await expect(page.locator("#tiltPerm")).toHaveText("granted");
    await expect(page.locator("#accelPerm")).toHaveText("granted");
    await expect(page.locator("#gyroPerm")).toHaveText("granted");
    await expect(page.locator("#tiltCode")).toHaveText("");
    expect(await page.evaluate(() => (window as any).__ios.asked)).toBe(1);

    await page.evaluate(() => {
      const ios = (window as any).__ios;
      ios.emit("deviceorientation", { alpha: 90, beta: 1, gamma: 2, absolute: false, webkitCompassHeading: 270 });
      ios.emit("devicemotion", { accelerationIncludingGravity: { x: 1.5, y: 0, z: -9.8 }, rotationRate: { alpha: 0, beta: 180, gamma: 0 }, interval: 16 });
    });
    await expect(page.locator("#heading")).toHaveText("270");
    await expect(page.locator("#ax")).toHaveText("1.5");
    // 180 度毎秒 = π ラジアン毎秒
    await expect(page.locator("#gx")).toHaveText("3.1416");
    expect(ours(messages)).toEqual([]);
  });

  test("利用者が断れば denied になる @browsers", async ({ page }) => {
    await page.addInitScript(iphoneSensors);
    await page.goto("/e2e/fixtures/io-sensors.html");
    await page.evaluate(() => { (window as any).__ios.answer = "denied"; });
    await page.click("#allow");
    await expect(page.locator("#tiltPerm")).toHaveText("denied");
    await expect(page.locator("#accelPerm")).toHaveText("denied");
    await expect(page.locator("#tiltCode")).toHaveText("");
  });

  test("連絡先: 選ばずに閉じると cancelled になり、前に選んだ値は残る。選び直すと cancelled は戻る @browsers", async ({ page }) => {
    await page.addInitScript(contactPicker);
    await page.goto("/e2e/fixtures/io-sensors.html");
    await expect(page.locator("#contactsOk")).toHaveText("true");
    await page.click("#pick");
    await expect(page.locator("#pickedNames")).toHaveText("山田 花子");
    await expect(page.locator("#picks")).toHaveText("1");

    await page.evaluate(() => { (window as any).__contacts.mode = "closed"; });
    await page.click("#pick");
    await expect(page.locator("#cancelled")).toHaveText("true");
    await expect(page.locator("#pickedNames")).toHaveText("山田 花子");
    await expect(page.locator("#picks")).toHaveText("1");

    await page.evaluate(() => { (window as any).__contacts.mode = "ok"; });
    await page.click("#pick");
    await expect(page.locator("#cancelled")).toHaveText("false");
    await expect(page.locator("#picks")).toHaveText("2");
  });

  test("代役の無いブラウザ: 連絡先は supported: false、知らない権限名は unsupported で理由は unknown-name @browsers", async ({ page }) => {
    const messages = watchConsole(page);
    await page.goto("/e2e/fixtures/io-sensors.html");
    await expect(page.locator("#contactsOk")).toHaveText("false");
    await expect(page.locator("#permState")).toHaveText("unsupported");
    await expect(page.locator("#permWhy")).toHaveText("unknown-name");
    expect(ours(messages)).toEqual([]);
  });
});
