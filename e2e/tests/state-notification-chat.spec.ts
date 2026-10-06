import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// examples/state-notification-chat の実ブラウザテスト。
//
// デモの内容: <wcs-notify> 1 つで双方向 —— state の command-token（$command.notify）
// でデスクトップ通知を出し、通知のクリックを event-token（eventToken.clicked: opened）
// で state へ戻す。許可は <wcs-notify> の request コマンドで取りに行き、隣の
// <wcs-permission name="notifications"> が許可状態を監視してバナーを出し分ける。
//
// このスペックが固定するもの:
// - Allow → request コマンド → Notification.requestPermission → 許可/拒否/閉じる、
//   それぞれの結果がバナー・pill・ボタンへ届くこと
// - 未許可では Simulate しても通知が出ないこと、許可後はメッセージ 1 件ごとに通知
//   1 件（タイトル・本文・tag が emit の引数どおり）
// - 通知のクリック → event-token → $on.opened → "Last opened: room N"
//
// プラットフォーム API の与え方:
// - 許可状態は Playwright のコンテキスト権限で与える（本物の Permissions API。
//   `permissions` 未指定で "prompt"、`[]` で "denied"、変更で change が発火する）。
// - window.Notification は addInitScript で差し替える。headless では OS 通知を
//   出せず数えられないので、生成された通知をページの配列に記録し、テストが
//   click を発火させる。requestPermission は実ブラウザと同じく、決定済みなら
//   プロンプト無しでその値を返し、prompt のときだけ「ユーザーの選択」
//   (__notifyDecision) を Playwright 側の権限へ反映してから返す
//   (exposeFunction 経由の grantPermissions。PermissionStatus の change も本物)。
const PAGE = "/examples/state-notification-chat/";

