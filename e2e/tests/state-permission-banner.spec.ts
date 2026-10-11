import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// examples/state-permission-banner の実ブラウザテスト。
//
// デモの内容: <wcs-permission name="geolocation"> が geolocation の許可状態を
// state / granted / prompt / denied / unsupported として state へ流し（監視のみ・
// コマンド無し）、<wcs-geo manual> が command-token（$command.locate）で位置を
// 取得して latitude / longitude / loading を state へ返す。バナーは `hidden: granted`
// だけで出し分け、文言・pill・ボタンの無効化はすべて派生 getter。
//
// このスペックが固定するもの:
// - 4 つの許可状態（prompt / granted / denied / unsupported）ごとのバナー・pill・ボタン
// - Permissions API の live `change` 追従: リロード無しで許可の付与・取り消しが
//   バナーへ届くこと（README の「設定で許可を変えるとリロード無しで更新」）
// - command-token → getCurrentPosition → 座標（小数 4 桁）と取得中の表示
//
// プラットフォーム API の与え方:
// - 許可状態は Playwright のコンテキスト権限で与える（本物の Permissions API）。
//   headless Chromium は `permissions` 未指定なら geolocation を "prompt" と報告し、
//   `permissions: []` なら "denied"、grantPermissions / clearPermissions で
//   PermissionStatus の change が実際に発火する。
// - 位置は Playwright の geolocation エミュレーション（本物の Geolocation API）。
//   "prompt" のまま getCurrentPosition を呼ぶと、headless はプロンプトを出せず
//   即座に PERMISSION_DENIED（code 1）で終わる（ユーザーが閉じたのと同じ）。
// - 「取得中」を観測するテストだけ、getCurrentPosition を addInitScript で
//   ゲートし、テストが開けるまで本物の呼び出しを保留する。
// - unsupported は navigator.permissions を addInitScript で消して作る。
const PAGE = "/examples/state-permission-banner/";

// 東京駅。toFixed(4) で 35.6812, 139.7671 に丸まる桁を持たせる。
const TOKYO = { latitude: 35.681236, longitude: 139.767125 };
// 大阪駅。2 回目の取得で値が入れ替わることを見る。
const OSAKA = { latitude: 34.702485, longitude: 135.495951 };

const PROMPT_TEXT = "This demo would like your location. Click “Locate me” to allow.";
const DENIED_TEXT = "Location is blocked. Enable it in your browser's site settings to continue.";
const UNSUPPORTED_TEXT = "The Permissions API is not available in this browser.";

function ui(page: Page) {
  // section[0] がバナー、section[1] が pill / ボタン / 座標 / ステータス。
  const banner = page.locator("section").first();
  return {
    bannerSection: banner,
    banner: banner.locator(".banner"),
    pill: page.locator(".pill"),
    button: page.getByRole("button", { name: /Locate me/ }),
    coords: page.locator(".coords"),
    status: page.locator(".status"),
  };
}

async function expectPill(page: Page, state: "prompt" | "granted" | "denied" | "unsupported") {
  const { pill } = ui(page);
  await expect(pill).toHaveText(state);
  // pill のクラスは 4 状態のうち 1 つだけ
  for (const s of ["prompt", "granted", "denied", "unsupported"]) {
    if (s === state) await expect(pill).toHaveClass(new RegExp(`\\b${s}\\b`));
    else await expect(pill).not.toHaveClass(new RegExp(`\\b${s}\\b`));
  }
}

