// @ts-nocheck — the bodies are the author's JavaScript tests, kept as written
import { test as base, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { iosSensors, pickers } from "./stamp-rally-standins";

// examples/stamp-rally — みどり市 まち歩きスタンプラリー（継ぎ目アプリ、docs/seam-apps.md の stamp-rally）。歩く人が
// 自分のスマートフォンで開くページ: 機能ごとに 5 つの答えを分ける端末のチェック、入力なしのサインイン（保存した
// パスワード）、画面から拾う色と連絡先から選ぶメンバー、つぎの場所への矢印（北と現在地）、歩数とふってスタンプ、
// 明るさのテーマ、見回せる昔の風景（全画面は横向きで固定、PC ではカーソルの捕捉）、ページをまたいで続く小窓の動画、
// 共有シート、それを <iframe> で見せる市のポータル。初めての作者が 4.24.2 で書き、4.25.0 で要らなくなった回避策を
// 外したもの: 自前の <sr-motion>（<wcs-accelerometer> / <wcs-gyroscope> が devicemotion を読む）と <sr-heading>
// （<wcs-tilt> の heading）、「error 付きの denied は未回答」と読む getter（断られた問いは permissionState を
// 変えない）、手で呼んでいた preventSilentAccess() と手で組んでいた PasswordCredential（<wcs-credential> の
// コマンド）、ambient-light-sensor の <wcs-permission> を囲んでいた if:、globalThis に置いたメモ、ページが自分で
// 読んでいた Permissions-Policy（要素の supported と <wcs-permission> の unsupportedReason）。
//
// この spec は、作者のブラウザのテスト（tests/e2e/*.spec.js の check / iphone / account / walk / spot / portal）を
// 意図として固定する。本文は作者が書いたまま。代役（tests/standins/）は stamp-rally-standins.ts に置いた。
// - 作者は iPhone の代役を WebKit で走らせた。CI には Chromium と Firefox しか無いので、ここでは Chromium で走らせる
//   （IPHONE）。代役は Chromium の Generic Sensor のクラスを取り除き、PC 自身のセンサーのイベントを止める — 要素は
//   iPhone と同じく devicemotion を読む。
// - センサーの読み取りは Chromium の DevTools プロトコルで流す（walk）。
// - WebKit の分岐（AS_IS.webkit、WebKit での skip）は作者のまま残す: このリポジトリの e2e には WebKit の
//   プロジェクトが無いので走らない。
// - @browsers の付いたテストは Firefox でも走る: 端末のチェック、ポータルの 2 つの枠、全画面と横向きの固定、
//   カーソルの捕捉、保存したパスワード、完歩証。
// どのテストも、捕まえられなかったページのエラーで失敗する。consoleClean() はコンソールのエラーと警告が無いこと
// （wcstack の警告を含む）を確かめる。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）でワーカーごとに 8300 + 10 × index のポートで立てる
// （4199–4900 / 5000–5540 / 5700– / 6100– / 7100– / 7300– / 7500– / 7700– / 7900– / 8100– は他の spec）。
// ポータルは localhost ↔ 127.0.0.1 で別のオリジンから埋め込むので、同じポートを両方の名前で使う。
const PORT = 8300 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
/** The browser the iPhone stand-in runs in (the author's: "webkit"; CI has no WebKit). */
const IPHONE = "chromium";

// (a worker runs one test at a time, against its own server and its request log)
base.use({ baseURL: `http://localhost:${PORT}`, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
base.describe.configure({ timeout: 45_000 });

let server: ChildProcess;

base.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/stamp-rally/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("stamp-rally server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Demo server running")) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`stamp-rally server exited with ${code}`)); });
  });
});

base.afterAll(() => {
  server?.kill();
});

// ---------------------------------------------------------------- 作者の fixtures（tests/e2e/fixtures.js）
// Shared fixtures: every test fails on an uncaught page error; `consoleClean()` asserts no console error/warning.

