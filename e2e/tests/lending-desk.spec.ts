import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { LoginResponse, Reservation, ReservationRequest, TestLogEntry } from "../../examples/lending-desk/shared/api.ts";
import type { CartLine } from "../../examples/lending-desk/src/lib/cart.ts";

// examples/lending-desk — みどり市 備品の貸出（継ぎ目アプリ、docs/seam-apps.md の lending-desk）。地区センターの備品を
// 町の団体に貸す SPA: URL に残る検索と期間の空き数、空き数の月のカレンダー、自作のステッパー（TypeScript の
// カスタム要素）の付いた 2 つのタブで同じ申込かご、行ごとの 422、職員の決定が SSE で届く申込の一覧、職員のページ、
// それに状態をページに書いた受付カウンターの画面。TypeScript のチームが strict で書き、サーバーとページが
// shared/ の API の型を共に使う。初めての作者が 4.25.0 で書き、4.26.0 で要らなくなった回避策を外したもの:
// 自前の Vite プラグイン（@wcstack/typescript/vite の wcstack()）とインラインのスクリプトの vite-ignore、
// lint のために外していたメソッドの `: void`、型注釈なしで形をリテラルに写していた counter.html の状態（JSDoc の型）、
// 手で渡していたマニフェスト（ルートの wcstack.manifest.json、stateSource で index.html だけに当たる）、
// interface を通して転送していた $on（型の付いたハンドラ）と `this.$command.x!`、<wcs-sse> の周りの自前の
// beforeunload / pagehide / pageshow とサインアウトの close()（<wcs-sse> が去るときを扱い、url を消すと閉じる）、
// <wcs-debounce> の枠の `undefined`、単体テストの <ul> とキャスト。
//
// この spec は、作者のブラウザのテスト（tests/e2e/*.spec.ts）を意図として固定する。本文は作者が書いたまま。
// - 作者は開発サーバー（Vite）とビルドの両方で走らせた。ここではビルドだけ: CI は e2e.yml で
//   `npm ci && WCS_LOCAL=1 npm run build`（@wcstack/* と Vite プラグインを src から作り直した packages/*/dist に
//   向ける）を先に走らせ、サーバーは例の TypeScript をそのまま Node で動かす（Node 22.18 以上）。
// - 作者は WebKit でも走らせた。このリポジトリの e2e には WebKit のプロジェクトが無い。
// - @browsers の付いたテストは Firefox でも走る: 開いたストリームのまま全体を読み込み直すところ（Firefox は
//   「接続が中断された」と出していた）、2 つのタブでのサインアウト、ライブの更新、サーバーの再起動、受付の画面、
//   日付と時間帯。
// どのテストも、捕まえられなかったページのエラーで失敗する。主な流れは expectQuietConsole() でコンソールのエラーと
// 警告が無いこと（wcstack の警告を含む）を確かめる。
//
// 例の静的サーバー（dist/ と /api の中継）をワーカーごとに 8500 + 10 × index、API をその次のポートで立てる
// （4199–4900 / 5000–5540 / 5700– / 6100– / 7100– / 7300– / 7500– / 7700– / 7900– / 8100– / 8300– は他の spec）。
const PORT = 8500 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const API_PORT = PORT + 1;
const API = `http://127.0.0.1:${API_PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const EXAMPLE = resolve(REPO_ROOT, "examples/lending-desk");

// (a worker runs one test at a time, against its own servers; each test that takes `api` resets the API)
base.use({ baseURL: `http://127.0.0.1:${PORT}`, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
base.describe.configure({ timeout: 60_000 });

const servers: ChildProcess[] = [];

function start(script: string, env: Record<string, string>, ready: string): Promise<void> {
  const child = spawn(process.execPath, [script], { cwd: EXAMPLE, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  servers.push(child);
  return new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`${script} did not start in 30s`)), 30_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes(ready)) { clearTimeout(timer); done(); }
    });
    child.on("error", (err) => { clearTimeout(timer); fail(err); });
    child.on("exit", (code) => { clearTimeout(timer); fail(new Error(`${script} exited with ${code}`)); });
  });
}

base.beforeAll(async () => {
  if (!existsSync(resolve(EXAMPLE, "dist/index.html"))) {
    throw new Error("examples/lending-desk is not built: cd examples/lending-desk && npm ci && WCS_LOCAL=1 npm run build");
  }
  await start("server/main.ts", { API_PORT: String(API_PORT) }, "API on");
  await start("server/static.ts", { STATIC_PORT: String(PORT), API_PORT: String(API_PORT) }, "static ");
});

// 子プロセスが終わるまで待つ: 同じワーカーで次に立てるサーバーが同じポートを使う。
base.afterAll(async () => {
  await Promise.all(servers.splice(0).map((child) => {
    if (child.exitCode !== null) return undefined;
    const exited = new Promise((done) => child.once("exit", done));
    child.kill();
    return exited;
  }));
});

// ---------------------------------------------------------------- 作者の fixtures（tests/e2e/fixtures.ts）
// Shared fixtures: every test resets the API, fails on an uncaught page error, and records the console.

interface ConsoleEntry {
  type: string;
  text: string;
}

interface Fixtures {
  consoleLog: ConsoleEntry[];
  /** asserts the console has no error and no warning (except what the pattern allows) */
  expectQuietConsole: (allow?: RegExp) => void;
  api: Api;
}

