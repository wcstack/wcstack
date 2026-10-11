import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// examples/state-pomodoro の実ブラウザテスト。
//
// デモの内容: <wcs-timer interval="1000" manual> は 1 秒のメトロノームで、tick
// （detail { count, elapsed }）を event-token で state へ流し、ポモドーロの状態機械
// (focus → break → focus)は state 側の $on.timerTick にある。<wcs-wakelock> は
// `active: keepAwake`（running かつ focus のときだけ true）で画面の起床を要求し、
// 実際の保持は `held` で読み返す。セッションの終わりに <wcs-notify> の notify
// コマンドで通知を出し、その通知のクリック(eventToken.clicked)が次のセッションを
// 始める。通知の許可は <wcs-notify> 自身が監視し、未許可ならバナーを出す。
//
// このスペックが固定するもの:
// - start / pause / resume / reset と残り時間・進捗バー・ボタンの出し分け
// - focus → break → focus の切り替え、完了数、セッション終了ごとの通知 1 件
// - 通知のクリックで次のセッションが始まること
// - wake lock は focus が走っている間だけ要求され(pause・break・reset で解放)、
//   pill は要求ではなく held(OS の事実)を映すこと。前半は state の属性ミラーの回帰
//   (そのテストのコメント参照)
// - 通知の許可バナー(prompt → Enable → 許可、denied ではセッションだけ回る)
//
// プラットフォーム API の与え方:
// - 時間は page.clock。goto の前に install し、ページの準備ができたら pauseAt で
//   止めて、以降は runFor で進める(<wcs-timer> の setInterval と Date.now が
//   どちらも偽の時計で動く)。デモ用の 6 秒 / 3 秒の選択肢を使う。
// - navigator.wakeLock は addInitScript で差し替え、request / release / OS による
//   解放を記録する。拒否(NotAllowedError)と、応答を保留するモードも持たせる。
// - window.Notification は addInitScript で差し替え、生成された通知を記録する。
//   許可状態は Playwright のコンテキスト権限(本物の Permissions API)で与え、
//   prompt のときの requestPermission は「ユーザーの選択」を exposeFunction 経由で
//   本物の権限へ反映する(state-notification-chat.spec.ts と同じ形)。
const PAGE = "/examples/state-pomodoro/";
const T0 = new Date("2026-10-07T09:00:00+09:00");

const INSTALL_FAKE_WAKELOCK = () => {
  const log: string[] = [];
  let live: any = null;
  let pending: ((s: any) => void) | null = null;
  class FakeSentinel extends EventTarget {
    released = false;
    type = "screen";
    onrelease: ((e: Event) => void) | null = null;
    release(): Promise<void> {
      if (!this.released) {
        this.released = true;
        log.push("release");
        if (live === this) live = null;
        this.dispatchEvent(new Event("release"));
        this.onrelease?.(new Event("release"));
      }
      return Promise.resolve();
    }
  }
  const wakeLock = {
    request(type = "screen"): Promise<any> {
      log.push("request:" + type);
      const mode = (window as any).__wakeLockMode ?? "grant";
      if (mode === "deny") {
        return Promise.reject(new DOMException("Wake Lock permission request denied", "NotAllowedError"));
      }
      const sentinel = new FakeSentinel();
      if (mode === "pending") {
        return new Promise((resolve) => {
          pending = () => { live = sentinel; resolve(sentinel); };
        });
      }
      live = sentinel;
      return Promise.resolve(sentinel);
    },
  };
  Object.defineProperty(navigator, "wakeLock", { configurable: true, get: () => wakeLock });
  (window as any).__wakeLog = log;
  // 保留中の request に OS が応える
  (window as any).__grantPendingWakeLock = () => {
    const p = pending;
    pending = null;
    p?.(null);
  };
  // OS が自分の都合で解放する(省電力など。ページは見えたまま)
  (window as any).__osReleaseWakeLock = () => {
    const s = live;
    if (!s || s.released) return;
    s.released = true;
    live = null;
    log.push("os-release");
    s.dispatchEvent(new Event("release"));
  };
};