const STANDIN = { ios: iosSensors, pickers };
// Firefox prints these on any deviceorientation/devicemotion listener (friction-log F-11); nothing else is allowed.
// WebKit reports reading document.fullscreenEnabled in a frame that forbids fullscreen as a page error, though
// nothing is thrown (friction-log F-24); it is the one "page error" let through, and only in WebKit.
const KNOWN_WEBKIT_PAGE_ERRORS = [/Permission policy 'Fullscreen' check failed for document with origin/];
// The portal page's own allow attribute lists features some browsers do not know (the city's markup, not the app's).
const PORTAL_ALLOW_WARNINGS = [/^Unrecognized feature: '/, /Feature Policy: Skipping unsupported feature name/];
const KNOWN_BROWSER_WARNINGS = [/^\[JavaScript Warning: "Use of the (orientation|motion) sensor is deprecated\."/];

const test = base.extend({
  console: [async ({}, use) => { await use([]); }, { scope: "test" }],
  page: async ({ page, console: log, request }, use, testInfo) => {
    await request.post("/api/_test/reset");
    const errors = [];
    page.on("console", (m) => {
      if (m.type() !== "error" && m.type() !== "warning") return;
      const text = m.text();
      if (KNOWN_BROWSER_WARNINGS.some((r) => r.test(text))) return;
      log.push(`${m.type()}: ${text}`);
    });
    page.on("pageerror", (e) => { if (!(testInfo.project.name === "webkit" && KNOWN_WEBKIT_PAGE_ERRORS.some((r) => r.test(`${e.message}\n${e.stack ?? ""}`)))) errors.push(e); });
    // allowHttp: statuses a test provokes on purpose — the browser itself logs "Failed to load resource … (409)"
    page.consoleClean = ({ allowHttp = [], allow = [] } = {}) => expect(
      log.filter((l) => !allowHttp.some((s) => l.includes("status of " + s + " ")) && !allow.some((r) => r.test(l.replace(/^(error|warning): (\[JavaScript Warning: ")?/, "")))),"console errors / warnings").toEqual([]);
    await use(page);
    expect(errors.map((e) => e.message), "uncaught page errors").toEqual([]);
  },
});

/** Read the state through the element's own API. */
function readState(page, fn) {
  return page.evaluate(async (src) => {
    const el = document.querySelector("wcs-state");
    let out;
    await el.createStateAsync("readonly", (s) => { out = new Function("s", `return (${src})(s)`)(s); });
    return JSON.parse(JSON.stringify(out ?? null));
  }, fn.toString());
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector("wcs-state")?.connectedCallbackPromise);
  await page.evaluate(() => document.querySelector("wcs-state").connectedCallbackPromise.catch(() => {}));
  await page.waitForFunction(() => document.querySelectorAll("table.check tr, main section").length > 0);
}

async function signIn(page, number = "1001", phrase) {
  await page.goto("/login");
  await page.waitForFunction(() => document.querySelector("wcs-state")?.connectedCallbackPromise);
  await page.evaluate(() => document.querySelector("wcs-state").connectedCallbackPromise);
  await page.getByLabel("参加者番号").fill(number);
  await page.getByLabel("あいことば").fill(phrase ?? `midori-${number}`);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.locator("header .count")).toBeVisible();
  await page.waitForFunction(() => !location.pathname.startsWith("/login"));
}

function checkLines(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll("table.check tr")].map((tr) => [tr.dataset.key, tr.dataset.status])));
}

/** Chromium only: DevTools protocol sensor feed. */
async function cdpSensors(page, types = ["accelerometer", "gyroscope", "magnetometer", "ambient-light", "absolute-orientation", "relative-orientation", "linear-acceleration", "gravity"]) {
  const cdp = await page.context().newCDPSession(page);
  for (const type of types) await cdp.send("Emulation.setSensorOverrideEnabled", { enabled: true, type });
  const read = (type, reading) => cdp.send("Emulation.setSensorOverrideReadings", { type, reading });
  return {
    cdp,
    accel: (x, y, z) => read("accelerometer", { xyz: { x, y, z } }),
    gyro: (x, y, z) => read("gyroscope", { xyz: { x, y, z } }),
    mag: (x, y, z) => read("magnetometer", { xyz: { x, y, z } }),
    light: (v) => read("ambient-light", { single: { value: v } }),
    /** compass heading of the device top, degrees clockwise from north (absolute-orientation quaternion about z) */
    heading: (deg) => {
      const alpha = ((360 - deg) % 360) * Math.PI / 180;
      return read("absolute-orientation", { quaternion: { x: 0, y: 0, z: Math.sin(alpha / 2), w: Math.cos(alpha / 2) } });
    },
    relative: (deg) => {
      const a = deg * Math.PI / 180;
      return read("relative-orientation", { quaternion: { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) } });
    },
    disable: async (type) => cdp.send("Emulation.setSensorOverrideEnabled", { enabled: false, type }),
  };
}
const SENSOR_FLAGS = ["--enable-blink-features=SensorExtraClasses", "--enable-features=GenericSensorExtraClasses"];
const SENSOR_PERMS = ["accelerometer", "gyroscope", "magnetometer", "ambient-light-sensor"];

/** Stand-in for "tab hidden / screen off": headless browsers never hide a page, so the test sets visibilityState and
 *  fires visibilitychange (what the page sees when the screen goes off). Does not prove the OS suspends sensors. */
function setHidden(page, hidden) {
  return page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

/** Records screen.orientation.lock()/unlock() calls (and whether the lock took): headless desktop browsers keep
 *  their screen's own orientation, so the calls are what the test can see. */
async function spyOrientation(page) {
  await page.addInitScript(() => {
    const o = screen.orientation;
    window.__orient = [];
    if (!o || typeof o.lock !== "function") return;
    const lock = o.lock.bind(o), unlock = o.unlock.bind(o);
    o.lock = (t) => lock(t).then((r) => { window.__orient.push(`lock ${t} ok`); return r; }, (e) => { window.__orient.push(`lock ${t} ${e.name}`); throw e; });
    o.unlock = () => { window.__orient.push("unlock"); return unlock(); };
  });
  return () => page.evaluate(() => window.__orient);
}

// ---------------------------------------------------------------- check.spec.js
// 端末のチェック in each browser as it is (a PC, no stand-ins) — and with every stand-in on.
test.describe("端末のチェック（check.spec.js）", () => {
  const AS_IS = {
    // A stock Chromium profile allows motion sensors; a PC has none of them (the browser has the events but never
    // a reading). The share sheet is not offered by Chromium on this Windows build.
    chromium: { orientation: "none", motion: "none", gyroscope: "none", magnetometer: "none", light: "none", fullscreen: "ok",
      orientationLock: "ok", pip: "ok", share: "none", contacts: "none", eyedropper: "ok", password: "ok" },
    firefox: { orientation: "none", motion: "none", gyroscope: "none", magnetometer: "none", light: "none", fullscreen: "ok",
      orientationLock: "ok", pip: "none", share: "none", contacts: "none", eyedropper: "none", password: "none" },
    webkit: { orientation: "none", motion: "none", gyroscope: "none", magnetometer: "none", light: "none", fullscreen: "ok",
      orientationLock: "none", pip: "none", share: "none", contacts: "none", eyedropper: "none", password: "none" },
  };

  test("端末のチェック: the browser as it is @browsers", async ({ page, browserName, context }) => {
    if (browserName === "chromium") await context.grantPermissions(SENSOR_PERMS);
    await page.goto("/");
    await ready(page);
    await expect.poll(() => checkLines(page), { timeout: 8000 }).toEqual(AS_IS[browserName]);
    // every line says exactly one of the five things
    const texts = await page.locator("table.check .status").allInnerTexts();
    expect(texts).toHaveLength(12);
    for (const t of texts) expect(["使えます", "許可が必要です", "許可されていません", "このページでは使えません", "この端末では使えません"]).toContain(t);
    page.consoleClean();
  });

  test("端末のチェック: every stand-in on @browsers", async ({ page, browserName }) => {
    await page.addInitScript(STANDIN.pickers);
    if (browserName === IPHONE) await page.addInitScript(STANDIN.ios);
    await page.goto("/");
    await ready(page);
    const lines = await checkLines(page);
    expect(lines.share).toBe("ok");
    expect(lines.contacts).toBe("ok");
    expect(lines.eyedropper).toBe("ok");
    expect(lines.password).toBe("ok");
    if (browserName === IPHONE) {
      // an iPhone before the tap: the sensors need the user's permission
      expect(lines.orientation).toBe("prompt");
      expect(lines.motion).toBe("prompt");
      await expect(page.locator('tr[data-key="orientation"] button.ask')).toBeVisible();
    }
    page.consoleClean();
  });
});

// ---------------------------------------------------------------- iphone.spec.js
// The iPhone's permission question, with a stand-in that behaves the way Safari does (tests/standins/ios-sensors.js).
test.describe("iPhone の問い（iphone.spec.js）", () => {
  test.skip(({ browserName }) => browserName !== IPHONE, "the Safari stand-in runs in one browser (the author's: WebKit)");
  test.beforeEach(async ({ page }) => { await page.addInitScript(STANDIN.ios); });

  const ios = (page) => page.evaluate(() => ({ asked: window.__standin.ios.asked, noGesture: window.__standin.ios.rejectedNoGesture, listeners: window.__standin.ios.listeners }));

  test("no question before the tap; 許可する → allowed → readings arrive", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 36.4300, longitude: 139.2778 });   // south of place 1
    await page.goto("/");
    await ready(page);
    await page.waitForTimeout(3000);
    expect(await ios(page)).toMatchObject({ asked: 0, noGesture: 0, listeners: 0 });   // nothing asked, nothing listening
    expect((await checkLines(page)).orientation).toBe("prompt");
    await page.locator('tr[data-key="orientation"] button.ask').click();
    await expect.poll(async () => (await checkLines(page)).orientation).not.toBe("prompt");
    expect(await ios(page)).toMatchObject({ asked: 1, noGesture: 0 });                  // one question for both
    expect((await checkLines(page)).motion).not.toBe("prompt");

    await signIn(page);
    await page.goto("/walk");
    await expect(page.locator(".next-name")).toHaveText("旧大間々銀行");
    // Safari gives north as webkitCompassHeading; facing north, the place (due north) is straight ahead
    await expect.poll(() => page.evaluate(() => window.__standin.ios.feedOrientation({ alpha: 10, beta: 0, gamma: 0, webkitCompassHeading: 0 }))).toBe(true);
    await expect(page.locator(".arrow")).toBeVisible();
    await expect.poll(() => readState(page, (s) => Math.round(s.arrowAngle))).toBe(0);
    await page.evaluate(() => window.__standin.ios.feedOrientation({ alpha: 100, beta: 0, gamma: 0, webkitCompassHeading: 90 }));
    await expect.poll(() => readState(page, (s) => Math.round(s.arrowAngle))).toBe(270);
    // motion readings arrive too: a step
    for (let i = 0; i < 6; i++) {
      await page.evaluate((z) => window.__standin.ios.feedMotion({ accelerationIncludingGravity: { x: 0, y: 0, z } }), i % 2 ? 12.5 : 8.5);
      await page.waitForTimeout(320);
    }
    await expect.poll(() => readState(page, (s) => s.steps)).toBeGreaterThan(0);
    page.consoleClean();
  });

  test("refused → the line and the advice; the app still works; a reload does not ask again", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    await page.evaluate(() => { window.__standin.ios.answer = "denied"; });
    await page.locator('tr[data-key="orientation"] button.ask').click();
    await expect.poll(async () => (await checkLines(page)).orientation).toBe("denied");
    expect((await checkLines(page)).motion).toBe("denied");
    await expect(page.locator('tr[data-key="orientation"] .advice')).toContainText("Safari は二度目を聞きません");
    // readings never arrive
    expect(await page.evaluate(() => window.__standin.ios.feedOrientation({ alpha: 1, webkitCompassHeading: 1 }))).toBe(false);
    await page.reload();
    await ready(page);
    await expect.poll(async () => (await checkLines(page)).orientation).toBe("denied");
    // the rest of the app works without the sensors: sign in, stamp with the sign's number
    await signIn(page);
    await page.goto("/walk");
    await page.locator("input.code").fill("1111");
    await page.locator("button.stamp").click();
    await expect(page.locator(".stamp-message")).toContainText("スタンプを押しました");
    await expect(page.locator("header .count")).toHaveText("1 / 8");
    page.consoleClean();
  });

  test("the question asked by something that is not a tap is refused, and nothing breaks", async ({ page }) => {
    await page.goto("/");
    await ready(page);
    // from a timer, after the 5 s a Playwright evaluate counts as a user gesture
    await page.evaluate(() => new Promise((r) => setTimeout(() => document.querySelector("wcs-tilt").requestPermission().then(r), 5600)));
    expect(await ios(page)).toMatchObject({ asked: 0, noGesture: 1 });
    expect((await checkLines(page)).orientation).toBe("prompt");     // still askable from a tap
    await page.locator('tr[data-key="orientation"] button.ask').click();
    await expect.poll(async () => (await checkLines(page)).orientation).not.toBe("prompt");
  });
});