const INSTALL_FAKE_NOTIFICATION = () => {
  const shown: any[] = [];
  let requests = 0;
  let current = "default";
  class FakeNotification extends EventTarget {
    title: string;
    body: string;
    tag: string;
    data: unknown;
    onclick: ((e: Event) => void) | null = null;
    onshow: ((e: Event) => void) | null = null;
    onclose: ((e: Event) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    static get permission() { return current; }
    static async requestPermission(): Promise<string> {
      requests++;
      const status = await navigator.permissions.query({ name: "notifications" as PermissionName });
      if (status.state === "granted" || status.state === "denied") {
        current = status.state;
        return current;
      }
      const decision = (window as any).__notifyDecision ?? "default";
      if (decision !== "default") await (window as any).__decideNotificationPermission(decision);
      current = decision;
      return decision;
    }
    constructor(title: string, options: any = {}) {
      super();
      this.title = title;
      this.body = options.body ?? "";
      this.tag = options.tag ?? "";
      this.data = options.data ?? null;
      shown.push(this);
      // 実物と同じく show は非同期に届く
      Promise.resolve().then(() => this.dispatchEvent(new Event("show")));
    }
    dispatchEvent(e: Event): boolean {
      const result = super.dispatchEvent(e);
      (this as any)["on" + e.type]?.call(this, e);
      return result;
    }
    close() { this.dispatchEvent(new Event("close")); }
  }
  (window as any).Notification = FakeNotification;
  (window as any).__notifications = shown;
  (window as any).__notificationRequests = () => requests;
};

async function setup(page: Page, context: BrowserContext) {
  // prompt でのユーザーの選択を、本物の権限の変更として反映する
  await page.exposeFunction("__decideNotificationPermission", async (decision: string) => {
    await context.grantPermissions(decision === "granted" ? ["notifications"] : []);
  });
  await page.addInitScript(INSTALL_FAKE_NOTIFICATION);
  await page.goto(PAGE);
}

const shownNotifications = (page: Page) =>
  page.evaluate(() => (window as any).__notifications.map((n: any) => ({ title: n.title, body: n.body, tag: n.tag })));
const requestCount = (page: Page) => page.evaluate(() => (window as any).__notificationRequests());
const clickNotification = (page: Page, index: number) =>
  page.evaluate((i) => (window as any).__notifications[i].dispatchEvent(new Event("click")), index);

function ui(page: Page) {
  const banner = page.locator("section").first();
  return {
    bannerSection: banner,
    banner: banner.locator(".banner"),
    pill: page.locator(".pill"),
    allow: page.getByRole("button", { name: /Allow notifications/ }),
    send: page.getByRole("button", { name: /Simulate new message/ }),
    log: page.getByRole("log"),
  };
}

const PROMPT_TEXT = "Allow notifications to see new-message alerts.";
const DENIED_TEXT = "Notifications are blocked. Enable them in your browser's site settings.";

test.describe("examples/state-notification-chat", () => {
  test.describe("許可が prompt のコンテキスト", () => {
    test("Allow で許可を求め、許可されるとバナーが消えて通知が出る(未許可の間は出ない)", async ({ page, context }) => {
      const errors = collectErrors(page);
      await setup(page, context);
      const u = ui(page);

      await expect(u.pill).toHaveText("prompt");
      await expect(u.pill).toHaveClass(/\bprompt\b/);
      await expect(u.bannerSection).toBeVisible();
      await expect(u.banner).toHaveClass(/\bprompt\b/);
      await expect(u.banner).toHaveText(PROMPT_TEXT);
      await expect(u.allow).toBeEnabled();
      await expect(u.send).toBeEnabled();
      await expect(u.log).toHaveText("Last opened: —");

      // 未許可で Simulate: notify コマンドは <wcs-notify> に届くが、許可が無いので
      // 通知を作らず error(not-granted)にする
      await u.send.click();
      await expect.poll(() => page.evaluate(() => (document.querySelector("wcs-notify") as any).error?.error))
        .toBe("not-granted");
      expect(await shownNotifications(page)).toEqual([]);

      // Allow → request コマンド → requestPermission → ユーザーが許可
      await page.evaluate(() => { (window as any).__notifyDecision = "granted"; });
      await u.allow.click();
      await expect(u.pill).toHaveText("granted");
      await expect(u.pill).toHaveClass(/\bgranted\b/);
      await expect(u.bannerSection).toBeHidden();
      await expect(u.allow).toBeDisabled();
      expect(await requestCount(page)).toBe(1);

      // 許可後の Simulate で通知が 1 件。メッセージ番号は Simulate の回数を数える
      // (1 回目は未許可で通知されなかったが、メッセージとしては #1 だった)
      await u.send.click();
      await expect.poll(() => shownNotifications(page)).toEqual([
        { title: "New message #2", body: "Tap to open room 2.", tag: "chat-2" },
      ]);

      expect(errors).toEqual([]);
    });

    test("プロンプトを閉じると prompt のまま、ブロックすると denied になり Simulate が無効になる", async ({ page, context }) => {
      const errors = collectErrors(page);
      await setup(page, context);
      const u = ui(page);
      await expect(u.pill).toHaveText("prompt");

      // 閉じた(default)→ 何も変わらない
      await u.allow.click();
      await expect.poll(() => requestCount(page)).toBe(1);
      await expect(u.pill).toHaveText("prompt");
      await expect(u.bannerSection).toBeVisible();
      await expect(u.send).toBeEnabled();

      // ブロック(denied)→ バナーがブロック中の文言に変わり、Simulate が無効になる
      await page.evaluate(() => { (window as any).__notifyDecision = "denied"; });
      await u.allow.click();
      await expect(u.pill).toHaveText("denied");
      await expect(u.pill).toHaveClass(/\bdenied\b/);
      await expect(u.banner).toHaveClass(/\bdenied\b/);
      await expect(u.banner).not.toHaveClass(/\bprompt\b/);
      await expect(u.banner).toHaveText(DENIED_TEXT);
      await expect(u.send).toBeDisabled();
      // granted ではないので Allow は押せたまま(押しても決定済みの denied が返るだけ)
      await expect(u.allow).toBeEnabled();
      expect(await requestCount(page)).toBe(2);

      expect(await shownNotifications(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  });

  test.describe("許可が granted のコンテキスト", () => {
    test.use({ permissions: ["notifications"] });

    test("メッセージごとに通知が 1 件出て、通知のクリックが room を state へ戻す", async ({ page, context }) => {
      const errors = collectErrors(page);
      await setup(page, context);
      const u = ui(page);

      await expect(u.pill).toHaveText("granted");
      await expect(u.bannerSection).toBeHidden();
      await expect(u.allow).toBeDisabled();
      await expect(u.send).toBeEnabled();

      // 命令的な notify コマンドは押すたびに発火する(same-value ガードは無い)
      await u.send.click();
      await u.send.click();
      await u.send.click();
      await expect.poll(() => shownNotifications(page)).toEqual([
        { title: "New message #1", body: "Tap to open room 1.", tag: "chat-1" },
        { title: "New message #2", body: "Tap to open room 2.", tag: "chat-2" },
        { title: "New message #3", body: "Tap to open room 3.", tag: "chat-3" },
      ]);
      // 許可済みなので requestPermission は一度も呼ばれない
      expect(await requestCount(page)).toBe(0);

      // OS 通知のクリック → wcs-notify:click → eventToken.clicked → $on.opened
      await clickNotification(page, 1);
      await expect(u.log).toHaveText("Last opened: room 2");
      await clickNotification(page, 0);
      await expect(u.log).toHaveText("Last opened: room 1");
      await clickNotification(page, 2);
      await expect(u.log).toHaveText("Last opened: room 3");

      expect(errors).toEqual([]);
    });
  });

  test.describe("許可が denied のコンテキスト", () => {
    test.use({ permissions: [] });

    test("ブロック済みならバナーがブロック中の文言で、Simulate は押せない", async ({ page, context }) => {
      const errors = collectErrors(page);
      await setup(page, context);
      const u = ui(page);

      await expect(u.pill).toHaveText("denied");
      await expect(u.banner).toHaveClass(/\bdenied\b/);
      await expect(u.banner).toHaveText(DENIED_TEXT);
      await expect(u.send).toBeDisabled();

      // Allow を押しても、決定済みの denied が返るだけで状態は変わらない
      await u.allow.click();
      await expect.poll(() => requestCount(page)).toBe(1);
      await expect(u.pill).toHaveText("denied");
      expect(await shownNotifications(page)).toEqual([]);

      expect(errors).toEqual([]);
    });
  });
});