class Api {
  async reset(today?: string): Promise<void> {
    const r = await fetch(`${API}/api/_test/reset`, { method: "POST", body: JSON.stringify(today ? { today } : {}) });
    expect(r.ok).toBe(true);
  }
  async today(): Promise<string> {
    return ((await (await fetch(`${API}/api/today`)).json()) as { today: string }).today;
  }
  async login(id: string): Promise<string> {
    const r = await fetch(`${API}/api/login`, { method: "POST", body: JSON.stringify({ id, phrase: `midori-${id.toLowerCase()}` }) });
    return ((await r.json()) as LoginResponse).token;
  }
  async post<T>(path: string, token: string, body: unknown): Promise<{ status: number; body: T }> {
    const r = await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as T };
  }
  async reserve(groupId: string, req: ReservationRequest): Promise<Reservation> {
    const r = await this.post<Reservation>("/api/reservations", await this.login(groupId), req);
    expect(r.status).toBe(201);
    return r.body;
  }
  async decide(id: number, decision: "approved" | "denied", reason?: string): Promise<number> {
    return (await this.post(`/api/reservations/${id}/decision`, await this.login("S01"), { decision, reason })).status;
  }
  async fail(path: string, status: number, times = 1): Promise<void> {
    await fetch(`${API}/api/_test/fail`, { method: "POST", body: JSON.stringify({ path, status, times }) });
  }
  async log(): Promise<TestLogEntry[]> {
    return (await (await fetch(`${API}/api/_test/log`)).json()) as TestLogEntry[];
  }
  async itemId(centerId: number, name: string): Promise<number> {
    const token = await this.login("G08");
    const r = await fetch(`${API}/api/items?center=${centerId}&per=500&q=${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await r.json()) as { items: { id: number; name: string }[] };
    const it = body.items.find((i) => i.name === name);
    if (!it) throw new Error(`no ${name} at ${centerId}`);
    return it.id;
  }
}

function watchPage(page: Page, log: ConsoleEntry[]): void {
  page.on("console", (m) => {
    if (m.text().startsWith("[vite]")) return;
    log.push({ type: m.type(), text: m.text() });
  });
  page.on("pageerror", (e) => {
    log.push({ type: "pageerror", text: e.message });
  });
}

const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const api = new Api();
    await api.reset();
    await use(api);
  },
  consoleLog: async ({ page }, use) => {
    const log: ConsoleEntry[] = [];
    watchPage(page, log);
    await use(log);
    const errors = log.filter((l) => l.type === "pageerror");
    expect(errors, "uncaught page errors").toEqual([]);
  },
  expectQuietConsole: async ({ consoleLog }, use) => {
    await use((allow?: RegExp) => {
      const bad = consoleLog.filter((l) => (l.type === "error" || l.type === "warning") && !(allow && allow.test(l.text)));
      expect(bad, "console errors / warnings").toEqual([]);
    });
  },
});

/** Waits until the page's <wcs-state> has bound and run its $connectedCallback. */
async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => customElements.get("wcs-state") !== undefined);
  await page.evaluate(async () => {
    const el = document.querySelector("wcs-state") as (Element & { connectedCallbackPromise?: Promise<void> }) | null;
    await el?.connectedCallbackPromise;
  });
}

async function signIn(page: Page, id: string, path = "/"): Promise<void> {
  await page.goto(path);
  await ready(page);
  if (!page.url().includes("/login")) return;
  await page.getByLabel("団体番号").fill(id);
  await page.getByLabel("あいことば").fill(`midori-${id.toLowerCase()}`);
  await page.getByRole("button", { name: "サインイン" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A second, separate browser (another person), signed in. */
async function otherBrowser(browser: Browser, baseURL: string, id: string, log: ConsoleEntry[] = []): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await context.newPage();
  watchPage(page, log);
  await signIn(page, id);
  return { context, page };
}

function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- サインイン（auth.spec.ts）

test.describe("サインイン（auth.spec.ts）", () => {
  test("an association signs in; the header shows its name, the cart and ログアウト", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("who")).toHaveText("みどり町一丁目町内会");
    await expect(page.getByTestId("cart-count")).toHaveText("0");
    await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
    await expect(page.getByRole("link", { name: "管理" })).toHaveCount(0);
    await expect(page.locator("h1")).toHaveText("備品をさがす");
    expectQuietConsole();
  });

  test("a wrong あいことば is refused", async ({ page, api, expectQuietConsole }) => {
    void api;
    await page.goto("/login");
    await ready(page);
    await page.getByLabel("団体番号").fill("G01");
    await page.getByLabel("あいことば").fill("nope");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page.getByRole("alert")).toHaveText("団体番号かあいことばが違います");
    await expect(page).toHaveURL(/\/login/);
    expectQuietConsole(/status of 401/);
  });

  test("a deep link while signed out comes back to that page after signing in @browsers", async ({ page, api, expectQuietConsole }) => {
    void api;
    await page.goto("/cart");
    await expect(page).toHaveURL(/\/login\?next=%2Fcart/);
    await ready(page);
    await page.getByLabel("団体番号").fill("G02");
    await page.getByLabel("あいことば").fill("midori-g02");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.locator("h1")).toHaveText("申込かご");
    // with a query too
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/?q=%E3%83%86%E3%83%B3%E3%83%88&center=2");
    await expect(page).toHaveURL(/next=/);
    await ready(page);
    await page.getByLabel("団体番号").fill("G02");
    await page.getByLabel("あいことば").fill("midori-g02");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page).toHaveURL(/\/\?q=%E3%83%86%E3%83%B3%E3%83%88&center=2$/);
    await expect(page.getByTestId("q")).toHaveValue("テント");
    expectQuietConsole();
  });

  test("a reload stays signed in @browsers", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G03", "/reservations");
    await page.reload();
    await ready(page);
    await expect(page).toHaveURL(/\/reservations$/);
    await expect(page.getByTestId("who")).toHaveText("みどり市子ども会連合");
    expectQuietConsole();
  });

  test("/admin: staff get in, an association is sent to /", async ({ page, api, browser, baseURL, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/admin");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("h1")).toHaveText("備品をさがす");
    const staff = await otherBrowser(browser, baseURL!, "S01");
    await staff.page.goto("/admin");
    await ready(staff.page);
    await expect(staff.page.locator("h1")).toHaveText("管理 — 申請中の申込");
    await expect(staff.page.getByTestId("who")).toHaveText("職員");
    await expect(staff.page.getByRole("link", { name: "管理" })).toBeVisible();
    await staff.context.close();
    expectQuietConsole();
  });

  test("two tabs: one signs out, the other leaves the member pages @browsers", async ({ page, context, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/cart");
    const tab2 = await context.newPage();
    await tab2.goto("/reservations");
    await ready(tab2);
    await expect(tab2.locator("h1")).toHaveText("申込");
    const streamOpen = (p: Page) => p.evaluate(() => (document.querySelector("wcs-sse") as (Element & { connected: boolean }) | null)?.connected);
    await expect.poll(() => streamOpen(tab2)).toBe(true);
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(tab2).toHaveURL(/\/login\?next=%2Freservations/);
    await expect(tab2.getByTestId("who")).toHaveCount(0);
    // signed out, the stream's url is cleared, and that closes it — in this tab and in the other (the page calls no close())
    await expect.poll(() => streamOpen(page)).toBe(false);
    await expect.poll(() => streamOpen(tab2)).toBe(false);
    expectQuietConsole();
  });
});

// ---------------------------------------------------------------- 検索（search.spec.ts）

const names = (page: Page) => page.locator(".item .item-name").allInnerTexts();

test.describe("検索（search.spec.ts）", () => {
  test("keyword: the URL follows, a reload shows the same search", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    await page.getByTestId("q").fill("テント");
    await expect(page).toHaveURL(/\?q=%E3%83%86%E3%83%B3%E3%83%88$/);
    await expect(page.getByTestId("summary")).toContainText("件");
    const list = await names(page);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((n) => n.includes("テント"))).toBe(true);
    await page.reload();
    await ready(page);
    await expect(page.getByTestId("q")).toHaveValue("テント");
    await expect.poll(() => names(page)).toEqual(list);
    expectQuietConsole();
  });

  test("category, centre, sort; Back returns to the previous search", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    await page.getByTestId("category").selectOption("映像・音響");
    await expect(page).toHaveURL(/category=%E6%98%A0%E5%83%8F/);
    await expect(page.locator(".item").first()).toContainText("映像・音響");
    await page.getByTestId("center").selectOption("2");
    await expect(page).toHaveURL(/center=2/);
    await expect(page.locator(".item").first()).toContainText("北地区センター");
    const metas = await page.locator(".item .item-meta").allInnerTexts();
    expect(metas.every((m) => m.includes("映像・音響") && m.includes("北地区センター"))).toBe(true);
    await page.getByTestId("sort").selectOption("deposit");
    await expect(page).toHaveURL(/sort=deposit/);
    await expect(async () => {
      const deposits = (await page.locator(".item .item-meta").allInnerTexts()).map((m) => Number(/保証金 ([\d,]+)円/.exec(m)?.[1]?.replace(/,/g, "")));
      expect(deposits).toEqual([...deposits].sort((a, b) => a - b));
      expect(deposits.at(-1)).toBeGreaterThan(deposits[0]!);
    }).toPass();
    await page.goBack();
    await expect(page).not.toHaveURL(/sort=deposit/);
    await expect(page.getByTestId("sort")).toHaveValue("name");
    await page.goBack();
    await expect(page).not.toHaveURL(/center=2/);
    await expect(page.getByTestId("center")).toHaveValue("");
    await page.goForward();
    await expect(page.getByTestId("center")).toHaveValue("2");
    expectQuietConsole();
  });

  test("a period: each item shows how many are free, the ones with none are marked", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    // book the only ポップコーン機 of centre 1 for two days
    const id = await api.itemId(1, "ポップコーン機");
    await api.reserve("G02", { lines: [{ itemId: id, from: addDaysIso(today, 5), to: addDaysIso(today, 6), quantity: 1 }], purpose: "祭り", pickupAt: `${addDaysIso(today, 5)}T09:00` });
    await signIn(page, "G01", `/?q=${encodeURIComponent("ポップコーン")}&center=1`);
    await expect(page.getByTestId("free")).toHaveText([""]);
    await page.getByTestId("from").fill(addDaysIso(today, 4));
    await page.getByTestId("to").fill(addDaysIso(today, 5));
    await expect(page).toHaveURL(new RegExp(`from=${addDaysIso(today, 4)}&to=${addDaysIso(today, 5)}`));
    await expect(page.getByTestId("free")).toHaveText(["空き 0 / 1"]);
    await expect(page.locator(".item.none")).toHaveCount(1);
    await expect(page.locator(".item-none")).toBeVisible();
    await page.getByTestId("from").fill(addDaysIso(today, 7));
    await page.getByTestId("to").fill(addDaysIso(today, 8));
    await expect(page.getByTestId("free")).toHaveText(["空き 1 / 1"]);
    await expect(page.locator(".item.none")).toHaveCount(0);
    expectQuietConsole();
  });

  test("20 per page with page numbers; the page is in the URL", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    await expect(page.locator(".item")).toHaveCount(20);
    const first = await names(page);
    const pager = page.getByTestId("pager");
    await pager.getByRole("link", { name: "2", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(pager.getByRole("link", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".item")).toHaveCount(20);
    // (the URL, the current page and the count of 20 are all true before page 2's answer arrives: wait for the
    // items, as the step back below does — read at once, it saw page 1's now and then, 2 of 40 runs)
    await expect.poll(() => names(page)).not.toEqual(first);
    await page.goBack();
    await expect(page).not.toHaveURL(/page=2/);
    await expect.poll(() => names(page)).toEqual(first);
    // a link someone sent
    await page.goto(`/?category=${encodeURIComponent("机・椅子")}&page=2`);
    await ready(page);
    await expect(page.getByTestId("category")).toHaveValue("机・椅子");
    await expect(pager.getByRole("link", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");
    expectQuietConsole();
  });

  test("typing fast never leaves an older answer on the screen (a slow answer overtaken by a newer one)", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    // the first search for 机 is made slow on the server (?delay=), the next one is not
    let slowed = false;
    await page.route(/\/api\/items\?/, async (route) => {
      const url = new URL(route.request().url());
      if (!slowed && url.searchParams.get("q") === "机") {
        slowed = true;
        url.searchParams.set("delay", "2500");
        await route.continue({ url: url.toString() });
      } else await route.continue();
    });
    const q = page.getByTestId("q");
    await q.fill("机");
    await expect.poll(() => slowed).toBe(true);
    await q.fill("椅子");
    await expect(page).toHaveURL(/q=%E6%A4%85%E5%AD%90/);
    await expect.poll(async () => (await names(page)).every((n) => n.includes("椅子")) && (await names(page)).length > 0).toBe(true);
    await page.waitForTimeout(3000); // the slow answer would have landed by now
    const after = await names(page);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((n) => n.includes("椅子"))).toBe(true);
    // an aborted request is logged by Firefox as a warning-free cancellation; nothing else may be said
    expectQuietConsole(/wcs\/fetch-request-superseded/);
  });
});

// ---------------------------------------------------------------- カレンダー（calendar.spec.ts）

const day = (page: Page, date: string) => page.locator(`button.day[data-date="${date}"]`);

test.describe("カレンダー（calendar.spec.ts）", () => {
  test("free counts per day, today marked, days before today cannot be chosen", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    const projector = await api.itemId(1, "プロジェクター"); // stock 2; seeds: approved d+10..11 ×1, pending d+10 ×1
    await signIn(page, "G01", `/items/${projector}`);
    await expect(page.getByTestId("item-name")).toHaveText("プロジェクター");
    await expect(day(page, today)).toHaveClass(/today/);
    if (today.slice(8) !== "01") await expect(day(page, addDaysIso(today, -1))).toBeDisabled();
    await expect(day(page, today)).toBeEnabled();
    // d+10 may be next month
    if (addDaysIso(today, 10).slice(0, 7) !== today.slice(0, 7)) await page.getByTestId("next-month").click();
    await expect(day(page, addDaysIso(today, 10))).toContainText("空き 0");
    await expect(day(page, addDaysIso(today, 10))).toHaveClass(/none/);
    await expect(day(page, addDaysIso(today, 11))).toContainText("空き 1");
    expectQuietConsole();
  });

  test("a period by two clicks, then by the two date fields; 数量 up to what is free on every day", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    const projector = await api.itemId(1, "プロジェクター");
    await signIn(page, "G01", `/items/${projector}`);
    await expect(page.getByTestId("pick-problem")).toContainText("カレンダーで期間を選んでください");
    const a = addDaysIso(today, 1);
    const b = addDaysIso(today, 2);
    if (b.slice(0, 7) !== today.slice(0, 7)) test.skip(true, "today is the last days of a month — covered by the month's-end test");
    await day(page, b).click();
    await expect(page.getByTestId("pick-problem")).toHaveText("終了日を選んでください");
    await day(page, a).click(); // before the first: swapped
    await expect(page.getByTestId("pick-from")).toHaveValue(a);
    await expect(page.getByTestId("pick-to")).toHaveValue(b);
    await expect(page.getByTestId("pick-summary")).toContainText("・2日　空き 2");
    await expect(day(page, a)).toHaveClass(/edge/);
    // the fields: a period over the booked day (d+10 has none free)
    await page.getByTestId("pick-from").fill(addDaysIso(today, 9));
    await page.getByTestId("pick-to").fill(addDaysIso(today, 11));
    await expect(page.getByTestId("pick-problem")).toHaveText("この期間は空きがありません");
    await expect(page.getByTestId("add-to-cart")).toBeDisabled();
    await page.getByTestId("pick-from").fill(addDaysIso(today, 11));
    await expect(page.getByTestId("pick-summary")).toContainText("・1日　空き 1");
    const qty = page.getByTestId("pick-qty");
    await expect(qty.getByRole("button", { name: "数量を増やす" })).toBeDisabled(); // max is what is free: 1
    await expect(qty.getByRole("spinbutton")).toHaveValue("1");
    await expect(qty.getByRole("spinbutton")).toHaveAttribute("aria-valuemax", "1");
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByTestId("added")).toHaveText("かごに入れました");
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    expectQuietConsole();
  });

  for (const tz of ["Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    test(`a period across a month's end and a year's end; at 23:59 and 00:01 in Japan (browser in ${tz}) @browsers`, async ({ browser, baseURL, api }) => {
      const context = await browser.newContext({ baseURL, locale: "ja-JP", timezoneId: tz });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
      // 2026-12-28 23:59 in Japan
      await api.reset("2026-12-28");
      await page.clock.setFixedTime(new Date("2026-12-28T23:59:00+09:00"));
      const tent = await api.itemId(2, "イベントテント 3×3m");
      await signIn(page, "G05", `/items/${tent}`);
      await expect(page.getByTestId("cal-title")).toHaveText("2026年12月");
      await expect(page.locator("button.day.today")).toHaveAttribute("data-date", "2026-12-28");
      await expect(day(page, "2026-12-27")).toBeDisabled();
      await day(page, "2026-12-30").click();
      await page.getByTestId("next-month").click();
      await expect(page.getByTestId("cal-title")).toHaveText("2027年1月");
      await day(page, "2027-01-02").click();
      await expect(page.getByTestId("pick-summary")).toContainText("12/30(水)〜1/2(土)・4日");
      await page.getByTestId("add-to-cart").click();
      await page.goto("/cart");
      await expect(page.locator("td.period")).toHaveText(["12/30(水)〜1/2(土)・4日"]);
      await page.getByTestId("purpose").fill("年末年始の夜警");
      await page.getByTestId("pickup").fill("2026-12-30T09:00");
      await page.getByTestId("submit").click();
      await expect(page).toHaveURL(/\/reservations\/\d+$/);
      const sent = (await api.log()).find((l) => l.method === "POST" && l.path === "/api/reservations");
      expect(sent?.body).toMatchObject({ lines: [{ itemId: tent, from: "2026-12-30", to: "2027-01-02", quantity: 1 }], pickupAt: "2026-12-30T09:00" });
      // two minutes later it is 00:01 on the 29th in Japan: the 28th can no longer be chosen
      await api.reset("2026-12-29");
      await page.clock.setFixedTime(new Date("2026-12-29T00:01:00+09:00"));
      await page.goto(`/items/${tent}`);
      await expect(page.locator("button.day.today")).toHaveAttribute("data-date", "2026-12-29");
      await expect(day(page, "2026-12-28")).toBeDisabled();
      expect(errors).toEqual([]);
      await context.close();
    });
  }
});

// ---------------------------------------------------------------- 申込かご（cart.spec.ts）

async function addFromItemPage(page: Page, itemId: number, from: string, to: string): Promise<void> {
  await page.goto(`/items/${itemId}`);
  await ready(page);
  await expect(page.getByTestId("item-name")).not.toBeEmpty();
  await page.getByTestId("pick-from").fill(from);
  await page.getByTestId("pick-to").fill(to);
  await expect(page.getByTestId("add-to-cart")).toBeEnabled();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("added")).not.toBeEmpty();
}

async function lines(api: Api, today: string): Promise<CartLine[]> {
  const mk = async (center: number, name: string, deposit: number, max: number, quantity: number): Promise<CartLine> => {
    const itemId = await api.itemId(center, name);
    const from = addDaysIso(today, 3);
    const to = addDaysIso(today, 4);
    return { key: `${itemId}:${from}:${to}`, itemId, name, centerId: center, deposit, max, from, to, quantity };
  };
  return [await mk(1, "折りたたみ長机", 0, 20, 2), await mk(1, "ワイヤレスマイク", 3000, 4, 1), await mk(1, "プロジェクター", 10000, 2, 2)];
}

test.describe("申込かご（cart.spec.ts）", () => {
  test("adding, merging the same item and period, the stepper, deleting, the totals, a reload", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    const tent = await api.itemId(1, "イベントテント 3×3m"); // stock 4, deposit 3000
    const mic = await api.itemId(1, "ワイヤレスマイク"); // stock 4, deposit 3000
    await signIn(page, "G04");
    await addFromItemPage(page, tent, addDaysIso(today, 3), addDaysIso(today, 4));
    await addFromItemPage(page, tent, addDaysIso(today, 3), addDaysIso(today, 4));
    await expect(page.getByTestId("added")).toHaveText("かごの同じ行に追加しました");
    await addFromItemPage(page, mic, addDaysIso(today, 5), addDaysIso(today, 5));
    await expect(page.getByTestId("cart-count")).toHaveText("2");
    await page.getByRole("link", { name: "申込かご" }).click();
    await expect(page.locator("h1")).toHaveText("申込かご");
    const rows = page.locator("tr.line");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator("td.period")).toContainText("・2日");
    const totals = page.getByTestId("totals");
    await expect(totals).toContainText("2行");
    await expect(totals).toContainText("3点");
    await expect(totals).toContainText("9,000円");
    // the stepper: buttons
    const qty = rows.nth(0).locator("midori-qty");
    const field = qty.getByRole("spinbutton");
    await expect(field).toHaveValue("2");
    await qty.getByRole("button", { name: "数量を増やす" }).click();
    await expect(field).toHaveValue("3");
    await expect(totals).toContainText("4点");
    await expect(totals).toContainText("12,000円");
    // keys
    await field.focus();
    await field.press("ArrowUp");
    await expect(field).toHaveValue("4");
    await expect(qty.getByRole("button", { name: "数量を増やす" })).toBeDisabled(); // max: what was free
    await field.press("ArrowDown");
    await field.press("ArrowDown");
    await expect(field).toHaveValue("2");
    // typed, clamped on blur
    await field.fill("９");
    await field.blur();
    await expect(field).toHaveValue("4");
    await expect(totals).toContainText("5点");
    await field.fill("0");
    await field.press("Tab");
    await expect(field).toHaveValue("1");
    await expect(totals).toContainText("2点");
    await expect(field).toHaveAttribute("aria-valuenow", "1");
    // deleting
    await rows.nth(0).getByRole("button", { name: "削除" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText("ワイヤレスマイク");
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    // a reload
    await page.reload();
    await ready(page);
    await expect(rows).toHaveCount(1);
    await expect(totals).toContainText("1行");
    await expect(totals).toContainText("3,000円");
    expectQuietConsole();
  });

  test("the same cart in two tabs: a change in one shows in the other", async ({ page, context, api, expectQuietConsole }) => {
    const today = await api.today();
    await signIn(page, "G04");
    await page.evaluate((l) => localStorage.setItem("midori.cart", JSON.stringify(l)), await lines(api, today));
    await page.goto("/cart");
    await ready(page);
    const tab2 = await context.newPage();
    await tab2.goto("/cart");
    await ready(tab2);
    await expect(tab2.locator("tr.line")).toHaveCount(3);
    await page.locator("tr.line").nth(0).locator("midori-qty").getByRole("button", { name: "数量を増やす" }).click();
    await expect(tab2.locator("tr.line").nth(0).getByRole("spinbutton")).toHaveValue("3");
    await expect(tab2.getByTestId("totals")).toContainText("6点");
    await tab2.locator("tr.line").nth(1).getByRole("button", { name: "削除" }).click();
    await expect(page.locator("tr.line")).toHaveCount(2);
    await expect(page.getByTestId("cart-count")).toHaveText("2");
    expectQuietConsole();
  });

  test("a 422 on the third line is shown at that line, and stays with it after the first line is deleted", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    const cart = await lines(api, today);
    await signIn(page, "G04");
    await page.evaluate((l) => localStorage.setItem("midori.cart", JSON.stringify(l)), cart);
    // meanwhile someone else books one of the two projectors for those days
    await api.reserve("G06", { lines: [{ itemId: cart[2]!.itemId, from: cart[2]!.from, to: cart[2]!.to, quantity: 1 }], purpose: "上映会", pickupAt: `${cart[2]!.from}T09:00` });
    await page.goto("/cart");
    await ready(page);
    await page.getByTestId("purpose").fill("地区の防災訓練");
    await page.getByTestId("pickup").fill(`${cart[0]!.from}T09:00`);
    await page.getByTestId("submit").click();
    const rowErrors = page.getByTestId("line-error");
    await expect(rowErrors).toHaveText(["", "", "数量: この期間の空きは1です"]);
    await expect(page.locator("tr.line").nth(2)).toHaveClass(/has-error/);
    await expect(page.getByTestId("submit-message")).toHaveText("入力内容を確かめてください");
    await page.locator("tr.line").nth(0).getByRole("button", { name: "削除" }).click();
    await expect(rowErrors).toHaveText(["", "数量: この期間の空きは1です"]);
    await expect(page.locator("tr.line").nth(1)).toContainText("プロジェクター");
    // fix it and send again: success empties the cart and goes to the new request
    await page.locator("tr.line").nth(1).locator("midori-qty").getByRole("button", { name: "数量を減らす" }).click();
    await page.getByTestId("submit").click();
    await expect(page).toHaveURL(/\/reservations\/\d+$/);
    await expect(page.getByTestId("detail-status")).toHaveText("申請中");
    await expect(page.getByTestId("cart-count")).toHaveText("0");
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("midori.cart"))) ?? "null")).toEqual([]);
    expectQuietConsole(/status of 422/);
  });
});

// ---------------------------------------------------------------- ライブの更新・取消・決定（live.spec.ts）

test.describe("ライブの更新・取消・決定（live.spec.ts）", () => {
  test("staff approve in another browser → the association's list changes without a reload, and the header counts it @browsers", async ({ page, api, browser, baseURL, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/reservations");
    const row7 = page.locator('li.res[data-id="7"]');
    await expect(row7.getByTestId("status")).toHaveText("申請中");
    await expect(page.getByTestId("unseen")).toBeHidden();
    // the association goes elsewhere; staff decide meanwhile
    await page.getByRole("link", { name: "備品をさがす" }).first().click();
    const staffLog: ConsoleEntry[] = [];
    const staff = await otherBrowser(browser, baseURL!, "S01", staffLog);
    await staff.page.goto("/admin");
    await ready(staff.page);
    const card = staff.page.locator('li.res[data-id="7"]');
    await card.getByTestId("approve").click();
    await expect(staff.page.getByTestId("admin-message")).toHaveText("申込 #7 を承認しました");
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("unseen")).toHaveText("1");
    // opening /reservations counts as seen
    await page.getByRole("link", { name: "申込", exact: true }).click();
    await expect(row7.getByTestId("status")).toHaveText("承認");
    await expect(page.getByTestId("unseen")).toBeHidden();
    // while on the list: a decision changes the row and is seen at once
    await staff.page.locator('li.res[data-id="2"]').getByTestId("reason").fill("在庫が足りません");
    await expect(page.locator('li.res[data-id="2"]')).toHaveCount(0); // G02's request is not in G01's list
    await staff.context.close();
    expect(staffLog.filter((l) => l.type === "error" || l.type === "warning" || l.type === "pageerror")).toEqual([]);
    expectQuietConsole();
  });

  test("a new request appears on /admin without a reload; a request that would exceed the stock is marked", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    await signIn(page, "S01", "/admin");
    await expect(page.locator("li.res")).toHaveCount(4);
    // #9 (screen ×1 on d+14..15) together with the approved #8 (×2 on d+15) exceeds the stock of 2
    const d15 = addDaysIso(today, 15);
    const marked = page.locator('li.res[data-id="9"]');
    await expect(marked.getByTestId("conflict")).toHaveText(`在庫を超えます: スクリーン 100型 ${Number(d15.slice(5, 7))}/${Number(d15.slice(8, 10))}`);
    await expect(marked).toHaveClass(/conflict/);
    await expect(page.locator('li.res[data-id="6"]').getByTestId("conflict")).toBeHidden();
    // a new request arrives live, last (oldest first)
    const chairs = await api.itemId(3, "パイプ椅子");
    const r = await api.reserve("G03", { lines: [{ itemId: chairs, from: addDaysIso(today, 9), to: addDaysIso(today, 9), quantity: 10 }], purpose: "研修", pickupAt: `${addDaysIso(today, 9)}T09:00` });
    const card = page.locator(`li.res[data-id="${r.id}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("パイプ椅子×10");
    const ids = await page.locator("li.res").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-id"))));
    expect(ids.at(-1)).toBe(r.id);
    expectQuietConsole();
  });

  test("却下 needs a reason; the association sees the reason on the request", async ({ page, api, browser, baseURL, expectQuietConsole }) => {
    void api;
    await signIn(page, "S01", "/admin");
    const card = page.locator('li.res[data-id="7"]');
    await card.getByTestId("deny").click();
    await expect(page.getByTestId("admin-message")).toHaveText("申込 #7: 却下の理由を入力してください");
    await card.getByTestId("reason").fill("同じ日に市の行事があります");
    await card.getByTestId("deny").click();
    await expect(page.getByTestId("admin-message")).toHaveText("申込 #7 を却下しました");
    const g = await otherBrowser(browser, baseURL!, "G01");
    await g.page.goto("/reservations/7");
    await ready(g.page);
    await expect(g.page.getByTestId("detail-status")).toHaveText("却下");
    await expect(g.page.getByTestId("reason")).toHaveText("却下の理由: 同じ日に市の行事があります");
    await expect(g.page.getByTestId("steps")).toContainText("却下");
    await g.context.close();
    expectQuietConsole();
  });

  test("cancelling a request in 申請中 (with a confirmation)", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/reservations");
    const row = page.locator('li.res[data-id="7"]');
    page.once("dialog", (d) => { expect(d.message()).toContain("#7"); void d.dismiss(); });
    await row.getByTestId("cancel").click();
    await expect(row.getByTestId("status")).toHaveText("申請中");
    page.once("dialog", (d) => void d.accept());
    await row.getByTestId("cancel").click();
    await expect(row.getByTestId("status")).toHaveText("取消");
    await expect(page.getByTestId("cancel-message")).toHaveText("申込 #7 を取り消しました");
    await expect(row.getByTestId("cancel")).toBeHidden();
    expectQuietConsole();
  });

  test("a 409 when staff decided first (the live update did not arrive)", async ({ page, api, expectQuietConsole }) => {
    // this page gets no live updates, so it still shows 申請中
    await page.route(/\/api\/events/, (route) => route.abort());
    await signIn(page, "G01", "/reservations");
    const row = page.locator('li.res[data-id="7"]');
    await expect(row.getByTestId("status")).toHaveText("申請中");
    expect(await api.decide(7, "approved")).toBe(200);
    page.once("dialog", (d) => void d.accept());
    await row.getByTestId("cancel").click();
    await expect(page.getByTestId("cancel-message")).toHaveText("職員がすでに決定したため取り消せませんでした");
    await expect(row.getByTestId("status")).toHaveText("承認"); // reloaded
    expectQuietConsole(/status of 409|ERR_FAILED|api\/events|EventSource|wcs-sse|io-error-unobserved/);
  });
});