// ---------------------------------------------------------------- account.spec.js
// Signing in, saved passwords (stand-in: tests/standins/pickers.js), team (contacts, eye dropper, 422), the card.
test.describe("サインイン・チーム・スタンプ帳（account.spec.js）", () => {
  const apiLog = async (request) => (await request.get("/api/_test/log")).json();

  test.describe("saved passwords", () => {
    test.beforeEach(async ({ page }) => { await page.addInitScript(STANDIN.pickers); });

    test("sign in → the pair is offered after the server accepted; reload → signed in without the form @browsers", async ({ page, request }) => {
      await page.goto("/login");
      await page.getByLabel("参加者番号").fill("1003");
      await page.getByLabel("あいことば").fill("wrong");
      await page.getByRole("button", { name: "ログイン" }).click();
      await expect(page.locator("form.login .error")).toHaveText("参加者番号かあいことばが違います");
      page.consoleClean({ allowHttp: [401] });
      expect(await page.evaluate(() => window.__standin.credentials.log.filter((l) => l.op === "store"))).toEqual([]);
      await page.getByLabel("あいことば").fill("midori-1003");
      await page.getByRole("button", { name: "ログイン" }).click();
      await expect(page).toHaveURL(/\/walk$/);
      await expect.poll(() => page.evaluate(() => window.__standin.credentials.saved())).toMatchObject({ id: "1003", password: "midori-1003" });
      // forget the session (as if days later), keep the browser's saved pair
      await page.evaluate(() => localStorage.removeItem("sr.session"));
      await page.goto("/");
      await expect(page.locator("header .count")).toHaveText("0 / 8");
      await expect.poll(() => readState(page, (s) => s.participantNumber)).toBe("1003");
      await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
      page.consoleClean({ allowHttp: [401] });
    });

    test("a deep link to /card on a fresh load lands on /card; ログアウト, reload → the form @browsers", async ({ page, request }) => {
      await page.goto("/");
      await ready(page);                       // the home page has finished its own silent sign-in
      await page.evaluate(() => window.__standin.credentials.store("1004", "midori-1004", "参加者1004"));
      await page.goto("/card");
      await expect(page).toHaveURL(/\/card$/);
      await expect(page.locator("main h1")).toHaveText("スタンプ帳");
      const log = await apiLog(request);
      expect(log.filter((e) => e.path === "/api/login")).toHaveLength(1);          // asked once, guard and state together
      await page.getByRole("button", { name: "ログアウト" }).click();
      await expect(page).toHaveURL(/\/$/);
      expect(await page.evaluate(() => window.__standin.credentials.log.some((l) => l.op === "preventSilentAccess"))).toBe(true);
      await page.goto("/card");
      await expect(page).toHaveURL(/\/login\?next=%2Fcard$/);
      await expect(page.getByLabel("参加者番号")).toBeVisible();
      // signing in from there comes back to /card
      await page.getByLabel("参加者番号").fill("1004");
      await page.getByLabel("あいことば").fill("midori-1004");
      await page.getByRole("button", { name: "ログイン" }).click();
      await expect(page).toHaveURL(/\/card$/);
      page.consoleClean();
    });

    test("the token no longer accepted (401) with a saved pair still right → signed in again; now wrong → the form", async ({ page, request }) => {
      await page.goto("/");
      await ready(page);                       // the home page has finished its own silent sign-in
      await page.evaluate(() => window.__standin.credentials.store("1005", "midori-1005", ""));
      await page.goto("/walk");
      await expect(page.locator(".next-name")).toHaveText("旧大間々銀行");
      await request.post("/api/_test/revoke");
      await page.locator("header").getByRole("link", { name: "スタンプ帳" }).click();     // /api/me again → 401
      await expect(page.locator("main h1")).toHaveText("スタンプ帳");
      await expect.poll(async () => (await apiLog(request)).filter((e) => e.path === "/api/login").length).toBe(2);
      await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
      // (added) …and the walker is still on the card once the page has settled: the heading above was also there for
      // an instant before the app took the new token for a sign-out and left for "/" — which the three lines above
      // passed, unless the machine was slow enough to miss that instant. Settled = the card asked for its data again,
      // after the second sign-in.
      await expect.poll(async () => {
        const log = await apiLog(request);
        return log.slice(log.findLastIndex((e) => e.path === "/api/login")).some((e) => e.path === "/api/me");
      }).toBe(true);
      await expect(page).toHaveURL(/\/card$/);
      await expect(page.locator("main h1")).toHaveText("スタンプ帳");
      // now the saved pair is wrong too
      await request.post("/api/_test/phrase", { data: { number: "1005", phrase: "changed" } });
      await request.post("/api/_test/revoke");
      await page.locator("header").getByRole("link", { name: "コンパス" }).click();
      await expect(page).toHaveURL(/\/login\?next=%2Fwalk$/);
      await expect(page.locator(".notice")).toHaveText("もう一度サインインしてください。");
      page.consoleClean({ allowHttp: [401] });
    });
  });

  test("two tabs: one signs out, the other leaves its member page", async ({ page, context }) => {
    await signIn(page, "1006");
    await page.goto("/team");
    const other = await context.newPage();
    await other.goto("/card");
    await expect(other.locator("main h1")).toHaveText("スタンプ帳");
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(other).toHaveURL(/\/$/);
    await expect(other.getByRole("link", { name: "ログイン" })).toBeVisible();
  });

  test("a deep link while signed out (no saved pair) comes back after signing in", async ({ page }) => {
    await page.goto("/team");
    await expect(page).toHaveURL(/\/login\?next=%2Fteam$/);
    await page.getByLabel("参加者番号").fill("1002");
    await page.getByLabel("あいことば").fill("midori-1002");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/\/team$/);
    page.consoleClean();
  });

  test.describe("team", () => {
    test.beforeEach(async ({ page }) => { await page.addInitScript(STANDIN.pickers); });

    test("contacts: two picked, one already a member → one added; closed without choosing → nothing changes", async ({ page }) => {
      await signIn(page, "1007");
      await page.goto("/team");
      await page.getByPlaceholder("名前").fill("山田 花子");
      await page.getByPlaceholder("メール").fill("hanako@example.jp");
      await page.getByRole("button", { name: "加える" }).click();
      await expect(page.locator("li.member")).toHaveCount(1);
      await page.evaluate(() => {
        window.__standin.contacts.next = [
          { name: ["Hanako Yamada"], email: ["HANAKO@example.jp"], tel: [] },
          { name: [], email: ["taro@example.jp"], tel: [] },
        ];
      });
      await page.getByRole("button", { name: "連絡先から選ぶ" }).click();
      await expect(page.locator("li.member")).toHaveCount(2);
      await expect(page.locator(".contacts-message")).toContainText("1人を加えました");
      expect(await page.evaluate(() => window.__standin.contacts.calls[0])).toMatchObject({ props: ["name", "email"], multiple: true, activation: true });
      await page.evaluate(() => { window.__standin.contacts.mode = "dismiss"; });
      await page.getByRole("button", { name: "連絡先から選ぶ" }).click();
      await page.waitForTimeout(300);
      await expect(page.locator("li.member")).toHaveCount(2);
      await page.getByLabel("チームの名前").fill("みどり探検隊");
      await page.getByRole("button", { name: "保存" }).click();
      await expect(page.locator(".team-message")).toHaveText("保存しました。");
      await expect(page.locator("header .team")).toContainText("みどり探検隊");
      page.consoleClean();
    });

    test("the server refuses (422): the message at the field", async ({ page }) => {
      await signIn(page, "1008");
      await page.goto("/team");
      await page.getByLabel("チームの名前").fill("あ".repeat(21));
      await page.getByPlaceholder("名前").fill("誰か");
      await page.getByPlaceholder("メール").fill("no-at-sign");
      await page.getByRole("button", { name: "加える" }).click();
      await page.getByRole("button", { name: "保存" }).click();
      await expect(page.locator('.field-error[data-field="name"]')).toHaveText("チーム名は20文字までです");
      await expect(page.locator("li.member .error")).toHaveText("メールアドレスに @ がありません");
      page.consoleClean({ allowHttp: [422] });
    });

    test("the eye dropper: a colour picked becomes the team's colour and is sent; closed → the colour stays", async ({ page, request }) => {
      await signIn(page, "1009");
      await page.goto("/team");
      await page.getByLabel("チームの名前").fill("いろ班");
      await page.evaluate(() => { window.__standin.eyedropper.next = "#F9A825"; });
      await page.getByRole("button", { name: "画面から色を拾う" }).click();
      await expect(page.locator(".team-message")).toHaveText("保存しました。");
      const put = (await apiLog(request)).filter((e) => e.path === "/api/team").at(-1);
      expect(put.body.color).toBe("#f9a825");
      await expect(page.locator(".team-form code")).toHaveText("#f9a825");
      await page.evaluate(() => { window.__standin.eyedropper.mode = "dismiss"; });
      await page.getByRole("button", { name: "画面から色を拾う" }).click();
      await page.waitForTimeout(300);
      await expect(page.locator(".team-form code")).toHaveText("#f9a825");
      expect((await apiLog(request)).filter((e) => e.path === "/api/team")).toHaveLength(1);
      page.consoleClean();
    });
  });

  test.describe("the card", () => {
    test.beforeEach(async ({ page }) => { await page.addInitScript(STANDIN.pickers); });

    test("スタンプ帳を共有: a PNG with a line of text; closing it shows no error; files not shareable → text and link", async ({ page }) => {
      await signIn(page, "1010");
      await page.goto("/card");
      await expect(page.locator("button.share-card")).toHaveText("スタンプ帳を共有");   // the picture is ready before the tap
      await page.locator("button.share-card").click();
      await expect.poll(() => page.evaluate(() => window.__standin.share.calls.length)).toBe(1);
      const call = await page.evaluate(() => window.__standin.share.calls[0]);
      expect(call.files).toHaveLength(1);
      expect(call.files[0].type).toBe("image/png");
      expect(call.files[0].size).toBeGreaterThan(1000);
      expect(call.text).toContain("0 / 8");
      expect(call.activation).toBe(true);
      await expect(page.locator(".card .share-message")).toHaveText("共有しました。");
      await page.evaluate(() => { window.__standin.share.mode = "dismiss"; window.__standin.share.files = false; });
      await page.locator("button.share-card").click();
      await expect.poll(() => page.evaluate(() => window.__standin.share.calls.length)).toBe(2);
      expect(await page.evaluate(() => window.__standin.share.calls[1].files)).toEqual([]);
      await page.waitForTimeout(300);
      await expect(page.locator(".card .share-message")).toBeEmpty();
      page.consoleClean();
    });

    test("ゴールで見せる: the certificate fills the screen, upright, screen kept on, until closed @browsers", async ({ page, browserName }) => {
      const calls = await spyOrientation(page);
      await signIn(page, "1001");
      await page.goto("/card");
      await page.getByRole("button", { name: "ゴールで見せる" }).click();
      await expect(page.locator("#certificate")).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null)).toBe("certificate");
      if (browserName === "chromium") await expect.poll(async () => (await calls()).at(-1)).toBe("lock portrait ok");
      expect(await readState(page, (s) => s.keepAwake)).toBe(true);
      await page.locator("#certificate").getByRole("button", { name: "閉じる" }).click();
      await expect(page.locator("#certificate")).toBeHidden();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null)).toBe(null);
      if (browserName === "chromium") expect((await calls()).at(-1)).toBe("unlock");
      expect(await readState(page, (s) => s.keepAwake)).toBe(false);
      page.consoleClean();
    });
  });

  test("no share sheet → the picture as a download", async ({ page }) => {
    await signIn(page, "1002");
    await page.goto("/card");
    await expect(page.locator("button.share-card")).toHaveText("スタンプ帳を共有");
    const download = page.waitForEvent("download");
    await page.locator("button.share-card").click();
    expect((await download).suggestedFilename()).toBe("midori-stamp-card.png");
  });
});

