import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// examples/state-color-palette の実ブラウザテスト。
//
// デモの内容: <wcs-eyedropper> の command.open で画面から色を拾い、結果が
// eventToken.value（{ sRGBHex }）で state の $on.colorPicked に戻る（command → event の
// 往復）。スウォッチのクリックは行の中で `this["list.*.hex"]` を解決し、
// $command.copy.emit(hex) → <wcs-clipboard>.writeText(hex) へ素通しする。パレットは
// <wcs-storage key="wcs-color-palette" data-wcs="value#init=element: palette"> の双方向
// バインド 1 本で、接続時ロード・代入時セーブ・タブ間同期(storage イベント)を持つ。
// EyeDropper が無いブラウザでは <input type="color"> のフォールバックを使う。
//
// このスペックが固定するもの:
// - 拾った色が for: の行(hex 表示・背景色)として並び、拾い直しは末尾へ移る(重複なし)
// - 拾っている間の表示(ボタン無効・案内文)と、Esc のキャンセルがエラーにならないこと
// - スウォッチのクリックで、その行の hex が実際のクリップボードに入ること、
//   書き込みの失敗が Copy failed として出て、次の成功で消えること
// - リロードをまたぐ永続化(#init=element で永続値が初期値に潰されない)、✕ / clear all
// - 同じオリジンの別ページ(=別タブ)への同期
// - EyeDropper の無い環境でのフォールバック
//
// プラットフォーム API の与え方:
// - window.EyeDropper は addInitScript で差し替える(headless でも EyeDropper は
//   存在するが、ピッカーを操作できず open() は即 AbortError で終わる)。open() は
//   保留した Promise を返し、テストが色を返す(pick)かキャンセル(AbortError)する。
//   signal の abort にも本物と同じく AbortError で応える。
// - クリップボードは本物。コンテキストに clipboard-read / clipboard-write を与え、
//   書き込まれた値を navigator.clipboard.readText() で読み返す。失敗のテストだけ
//   writeText を差し替えて NotAllowedError で 1 回拒否させる。
// - localStorage は本物(同じコンテキストの 2 ページで storage イベントも本物)。
const PAGE = "/examples/state-color-palette/";
const KEY = "wcs-color-palette";

const INSTALL_FAKE_EYEDROPPER = () => {
  const opens: Array<{ pick: (hex: string) => void; cancel: () => void }> = [];
  class FakeEyeDropper {
    open(options: { signal?: AbortSignal } = {}): Promise<{ sRGBHex: string }> {
      return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("The user canceled the selection.", "AbortError"));
        opens.push({ pick: (hex) => resolve({ sRGBHex: hex }), cancel: abort });
        options.signal?.addEventListener("abort", abort);
      });
    }
  }
  (window as any).EyeDropper = FakeEyeDropper;
  (window as any).__eyedropper = {
    opened: () => opens.length,
    pick: (hex: string) => opens[opens.length - 1].pick(hex),
    cancel: () => opens[opens.length - 1].cancel(),
  };
};

function ui(page: Page) {
  return {
    pick: page.getByRole("button", { name: /Pick a color from the screen/ }),
    unsupportedNote: page.locator(".unsupported-note"),
    manual: page.getByLabel("Add a color manually"),
    status: page.getByRole("status"),
    heading: page.locator(".palette-head h2"),
    clearAll: page.getByRole("button", { name: "clear all" }),
    empty: page.locator(".empty"),
    swatches: page.locator(".swatch"),
    hexes: page.locator(".swatch .hex"),
  };
}

const STATUS_EMPTY = "Your palette is empty — grab a color!";
const STATUS_HINT = "Click a swatch to copy its hex.";
const STATUS_PICKING = "Pick a color anywhere on the screen… (Esc to cancel)";

async function pickColor(page: Page, hex: string) {
  const u = ui(page);
  const before = await page.evaluate(() => (window as any).__eyedropper.opened());
  await u.pick.click();
  await expect.poll(() => page.evaluate(() => (window as any).__eyedropper.opened())).toBe(before + 1);
  await page.evaluate((h) => (window as any).__eyedropper.pick(h), hex);
}

const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);