const INSTALL_FAKE_NOTIFICATION = () => {
  const shown: any[] = [];
  let requests = 0;
  let current = "default";
  class FakeNotification extends EventTarget {
    title: string;
    body: string;
    tag: string;
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
      shown.push(this);
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

async function open(page: Page, context: BrowserContext,
  { demoDurations = true, wakeLockMode = "grant" }: { demoDurations?: boolean; wakeLockMode?: "grant" | "deny" } = {}) {
  await page.exposeFunction("__decideNotificationPermission", async (decision: string) => {
    await context.grantPermissions(decision === "granted" ? ["notifications"] : []);
  });
  await page.addInitScript(INSTALL_FAKE_WAKELOCK);
  // 読み込み時点の OS の応え方(以降はテストが __wakeLockMode を切り替える)
  await page.addInitScript((mode) => { (window as any).__wakeLockMode = mode; }, wakeLockMode);
  await page.addInitScript(INSTALL_FAKE_NOTIFICATION);
  await page.clock.install({ time: T0 });
  await page.goto(PAGE);
  const u = ui(page);
  // 初期値 25 分。ここまで描けていればページの準備はできている
  await expect(u.clock).toHaveText("25:00");
  // 以降の時間はテストが runFor で進める
  await page.clock.pauseAt(new Date(T0.getTime() + 60_000));
  if (demoDurations) {
    await u.focusSelect.selectOption("0.1");   // 6 sec (demo)
    await u.breakSelect.selectOption("0.05");  // 3 sec (demo)
    await expect(u.clock).toHaveText("00:06");
  }
  return u;
}

function ui(page: Page) {
  const pills = page.locator(".pills .pill");
  return {
    mode: pills.nth(0),
    status: page.getByRole("status"),
    wake: pills.nth(2),
    clock: page.locator(".clock"),
    bar: page.locator(".bar-fill"),
    start: page.getByRole("button", { name: /Start/ }),
    pause: page.getByRole("button", { name: /Pause/ }),
    resume: page.getByRole("button", { name: /Resume/ }),
    reset: page.getByRole("button", { name: /Reset/ }),
    focusSelect: page.getByLabel("Focus"),
    breakSelect: page.getByLabel("Break"),
    tomatoes: page.locator(".tally b"),
    completed: page.locator(".tally span"),
    bannerSection: page.locator("section").nth(1),
    banner: page.locator(".banner"),
    enable: page.getByRole("button", { name: /Enable/ }),
  };
}

const wakeLog = (page: Page) => page.evaluate(() => [...(window as any).__wakeLog]);
const shownNotifications = (page: Page) =>
  page.evaluate(() => (window as any).__notifications.map((n: any) => ({ title: n.title, tag: n.tag, body: n.body })));
const barWidth = (page: Page) => page.locator(".bar-fill").evaluate((el) => (el as HTMLElement).style.width);


test.describe("examples/state-pomodoro", () => {
  test.describe("通知が許可済みのコンテキスト", () => {
    test.use({ permissions: ["notifications"] });

    test("start で 1 秒ごとに残り時間と進捗が進み、pause で止まり resume で続きから数える", async ({ page, context }) => {
      const errors = collectErrors(page);
      const u = await open(page, context);

      await expect(u.mode).toHaveText("🍅 focus");
      await expect(u.mode).toHaveClass(/\bfocus\b/);
      await expect(u.status).toHaveText("Ready — press start");
      await expect(u.start).toBeVisible();
      await expect(u.pause).toBeHidden();
      await expect(u.resume).toBeHidden();
      await expect(u.focusSelect).toBeEnabled();
      await expect(u.breakSelect).toBeEnabled();
      expect(await barWidth(page)).toBe("0%");
      // 許可済みなのでバナーは出ない
      await expect(u.bannerSection).toBeHidden();

      await u.start.click();
      await expect(u.status).toHaveText("Focusing…");
      await expect(u.start).toBeHidden();
      await expect(u.pause).toBeVisible();
      await expect(u.focusSelect).toBeDisabled();
      await expect(u.breakSelect).toBeDisabled();
      // まだ 1 秒経っていない
      await expect(u.clock).toHaveText("00:06");

      await page.clock.runFor(1000);
      await expect(u.clock).toHaveText("00:05");
      expect(await barWidth(page)).toBe("16.7%");   // 1/6
      await page.clock.runFor(1000);
      await expect(u.clock).toHaveText("00:04");
      expect(await barWidth(page)).toBe("33.3%");   // 2/6

      await u.pause.click();
      await expect(u.status).toHaveText("Paused");
      await expect(u.clock).toHaveClass(/\bpaused\b/);
      await expect(u.pause).toBeHidden();
      await expect(u.resume).toBeVisible();
      await expect(u.start).toBeHidden();
      await expect(u.focusSelect).toBeDisabled();

      // 止まっている間は時間が進んでも残り時間は動かない
      await page.clock.runFor(5000);
      await expect(u.clock).toHaveText("00:04");

      // resume で続きから数える
      await u.resume.click();
      await expect(u.status).toHaveText("Focusing…");
      await expect(u.clock).not.toHaveClass(/\bpaused\b/);
      await expect(u.resume).toBeHidden();
      await expect(u.pause).toBeVisible();
      await page.clock.runFor(1000);
      await expect(u.clock).toHaveText("00:03");
      expect(await barWidth(page)).toBe("50%");     // 3/6

      expect(await shownNotifications(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test("focus が終わると break へ切り替わって通知が出て、通知のクリックが次のセッションを始める", async ({ page, context }) => {
      const errors = collectErrors(page);
      const u = await open(page, context);

      await u.start.click();
      await page.clock.runFor(5000);
      await expect(u.clock).toHaveText("00:01");
      await page.clock.runFor(1000);

      // focus 完了 → break(自動では始まらない)
      await expect(u.mode).toHaveText("☕ break");
      await expect(u.mode).toHaveClass(/\bbreak\b/);
      await expect(u.clock).toHaveText("00:03");
      await expect(u.status).toHaveText("Ready — press start");
      await expect(u.start).toBeVisible();
      await expect(u.completed).toHaveText("1");
      await expect(u.tomatoes).toHaveText("🍅");
      await expect(u.bar).toHaveClass(/\bbreak\b/);
      expect(await barWidth(page)).toBe("0%");

      // セッション終了の通知が 1 件
      await expect.poll(() => shownNotifications(page)).toHaveLength(1);
      const [first] = await shownNotifications(page);
      expect(first.title).toBe("Focus session complete! ☕");
      expect(first.tag).toBe("wcs-pomodoro");
      expect(first.body).toContain("break");

      // 時間が進んでも break は勝手に始まらない
      await page.clock.runFor(5000);
      await expect(u.status).toHaveText("Ready — press start");
      await expect(u.clock).toHaveText("00:03");

      // 通知のクリック → eventToken.clicked → break を開始
      await page.evaluate(() => (window as any).__notifications[0].dispatchEvent(new Event("click")));
      await expect(u.status).toHaveText("On break…");
      await expect(u.pause).toBeVisible();

      await page.clock.runFor(2000);
      await expect(u.clock).toHaveText("00:01");
      await page.clock.runFor(1000);

      // break 完了 → focus へ戻る。完了数は focus だけを数える
      await expect(u.mode).toHaveText("🍅 focus");
      await expect(u.clock).toHaveText("00:06");
      await expect(u.completed).toHaveText("1");
      await expect.poll(() => shownNotifications(page)).toHaveLength(2);
      const second = (await shownNotifications(page))[1];
      expect(second.title).toBe("Break is over! 🍅");
      // tag は一定(OS は前の通知を置き換える)
      expect(second.tag).toBe("wcs-pomodoro");

      // 2 件目のクリックで次の focus が始まる
      await page.evaluate(() => (window as any).__notifications[1].dispatchEvent(new Event("click")));
      await expect(u.status).toHaveText("Focusing…");
      await page.clock.runFor(6000);
      await expect(u.completed).toHaveText("2");
      await expect(u.tomatoes).toHaveText("🍅🍅");
      await expect(u.mode).toHaveText("☕ break");
      await expect.poll(() => shownNotifications(page)).toHaveLength(3);

      expect(errors).toEqual([]);
    });

    test("走っている間の通知クリックは何もしない(次のセッションは止まっているときだけ始まる)", async ({ page, context }) => {
      const errors = collectErrors(page);
      const u = await open(page, context);

      await u.start.click();
      await page.clock.runFor(6000);
      await expect(u.mode).toHaveText("☕ break");
      await expect.poll(() => shownNotifications(page)).toHaveLength(1);

      // break をボタンで始めてから、古い通知をクリックする
      await u.start.click();
      await expect(u.status).toHaveText("On break…");
      await page.clock.runFor(1000);
      await expect(u.clock).toHaveText("00:02");
      await page.evaluate(() => (window as any).__notifications[0].dispatchEvent(new Event("click")));
      // 走っている timer はそのまま(やり直しにならない)
      await page.clock.runFor(1000);
      await expect(u.clock).toHaveText("00:01");
      await expect(u.status).toHaveText("On break…");

      expect(errors).toEqual([]);
    });

    test("reset で走行中・一時停止中のセッションを止めて巻き戻す", async ({ page, context }) => {
      const errors = collectErrors(page);
      const u = await open(page, context);

      await u.start.click();
      await page.clock.runFor(2000);
      await expect(u.clock).toHaveText("00:04");

      await u.reset.click();
      await expect(u.status).toHaveText("Ready — press start");
      await expect(u.clock).toHaveText("00:06");
      expect(await barWidth(page)).toBe("0%");
      await expect(u.start).toBeVisible();
      await expect(u.pause).toBeHidden();
      await expect(u.focusSelect).toBeEnabled();
      // 止まっている(時間が進んでも減らない)
      await page.clock.runFor(5000);
      await expect(u.clock).toHaveText("00:06");

      // 一時停止中の reset も、paused を解いて巻き戻す
      await u.start.click();
      await page.clock.runFor(1000);
      await u.pause.click();
      await expect(u.status).toHaveText("Paused");
      await u.reset.click();
      await expect(u.status).toHaveText("Ready — press start");
      await expect(u.clock).toHaveText("00:06");
      await expect(u.clock).not.toHaveClass(/\bpaused\b/);
      await expect(u.resume).toBeHidden();
      await expect(u.start).toBeVisible();

      // reset 後の start は最初から数える
      await u.start.click();
      await page.clock.runFor(1000);
      await expect(u.clock).toHaveText("00:05");
      await expect(u.completed).toHaveText("0");

      expect(await shownNotifications(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    // README / デモの約束: 「the screen stays awake only while you focus」。
    // keepAwake(running かつ focus)が false の間は wake lock を要求せず、保持もしない。
    // 4.0.0-rc.6 の不具合の回帰: state は inputs[].attribute のミラーで boolean の false を
    // active="false" と書き、<wcs-wakelock> の active は属性の有無で真偽を決めるので、
    // 読み込み直後と false に戻した直後に要求が出て保持され続けていた(3.x も false に
    // 戻したときは同じ。4.0 は初期適用でもミラーするので読み込み直後から)。今の state は
    // プロパティだけを書き、属性は <wcs-wakelock> の setter が反映する。
    test("wake lock は focus が走っている間だけ保持する(読み込み直後・pause・reset・break では保持しない)", async ({ page, context }) => {
      const errors = collectErrors(page);
      const u = await open(page, context);

      // 読み込み直後: keepAwake は false。要求していない
      await expect(u.status).toHaveText("Ready — press start");
      expect(await wakeLog(page)).toEqual([]);
      await expect(u.wake).toHaveText("screen: normal");
      await expect(u.wake).not.toHaveClass(/\bawake\b/);

      // focus を開始 → 要求 1 回、held が返って pill が変わる
      await u.start.click();
      await expect(u.wake).toHaveText("screen: kept awake");
      await expect(u.wake).toHaveClass(/\bawake\b/);
      expect(await wakeLog(page)).toEqual(["request:screen"]);

      // pause → 解放(要求し直さない)
      await u.pause.click();
      await expect(u.status).toHaveText("Paused");
      await expect(u.wake).toHaveText("screen: normal");
      expect(await wakeLog(page)).toEqual(["request:screen", "release"]);

      // resume → 再取得
      await u.resume.click();
      await expect(u.wake).toHaveText("screen: kept awake");
      expect(await wakeLog(page)).toEqual(["request:screen", "release", "request:screen"]);

      // reset → 解放
      await u.reset.click();
      await expect(u.wake).toHaveText("screen: normal");
      expect(await wakeLog(page)).toEqual(["request:screen", "release", "request:screen", "release"]);

      // focus を最後まで走らせる → 終わったところで解放、break では要求しない
      await u.start.click();
      await expect(u.wake).toHaveText("screen: kept awake");
      await page.clock.runFor(6000);
      await expect(u.mode).toHaveText("☕ break");
      await expect(u.wake).toHaveText("screen: normal");
      await u.start.click();
      await expect(u.status).toHaveText("On break…");
      await page.clock.runFor(1000);
      await expect(u.wake).toHaveText("screen: normal");
      expect(await wakeLog(page)).toEqual([
        "request:screen", "release", "request:screen", "release", "request:screen", "release",
      ]);

      expect(errors).toEqual([]);
    });

    test("pill は要求ではなく held を映す(OS の拒否・OS による解放と取り直し)", async ({ page, context }) => {
      const errors = collectErrors(page);
      // wake lock を拒否する環境(読み込みの時点から)
      const u = await open(page, context, { wakeLockMode: "deny" });
      const requests = async () => (await wakeLog(page)).filter((x) => x.startsWith("request")).length;

      // OS が拒否: focus が走っていても held にならない
      const before = await requests();
      await u.start.click();
      await expect(u.status).toHaveText("Focusing…");
      await expect.poll(requests).toBe(before + 1);
      await page.clock.runFor(1000);
      await expect(u.clock).toHaveText("00:05");
      await expect(u.wake).toHaveText("screen: normal");
      await expect(u.wake).not.toHaveClass(/\bawake\b/);

      // 保持できる環境で走り直す
      await u.reset.click();
      await page.evaluate(() => { (window as any).__wakeLockMode = "grant"; });
      await u.start.click();
      await expect(u.wake).toHaveText("screen: kept awake");

      // OS が(ページは見えたまま)解放 → held が落ち、要求は生きているので取り直す。
      // 取り直しの応答を保留して、その間の pill を見る
      await page.evaluate(() => { (window as any).__wakeLockMode = "pending"; });
      const beforeRelease = await requests();
      await page.evaluate(() => (window as any).__osReleaseWakeLock());
      await expect(u.wake).toHaveText("screen: normal");
      await expect(u.status).toHaveText("Focusing…");
      await expect.poll(requests).toBe(beforeRelease + 1);
      await page.evaluate(() => (window as any).__grantPendingWakeLock());
      await expect(u.wake).toHaveText("screen: kept awake");

      expect(errors).toEqual([]);
    });
  });

  test.describe("通知の許可が prompt のコンテキスト", () => {
    test("バナーと Enable を出し、Enable → 許可でバナーが消える", async ({ page, context }) => {
      const errors = collectErrors(page);
      const u = await open(page, context, { demoDurations: false });

      await expect(u.bannerSection).toBeVisible();
      await expect(u.banner).not.toHaveClass(/\bdenied\b/);
      await expect(u.banner).toContainText("Enable notifications to get pinged when a session ends");
      await expect(u.enable).toBeVisible();

      await page.evaluate(() => { (window as any).__notifyDecision = "granted"; });
      await u.enable.click();
      await expect(u.bannerSection).toBeHidden();
      expect(await page.evaluate(() => (window as any).__notificationRequests())).toBe(1);

      expect(errors).toEqual([]);
    });
  });

  test.describe("通知がブロックされたコンテキスト", () => {
    test.use({ permissions: [] });

    test("ブロック中のバナーを出し(Enable は無い)、セッションは通知なしで回る", async ({ page, context }) => {
      const errors = collectErrors(page);
      const u = await open(page, context);

      await expect(u.bannerSection).toBeVisible();
      await expect(u.banner).toHaveClass(/\bdenied\b/);
      await expect(u.banner).toContainText("Notifications are blocked — sessions still work, you just won't be notified.");
      await expect(u.enable).toBeHidden();

      await u.start.click();
      await page.clock.runFor(6000);
      await expect(u.mode).toHaveText("☕ break");
      await expect(u.completed).toHaveText("1");
      // notify コマンドは届くが、許可が無いので通知は作られない
      await expect.poll(() => page.evaluate(() => (document.querySelector("wcs-notify") as any).error?.error))
        .toBe("not-granted");
      expect(await shownNotifications(page)).toEqual([]);

      expect(errors).toEqual([]);
    });
  });
});