// ---------------------------------------------------------------- walk.spec.js
// コンパス with sensor readings fed through Chromium's DevTools protocol (Emulation.setSensorOverride*).
// Proves: the page's handling of readings (arrow, steps, shake, light, magnetic warning, start/stop).
// Does not prove: a real phone's sensor noise, rates, axes conventions per device, or the OS compass calibration.
// (the author's file set `test.use({ launchOptions: { args: SENSOR_FLAGS } })`; a group of one file cannot — it forces
// a new worker — so the group's tests come from a test whose worker launches its browser with the flags)
const sensorTest = test.extend({
  browser: [async ({ playwright, browserName }, use) => {
    const browser = await playwright[browserName].launch({ args: browserName === "chromium" ? SENSOR_FLAGS : [] });
    await use(browser);
    await browser.close();
  }, { scope: "worker" }],
});

test.describe("コンパス（walk.spec.js）", () => {
  const test = sensorTest;
  test.skip(({ browserName }) => browserName !== "chromium", "DevTools protocol sensors are Chromium only");

  const PLACE1 = { latitude: 36.43620, longitude: 139.27780 };
  const SOUTH_OF_1 = { latitude: 36.43400, longitude: 139.27780 };   // place 1 is due north, ~245 m

  async function walkPage(page, context, where = SOUTH_OF_1) {
    await context.grantPermissions([...SENSOR_PERMS, "geolocation"]);
    await context.setGeolocation(where);
    const s = await cdpSensors(page);
    await signIn(page);
    await page.locator("header").getByRole("link", { name: "コンパス" }).click();
    await expect(page.locator(".next-name")).toHaveText("旧大間々銀行");
    await expect.poll(() => readState(page, (st) => st.lat)).not.toBeNull();
    return s;
  }
  // one step ≈ a smooth swing of |a| around g, sampled every 80 ms
  const STEP = [9.8, 11.5, 12.8, 11.5, 9.8, 8.4, 7.8, 8.4];
  async function walkSteps(s, page, n) {
    for (let i = 0; i < n; i++) for (const z of STEP) { await s.accel(0, 0, z + (i % 2) * 0.01); await page.waitForTimeout(80); }
  }
  const arrow = (page) => readState(page, (s) => (s.showArrow ? Math.round(s.arrowAngle) : null));

  test("the arrow follows the readings: north, east, a place behind", async ({ page, context }) => {
    const s = await walkPage(page, context);
    await s.heading(0);
    await expect.poll(() => arrow(page)).toBe(0);           // facing north, the place is straight ahead
    await s.heading(90);
    await expect.poll(() => arrow(page)).toBe(270);         // facing east, it is to the left
    await s.heading(180);
    await expect.poll(() => arrow(page)).toBe(180);         // facing south, it is behind
    await expect(page.locator(".arrow")).toBeVisible();
    await expect(page.locator(".distance")).toHaveText("240 m");
    page.consoleClean();
  });

  test("a phone that gives only relative directions gets the text", async ({ page, context }) => {
    await context.grantPermissions([...SENSOR_PERMS, "geolocation"]);
    await context.setGeolocation(SOUTH_OF_1);
    const s = await cdpSensors(page, ["relative-orientation", "accelerometer", "gyroscope", "linear-acceleration", "gravity"]);
    await signIn(page);
    await page.goto("/walk");
    await expect(page.locator(".next-name")).toHaveText("旧大間々銀行");
    await s.relative(30);
    await s.relative(40);
    await expect(page.locator(".direction")).toHaveText("北へ 240 m");
    await expect(page.locator(".arrow")).toBeHidden();
    await expect(page.locator(".north-note")).toContainText("北の向き");
    page.consoleClean();
  });

  async function shakeOnce(s, page) {
    for (const z of [9.8, 26, 9.8, 26, 9.8, 26, 9.8]) { await s.accel(0, 0, z); await page.waitForTimeout(90); }
  }

  test("a shake stamps once; shaking on stamps nothing; the button does the same; 409", async ({ page, context, request }) => {
    const s = await walkPage(page, context, PLACE1);
    await expect(page.locator("button.stamp")).toBeEnabled();
    await shakeOnce(s, page);
    await expect(page.locator(".stamp-message")).toContainText("旧大間々銀行」のスタンプを押しました");
    await expect(page.locator("header .count")).toHaveText("1 / 8");
    for (let i = 0; i < 3; i++) await shakeOnce(s, page);   // shaking on at the same place
    await page.waitForTimeout(500);
    const log = await (await request.get("/api/_test/log")).json();
    expect(log.filter((e) => e.path === "/api/stamps")).toHaveLength(1);
    // the next place is far away: the button is not offered
    await expect(page.locator("button.stamp")).toBeDisabled();
    // the server's 409: the stamp was taken meanwhile (another tab)
    await page.locator("input.code").fill("2222");
    const token = await readState(page, (st) => st.token);
    await request.post("/api/stamps", { headers: { Authorization: `Bearer ${token}` }, data: { spotId: 2, code: "2222" } });
    await page.locator("button.stamp").click();
    await expect(page.locator(".stamp-message")).toContainText("もう押してあります");
    await expect(page.locator("header .count")).toHaveText("2 / 8");
    page.consoleClean({ allowHttp: [409] });
  });

  test("a failed stamp says so and can be tried again; offline and back", async ({ page, context, request }) => {
    await walkPage(page, context, PLACE1);
    await request.post("/api/_test/fail", { data: { path: "/api/stamps", status: 500, times: 1 } });
    await page.locator("button.stamp").click();
    await expect(page.locator(".stamp-message")).toContainText("送れませんでした");
    await page.locator("button.retry").click();
    await expect(page.locator(".stamp-message")).toContainText("スタンプを押しました");
    // offline at the next place (the sign's number), back online → sent by itself
    await page.locator("input.code").fill("2222");
    await context.setOffline(true);
    await page.locator("button.stamp").click();
    await expect(page.locator(".stamp-message")).toContainText(/電波がありません|送れませんでした/);
    await context.setOffline(false);
    await expect(page.locator(".stamp-message")).toContainText("高津戸峡」のスタンプを押しました");
    await expect(page.locator("header .count")).toHaveText("2 / 8");
  });

  test("steps: counted, not while hidden, the note on return, kept over a reload", async ({ page, context }) => {
    const s = await walkPage(page, context);
    await walkSteps(s, page, 5);
    await expect.poll(() => readState(page, (st) => st.steps)).toBeGreaterThanOrEqual(4);
    const before = await readState(page, (st) => st.steps);
    await setHidden(page, true);                                   // the screen goes off
    await page.waitForTimeout(200);
    const handledHidden = await page.evaluate(() => window.__srStats.handled.accel);
    await walkSteps(s, page, 3);
    expect(await page.evaluate(() => window.__srStats.handled.accel)).toBe(handledHidden);
    expect(await readState(page, (st) => st.steps)).toBe(before);
    await setHidden(page, false);
    await expect(page.locator(".steps-note")).toHaveText("画面を閉じていた間は数えていません");
    await page.reload();
    await expect(page.locator(".steps")).toContainText(String(before));
    page.consoleClean();
  });

  test("light: bright → くっきり, dark → 暗い, no flicker at the limit; the switch overrides", async ({ page, context }) => {
    const s = await walkPage(page, context);
    const theme = () => page.locator(".app").getAttribute("data-theme");
    await s.light(500);
    await expect.poll(theme).toBe("light");
    await s.light(30000);
    await expect.poll(theme).toBe("contrast");
    const changes = [];
    await page.exposeFunction("__themeChanged", (t) => changes.push(t));
    await page.evaluate(() => new MutationObserver(() => window.__themeChanged(document.querySelector(".app").dataset.theme))
      .observe(document.querySelector(".app"), { attributes: true, attributeFilter: ["data-theme"] }));
    for (const v of [19000, 21000, 18000, 22000, 15000, 20500]) { await s.light(v); await page.waitForTimeout(250); }
    expect(changes).toEqual([]);                               // hovering around the limit: no flicker
    await s.light(5);
    await expect.poll(theme).toBe("dark");
    for (const v of [20, 8, 30, 6]) { await s.light(v); await page.waitForTimeout(250); }
    expect(changes).toEqual(["dark"]);
    await page.getByLabel("明るい").check();
    await expect.poll(theme).toBe("light");
    await s.light(30000);
    await page.waitForTimeout(500);
    expect(await theme()).toBe("light");
    page.consoleClean();
  });

  test("magnetic field far outside the usual warns", async ({ page, context }) => {
    const s = await walkPage(page, context);
    for (let i = 0; i < 5; i++) { await s.mag(20, 30, 20); await page.waitForTimeout(150); }
    await expect(page.locator(".mag-warning")).toBeEmpty();
    for (let i = 0; i < 8; i++) { await s.mag(90 + i, 60, 40); await page.waitForTimeout(150); }
    await expect(page.locator(".mag-warning")).toHaveText("近くに鉄のものがあります。矢印がずれるかもしれません");
    page.consoleClean();
  });

  test("sensors off: no readings are handled on /team, nor while hidden", async ({ page, context }) => {
    const s = await walkPage(page, context);
    await s.accel(0, 0, 9.8);
    await expect.poll(() => page.evaluate(() => window.__srStats.handled.accel)).toBeGreaterThan(0);
    await page.locator("header").getByRole("link", { name: "チーム" }).click();
    await expect(page.locator("h1")).toHaveText("チーム");
    await page.waitForTimeout(300);
    const h0 = await page.evaluate(() => ({ ...window.__srStats.handled }));
    for (let i = 0; i < 10; i++) {
      await s.accel(0, 0, 9 + i); await s.heading(i * 10); await s.mag(30 + i, 20, 10); await s.light(100 + i * 100);
      await page.waitForTimeout(100);
    }
    expect(await page.evaluate(() => ({ ...window.__srStats.handled }))).toEqual(h0);
    // back on /walk, then hidden: nothing is handled either
    await page.locator("header").getByRole("link", { name: "コンパス" }).click();
    await expect(page.locator(".next-name")).toHaveText("旧大間々銀行");
    await setHidden(page, true);
    await page.waitForTimeout(200);
    const h1 = await page.evaluate(() => ({ ...window.__srStats.handled }));
    for (let i = 0; i < 10; i++) { await s.accel(0, 0, 9 + i); await s.heading(i * 10 + 5); await page.waitForTimeout(100); }
    expect(await page.evaluate(() => ({ ...window.__srStats.handled }))).toEqual(h1);
    page.consoleClean();
  });

  test("permission taken away in the browser's settings while /walk is open: the lines say so, the sensors stop", async ({ page, context, browser, baseURL }) => {
    const s = await walkPage(page, context);
    await s.heading(10);
    await expect.poll(() => readState(page, (st) => st.heading)).toBe(10);
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    const bc = await browser.newBrowserCDPSession();
    for (const name of ["accelerometer", "gyroscope", "magnetometer"]) {
      await bc.send("Browser.setPermission", { permission: { name }, setting: "denied", origin: baseURL, browserContextId: targetInfo.browserContextId });
    }
    await expect.poll(() => readState(page, (st) => st.permAccelerometer)).toBe("denied");
    await page.waitForTimeout(300);
    const h0 = await page.evaluate(() => ({ ...window.__srStats.handled }));
    for (let i = 0; i < 5; i++) { await s.accel(0, 0, 9 + i); await s.heading(20 + i * 10); await page.waitForTimeout(100); }
    expect(await page.evaluate(() => ({ ...window.__srStats.handled }))).toEqual(h0);
    await page.locator("header").getByRole("link", { name: "みどり市 まち歩きスタンプラリー" }).click();
    await expect(page.locator('tr[data-key="orientation"]')).toHaveAttribute("data-status", "denied");
    await expect(page.locator('tr[data-key="orientation"] .advice')).toContainText("サイトの設定");
    page.consoleClean();
  });
});