async function openWith(page: Page, palette: string[] | null = null) {
  await page.addInitScript(INSTALL_FAKE_EYEDROPPER);
  await page.goto(PAGE);
  if (palette !== null) {
    // 永続値を置いてから読み込み直す(接続時ロードの経路で並ぶ)
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(palette.map((hex) => ({ hex })))] as const);
    await page.reload();
    await expect(ui(page).swatches).toHaveCount(palette.length);
  }
}

test.describe("examples/state-color-palette", () => {
  test("EyeDropper で拾った色がパレットに並び、拾い直すと末尾へ移る(重複しない)", async ({ page }) => {
    const errors = collectErrors(page);
    await openWith(page);
    const u = ui(page);

    await expect(u.empty).toBeVisible();
    await expect(u.heading).toHaveText("Palette (0)");
    await expect(u.status).toHaveText(STATUS_EMPTY);
    await expect(u.clearAll).toBeDisabled();
    await expect(u.pick).toBeVisible();
    await expect(u.unsupportedNote).toHaveCount(0);

    // 拾っている間: ボタンは無効、案内文
    await u.pick.click();
    await expect(u.pick).toBeDisabled();
    await expect(u.status).toHaveText(STATUS_PICKING);
    await page.evaluate(() => (window as any).__eyedropper.pick("#e63946"));
    await expect(u.pick).toBeEnabled();

    await expect(u.hexes).toHaveText(["#e63946"]);
    await expect(u.heading).toHaveText("Palette (1)");
    await expect(u.status).toHaveText(STATUS_HINT);
    await expect(u.empty).toHaveCount(0);
    await expect(u.clearAll).toBeEnabled();

    await pickColor(page, "#2a9d8f");
    await pickColor(page, "#264653");
    await expect(u.hexes).toHaveText(["#e63946", "#2a9d8f", "#264653"]);

    // 既にある色を拾い直すと末尾へ移る
    await pickColor(page, "#e63946");
    await expect(u.hexes).toHaveText(["#2a9d8f", "#264653", "#e63946"]);
    await expect(u.heading).toHaveText("Palette (3)");
    // 代入のたびに保存されている
    expect(await stored(page)).toEqual([{ hex: "#2a9d8f" }, { hex: "#264653" }, { hex: "#e63946" }]);

    expect(errors).toEqual([]);
  });

  test("Esc(キャンセル)では何も足さず、エラーにもならない", async ({ page }) => {
    const errors = collectErrors(page);
    await openWith(page);
    const u = ui(page);

    await u.pick.click();
    await expect(u.status).toHaveText(STATUS_PICKING);
    await page.evaluate(() => (window as any).__eyedropper.cancel());

    await expect(u.pick).toBeEnabled();
    await expect(u.status).toHaveText(STATUS_EMPTY);
    await expect(u.status).not.toHaveClass(/\berror\b/);
    await expect(u.swatches).toHaveCount(0);
    // キャンセルは cancelled に落ち、error ではない
    expect(await page.evaluate(() => {
      const el = document.querySelector("wcs-eyedropper") as any;
      return { cancelled: el.cancelled, error: el.error };
    })).toEqual({ cancelled: true, error: null });

    // キャンセルの後も、次の pick は普通に動く
    await pickColor(page, "#f4a261");
    await expect(u.hexes).toHaveText(["#f4a261"]);

    expect(errors).toEqual([]);
  });

  test.describe("クリップボードの許可があるコンテキスト", () => {
    test.use({ permissions: ["clipboard-read", "clipboard-write"] });

    test("スウォッチのクリックで、その行の hex がクリップボードに入る", async ({ page }) => {
      const errors = collectErrors(page);
      await openWith(page, ["#e63946", "#2a9d8f", "#264653"]);
      const u = ui(page);
      await expect(u.status).toHaveText(STATUS_HINT);

      await u.swatches.nth(1).locator(".chip").click();
      await expect(u.status).toHaveText("Copied #2a9d8f to the clipboard ✓");
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("#2a9d8f");

      await u.swatches.nth(2).locator(".chip").click();
      await expect(u.status).toHaveText("Copied #264653 to the clipboard ✓");
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("#264653");

      await u.swatches.nth(0).locator(".chip").click();
      await expect(u.status).toHaveText("Copied #e63946 to the clipboard ✓");
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("#e63946");

      expect(errors).toEqual([]);
    });

    test("書き込みに失敗すると Copy failed をエラー表示し、次の成功で消える", async ({ page }) => {
      const errors = collectErrors(page);
      // 1 回目の writeText だけ拒否する(以降は本物)
      await page.addInitScript(() => {
        const real = Clipboard.prototype.writeText;
        let failNext = true;
        Clipboard.prototype.writeText = function (this: Clipboard, text: string) {
          if (failNext) {
            failNext = false;
            return Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));
          }
          return real.call(this, text);
        };
      });
      await openWith(page, ["#e63946", "#2a9d8f"]);
      const u = ui(page);

      await u.swatches.nth(0).locator(".chip").click();
      await expect(u.status).toHaveText("Copy failed: Write permission denied.");
      await expect(u.status).toHaveClass(/\berror\b/);

      await u.swatches.nth(1).locator(".chip").click();
      await expect(u.status).toHaveText("Copied #2a9d8f to the clipboard ✓");
      await expect(u.status).not.toHaveClass(/\berror\b/);
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("#2a9d8f");

      expect(errors).toEqual([]);
    });

    test("✕ で 1 色を消し(コピー済みの色なら Copied 表示も消える)、clear all で空にする", async ({ page }) => {
      const errors = collectErrors(page);
      await openWith(page, ["#e63946", "#2a9d8f", "#264653"]);
      const u = ui(page);

      // 真ん中を消す
      await u.swatches.nth(1).getByRole("button", { name: "Remove color" }).click();
      await expect(u.hexes).toHaveText(["#e63946", "#264653"]);
      await expect(u.heading).toHaveText("Palette (2)");
      expect(await stored(page)).toEqual([{ hex: "#e63946" }, { hex: "#264653" }]);

      // コピーした色を消すと、Copied の表示も消える
      await u.swatches.nth(1).locator(".chip").click();
      await expect(u.status).toHaveText("Copied #264653 to the clipboard ✓");
      await u.swatches.nth(1).getByRole("button", { name: "Remove color" }).click();
      await expect(u.hexes).toHaveText(["#e63946"]);
      await expect(u.status).toHaveText(STATUS_HINT);

      // 別の色を消しても、コピーした色の表示はそのまま
      await pickColor(page, "#e9c46a");
      await u.swatches.nth(1).locator(".chip").click();
      await expect(u.status).toHaveText("Copied #e9c46a to the clipboard ✓");
      await u.swatches.nth(0).getByRole("button", { name: "Remove color" }).click();
      await expect(u.hexes).toHaveText(["#e9c46a"]);
      await expect(u.status).toHaveText("Copied #e9c46a to the clipboard ✓");

      // clear all
      await u.clearAll.click();
      await expect(u.swatches).toHaveCount(0);
      await expect(u.empty).toBeVisible();
      await expect(u.heading).toHaveText("Palette (0)");
      await expect(u.status).toHaveText(STATUS_EMPTY);
      await expect(u.clearAll).toBeDisabled();
      expect(await stored(page)).toEqual([]);

      expect(errors).toEqual([]);
    });
  });

  // load-before-bind clobber の回帰(state-cross-tab-todo と同じ契約)。
  // value は双方向メンバなので、初期同期を state 側に任せると seed の null が
  // 書き戻されて永続パレットが消える。#init=element がそれを防ぐ。
  test("パレットはリロードをまたいで残り、消した結果も残る", async ({ page }) => {
    const errors = collectErrors(page);
    await openWith(page);
    const u = ui(page);

    await pickColor(page, "#e63946");
    await pickColor(page, "#6c63ff");
    await pickColor(page, "#f72585");
    await expect(u.hexes).toHaveText(["#e63946", "#6c63ff", "#f72585"]);

    await page.reload();
    await expect(u.hexes).toHaveText(["#e63946", "#6c63ff", "#f72585"]);
    await expect(u.heading).toHaveText("Palette (3)");
    expect(await stored(page)).toEqual([{ hex: "#e63946" }, { hex: "#6c63ff" }, { hex: "#f72585" }]);

    await u.swatches.nth(0).getByRole("button", { name: "Remove color" }).click();
    await expect(u.hexes).toHaveText(["#6c63ff", "#f72585"]);
    await page.reload();
    await expect(u.hexes).toHaveText(["#6c63ff", "#f72585"]);

    // 2 回読み込み直しても、拾い足しは続きに並ぶ
    await pickColor(page, "#2a9d8f");
    await expect(u.hexes).toHaveText(["#6c63ff", "#f72585", "#2a9d8f"]);

    expect(errors).toEqual([]);
  });

  test("同じオリジンの別ページ(別タブ)へ storage イベントで同期する", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const errorsA = collectErrors(pageA);
    const errorsB = collectErrors(pageB);
    await openWith(pageA);
    await openWith(pageB);
    await expect(ui(pageB).empty).toBeVisible();

    await pickColor(pageA, "#264653");
    await expect(ui(pageA).hexes).toHaveText(["#264653"]);
    await expect(ui(pageB).hexes).toHaveText(["#264653"]);
    await expect(ui(pageB).status).toHaveText(STATUS_HINT);

    // 逆向き: B で足した色が A に届く
    await pickColor(pageB, "#f4a261");
    await expect(ui(pageA).hexes).toHaveText(["#264653", "#f4a261"]);

    // B で clear all → A も空
    await ui(pageB).clearAll.click();
    await expect(ui(pageA).empty).toBeVisible();
    await expect(ui(pageA).swatches).toHaveCount(0);

    expect(errorsA).toEqual([]);
    expect(errorsB).toEqual([]);
  });

  test("color input でも色を足せる(EyeDropper がある環境でも)", async ({ page }) => {
    const errors = collectErrors(page);
    await openWith(page);
    const u = ui(page);

    await u.manual.fill("#123456");
    await expect(u.hexes).toHaveText(["#123456"]);
    await pickColor(page, "#e63946");
    await expect(u.hexes).toHaveText(["#123456", "#e63946"]);

    expect(errors).toEqual([]);
  });

  // 行の `style.backgroundColor: .hex`。3.x は style[prop] への代入で camelCase を受け、
  // @wcstack/eyedropper の README も同じ書き方をしている。
  // 4.0.0-rc.6 の不具合の回帰: 4.0 は style.setProperty(name, v) だけで書いていたので、
  // camelCase の名前は黙って無視されていた(kebab-case の style.background-color は塗られた)。
  test("スウォッチの chip がその行の hex の色で塗られ、行が動けば色も動く", async ({ page }) => {
    const errors = collectErrors(page);
    await openWith(page);
    const u = ui(page);
    const chip = (i: number) => u.swatches.nth(i).locator(".chip");

    await pickColor(page, "#e63946");
    await pickColor(page, "#2a9d8f");
    await u.manual.fill("#123456");
    await expect(u.hexes).toHaveText(["#e63946", "#2a9d8f", "#123456"]);
    await expect(chip(0)).toHaveCSS("background-color", "rgb(230, 57, 70)");
    await expect(chip(1)).toHaveCSS("background-color", "rgb(42, 157, 143)");
    await expect(chip(2)).toHaveCSS("background-color", "rgb(18, 52, 86)");

    // 先頭を拾い直して末尾へ → 位置ごとの色も入れ替わる
    await pickColor(page, "#e63946");
    await expect(u.hexes).toHaveText(["#2a9d8f", "#123456", "#e63946"]);
    await expect(chip(0)).toHaveCSS("background-color", "rgb(42, 157, 143)");
    await expect(chip(2)).toHaveCSS("background-color", "rgb(230, 57, 70)");

    expect(errors).toEqual([]);
  });

  test("EyeDropper の無いブラウザでは Pick ボタンを隠して案内を出し、color input で足す", async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => { delete (window as any).EyeDropper; });
    await page.goto(PAGE);
    const u = ui(page);

    await expect(u.unsupportedNote).toBeVisible();
    await expect(u.unsupportedNote).toContainText("EyeDropper API is Chromium-only");
    await expect(u.pick).toBeHidden();
    await expect(u.status).toHaveText(STATUS_EMPTY);

    await u.manual.fill("#2a9d8f");
    await expect(u.hexes).toHaveText(["#2a9d8f"]);
    await u.manual.fill("#e9c46a");
    await expect(u.hexes).toHaveText(["#2a9d8f", "#e9c46a"]);
    expect(await stored(page)).toEqual([{ hex: "#2a9d8f" }, { hex: "#e9c46a" }]);

    expect(errors).toEqual([]);
  });
});