// ---------------------------------------------------------------- うまくいかないとき（failures.spec.ts）

test.describe("うまくいかないとき（failures.spec.ts）", () => {
  test("/items/9999 and /items/abc show 見つかりません", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/items/9999");
    await expect(page.locator("h1")).toHaveText("見つかりません");
    await page.goto("/items/abc");
    await expect(page.locator("h1")).toHaveText("見つかりません");
    await page.goto("/no/such/page");
    await expect(page.locator("h1")).toHaveText("見つかりません");
    expectQuietConsole(/status of 404/);
  });

  test("reload on every route @browsers", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "S01");
    for (const [path, h1] of [["/", "備品をさがす"], ["/items/1", "イベントテント 3×3m"], ["/cart", "申込かご"], ["/reservations", "申込"],
      ["/reservations/2", "申込 #2"], ["/admin", "管理 — 申請中の申込"], ["/login", "備品をさがす"] /* signed in: sent on */] as const) {
      await page.goto(path);
      await ready(page);
      await page.reload();
      await ready(page);
      await expect(page.locator("h1").first(), path).toHaveText(h1);
    }
    expectQuietConsole();
  });

  test("Back and Forward through a search, an item and the cart", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    await page.getByTestId("q").fill("机");
    await expect(page).toHaveURL(/q=%E6%9C%BA/);
    await page.locator(".item a").first().click();
    await expect(page).toHaveURL(/\/items\/\d+$/);
    await expect(page.getByTestId("item-name")).toContainText("机");
    await page.getByRole("link", { name: "申込かご" }).click();
    await expect(page.locator("h1")).toHaveText("申込かご");
    await page.goBack();
    await expect(page.getByTestId("item-name")).toContainText("机");
    await page.goBack();
    await expect(page.getByTestId("q")).toHaveValue("机");
    await expect(page.locator(".item").first()).toContainText("机");
    await page.goForward();
    await expect(page.getByTestId("item-name")).toContainText("机");
    await page.goForward();
    await expect(page.locator("h1")).toHaveText("申込かご");
    expectQuietConsole();
  });

  test("the token is no longer accepted (401) while filling the cart: sign in again and come back, the cart kept", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    await signIn(page, "G01");
    const tent = await api.itemId(1, "イベントテント 3×3m");
    await page.goto(`/items/${tent}`);
    await ready(page);
    await page.getByTestId("pick-from").fill(addDaysIso(today, 3));
    await page.getByTestId("pick-to").fill(addDaysIso(today, 3));
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    await api.fail("/api/items", 401);
    await page.getByRole("link", { name: "備品をさがす" }).first().click();
    await expect(page).toHaveURL(/\/login\?next=%2F/);
    await expect(page.getByRole("alert")).toContainText("もう一度サインインしてください");
    await page.getByLabel("団体番号").fill("G01");
    await page.getByLabel("あいことば").fill("midori-g01");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    expectQuietConsole(/status of 401/);
  });

  test("a 500 on 申し込む, and offline while sending: the cart stays, a message says so, sending again works", async ({ page, context, api, expectQuietConsole }) => {
    const today = await api.today();
    const tent = await api.itemId(1, "イベントテント 3×3m");
    await signIn(page, "G01");
    await page.evaluate((l) => localStorage.setItem("midori.cart", JSON.stringify(l)),
      [{ key: `${tent}:${addDaysIso(today, 3)}:${addDaysIso(today, 3)}`, itemId: tent, name: "イベントテント 3×3m", centerId: 1, deposit: 3000, max: 4, from: addDaysIso(today, 3), to: addDaysIso(today, 3), quantity: 1 }]);
    await page.goto("/cart");
    await ready(page);
    await page.getByTestId("purpose").fill("夏祭り");
    await page.getByTestId("pickup").fill(`${addDaysIso(today, 3)}T09:00`);
    await api.fail("/api/reservations", 500);
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("submit-message")).toHaveText("送信できませんでした（500）。もう一度お試しください。");
    await expect(page.locator("tr.line")).toHaveCount(1);
    await context.setOffline(true);
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("submit-message")).toHaveText("送信できませんでした。接続を確かめてもう一度お試しください。");
    await context.setOffline(false);
    await page.getByTestId("submit").click();
    await expect(page).toHaveURL(/\/reservations\/\d+$/);
    expectQuietConsole(/status of 500|ERR_INTERNET_DISCONNECTED|NetworkError|Failed to fetch|Load failed|network connection was lost|WebKit encountered an internal error|io-error-unobserved/);
  });

  test("a 500 on a decision: the request stays pending, a message says so", async ({ page, api, expectQuietConsole }) => {
    await signIn(page, "S01", "/admin");
    await api.fail("/api/reservations/7/decision", 500);
    const card = page.locator('li.res[data-id="7"]');
    await card.getByTestId("approve").click();
    await expect(page.getByTestId("admin-message")).toHaveText("決定を送れませんでした（500）。もう一度お試しください。");
    await expect(card).toBeVisible();
    await card.getByTestId("approve").click();
    await expect(card).toHaveCount(0);
    expectQuietConsole(/status of 500/);
  });

  test("the server slow (?delay=2000): the list says it is loading, then shows", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/?delay=2000");
    await expect(page.locator(".summary .loading")).toBeVisible();
    await expect(page.locator(".item")).toHaveCount(20, { timeout: 6000 });
    await expect(page.locator(".summary .loading")).toBeHidden();
    expectQuietConsole();
  });

  test("the live updates come back after the API restarts (the connection drops, then reconnects) @browsers", async ({ page, api, browser, baseURL, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/reservations");
    // dropping every stream is what a restart looks like to the browser
    await fetch(`${API}/api/_test/reset`, { method: "POST" });
    // the page resyncs on reconnect; a decision made after it arrives live
    await page.waitForTimeout(3000);
    const staff = await otherBrowser(browser, baseURL!, "S01");
    await staff.page.goto("/admin");
    await ready(staff.page);
    await staff.page.locator('li.res[data-id="7"]').getByTestId("approve").click();
    await expect(page.locator('li.res[data-id="7"]').getByTestId("status")).toHaveText("承認", { timeout: 10_000 });
    await staff.context.close();
    expectQuietConsole(/api\/events|ERR_INCOMPLETE_CHUNKED_ENCODING|interrupted|io-error-unobserved/);
  });
});