// ---------------------------------------------------------------- spot.spec.js
// 場所: the viewer (fullscreen + orientation lock, mouse look), the small window, sharing.
test.describe("場所（spot.spec.js）", () => {
  const fsId = (page) => page.evaluate(() => (document.fullscreenElement ? document.fullscreenElement.id : null));

  /** The browser's own way out (Escape / the swipe). Firefox leaves on the key; headless Chromium and WebKit ignore
   *  Escape for fullscreen (the key belongs to the browser UI there), so the test then exits from outside the app —
   *  which is what the browser does: the app's buttons are not involved either way. */
  async function browserEscape(page) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    if (await fsId(page)) await page.evaluate(() => document.exitFullscreen());
  }

  const NAMES = { 2: "高津戸峡", 3: "ながめ余興場", 4: "大間々神明宮", 5: "岩下家の蔵", 6: "わたらせ渓谷鐵道 大間々駅" };
  /** From はじめに, through the list (an in-app navigation, so Back has somewhere to go). */
  async function openSpot(page, id = 3) {
    if (!/localhost:\d+\/$/.test(page.url())) await page.goto("/");
    await page.locator("ol.places").getByRole("link", { name: NAMES[id] }).click();
    await expect(page.locator("main h1")).toHaveText(NAMES[id]);
    await expect(page.locator("#viewer-strip")).toHaveAttribute("data-angle", "0");
  }

  test.describe("held in landscape", () => {
  test("全画面で見る: in and out by 閉じる, by the browser's way out, by Back — and in again @browsers", async ({ page, browserName }) => {
    const calls = await spyOrientation(page);
    await openSpot(page);
    const button = page.locator("button.viewer-fs");
    for (const how of ["close", "escape", "back", "close"]) {
      await expect(button).toHaveText("全画面で見る");
      await button.click();
      await expect.poll(() => fsId(page)).toBe("viewer");
      await expect(button).toHaveText("閉じる");
      // held in landscape — asked only once the viewer is fullscreen (Chromium holds it; Firefox refuses; WebKit has no lock)
      if (browserName !== "webkit") await expect.poll(async () => (await calls()).at(-1)).toMatch(browserName === "chromium" ? /^lock landscape ok$/ : /^lock landscape/);
      if (how === "close") await button.click();
      if (how === "escape") await browserEscape(page);
      if (how === "back") {
        await page.goBack();
        await expect(page).toHaveURL(/\/$/);
      }
      await expect.poll(() => fsId(page)).toBe(null);
      await expect.poll(() => readState(page, (s) => [s.viewerFs, s.lockErrorInfo == null || true])).toEqual([false, true]);
      if (how === "back") await openSpot(page);
      await expect(button).toHaveText("全画面で見る");
      if (browserName !== "webkit") expect((await calls()).at(-1)).toBe("unlock");                 // the screen is free
    }
    page.consoleClean();
  });
  });

  test("the view angle is kept between drag, fullscreen and back", async ({ page }) => {
    await openSpot(page);
    const strip = page.locator("#viewer-strip");
    const box = await strip.boundingBox();
    // a touch-like drag (pointer events, not a mouse click that would capture the cursor)
    await strip.dispatchEvent("pointerdown", { pointerId: 5, pointerType: "touch", clientX: box.x + 300, clientY: box.y + 50, button: 0 });
    await strip.dispatchEvent("pointermove", { pointerId: 5, pointerType: "touch", clientX: box.x + 100, clientY: box.y + 50 });
    await strip.dispatchEvent("pointerup", { pointerId: 5, pointerType: "touch", clientX: box.x + 100, clientY: box.y + 50 });
    const angle = Number(await strip.getAttribute("data-angle"));
    expect(angle).toBeGreaterThan(10);
    await page.locator("button.viewer-fs").click();
    await expect.poll(() => fsId(page)).toBe("viewer");
    expect(Number(await strip.getAttribute("data-angle"))).toBe(angle);
    await page.locator("button.viewer-fs").click();
    await expect.poll(() => fsId(page)).toBe(null);
    expect(Number(await strip.getAttribute("data-angle"))).toBe(angle);
  });

  test("mouse look on a PC: captured on the click, the view follows, Escape releases, a second click captures again @browsers", async ({ page, browserName }) => {
    test.skip(browserName === "webkit", "headless WebKit refuses: Pointer lock requires the window to have focus (life-events.md)");
    await openSpot(page);
    const strip = page.locator("#viewer-strip");
    const locked = () => page.evaluate(() => document.pointerLockElement?.id ?? null);
    for (let round = 0; round < 2; round++) {
      await strip.click();
      await expect.poll(locked).toBe("viewer-strip");
      await expect(page.locator(".viewer-hint")).toContainText("Esc");
      const before = Number(await strip.getAttribute("data-angle"));
      await strip.dispatchEvent("mousemove", { movementX: 120, movementY: 0, bubbles: true });
      await expect.poll(async () => Number(await strip.getAttribute("data-angle"))).not.toBe(before);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      if (await locked()) await page.evaluate(() => document.exitPointerLock());   // headless: Escape belongs to the browser UI
      await expect.poll(locked).toBe(null);
      await expect(page.locator(".viewer-hint")).toBeEmpty();
    }
    // the route changes while the cursor is captured → released
    await strip.click();
    await expect.poll(locked).toBe("viewer-strip");
    await page.goBack();                                            // (clicks go to the captured element)
    await expect(page.locator("main h1")).toHaveText("まち歩きスタンプラリー");
    await expect.poll(locked).toBe(null);
    page.consoleClean();
  });

  test("the small window: opens, the page says so, plays on across /walk and back, 戻す and the window's × put it right", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Picture-in-Picture: only Chromium has it here (Firefox: no API; WebKit/Windows: no video)");
    await openSpot(page, 2);
    const video = page.locator("#guide-video");
    await expect.poll(() => video.evaluate((v) => v.readyState)).toBeGreaterThan(0);
    await page.locator("button.pip-open").click();
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement?.id ?? null)).toBe("guide-video");
    await expect(page.locator(".pip-status")).toBeVisible();
    await expect(page.locator(".pip-bar")).toContainText("高津戸峡");
    const t0 = await video.evaluate((v) => v.currentTime);
    await page.locator("header").getByRole("link", { name: "コンパス" }).click();     // guarded → /login; any page will do
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => document.pictureInPictureElement?.id ?? null)).toBe("guide-video");
    expect(await video.evaluate((v) => !v.paused)).toBe(true);
    expect(await video.evaluate((v) => v.currentTime)).toBeGreaterThan(t0);
    await page.goBack();
    await expect(page.locator(".pip-status")).toBeVisible();
    // 戻す
    await page.locator(".pip-status button").click();
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement?.id ?? null)).toBe(null);
    await expect(page.locator(".pip-status")).toBeHidden();
    await expect(page.locator(".pip-bar")).toBeHidden();
    // again, then the window's own × (the browser exits Picture-in-Picture; no app button involved)
    await page.locator("button.pip-open").click();
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement?.id ?? null)).toBe("guide-video");
    await page.evaluate(() => document.exitPictureInPicture());
    await expect(page.locator(".pip-status")).toBeHidden();
    await expect(page.locator(".pip-bar")).toBeHidden();
    page.consoleClean();
  });

  test("a second place's video replaces the first in the small window", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Picture-in-Picture: Chromium only here");
    const pipId = () => page.evaluate(() => document.pictureInPictureElement?.id ?? null);
    await openSpot(page, 2);
    await expect.poll(() => page.locator("#guide-video").evaluate((v) => v.readyState)).toBeGreaterThan(0);
    await page.locator("button.pip-open").click();
    await expect.poll(pipId).toBe("guide-video");
    await expect(page.locator(".pip-bar")).toContainText("高津戸峡");
    await page.locator("header").getByRole("link", { name: "みどり市 まち歩きスタンプラリー" }).click();
    await openSpot(page, 5);
    await expect(page.locator(".pip-status")).toBeHidden();                 // this place's video is not the one playing
    expect(await pipId()).toBe("guide-video");
    await page.locator("button.pip-open").click();
    await expect(page.locator(".pip-bar")).toContainText("岩下家の蔵");
    await expect(page.locator(".pip-status")).toBeVisible();
    expect(await pipId()).toBe("guide-video");
    await expect.poll(() => page.locator("#guide-video").getAttribute("src")).toBe("/video/5");
    await expect.poll(() => page.locator("#guide-video").evaluate((v) => !v.paused)).toBe(true);
    // a reload ends the small window (the document is gone) and the page says nothing about it
    await page.reload();
    await expect(page.locator("main h1")).toHaveText("岩下家の蔵");
    expect(await pipId()).toBe(null);
    await expect(page.locator(".pip-bar")).toBeHidden();
    page.consoleClean();
  });

  test.describe("sharing", () => {
    test.beforeEach(async ({ page }) => { await page.addInitScript(STANDIN.pickers); });

    test("この場所を共有 hands title, text and URL; closing it shows nothing; a double tap opens one sheet", async ({ page }) => {
      await openSpot(page, 4);
      await page.locator("button.share-spot").click();
      await expect.poll(() => page.evaluate(() => window.__standin.share.calls.length)).toBe(1);
      const call = await page.evaluate(() => window.__standin.share.calls[0]);
      expect(call).toMatchObject({ title: "大間々神明宮", url: `http://localhost:${PORT}/spots/4`, files: [], activation: true });
      expect(call.text).toContain("大間々神明宮");
      await expect(page.locator(".share-message")).toHaveText("共有しました。");
      // closed without sharing: not an error, nothing shown
      await page.evaluate(() => { window.__standin.share.mode = "dismiss"; });
      await page.locator("button.share-spot").click();
      await expect.poll(() => page.evaluate(() => window.__standin.share.open)).toBe(false);
      await page.waitForTimeout(200);
      await expect(page.locator(".spot .share-message")).toBeEmpty();
      // a double tap: one sheet
      await page.evaluate(() => { window.__standin.share.mode = "manual"; window.__standin.share.calls = []; window.__standin.share.refused = []; });
      await page.locator("button.share-spot").dblclick();
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => window.__standin.share.calls.length)).toBe(1);
      expect(await page.evaluate(() => window.__standin.share.refused)).toEqual([]);
      await page.evaluate(() => window.__standin.share.finish("complete"));
      await expect(page.locator(".spot .share-message")).toHaveText("共有しました。");
      page.consoleClean();
    });
  });

  test("no share sheet → リンクをコピー", async ({ page, context, browserName }) => {
    if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openSpot(page, 6);
    await expect(page.locator("button.share-spot")).toBeHidden();
    await page.locator("button.copy-link").click();
    await expect(page.locator(".spot .share-message")).toHaveText(/リンクをコピーしました|コピーできませんでした/);
    if (browserName === "chromium") {
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://localhost:${PORT}/spots/6`);
      await expect(page.locator(".spot .share-message")).toHaveText("リンクをコピーしました。");
    }
  });
});