test.describe("examples/state-permission-banner", () => {
  test.describe("許可が prompt のコンテキスト", () => {
    test.use({ geolocation: TOKYO });

    test("prompt ではバナーを出し、許可の付与・取り消しがリロード無しでバナーへ届く", async ({ page, context }) => {
      const errors = collectErrors(page);
      await page.goto(PAGE);
      const u = ui(page);

      await expect(u.bannerSection).toBeVisible();
      await expect(u.banner).toHaveClass(/\bprompt\b/);
      await expect(u.banner).toHaveText(PROMPT_TEXT);
      await expectPill(page, "prompt");
      await expect(u.button).toBeEnabled();
      await expect(u.coords).toHaveText("—");
      await expect(u.status).toHaveText("Idle.");

      // prompt のまま Locate → headless はプロンプトを閉じた扱い(PERMISSION_DENIED)。
      // 取得は失敗し、loading は戻り、許可状態は prompt のまま。
      await page.evaluate(() => {
        const codes: number[] = [];
        (window as any).__geoErrorCodes = codes;
        document.querySelector("wcs-geo")!.addEventListener("wcs-geo:error", (e) => {
          const d = (e as CustomEvent).detail;
          if (d) codes.push(d.code);
        });
      });
      await u.button.click();
      await expect.poll(() => page.evaluate(() => (window as any).__geoErrorCodes)).toEqual([1]);
      await expect(u.status).toHaveText("Idle.");
      await expect(u.coords).toHaveText("—");
      await expectPill(page, "prompt");

      // ブラウザ側で許可 → PermissionStatus の change → バナーが消える
      await context.grantPermissions(["geolocation"]);
      await expect(u.bannerSection).toBeHidden();
      await expectPill(page, "granted");

      await u.button.click();
      await expect(u.coords).toHaveText("35.6812, 139.7671");
      await expect(u.status).toHaveText("Position acquired.");

      // 許可を取り消す(prompt へ戻る)→ バナーが prompt の文言で戻る
      await context.clearPermissions();
      await expect(u.bannerSection).toBeVisible();
      await expect(u.banner).toHaveClass(/\bprompt\b/);
      await expect(u.banner).toHaveText(PROMPT_TEXT);
      await expectPill(page, "prompt");
      // 取得済みの座標は許可状態とは独立に残る
      await expect(u.coords).toHaveText("35.6812, 139.7671");

      expect(errors).toEqual([]);
    });
  });

  test.describe("許可が granted のコンテキスト", () => {
    test.use({ permissions: ["geolocation"], geolocation: TOKYO });

    test("granted ではバナーを出さず、Locate me で座標を取得する(再取得で値が変わる)", async ({ page, context }) => {
      const errors = collectErrors(page);
      await page.goto(PAGE);
      const u = ui(page);

      await expectPill(page, "granted");
      await expect(u.bannerSection).toBeHidden();
      await expect(u.button).toBeEnabled();
      // manual なので接続時には取得しない
      await expect(u.coords).toHaveText("—");
      await expect(u.status).toHaveText("Idle.");

      await u.button.click();
      await expect(u.coords).toHaveText("35.6812, 139.7671");
      await expect(u.status).toHaveText("Position acquired.");

      // デバイスが移動した後のもう 1 回の取得で値が置き換わる
      await context.setGeolocation(OSAKA);
      await u.button.click();
      await expect(u.coords).toHaveText("34.7025, 135.4960");
      await expect(u.status).toHaveText("Position acquired.");

      expect(errors).toEqual([]);
    });

    test("取得中は Acquiring position… を出し、位置が届くと Position acquired. になる", async ({ page }) => {
      const errors = collectErrors(page);
      // 本物の getCurrentPosition をテストが開けるまで保留するゲート
      await page.addInitScript(() => {
        const real = Geolocation.prototype.getCurrentPosition;
        const pending: Array<() => void> = [];
        Geolocation.prototype.getCurrentPosition = function (this: Geolocation, ...args: any[]) {
          pending.push(() => (real as any).apply(this, args));
        } as any;
        (window as any).__releaseGeo = () => {
          const n = pending.length;
          pending.splice(0).forEach((run) => run());
          return n;
        };
      });
      await page.goto(PAGE);
      const u = ui(page);
      await expectPill(page, "granted");

      await u.button.click();
      await expect(u.status).toHaveText("Acquiring position…");
      await expect(u.coords).toHaveText("—");

      // ちょうど 1 回の取得要求が出ている
      expect(await page.evaluate(() => (window as any).__releaseGeo())).toBe(1);
      await expect(u.coords).toHaveText("35.6812, 139.7671");
      await expect(u.status).toHaveText("Position acquired.");

      expect(errors).toEqual([]);
    });
  });

  test.describe("許可が denied のコンテキスト", () => {
    test.use({ permissions: [], geolocation: TOKYO });

    test("denied ではブロック中のバナーとボタンの無効化、設定で許可すると解除される", async ({ page, context }) => {
      const errors = collectErrors(page);
      await page.goto(PAGE);
      const u = ui(page);

      await expectPill(page, "denied");
      await expect(u.bannerSection).toBeVisible();
      await expect(u.banner).toHaveClass(/\bdenied\b/);
      await expect(u.banner).not.toHaveClass(/\bprompt\b/);
      await expect(u.banner).toHaveText(DENIED_TEXT);
      await expect(u.button).toBeDisabled();
      await expect(u.coords).toHaveText("—");

      // サイト設定で許可した(live change)→ リロード無しでバナーが消え、ボタンが戻る
      await context.grantPermissions(["geolocation"]);
      await expectPill(page, "granted");
      await expect(u.bannerSection).toBeHidden();
      await expect(u.button).toBeEnabled();

      await u.button.click();
      await expect(u.coords).toHaveText("35.6812, 139.7671");

      expect(errors).toEqual([]);
    });
  });

  test.describe("Permissions API の無い環境", () => {
    test.use({ permissions: ["geolocation"], geolocation: TOKYO });

    test("navigator.permissions が無ければ unsupported を表示し、位置の取得は動き続ける", async ({ page }) => {
      const errors = collectErrors(page);
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "permissions", {
          configurable: true,
          get: () => undefined,
        });
      });
      await page.goto(PAGE);
      const u = ui(page);

      await expectPill(page, "unsupported");
      // granted ではないのでバナーは出たまま、文言は unsupported
      await expect(u.bannerSection).toBeVisible();
      await expect(u.banner).toHaveClass(/\bunsupported\b/);
      await expect(u.banner).toHaveText(UNSUPPORTED_TEXT);
      // denied ではないのでボタンは押せる
      await expect(u.button).toBeEnabled();

      // 監視ノードが unsupported でも、取得ノードは Geolocation API で位置を取れる
      await u.button.click();
      await expect(u.coords).toHaveText("35.6812, 139.7671");
      await expect(u.status).toHaveText("Position acquired.");

      expect(errors).toEqual([]);
    });
  });
});