// ---------------------------------------------------------------- 受付の画面とステッパー（counter-qty.spec.ts）

test.describe("受付の画面（counter-qty.spec.ts）", () => {
  test("today's pickups and returns for one centre, updated live @browsers", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    await page.goto("/counter.html?center=2");
    await expect(page.getByTestId("counter-title")).toHaveText("北地区センター　受付");
    const pickups = page.getByTestId("pickups").locator("li");
    const returns = page.getByTestId("returns").locator("li");
    await expect(pickups).toHaveCount(2);
    await expect(returns).toHaveCount(2);
    await expect(pickups.first()).toContainText("08:00");
    await expect(page.locator("footer")).toContainText("ライブ");
    // a request for today is approved: it appears without a reload
    const bench = await api.itemId(2, "ベンチ");
    const r = await api.reserve("G06", { lines: [{ itemId: bench, from: today, to: today, quantity: 2 }], purpose: "清掃", pickupAt: `${today}T15:00` });
    expect(await api.decide(r.id, "approved")).toBe(200);
    await expect(pickups).toHaveCount(3);
    await expect(pickups.last()).toContainText("15:00");
    await expect(pickups.last()).toContainText("ベンチ × 2");
    await expect(returns).toHaveCount(3);
    expectQuietConsole();
  });

  test("without ?center= it says what to add", async ({ page, api, expectQuietConsole }) => {
    void api;
    await page.goto("/counter.html");
    await expect(page.getByRole("alert")).toContainText("?center=");
    expectQuietConsole();
  });
});