// ---------------------------------------------------------------- portal.spec.js
// The city's portal shows the rally in an <iframe> from another origin (localhost ↔ 127.0.0.1).
test.describe("市のポータル（portal.spec.js）", () => {
  const frameLines = (frame) => frame.evaluate(() => Object.fromEntries([...document.querySelectorAll("table.check tr")].map((tr) => [tr.dataset.key, tr.dataset.status])));
  async function rally(page, kind) {
    await page.goto(`/portal/${kind}`);
    const frame = page.frameLocator("#rally");
    await expect(frame.locator("table.check tr")).toHaveCount(12, { timeout: 15000 });
    const f = page.frames().find((x) => x.url().startsWith("http://127.0.0.1"));
    await expect.poll(async () => Object.values(await frameLines(f)).includes("checking")).toBe(false);
    return { frame, f };
  }

  test.beforeEach(async ({ page }) => { await page.addInitScript(STANDIN.pickers); });

  test("the allowing frame works @browsers", async ({ page, browserName }) => {
    const { frame, f } = await rally(page, "allowed");
    const lines = await frameLines(f);
    expect(lines.fullscreen).toBe("ok");
    expect(lines.share).toBe("ok");
    if (browserName === "chromium") {
      expect(lines.pip).toBe("ok");
      expect(lines.orientationLock).toBe("ok");
      expect(lines.password).toBe("policy");     // a saved password is not offered to a frame of another origin
      expect(lines.contacts).toBe("policy");     // the contact picker is for a top-level page only
    }
    await frame.locator("ol.places").getByRole("link", { name: "高津戸峡" }).click();
    await frame.locator("button.viewer-fs").click();
    await expect.poll(() => f.evaluate(() => document.fullscreenElement?.id ?? null)).toBe("viewer");
    await frame.locator("button.viewer-fs").click();
    await expect.poll(() => f.evaluate(() => document.fullscreenElement?.id ?? null)).toBe(null);
    page.consoleClean({ allow: PORTAL_ALLOW_WARNINGS });
  });

  test("the forbidding frame: このページでは使えません on every line it forbids; buttons that cannot work are not offered @browsers", async ({ page, browserName }) => {
    const { frame, f } = await rally(page, "forbidden");
    const lines = await frameLines(f);
    expect(lines.fullscreen).toBe("policy");
    if (browserName === "chromium") {
      expect(lines).toMatchObject({
        orientation: "policy", motion: "policy", gyroscope: "policy", fullscreen: "policy", orientationLock: "policy",
        pip: "policy", contacts: "policy", password: "policy",
      });
    }
    await expect(frame.locator(".framed")).toBeVisible();
    await expect(frame.locator('tr[data-status="policy"] a.newtab').first()).toHaveAttribute("href", /^http:\/\/127\.0\.0\.1:\d+\/$/);
    await frame.locator("ol.places").getByRole("link", { name: "高津戸峡" }).click();
    await expect(frame.locator("main h1")).toHaveText("高津戸峡");
    await expect(frame.locator("button.viewer-fs")).toBeHidden();
    await expect(frame.locator("button.pip-open")).toBeHidden();
    // This Chromium does not know the web-share policy name, so the page cannot tell before a tap; the first tap's
    // refusal turns the line and the button: nothing goes on pretending.
    await f.evaluate(() => { window.__standin.share.policyBlocked = true; });
    if (await frame.locator("button.share-spot").isVisible()) {
      await frame.locator("button.share-spot").click();
      await expect(frame.locator(".spot .share-message")).toContainText("新しいタブで開いて");
      await expect(frame.locator("button.share-spot")).toBeHidden();
    }
    if (browserName === "chromium") {
      await expect(frame.locator("button.copy-link")).toBeHidden();               // clipboard-write is forbidden too
      await expect(frame.locator(".plain-url")).toContainText("/spots/2");
    }
    page.consoleClean({ allow: PORTAL_ALLOW_WARNINGS });
  });

  test("Permissions-Policy header on the top-level page (?policy=none)", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "only Chromium exposes the policy to the page");
    await page.goto("/?policy=none");
    await expect(page.locator("table.check tr")).toHaveCount(12);
    await expect.poll(async () => Object.fromEntries(await page.evaluate(() => [...document.querySelectorAll("table.check tr")].map((tr) => [tr.dataset.key, tr.dataset.status]))))
      .toMatchObject({ orientation: "policy", motion: "policy", fullscreen: "policy", pip: "policy" });
    await expect(page.locator(".framed")).toBeVisible();
  });
});
