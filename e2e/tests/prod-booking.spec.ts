import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/prod-booking — 会議室の予約アプリを本番の配信に載せる継ぎ目アプリ（docs/seam-apps.md の prod-booking）。
// /booking/ の下で、配信の形（プロファイル）ごとに 1 つのポートで動く: 0 pinned（パッケージごとの dist/auto.min.js と
// integrity）、1 split-importmap（core + add-on を import map と integrity で、diagnostics なし）、2 split-auto
// （dist/split/auto.js + features= / $features）、3 csp（nonce と Trusted Types の厳しい CSP）、4 selfhost（版を URL に
// 入れた自前配信）、5 selfhost-inplace（同じ URL を置き換える誤り）。v1 = npm の @wcstack/* 4.6.2、v2 = この木の
// packages/*/dist（WCS_LOCAL=1）。
//
// この spec は意図を固定する: 配備のあとの再読み込みが v2 に届く、ほかのライブラリのタグがアプリのコンポーネントの
// 自動読み込みを止めない、本番のエラーがページの error リスナーに届く、script の無いガードは管理ページを閉じる、
// 版を URL に入れた配信では開いたままの v1 のタブが動き続け、置き換えた配信は大きな声で拒まれる。
// 「@browsers」の付いたテストは firefox プロジェクトでも走る（import map の integrity と Trusted Types — ブラウザで
// 違うと文書が書いていた所）。
//
// サーバーはワーカーごとに 5300 + 30 × index から 6 つのポートで立てる（4600–4900 / 5100 / 5200 は他の spec）。
const BASE_PORT = 5300 + 30 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const PROFILE = { pinned: 0, splitImportmap: 1, splitAuto: 2, csp: 3, selfhost: 4, inplace: 5 } as const;
type Profile = keyof typeof PROFILE;
const origin = (p: Profile) => `http://localhost:${BASE_PORT + PROFILE[p]}`;
const app = (p: Profile, path = "") => `${origin(p)}/booking/${path}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const EXAMPLE = resolve(REPO_ROOT, "examples/prod-booking");

let server: ChildProcess;

test.beforeAll(async () => {
  if (!existsSync(resolve(EXAMPLE, "node_modules/state-v1/package.json"))) {
    throw new Error("examples/prod-booking has no node_modules: cd examples/prod-booking && npm ci");
  }
  server = spawn(process.execPath, ["examples/prod-booking/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(BASE_PORT), WCS_LOCAL: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("prod-booking server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("prod-booking server running")) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`prod-booking server exited with ${code}`)); });
  });
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill();
  await exited;
});

// --- helpers -------------------------------------------------------------------

async function hook(p: Profile, path: string): Promise<void> {
  const res = await fetch(origin(p) + path, { method: "POST" });
  expect(res.status, path).toBe(200);
}
async function reset(p: Profile, deployed: "v1" | "v2" = "v2"): Promise<void> {
  await hook(p, "/api/test/reset");
  await hook(p, `/api/test/deploy?to=${deployed}`);
}
async function clientErrors(p: Profile): Promise<{ deployed: string; report: { kind: string; message: string; cause?: string | null } }[]> {
  return (await fetch(`${origin(p)}/booking/api/client-errors`)).json();
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const slot = (page: Page, start: string) => page.locator("booking-calendar button.slot").filter({ hasText: new RegExp(`^\\s*${start}`) });
const unexpected = (messages: string[], ...allow: RegExp[]) => messages.filter((m) => !allow.some((re) => re.test(m)));
// a 409 / 422 the app shows on purpose comes with the browser's own resource line
const EXPECTED_HTTP = /Failed to load resource: the server responded with a status of (409|422|500)/;

/** CSP の違反を、ページが読む前から数える */
async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as any).__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
}
const violations = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__violations);

async function roomsShown(page: Page): Promise<void> {
  await expect(page.locator("li.room")).toHaveCount(8);
  await expect(page.locator("li.room price-tag").first()).toContainText("1,500");
}

// --- the app, everyday -------------------------------------------------------------

test("pinned: 深いリンクで部屋のページ、予約・同じ枠の 409・入力の 422・取り消し・Back / Forward、コンソールに誤りなし", async ({ page }) => {
  await reset("pinned");
  const errors = collectErrors(page);
  await page.goto(app("pinned", "rooms/3"));
  await expect(page.locator("#page-room h2")).toHaveText("Cedar");
  await expect(page.locator("#page-room .muted")).toContainText(/Day: \w+day/);   // the date filter, once the day is set
  await expect(page.locator("booking-calendar button.slot")).toHaveCount(9);

  await slot(page, "10:00").click();
  await expect(page.locator("#selected-slot")).toHaveText("10:00");
  await page.fill("input[name=title]", "Standup");
  await page.click("form.book button[type=submit]");
  await expect(page.locator("#create-message")).toHaveText("Booked.");
  await expect(slot(page, "10:00")).toBeDisabled();

  // someone else takes 11:00 while this page still shows it free
  const taken = await fetch(`${origin("pinned")}/booking/api/bookings`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: 3, date: today(), start: "11:00", end: "12:00", title: "Elsewhere" }),
  });
  expect(taken.status).toBe(201);
  await slot(page, "11:00").click();
  await page.fill("input[name=title]", "Retro");
  await page.click("form.book button[type=submit]");
  await expect(page.locator("#create-message")).toHaveText("That slot is already taken.");
  await expect(slot(page, "11:00")).toBeDisabled();

  await slot(page, "12:00").click();
  await page.fill("input[name=title]", "");
  await page.click("form.book button[type=submit]");
  await expect(page.locator("#create-message")).toHaveText("Please fix the fields marked.");
  await expect(page.locator("#err-title")).toHaveText("title is required");

  await page.click("nav a[href='/booking/bookings']");
  await expect(page.locator("li.booking")).toHaveCount(2);
  await page.locator("li.booking", { hasText: "Standup" }).locator("button.cancel").click();
  await expect(page.locator("li.booking")).toHaveCount(1);

  await page.goBack();
  await expect(page.locator("#page-room h2")).toHaveText("Cedar");
  await expect(slot(page, "10:00")).toBeEnabled();   // the cancelled slot is free again
  await page.goForward();
  await expect(page.locator("li.booking")).toHaveCount(1);
  expect(unexpected(errors, EXPECTED_HTTP)).toEqual([]);
});

test("ほかのライブラリのタグ（<intranet-badge>）がアプリのコンポーネントより前にあっても自動読み込みは止まらない — autoloader が先、split auto entry が <wcs-state> を後で定義しても", async ({ page }) => {
  for (const p of ["pinned", "splitAuto"] as const) {
    await reset(p);
    const errors = collectErrors(page);
    await page.goto(app(p));
    await roomsShown(page);
    expect(await page.evaluate(() => !!customElements.get("intranet-badge"))).toBe(false);   // nobody defines it
    await page.locator("li.room a").nth(2).click();
    await expect(page.locator("booking-calendar button.slot")).toHaveCount(9);
    expect(unexpected(errors), p).toEqual([]);
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
  }
});

test("split-auto: 部屋のページだけが要る add-on（list-keys）は、そのルートに入ったときに読まれる", async ({ page }) => {
  await reset("splitAuto");
  const requested: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/dist/split/features/")) requested.push(r.url().replace(/.*\/features\//, "")); });
  await page.goto(app("splitAuto"));
  await roomsShown(page);
  expect(requested).not.toContain("list-keys.js");
  await page.locator("li.room a").nth(2).click();
  await expect(page.locator("booking-calendar button.slot")).toHaveCount(9);
  expect(requested).toContain("list-keys.js");
});

test("rooms の失敗（500）は文言で知らせ、再読み込みで戻る", async ({ page }) => {
  await reset("pinned");
  await hook("pinned", "/api/test/fail-next?path=rooms");
  const errors = collectErrors(page);
  await page.goto(app("pinned"));
  await expect(page.locator("#page-rooms .err")).toHaveText("Could not load the rooms.");
  await page.reload();
  await roomsShown(page);
  await expect(page.locator("#page-rooms .err")).toHaveCount(0);
  expect(unexpected(errors, EXPECTED_HTTP)).toEqual([]);
});

// --- the delivery -------------------------------------------------------------------

test("@browsers split-importmap: import map の integrity が core・add-on・chunk のすべてを覆い、書き換えた chunk は拒まれる", async ({ page }) => {
  await reset("splitImportmap");
  const errors = collectErrors(page);
  await page.goto(app("splitImportmap"));
  await roomsShown(page);
  const map = JSON.parse(await page.locator("script[type=importmap]").textContent() ?? "{}");
  const covered = Object.keys(map.integrity ?? {});
  expect(covered.some((u) => u.endsWith("/dist/split/core.js"))).toBe(true);
  expect(covered.filter((u) => u.includes("/dist/split/chunks/")).length).toBeGreaterThan(5);
  expect(unexpected(errors)).toEqual([]);

  // the same page with every chunk changed on the way
  const tampered = await page.context().newPage();
  const tamperedErrors = collectErrors(tampered);
  await tampered.route("**/dist/split/chunks/*.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()) + "\n;" });
  });
  await tampered.goto(app("splitImportmap"));
  await tampered.waitForTimeout(1500);
  await expect(tampered.locator("li.room")).toHaveCount(0);
  expect(await tampered.evaluate(() => !!customElements.get("wcs-state"))).toBe(false);
  expect(tamperedErrors.join("\n")).toMatch(/integrity|digest|hash/i);
});

test("@browsers csp: nonce と Trusted Types の厳しい CSP の下で、違反なしに動き、ガードは router の nonce で通る", async ({ page }) => {
  await reset("csp");
  await recordViolations(page);
  const errors = collectErrors(page);
  const res = await page.goto(app("csp"));
  const policy = res?.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("require-trusted-types-for 'script'");
  expect(policy).not.toContain("unsafe-inline");
  await roomsShown(page);

  await page.locator("li.room a").nth(2).click();
  await expect(page.locator("booking-calendar button.slot")).toHaveCount(9);   // components build their shadow without innerHTML

  await page.click("nav a[href='/booking/admin']");
  await expect(page.locator("#page-login")).toBeVisible();   // the guard ran (blob: import on the router's nonce)
  await page.click("#login");
  await expect(page.locator("#admin-stats")).toContainText("0 bookings in 8 rooms");
  expect(await violations(page)).toEqual([]);
  expect(unexpected(errors)).toEqual([]);

  // the protection is in effect: an HTML sink without a policy is refused
  const sink = await page.evaluate(() => { try { document.createElement("div").innerHTML = "<b>x</b>"; return "allowed"; } catch { return "refused"; } });
  expect(sink).toBe("refused");
});

test("本番のエラーはページの error リスナーに届く（split-importmap、diagnostics なし）: 初期化の失敗も、適用に失敗した束縛も", async ({ page }) => {
  // a 3.x filter name in the markup: the <wcs-state> fails to initialize, the page stays empty
  await reset("splitImportmap");
  await page.route("**/booking/", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace("textContent: roomsSummary", "textContent: roomsSummary|uc") });
  });
  await page.goto(app("splitImportmap"));
  await expect.poll(async () => (await clientErrors("splitImportmap")).map((e) => e.report.message).join("\n")).toContain('#501 "uc"');
  await expect(page.locator("li.room")).toHaveCount(0);

  // a getter that throws while its binding applies: the page goes on, the error arrives with its cause
  await reset("splitImportmap");
  const fresh = await page.context().newPage();
  await fresh.route("**/booking/state.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace('get roomsSummary() { return this.roomList.length + " rooms"; }', "get roomsSummary() { return this.rooms[0].nmae.toUpperCase(); }") });
  });
  await fresh.goto(app("splitImportmap"));
  await roomsShown(fresh);
  await expect.poll(async () => (await clientErrors("splitImportmap")).map((e) => `${e.report.message} | ${e.report.cause}`).join("\n")).toMatch(/#12 .*roomsSummary[\s\S]*\| .*(toUpperCase|null|undefined)/);
});

test("script の無い <wcs-guard-handler>（HTML を処理するバンドラーが外す）は管理ページを閉じ、guard の行き先へ送る", async ({ page }) => {
  await reset("pinned");
  await page.goto(app("pinned"));
  await page.evaluate(() => localStorage.setItem("booking.admin", JSON.stringify({ token: "admin" })));
  await page.goto(app("pinned", "admin"));
  await expect(page.locator("#page-admin")).toBeVisible();   // with its script, the guard lets the admin in

  await page.route("**/booking/admin", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/(<wcs-guard-handler>)[\s\S]*?(<\/wcs-guard-handler>)/, "$1$2") });
  });
  await page.goto(app("pinned", "admin"));
  await expect(page).toHaveURL(/\/booking\/login$/);
  await expect(page.locator("#page-login")).toBeVisible();
  await expect(page.locator("#page-admin")).toHaveCount(0);
});

// --- the deploy ---------------------------------------------------------------------

test("版を URL に入れた配信: v2 を配備しても開いたままの v1 のタブは自分の版のファイルで動き続け、その Reload で v2 に届く。v2 の素の location.reload() も文書を読み直す", async ({ page }) => {
  await reset("selfhost", "v1");
  const errors = collectErrors(page);
  const lazy: string[] = [];
  await page.goto(app("selfhost"));
  await roomsShown(page);
  await expect(page.locator("#app-version")).toHaveText("v1");
  page.on("request", (r) => { if (/\/components\/|\/features\//.test(r.url())) lazy.push(new URL(r.url()).pathname); });

  await hook("selfhost", "/api/test/deploy?to=v2");
  await expect(page.locator("#update-banner")).toBeVisible({ timeout: 15_000 });

  await page.locator("li.room a").nth(2).click();   // a route this tab has not rendered: a component and an add-on load now
  await expect(page.locator("booking-calendar button.slot")).toHaveCount(9);
  expect(lazy).toContain("/booking/v1/components/booking/calendar.js");
  expect(lazy).toContain("/booking/vendor/@wcstack/state@4.6.2/dist/split/features/list-keys.js");
  await slot(page, "14:00").click();
  await page.fill("input[name=title]", "From the old tab");
  await page.click("form.book button[type=submit]");
  await expect(page.locator("#create-message")).toHaveText("Booked.");   // the v1 form against the v2 server

  await page.click("#update-banner button");   // v1's Reload takes <wcs-router> out first (4.6.2 swallowed the reload)
  await expect(page.locator("#app-version")).toHaveText("v2");
  await page.goto(app("selfhost", "rooms/3"));
  await expect(page.locator("input[name=attendees]")).toBeVisible();
  await expect(slot(page, "14:00")).toBeDisabled();

  // v2's Reload is a plain location.reload(): under the 4.7 router it reloads the document (a rollback here)
  await page.evaluate(() => { (window as any).__sameDocument = true; });
  await hook("selfhost", "/api/test/deploy?to=v1");
  await expect(page.locator("#update-banner")).toBeVisible({ timeout: 15_000 });
  await page.click("#update-banner button");
  await expect(page.locator("#app-version")).toHaveText("v1");
  expect(await page.evaluate(() => (window as any).__sameDocument ?? false)).toBe(false);
  expect(unexpected(errors)).toEqual([]);
});

test("同じ URL を置き換える配信: 開いたままのタブの core は、置き換えた版の add-on を [wcs/feature-foreign] で拒み、error リスナーに届く", async ({ page }) => {
  // The tab runs 4.7 (v2) and the directory is replaced by another build (v1) under the same URLs. The other
  // direction cannot be refused: a 4.6.2 core has no check, so a v1 tab takes a v2 add-on without a word.
  await reset("inplace", "v2");
  const errors = collectErrors(page);
  await page.goto(app("inplace"));
  await roomsShown(page);
  await hook("inplace", "/api/test/deploy?to=v1");

  await page.locator("li.room a").nth(2).click();   // the calendar's state asks for list-keys: now v1's file
  await expect(page.locator("#page-room h2")).toHaveText("Cedar");
  await expect.poll(async () => (await clientErrors("inplace")).map((e) => e.report.cause ?? e.report.message).join("\n")).toContain("[wcs/feature-foreign]");
  await expect(page.locator("booking-calendar button.slot")).toHaveCount(0);
  expect(errors.join("\n")).toContain("[wcs/feature-foreign]");
});

test("2 つのタブ、v1 と v2: どちらで変えた設定も、もう片方と再読み込みのあとに届く", async ({ context }) => {
  await reset("selfhost", "v1");
  const a = await context.newPage();
  await a.goto(app("selfhost", "prefs"));
  await expect(a.locator("#app-version")).toHaveText("v1");
  await a.selectOption("select[name=currency]", "USD");

  await hook("selfhost", "/api/test/deploy?to=v2");
  const b = await context.newPage();
  await b.goto(app("selfhost", "prefs"));
  await expect(b.locator("#app-version")).toHaveText("v2");
  await expect(b.locator("select[name=currency]")).toHaveValue("USD");   // v2 reads what v1 stored

  await b.selectOption("select[name=day]", "tomorrow");
  await b.fill("input[name=default-attendees]", "3");
  await b.locator("input[name=default-attendees]").blur();
  await expect(a.locator("select[name=day]")).toHaveValue("tomorrow");   // v1 reads what v2 stored

  await a.selectOption("select[name=currency]", "JPY");
  await expect(b.locator("select[name=currency]")).toHaveValue("JPY");
  await expect(b.locator("input[name=default-attendees]")).toHaveValue("3");   // v1's write kept v2's key

  await a.reload();
  await expect(a.locator("#app-version")).toHaveText("v2");
  await expect(a.locator("select[name=day]")).toHaveValue("tomorrow");
  await expect(a.locator("select[name=currency]")).toHaveValue("JPY");
  await expect(a.locator("input[name=default-attendees]")).toHaveValue("3");
});