test.describe("wcstack の無いページのステッパー（counter-qty.spec.ts）", () => {
  test("buttons, keys, typed digits clamped on blur, aria, the change event", async ({ page, expectQuietConsole }) => {
    await page.goto("/qty-test.html");
    expect(await page.evaluate(() => customElements.get("wcs-state"))).toBeUndefined();
    const qty = page.locator("midori-qty");
    const field = qty.getByRole("spinbutton", { name: "テスト数量" });
    await expect(field).toHaveValue("2");
    await qty.getByRole("button", { name: "テスト数量を増やす" }).click();
    await expect(page.locator("#out")).toHaveText("3");
    await field.press("ArrowUp");
    await field.press("ArrowUp");
    await expect(field).toHaveValue("5");
    await expect(qty.getByRole("button", { name: "テスト数量を増やす" })).toBeDisabled();
    await field.press("Home");
    await expect(field).toHaveValue("1");
    await expect(qty.getByRole("button", { name: "テスト数量を減らす" })).toBeDisabled();
    await field.fill("42");
    await field.blur();
    await expect(field).toHaveValue("5");
    await expect(field).toHaveAttribute("aria-valuenow", "5");
    await expect(field).toHaveAttribute("aria-valuemin", "1");
    await expect(field).toHaveAttribute("aria-valuemax", "5");
    await expect(page.locator("#count")).toHaveText("5");
    // set by a program: no change event
    await page.getByRole("button", { name: "プログラムから 4 にする" }).click();
    await expect(field).toHaveValue("4");
    await page.getByRole("button", { name: "max を 3 にする" }).click();
    await expect(field).toHaveValue("3");
    await expect(page.locator("#count")).toHaveText("5");
    expectQuietConsole();
  });
});
