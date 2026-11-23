// @ts-nocheck — the bodies are the author's JavaScript tests, kept as written
import { test as base, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
// (the FAQ test counts with the arithmetic the <faq-node> part itself uses, as the author's test did)
import { countQuestions, walk } from "../../examples/garden-plots/public/parts/lib/faq.js";

// examples/garden-plots — みどり市 市民農園 区画管理（継ぎ目アプリ、docs/seam-apps.md の garden-plots）。農政課の職員が市の
// 市民農園（4 農園・298 区画）を扱う画面を、部品から組み立てたもの: デザイナーの部品は HTML ファイルに書いた
// Declarative Custom Component（midori-badge / toggle / pager / tabs / dialog / toast）、開発者の部品は bind-component で
// ページのデータに載せるクラス（garden-card → area-block → plot-tile、tenant-editor、深さの決まらない faq-node）、
// 別のベンダーの要素（ken-postal、閉じた shadow root）、状態はルートと機能ごとのボリューム（map / plot / waiting / faq /
// settings）。区画マップ、区画のページ（保存・422・409・利用開始・返還・休止）、待機者、よくある質問の木、設定、同じ部品を
// 別の状態に載せた市民向けの読むだけのページ（/public.html）、部品のショーケース（/parts.html）。初めての作者が
// 4.27.0 で書き、4.28.0 で要らなくなった回避策を外したもの:
// - ページが自分で持っていた部品のローダー（/parts/loader.js、window.midoriParts、`|dcc` を付けたキー）。
//   @wcstack/autoloader の dcc ローダーが .html のファイルを取りに行き、定義をページの末尾の隠れた要素
//   （#wcs-autoloader-definitions）に置く。読み込めない部品は autoloader が console.error で言う
//   （`Failed to eager load component '<tag>'` とファイルの URL）。ページ自身の知らせ（<wcs-defined> の missing）は同じ
// - <wcs-link> の代わりに router へ頼んでいた素の <a onclick>（「この区画のページへ」と前後の区画）
// - ルートに置いた savedSettings と、それをボリュームへ写す watch（<wcs-storage> を settings.stored に直接結ぶ。
//   ボリュームのファイルが後から届いてもよい）
// - volumesGrafted と各ボリュームの `grafted`、それを待つポーリング（ボリュームの connectedCallbackPromise は接ぎ木の
//   後に解決する）、状態ファイルの modulepreload
// - 番号ごとに使い回していたページャーの行のオブジェクト（番号はデータで、行は $listKeys が保つ）
// 取り込みで見つけて、例の側で直したもの（どちらも作者のアプリの書き方で、回避策ではない。docs/seam-apps.md）:
// - テーマと密度のラジオは、値を与える `attr.value:` を `radio:` より前に書く。逆だと、最初の描画ではどれも選ばれず、
//   何も言わない。保存した設定がページを描く前に届くようになって、設定のテストが落ちて分かった。
// - 自分の保存は SSE でも返ってきて、サーバーは知らせを応答より先に書く。作者のアプリは応答が先に着くことに頼って
//   いて、知らせが先に着くと「他の職員によって変更されました」と出した（WebKit ではいつも）。保存中に届いた知らせは、
//   応答の後で判定する。
//
// この spec は、作者のブラウザのテスト（tests/e2e/*.spec.js の loading / map / pages / parts / plot / waiting、44 件）を
// 意図として固定する。本文は作者が書いたまま。作者の走らせ方と違うところ:
// - CDN を使わない。WCS_LOCAL=1 でページの esm.run の行が /packages/<pkg>/dist/auto.min.js になるので、作者の CDN の
//   キャッシュ（cachedCdn）は無い。
// - 作者は Chromium・Firefox・WebKit で全部を走らせた。ここでは Chromium で全部、@browsers の付いたテストを Firefox
//   でも走らせる（このリポジトリの e2e には WebKit のプロジェクトが無い）: 遅れて届く部品（Firefox は遅いモジュールが
//   届くまで load を待つ）、ファイルから来るデザイナーの部品、ボリュームに直接結んだ設定と別のタブ、ページャーの
//   フォーカス、ダイアログとフォーカスの戻り、前後の区画、開いた行の移動。
// - コンソール: 4.27.0 の誤報 `[wcs/write-path-missing] "(map|plot|waiting|faq|settings)" is not declared` の許容を
//   外した（4.28 は言わない）。主な流れは expectCleanConsole() で終わり、エラーや警告が 1 つでもあれば失敗する。
//   Firefox が読み込みの途中で外れた部品を「failed to initialize」と報告する分（INTERRUPTED_DCC）だけは、作者のまま許す。
// - 前後の区画は <wcs-link> が隣に作る <a> を押す（作者の `a.next` / `a.prev` は素のリンクだった。<wcs-link> は class を
//   <a> に写さない）。
// どのテストも、捕まえられなかったページのエラーで失敗する。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）でワーカーごとに 8700 + 10 × index のポートで立てる
// （4199–4900 / 5000–5540 / 5700– / 6100– / 7100– / 7300– / 7500– / 7700– / 7900– / 8100– / 8300– / 8500– は他の spec）。
const PORT = 8700 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const APP = `http://localhost:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

// (a worker runs one test at a time, against its own server; each test that takes `api` resets it)
// The viewport is the author's: the arrow keys move by the columns of an area's grid, and a click at (10, 10) is
// outside the dialog.
base.use({ baseURL: APP, viewport: { width: 1360, height: 900 }, locale: "ja-JP" });
base.describe.configure({ timeout: 60_000 });

let server: ChildProcess;

base.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/garden-plots/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("garden-plots server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Demo server running")) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`garden-plots server exited with ${code}`)); });
  });
});

// 子プロセスが終わるまで待つ: 同じワーカーで次に立てるサーバーが同じポートを使う。
base.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill();
  await exited;
});

// ---------------------------------------------------------------- 作者の fixtures（tests/e2e/fixtures.js）
// Shared fixtures for the browser tests.
// - api: the server is reset before every test
// - page: fail on an uncaught page error; collect console errors and warnings
// (the author's server fixture is the beforeAll above; the author's CDN cache and the WCS_TRACE aid for the 4.27.0
//  false warning are not here)

/** Messages that are expected noise, never a defect of the page under test. */
const NOISE = [
  // The browser logs every HTTP error response (a 404 plot, a 409 / 422 the test provokes) — network, not the page.
  // A part file that fails is checked through the page's own banner instead.
  /Failed to load resource: the server responded with a status of [45]\d\d/,
];

/**
 * A false report (docs/seam-apps.md, garden-plots): Firefox / WebKit, when a designers' part instance is removed (fast
 * route changes) while its inline state is still being imported, @wcstack/state reports that instance as "failed to
 * initialize" — the documents call a detach during loading an interruption. The instance is gone; the parts on the
 * page that stays work (the prev/next test checks it). Tolerated in this exact form only.
 */
const INTERRUPTED_DCC = /<wcs-state> failed to initialize\. Error: \[@wcstack\/state\] Failed to evaluate the inline <script> of <wcs-state>: (error loading dynamically imported module|Importing a module script failed)/;

const test = base.extend<any>({
  api: async ({}, use) => {
    const call = async (method, path, body) => {
      const r = await fetch(APP + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const text = await r.text();
      return { status: r.status, data: text ? JSON.parse(text) : null };
    };
    await call("POST", "/api/_test/reset");
    await use(call);
  },

  consoleMessages: async ({}, use) => { await use([]); },

  page: async ({ page, consoleMessages, api }, use) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e));
    page.on("console", (m) => {
      if (m.type() !== "error" && m.type() !== "warning") return;
      if (NOISE.some((re) => re.test(m.text()))) return;
      consoleMessages.push(`[${m.type()}] ${m.text()}`);
    });
    await use(page);
    expect(errors.map((e) => e.message).filter((m) => !INTERRUPTED_DCC.test(m)), "uncaught page errors").toEqual([]);
  },
});

/** Every main flow ends with this: no console errors and no warnings. */
// (the author's also let 4.27.0's `[wcs/write-path-missing] "<mount path>" is not declared` through; 4.28 does not say it)
function expectCleanConsole(messages, allow = []) {
  const left = messages.filter((m) => !allow.some((re) => re.test(m)));
  expect(left, "console errors / warnings").toEqual([]);
}

/** A second browser context (another member of staff). */
async function secondStaff(browser, baseURL) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1360, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page, errors };
}

/** Wait until the app has drawn its map (cards, tiles and the header count). */
async function openMap(page, path = "/") {
  await page.goto(path);
  await expect(page.locator("plot-tile button").first()).toBeVisible();
  await expect(page.locator(".free-now strong")).not.toHaveText("—");
}

function tile(page, plotId) {
  return page.locator(`plot-tile button[data-plot-id="${plotId}"]`);
}

// ---------------------------------------------------------------- loading.spec.js
// The parts arriving late and not at all (the server delays or refuses a part's file: POST /api/_test/static).
test.describe("部品が遅れて届く・届かない（loading.spec.js）", () => {
  test("a part arriving 3 s late: a placeholder meanwhile, the real part afterwards @browsers", async ({ page, api }) => {
    await api("POST", "/api/_test/static", { path: "/parts/garden-card.js", delay: 3000 });
    await page.goto("/", { waitUntil: "commit" }); // Firefox and WebKit hold the load event until the late module arrives
    // meanwhile: each card holds its place (checked first: the 3 s can be over by the time the header has its count)
    await expect(page.locator("garden-card").first()).toBeVisible();
    expect(await page.locator("garden-card").first().evaluate((el) => el.matches(":not(:defined)"))).toBe(true);
    const placeholder = await page.locator("garden-card").first().evaluate((el) => getComputedStyle(el, "::before").content);
    expect(placeholder).toContain("読み込み中");
    await expect(page.locator(".free-now strong")).not.toHaveText("—");
    // afterwards
    await expect(page.locator("plot-tile button").first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator(".banner[role=alert]:visible")).toHaveCount(0);
  });

  test("a designers' part arriving late: its text is readable meanwhile, then it becomes the part @browsers", async ({ page, api }) => {
    await api("POST", "/api/_test/static", { path: "/parts/midori-badge.html", delay: 3000 });
    await page.goto("/public.html", { waitUntil: "commit" });
    const legend = page.locator(".legend midori-badge").first();
    await expect(legend).toHaveText("空き");
    expect(await legend.evaluate((el) => el.matches(":not(:defined)"))).toBe(true);
    await expect(legend.locator(".box")).toHaveClass(/k-free/, { timeout: 8000 });
  });

  test("a part that cannot be loaded (404): the page says so, the rest works", async ({ page, api }) => {
    await api("POST", "/api/_test/static", { path: "/parts/midori-pager.html", status: 404 });
    await page.goto("/waiting");
    await expect(page.locator("tr.person").first()).toBeVisible(); // the list itself works
    const banner = page.locator(".banner[role=alert]").first();
    await expect(banner).toContainText("部品を読み込めませんでした（midori-pager）", { timeout: 12000 });
  });

  test("a part whose file throws while evaluated: the page says so", async ({ page, api }) => {
    await api("POST", "/api/_test/static", { path: "/parts/faq-node.js", body: "throw new Error('broken part');" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/help");
    await expect(page.locator(".banner[role=alert]").first()).toContainText("faq-node", { timeout: 12000 });
    await expect(page.locator(".faq-result")).toContainText("質問"); // the page's own text is there
  });

  test("the citizens' page with a missing part says so too", async ({ page, api }) => {
    await api("POST", "/api/_test/static", { path: "/parts/plot-tile.js", status: 404 });
    await page.goto("/public.html");
    await expect(page.locator(".free-total")).not.toHaveText("—");
    await expect(page.locator(".banner[role=alert]").first()).toContainText("plot-tile", { timeout: 12000 });
  });
});

// ---------------------------------------------------------------- map.spec.js
// 区画マップ: the counts, the filter and the URL, selecting, the arrow keys, a change from a second browser context.
test.describe("区画マップ（map.spec.js）", () => {
  test("counts: header, city summary, each garden's 利用率 (read from the cards)", async ({ page, api, consoleMessages }) => {
    const gardens = (await api("GET", "/api/gardens")).data;
    const plots = gardens.flatMap((g) => g.areas.flatMap((a) => a.plots));
    const free = plots.filter((p) => p.status === "free").length;
    await openMap(page);
    await expect(page.locator(".free-now strong")).toHaveText(String(free));
    await expect(page.locator(".city-free")).toHaveText(String(free));
    await expect(page.locator("plot-tile")).toHaveCount(plots.length);
    for (const [i, g] of gardens.entries()) {
      const ps = g.areas.flatMap((a) => a.plots);
      const pct = Math.round((ps.filter((p) => p.status === "used" || p.status === "renewal").length / ps.length) * 100);
      await expect(page.locator(".garden-usage").nth(i)).toHaveText(new RegExp(`利用率 ${pct}%`));
      await expect(page.locator("garden-card").nth(i).locator(".pct")).toHaveText(String(pct));
    }
    // each area: 空き n / m
    const area = gardens[0].areas[0];
    await expect(page.locator("garden-card").first().locator("area-block").first().locator(".count"))
      .toContainText(`空き ${area.plots.filter((p) => p.status === "free").length} / ${area.plots.length}`);
    expectCleanConsole(consoleMessages);
  });

  test("filter: in the URL, dims the tiles that do not match, the counts say how many match", async ({ page, api, consoleMessages }) => {
    const plots = (await api("GET", "/api/gardens")).data.flatMap((g) => g.areas.flatMap((a) => a.plots));
    const n = (s) => plots.filter((p) => p.status === s).length;
    await openMap(page);
    await page.getByRole("link", { name: "休止" }).click();
    await expect(page).toHaveURL(/\?status=paused$/);
    await expect(page.locator(".match-total")).toHaveText(String(n("paused")));
    await expect(page.locator("plot-tile button.dim")).toHaveCount(plots.length - n("paused"));
    const paused = plots.find((p) => p.status === "paused");
    await expect(tile(page, paused.id)).not.toHaveClass(/dim/);
    // a deep link with the filter, and Back
    await page.goto("/?status=free");
    await expect(page.locator(".match-total")).toHaveText(String(n("free")));
    await expect(page.locator("plot-tile button.dim")).toHaveCount(plots.length - n("free"));
    await page.getByRole("link", { name: "すべて" }).click();
    await expect(page).toHaveURL(/\/\?*$/);
    await expect(page.locator("plot-tile button.dim")).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\?status=free$/);
    await expect(page.locator(".match-total")).toHaveText(String(n("free")));
    expectCleanConsole(consoleMessages);
  });

  // (the link is a <wcs-link> now: the role and the name are those of the <a> it makes)
  test("selecting a tile shows the panel; the link opens its page", async ({ page, api, consoleMessages }) => {
    const plot = (await api("GET", "/api/plots/5")).data;
    await openMap(page);
    await tile(page, 5).click();
    await expect(tile(page, 5)).toHaveClass(/selected/);
    await expect(page.locator(".sel-no")).toHaveText(`${plot.gardenName} ${plot.areaName} ${plot.no}`);
    await expect(page.locator(".sel-tenant")).toHaveText(plot.tenant?.name ?? "—");
    await expect(page.locator(".sel-since")).toHaveText(plot.since ?? "—");
    await tile(page, 7).click();
    await expect(tile(page, 5)).not.toHaveClass(/selected/);
    await page.getByRole("link", { name: "この区画のページへ" }).click();
    await expect(page).toHaveURL(/\/plots\/7$/);
    await expect(page.locator(".plot-title")).toContainText((await api("GET", "/api/plots/7")).data.no);
    expectCleanConsole(consoleMessages);
  });

  test("arrow keys move between the tiles of an area", async ({ page, consoleMessages }) => {
    await openMap(page);
    await tile(page, 1).click();
    await page.keyboard.press("ArrowRight");
    await expect(tile(page, 2)).toBeFocused();
    await expect(tile(page, 2)).toHaveClass(/selected/);
    await page.keyboard.press("ArrowDown"); // one row down: the same column
    const focusedId = await page.evaluate(() => {
      let el = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      return Number(el?.dataset?.plotId);
    });
    expect(focusedId).toBeGreaterThan(2);
    await expect(tile(page, focusedId)).toHaveClass(/selected/);
    await page.keyboard.press("Home");
    await expect(tile(page, 1)).toBeFocused();
    await page.keyboard.press("ArrowLeft"); // the first tile: nowhere to go
    await expect(tile(page, 1)).toBeFocused();
    expectCleanConsole(consoleMessages);
  });

  test("live: a change made by another member of staff reaches the tile and the panel within a second", async ({ page, browser, baseURL, api, consoleMessages }) => {
    await openMap(page);
    const target = (await api("GET", "/api/plots/3")).data;
    await tile(page, 3).click();
    const other = await secondStaff(browser, baseURL);
    await other.page.goto("/plots/3");
    await expect(other.page.locator("tenant-editor #name")).toBeVisible();
    await other.page.locator("tenant-editor #name").fill("別所 次郎");
    const started = Date.now();
    await other.page.getByRole("button", { name: "保存" }).click();
    await expect(tile(page, 3).locator(".who")).toHaveText("別所", { timeout: 3000 });
    const took = Date.now() - started;
    expect(took).toBeLessThan(2000); // the save itself plus the live event; the event alone is well under a second
    await expect(page.locator(".sel-tenant")).toHaveText("別所 次郎");
    await other.context.close();
    expect(other.errors).toEqual([]);
    expect(target.no).toBeTruthy();
    expectCleanConsole(consoleMessages);
  });

  test("live: a status change from the API re-counts the header and the card", async ({ page, api, consoleMessages }) => {
    await openMap(page);
    const before = Number(await page.locator(".free-now strong").textContent());
    const plots = (await api("GET", "/api/gardens")).data.flatMap((g) => g.areas.flatMap((a) => a.plots));
    const free = plots.find((p) => p.status === "free");
    await api("PATCH", `/api/plots/${free.id}`, { version: free.version, status: "paused" });
    await expect(page.locator(".free-now strong")).toHaveText(String(before - 1));
    await expect(page.locator(".city-free")).toHaveText(String(before - 1));
    await expect(tile(page, free.id)).toHaveClass(/s-paused/);
    expectCleanConsole(consoleMessages);
  });
});

// ---------------------------------------------------------------- pages.spec.js
// よくある質問, 設定 and the citizens' page.
test.describe("よくある質問・設定・市民向けのページ（pages.spec.js）", () => {
  test.describe("FAQ", () => {
    test("the counts at every depth, opening, searching", async ({ page, api, consoleMessages }) => {
      const tree = (await api("GET", "/api/faq")).data;
      const total = tree.reduce((n, t) => n + countQuestions(t), 0);
      await page.goto("/help");
      await expect(page.locator(".faq-result")).toHaveText(`質問 ${total} 件`);
      const roots = page.locator(".faq-tree > faq-node");
      await expect(roots).toHaveCount(tree.length);
      // every node at every depth shows the questions in it and below it
      const deepest = walk(tree).reduce((a, b) => (b.depth > a.depth ? b : a));
      expect(deepest.depth).toBe(5);
      for (const { node } of walk(tree)) {
        const el = page.locator(`.node[data-node-id="${node.id}"]`);
        await expect(el.locator(".count").first()).toHaveText(String(countQuestions(node)));
      }
      // open the first branch down to the deepest node, by keyboard
      const first = roots.first();
      await first.locator(".head button").first().focus();
      await page.keyboard.press("Enter");
      await expect(first.locator(".head button").first()).toHaveAttribute("aria-expanded", "true");
      await expect(first.locator("ul.qs li").first()).toBeVisible();
      // search: dims the nodes without a match below them, opens the ones with one
      await page.locator("#faq-q").fill("委任状");
      await expect(page.locator(".faq-result")).toHaveText(`「委任状」に該当する質問 1 件（全 ${total} 件）`);
      const hit = page.locator("li.hit");
      await expect(hit).toHaveCount(1);
      await expect(hit).toBeVisible(); // its ancestors opened, five deep
      await expect(page.locator(`.node[data-node-id="${tree[1].id}"]`)).toHaveClass(/dim/);
      await page.locator("#faq-q").fill("");
      await expect(page.locator(".node.dim")).toHaveCount(0);
      expectCleanConsole(consoleMessages);
    });
  });

  test.describe("settings", () => {
    // (<wcs-storage> is bound straight to the settings volume now; what the test sees is the same)
    test("theme and density apply at once on every part, survive a reload, reach the citizens' page and another tab @browsers", async ({ page, context, consoleMessages }) => {
      await page.goto("/settings");
      await expect(page.locator("midori-tabs [role=tab]").first()).toBeVisible();
      await page.getByLabel("ダーク").check();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      // a part's shadow DOM follows (it reads the tokens): the tab strip's colours change
      const bg = await page.locator("midori-tabs [role=tab][aria-selected=true]").evaluate((b) => getComputedStyle(b).backgroundColor);
      expect(bg).toBe("rgb(29, 35, 42)");
      await page.getByLabel("つめる").check();
      await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
      // another tab of the same browser: the change shows there
      const other = await context.newPage();
      await other.goto("/");
      await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.getByLabel("高コントラスト").check();
      await expect(other.locator("html")).toHaveAttribute("data-theme", "contrast");
      // the citizens' page reads the same settings
      const pub = await context.newPage();
      await pub.goto("/public.html");
      await expect(pub.locator("html")).toHaveAttribute("data-theme", "contrast");
      await expect(pub.locator("html")).toHaveAttribute("data-density", "compact");
      await page.getByLabel("ライト").check();
      await expect(pub.locator("html")).toHaveAttribute("data-theme", "light");
      // a reload keeps them
      await page.getByLabel("ダーク").check();
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expect(page.getByLabel("ダーク")).toBeChecked();
      await other.close();
      await pub.close();
      expectCleanConsole(consoleMessages);
    });

    test("通知 toggles: switching 保存の結果 off silences success toasts", async ({ page, api, consoleMessages }) => {
      await page.goto("/settings");
      await page.getByRole("tab", { name: "通知" }).click();
      const sw = page.locator("midori-toggle.notify-saved input");
      await expect(sw).toBeChecked();
      await sw.click({ force: true });
      await expect(sw).not.toBeChecked();
      const plots = (await api("GET", "/api/gardens")).data.flatMap((g) => g.areas.flatMap((a) => a.plots));
      const free = plots.find((p) => p.status === "free");
      await page.goto(`/plots/${free.id}`);
      await page.locator("midori-toggle.pause input").click({ force: true });
      await expect(page.locator(".plot-status")).toContainText("休止");
      await page.waitForTimeout(500);
      await expect(page.locator("midori-toast li")).toHaveCount(0);
      // the tabs keep their keyboard behaviour
      await page.goto("/settings");
      await page.locator("midori-tabs [role=tab]").first().focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.locator("midori-tabs [role=tab][aria-selected=true]")).toHaveText("通知");
      expectCleanConsole(consoleMessages);
    });
  });

  test.describe("citizens' page", () => {
    test("shows the gardens and the free plots with the same parts; nothing can be changed", async ({ page, api, consoleMessages }) => {
      const gardens = (await api("GET", "/api/public/gardens")).data;
      const free = gardens.flatMap((g) => g.areas.flatMap((a) => a.plots)).filter((p) => p.status === "free").length;
      await page.goto("/public.html");
      await expect(page.locator(".free-total")).toHaveText(String(free));
      await expect(page.locator("garden-card")).toHaveCount(gardens.length);
      // (the definition is in the autoloader's hidden #wcs-autoloader-definitions now — still one <midori-badge>)
      await expect(page.locator("midori-badge")).toHaveCount(4 + 1); // the legend (+ the hidden definition)
      const tiles = page.locator("plot-tile button");
      await expect(tiles.first()).toBeDisabled();
      expect(await tiles.evaluateAll((bs) => bs.every((b) => b.disabled))).toBe(true);
      expect(await page.locator("plot-tile .who").evaluateAll((ws) => ws.every((w) => w.textContent === ""))).toBe(true);
      await tiles.first().click({ force: true });
      await expect(page.locator("plot-tile button.selected")).toHaveCount(0);
      // no request but reads
      const log = (await api("GET", "/api/_test/log")).data;
      expect(log.filter((r) => r.path.startsWith("/api/") && r.method !== "GET")).toEqual([]);
      expect(log.some((r) => r.path === "/api/gardens")).toBe(false); // never the staff API (tenant names)
      // the tabs work, and the guide is the page's own markup
      await page.getByRole("tab", { name: "ご利用案内" }).click();
      await expect(page.getByRole("heading", { name: "ご利用案内" })).toBeVisible();
      expectCleanConsole(consoleMessages);
    });
  });
});

// ---------------------------------------------------------------- parts.spec.js
// Each part on its own, on the showcase (/parts.html): what it shows for what it is given, and what it gives back.
test.describe("部品のショーケース（parts.spec.js）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/parts.html");
    await expect(page.locator("#faq faq-node").first()).toBeVisible();
    await expect(page.locator("#pager midori-pager button.num").first()).toBeVisible();
  });

  test("midori-badge: the kind chooses the colour and icon, the text is the content", async ({ page, consoleMessages }) => {
    const badge = page.locator("#badge .subject");
    await expect(badge.locator(".box")).toHaveClass(/k-free/);
    await expect(badge.locator(".icon")).toHaveText("○");
    await page.locator("#badge select").selectOption("warn");
    await expect(badge.locator(".box")).toHaveClass(/k-warn/);
    await expect(badge.locator(".icon")).toHaveText("!");
    await page.locator("#badge .badge-text").fill("要確認");
    await expect(badge).toHaveText(/要確認/);
    for (const kind of ["free", "used", "renewal", "paused", "info", "warn"]) {
      await expect(page.locator(`#badge .all midori-badge[data-kind="${kind}"] .box`)).toHaveClass(new RegExp(`k-${kind}`));
    }
    expectCleanConsole(consoleMessages);
  });

  test("midori-toggle: checked in both directions, disabled", async ({ page, consoleMessages }) => {
    const sw = page.locator("#toggle .subject input[role=switch]");
    const readback = page.locator("#toggle .readback");
    await expect(sw).not.toBeChecked();
    await sw.click({ force: true });
    await expect(readback).toHaveText("true"); // the page follows the switch
    await page.locator("#toggle .page-checked").uncheck();
    await expect(sw).not.toBeChecked(); // the switch follows the page
    await page.locator("#toggle .page-checked").check();
    await expect(sw).toBeChecked();
    await page.locator("#toggle .page-disabled").check();
    await expect(sw).toBeDisabled();
    // the label is the content: clicking the text toggles it when enabled
    await page.locator("#toggle .page-disabled").uncheck();
    await page.locator("#toggle .subject").getByText("休止にする").click();
    await expect(readback).toHaveText("false");
    expectCleanConsole(consoleMessages);
  });

  test("midori-pager: page numbers for total / per, page in both directions", async ({ page, consoleMessages }) => {
    const pager = page.locator("#pager .subject");
    const nums = pager.locator("button.num");
    await expect(nums).toHaveText(["1", "2", "6"]);
    await expect(pager.locator("button.prev")).toBeDisabled();
    await nums.filter({ hasText: "2" }).click();
    await expect(page.locator("#pager .readback")).toHaveText("2");
    await expect(nums).toHaveText(["1", "2", "3", "6"]);
    await expect(pager.locator('button[aria-current="page"]')).toHaveText("2");
    await pager.locator("button.next").click();
    await expect(page.locator("#pager .readback")).toHaveText("3");
    await expect(nums).toHaveText(["1", "2", "3", "4", "5", "6"]); // a gap of one number shows the number
    await page.locator("#pager input.page").fill("6");
    await expect(pager.locator('button[aria-current="page"]')).toHaveText("6");
    await expect(pager.locator("button.next")).toBeDisabled();
    await page.locator("#pager input.total").fill("30");
    await expect(nums).toHaveText(["1", "2"]);
    await expect(pager.locator('button[aria-current="page"]')).toHaveText("2"); // the page past the end shows the last
    await expect(pager.locator(".summary")).toHaveText("2 / 2 ページ（全 30 件）");
    expectCleanConsole(consoleMessages);
  });

  // (the numbers are a data list kept by $listKeys now; the pressed button is still the same element)
  test("midori-pager: keyboard — the focus stays on the number pressed @browsers", async ({ page }) => {
    const pager = page.locator("#pager .subject");
    await pager.locator("button.num", { hasText: "2" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#pager .readback")).toHaveText("2");
    await expect(pager.locator("button.num", { hasText: "2" })).toBeFocused();
  });

  test("midori-tabs: selected in both directions, panels are the page's markup with its bindings, arrow keys", async ({ page, consoleMessages }) => {
    const tabs = page.locator("#tabs .subject");
    await expect(tabs.locator('[role=tab][aria-selected="true"]')).toHaveText("一つ目");
    await expect(page.locator("#tabs .panel-one")).toBeVisible();
    await expect(page.locator("#tabs .panel-two")).toBeHidden();
    await page.locator("#tabs .in-panel").fill("書き換えた");
    await tabs.getByRole("tab", { name: "二つ目" }).click();
    await expect(page.locator("#tabs .readback")).toHaveText("two");
    await expect(page.locator("#tabs .panel-two")).toBeVisible();
    await expect(page.locator("#tabs .echo")).toHaveText("書き換えた"); // the page's binding inside a panel
    await page.locator("#tabs input.selected").fill("three");
    await expect(tabs.locator('[role=tab][aria-selected="true"]')).toHaveText("三つ目");
    await tabs.getByRole("tab", { name: "三つ目" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tabs .readback")).toHaveText("one");
    await expect(tabs.getByRole("tab", { name: "一つ目" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.locator("#tabs .readback")).toHaveText("three");
    expectCleanConsole(consoleMessages);
  });

  test("midori-dialog: the page opens it; Escape, × and outside close it and tell the page; focus goes back @browsers", async ({ page, consoleMessages }) => {
    const open = page.locator("#dialog button.open");
    const dialog = page.locator("#dialog .subject dialog");
    // Opened from the keyboard: WebKit does not focus a button on a mouse click, so there would be nothing to go back to.
    const openByKeyboard = async () => { await open.focus(); await page.keyboard.press("Enter"); };
    await openByKeyboard();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h2")).toHaveText("見本のダイアログ");
    await expect(page.locator("#dialog .dlg-name")).toBeFocused(); // autofocus on the page's field inside
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator("#dialog .readback")).toHaveText("false");
    await expect(open).toBeFocused();

    await openByKeyboard();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "閉じる" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#dialog .readback")).toHaveText("false");
    await expect(open).toBeFocused();

    await open.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(10, 10); // the backdrop
    await expect(dialog).toBeHidden();
    await expect(page.locator("#dialog .readback")).toHaveText("false");

    // the body is the page's own form, bound to the page's data
    await open.click();
    await page.locator("#dialog .dlg-name").fill("佐藤");
    await page.locator("#dialog button.ok").click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("#dialog .log")).toContainText("OK:佐藤");
    await page.locator("#dialog input.title").fill("新しい題");
    await open.click();
    await expect(dialog.locator("h2")).toHaveText("新しい題");
    await page.keyboard.press("Escape");
    expectCleanConsole(consoleMessages);
  });

  test("midori-toast: shows a message, goes away by itself or by ×, at most three visible", async ({ page, consoleMessages }) => {
    const toast = page.locator("#toast .subject");
    await page.locator("#toast .seconds").fill("1");
    await page.locator("#toast .text").fill("ひとつ目");
    await page.locator("#toast button.show").click();
    await expect(toast.locator("li")).toHaveCount(1);
    await expect(toast.locator("li .text")).toHaveText("ひとつ目");
    await expect(toast.locator("li")).toHaveCount(0, { timeout: 4000 }); // by itself
    await page.locator("#toast button.five").click();
    await expect(toast.locator("li")).toHaveCount(3);
    await expect(toast.locator(".more")).toHaveText("ほか 2 件");
    await toast.locator("li").first().getByRole("button", { name: "閉じる" }).click();
    await expect(toast.locator("li")).toHaveCount(3);
    await expect(toast.locator("li").first()).toContainText("お知らせ 2");
    await expect(toast.locator(".more")).toHaveText("ほか 1 件");
    await page.locator("#toast .kind").selectOption("error");
    await page.locator("#toast .seconds").fill("0");
    await page.locator("#toast button.show").click();
    await expect(toast.locator('li[data-kind="error"]')).toHaveCount(0); // waiting behind the visible ones
    expectCleanConsole(consoleMessages);
  });

  test("plot-tile: number, status colour, family name, selected; selecting writes the page's view", async ({ page, consoleMessages }) => {
    const b = page.locator("#tile .subject button");
    await expect(b.locator(".no")).toHaveText("A-01");
    await expect(b.locator(".who")).toHaveText("佐藤");
    await expect(b).toHaveClass(/s-used/);
    await expect(b).toHaveAttribute("aria-pressed", "false");
    await b.click();
    await expect(page.locator("#tile .readback")).toHaveText("true");
    await expect(b).toHaveClass(/selected/);
    await expect(b).toHaveAttribute("aria-pressed", "true");
    await page.locator("#tile button.cycle").click();
    await expect(b).toHaveClass(/s-renewal/);
    await expect(page.locator("#tile .status")).toHaveText("renewal");
    await page.locator("#tile button.rename").click();
    await expect(b.locator(".who")).toHaveText("鈴木");
    await page.locator("#tile select.filter").selectOption("free");
    await expect(b).toHaveClass(/dim/);
    await page.locator("#tile .selectable").uncheck();
    await expect(b).toBeDisabled();
    expectCleanConsole(consoleMessages);
  });

  test("area-block: name, 空き n / m, tiles; the page reads its free count; arrow keys move the selection", async ({ page, consoleMessages }) => {
    const area = page.locator("#area .subject");
    await expect(area.locator("h4")).toHaveText("見本エリア");
    await expect(area.locator("plot-tile")).toHaveCount(12);
    const free = await area.locator(".free").textContent();
    await expect(area.locator(".total")).toHaveText("12");
    await expect(page.locator("#area output.free")).toHaveText(free); // the derived value, read by the page
    await area.locator("plot-tile button").first().click();
    const first = await page.locator("#area .readback").textContent();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#area .readback")).toHaveText(String(Number(first) + 1));
    await expect(area.locator("plot-tile button").nth(1)).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.locator("#area .readback")).toHaveText(String(Number(first) + 11));
    await page.locator("#area select.filter").selectOption("free");
    await expect(area.locator(".matched")).toHaveText(free);
    expectCleanConsole(consoleMessages);
  });

  test("garden-card: 利用率 read by the page, folding is the card's own", async ({ page, consoleMessages }) => {
    const card = page.locator("#garden .subject");
    await expect(card.locator("h3")).toHaveText("見本農園");
    await expect(card.locator("area-block")).toHaveCount(2);
    const pct = await card.locator(".pct").textContent();
    await expect(page.locator("#garden output.usage")).toHaveText(pct);
    await card.locator("button.fold").click();
    await expect(card.locator(".areas")).toBeHidden();
    await expect(card.locator("button.fold")).toHaveAttribute("aria-expanded", "false");
    await card.locator("button.fold").click();
    await expect(card.locator(".areas")).toBeVisible();
    expectCleanConsole(consoleMessages);
  });

  test("tenant-editor: edits in place, its own messages, the unsaved mark, server messages at the fields, postal lookup", async ({ page, consoleMessages }) => {
    const ed = page.locator("#editor .subject");
    const json = page.locator("#editor output.json");
    await expect(ed.locator("#name")).toHaveValue("佐藤 太郎");
    await expect(ed.locator(".dirty")).toBeHidden();
    await ed.locator("#name").fill("佐藤 次郎");
    await expect(json).toContainText('"name":"佐藤 次郎"'); // nothing copied: the page sees it at once
    await expect(ed.locator(".dirty")).toBeVisible();
    await expect(page.locator("#editor output.dirty")).toHaveText("true");
    await ed.locator("#name").fill("");
    await ed.locator("#phone").focus();
    await expect(ed.locator("#name-msg")).toHaveText("氏名は必須です");
    await expect(page.locator("#editor output.valid")).toHaveText("false");
    await ed.locator("#phone").fill("03-12ab");
    await expect(ed.locator("#phone-msg")).toHaveText("電話番号は数字とハイフンで入力してください");
    await ed.locator("#name").fill("佐藤 次郎");
    await ed.locator("#phone").fill("03-1234-5678");
    await expect(page.locator("#editor output.valid")).toHaveText("true");
    await page.locator("#editor button.server-errors").click();
    await expect(ed.locator("#name-msg")).toHaveText("サーバー: 氏名が重複しています");
    await ed.locator("#name").fill("佐藤 三郎");
    await expect(ed.locator("#name-msg")).toHaveText(""); // editing the field clears the server's message
    await expect(ed.locator("#phone-msg")).toHaveText("サーバー: この番号は使えません");
    // the vendor's postal field: typing and the lookup fill the page's data
    const postal = ed.locator("ken-postal");
    await postal.click({ position: { x: 12, y: 12 } }); // the closed shadow root: click its field, then type
    await page.keyboard.press("Control+A");
    await page.keyboard.type("1000021");
    await expect(json).toContainText('"postal":"100-0021"');
    await page.keyboard.press("Enter");
    await expect(json).toContainText('"address":"みどり市川沿町"');
    await expect(ed.locator("#address")).toHaveValue("みどり市川沿町");
    await page.locator("#editor button.mark-saved").click();
    await expect(ed.locator(".dirty")).toBeHidden();
    expectCleanConsole(consoleMessages);
  });

  test("faq-node: counts in it and below it at every depth, opening, search", async ({ page, consoleMessages }) => {
    const roots = page.locator("#faq .stage > faq-node");
    await expect(roots).toHaveCount(2);
    // 申し込み: 2 questions + five levels below with one each = 7; 利用: 1 + 1 = 2
    await expect(roots.nth(0).locator(".count").first()).toHaveText("7");
    await expect(roots.nth(1).locator(".count").first()).toHaveText("2");
    await expect(page.locator("#faq output.total")).toHaveText("9");
    // open the whole chain and read the count at each depth
    const counts = [];
    let node = roots.nth(0);
    for (let depth = 1; depth <= 6; depth++) {
      await node.locator(".head button").first().click();
      counts.push(await node.locator(".count").first().textContent());
      node = node.locator(".body faq-node").first();
    }
    expect(counts).toEqual(["7", "5", "4", "3", "2", "1"]);
    await page.locator("#faq .query").fill("詳細・詳細・詳細");
    await expect(roots.nth(1).locator(".node").first()).toHaveClass(/dim/);
    await expect(roots.nth(0).locator(".count").first()).toHaveText("3 / 7");
    await page.locator("#faq .query").fill("");
    await page.locator("#faq button.add-child").click();
    await expect(roots.nth(1).locator(".count").first()).toHaveText("3");
    await expect(page.locator("#faq output.total")).toHaveText("10");
    expectCleanConsole(consoleMessages);
  });
});

// ---------------------------------------------------------------- plot.spec.js
// 区画 (/plots/:id): editing and saving, a 422 at its fields, a 409, the three actions, the toasts.
test.describe("区画のページ（plot.spec.js）", () => {
  const toast = (page) => page.locator("midori-toast li .text");

  async function findPlot(api, pred) {
    const plots = (await api("GET", "/api/gardens")).data.flatMap((g) => g.areas.flatMap((a) => a.plots));
    return plots.find(pred);
  }

  async function openPlot(page, id) {
    await page.goto(`/plots/${id}`);
    await expect(page.locator(".plot-title")).toBeVisible();
  }

  test("edit the tenant and save; the toast says so; the history grows", async ({ page, api, consoleMessages }) => {
    const plot = await findPlot(api, (p) => p.status === "used");
    await openPlot(page, plot.id);
    const editor = page.locator("tenant-editor");
    const save = page.getByRole("button", { name: "保存", exact: true });
    await expect(save).toBeDisabled(); // nothing changed yet
    await editor.locator("#phone").fill("090-1111-2222");
    await expect(editor.locator(".dirty")).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(toast(page)).toContainText(["利用者情報を保存しました"]);
    await expect(editor.locator(".dirty")).toBeHidden();
    await expect(page.locator(".history li").first()).toContainText("利用者情報を更新");
    expect((await api("GET", `/api/plots/${plot.id}`)).data.tenant.phone).toBe("090-1111-2222");
    expectCleanConsole(consoleMessages);
  });

  test("a 422 puts the server's messages at the fields", async ({ page, api, consoleMessages }) => {
    const plot = await findPlot(api, (p) => p.status === "used");
    await openPlot(page, plot.id);
    const editor = page.locator("tenant-editor");
    await editor.locator("#phone").fill("000-1234-5678"); // valid for the client, refused by the server
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor.locator("#phone-msg")).toHaveText("この電話番号は使用できません");
    await expect(toast(page)).toContainText(["入力内容を確認してください"]);
    await expect(editor.locator("#phone")).toHaveAttribute("aria-invalid", "true");
    await editor.locator("#phone").fill("090-0000-1111");
    await expect(editor.locator("#phone-msg")).toHaveText("");
    expectCleanConsole(consoleMessages);
  });

  test("the client's own rules stop the save", async ({ page, api }) => {
    const plot = await findPlot(api, (p) => p.status === "used");
    await openPlot(page, plot.id);
    const editor = page.locator("tenant-editor");
    await editor.locator("#name").fill("");
    await editor.locator("#phone").fill("abc");
    await expect(editor.locator("#name-msg")).toHaveText("氏名は必須です");
    await expect(editor.locator("#phone-msg")).toHaveText("電話番号は数字とハイフンで入力してください");
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  });

  test("a 409: someone else saved first — overwrite with mine", async ({ page, api, consoleMessages }) => {
    const plot = await findPlot(api, (p) => p.status === "used");
    await openPlot(page, plot.id);
    const editor = page.locator("tenant-editor");
    await editor.locator("#address").fill("みどり市東町 1-1（私）");
    // another member of staff saves first (straight through the API)
    await api("PATCH", `/api/plots/${plot.id}`, { version: plot.version, tenant: { ...plot.tenant, address: "みどり市西町 9-9（他）" } });
    await expect(page.locator(".changed-elsewhere")).toBeVisible(); // the live event, while I hold unsaved changes
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".conflict-text")).toContainText("他の職員が先にこの区画を変更しました");
    await expect(toast(page)).toContainText(["他の職員が先に変更していました"]);
    await page.getByRole("button", { name: "自分の変更で上書きする" }).click();
    await expect(toast(page).last()).toContainText("利用者情報を保存しました");
    expect((await api("GET", `/api/plots/${plot.id}`)).data.tenant.address).toBe("みどり市東町 1-1（私）");
    expectCleanConsole(consoleMessages);
  });

  test("a 409, then show theirs: my changes are dropped", async ({ page, api }) => {
    const plot = await findPlot(api, (p) => p.status === "used");
    await openPlot(page, plot.id);
    await page.locator("tenant-editor #address").fill("私の住所");
    await api("PATCH", `/api/plots/${plot.id}`, { version: plot.version, tenant: { ...plot.tenant, address: "他の住所" } });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByRole("button", { name: /最新の内容を表示する/ }).click();
    await expect(page.locator("tenant-editor #address")).toHaveValue("他の住所");
    await expect(page.locator(".conflict-text")).toHaveCount(0);
  });

  test("利用開始: choose from the first people on the waiting list", async ({ page, api, consoleMessages }) => {
    const plot = await findPlot(api, (p) => p.status === "free");
    const first = (await api("GET", "/api/waiting?sort=priority&per=5")).data.items[0];
    await openPlot(page, plot.id);
    await expect(page.getByRole("button", { name: "返還", exact: true })).toBeHidden();
    const opener = page.getByRole("button", { name: "利用開始" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator(".assign-dialog dialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator(".candidates li")).toHaveCount(5);
    await page.locator(".candidates label").first().click();
    await page.getByRole("button", { name: "利用を開始する" }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page)).toContainText([`利用を開始しました（${first.name}）`]);
    await expect(page.locator(".plot-status")).toContainText("利用中");
    await expect(page.locator("tenant-editor #name")).toHaveValue(first.name);
    const after = (await api("GET", "/api/waiting?sort=priority&per=100")).data;
    expect(after.items.some((w) => w.id === first.id)).toBe(false);
    expectCleanConsole(consoleMessages);
  });

  test("返還: asks to confirm; やめる keeps it; 返還する frees the plot", async ({ page, api, consoleMessages }) => {
    const plot = await findPlot(api, (p) => p.status === "used");
    await openPlot(page, plot.id);
    await page.getByRole("button", { name: "返還", exact: true }).click();
    const dialog = page.locator(".return-dialog dialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator(".return-text")).toContainText(plot.tenant.name);
    await page.locator(".return-dialog").getByRole("button", { name: "やめる" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "返還", exact: true }).click();
    await page.getByRole("button", { name: "返還する" }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page)).toContainText(["返還しました"]);
    await expect(page.locator(".plot-status")).toContainText("空き");
    await expect(page.locator(".no-tenant")).toBeVisible();
    expectCleanConsole(consoleMessages);
  });

  test("休止: the switch pauses and un-pauses the plot", async ({ page, api, consoleMessages }) => {
    const plot = await findPlot(api, (p) => p.status === "free");
    await openPlot(page, plot.id);
    const sw = page.locator("midori-toggle.pause input");
    await sw.click({ force: true });
    await expect(toast(page)).toContainText(["休止にしました"]);
    await expect(page.locator(".plot-status")).toContainText("休止");
    expect((await api("GET", `/api/plots/${plot.id}`)).data.status).toBe("paused");
    await sw.click({ force: true });
    await expect(toast(page).last()).toContainText("休止を解除しました");
    expect((await api("GET", `/api/plots/${plot.id}`)).data.status).toBe("free");
    expectCleanConsole(consoleMessages);
  });

  // The links are <wcs-link class="next"> / class="prev" now (the author's were plain <a class="next" onclick>, pressed
  // as `a.next` / `a.prev`): a <wcs-link> makes its <a> right after itself and does not copy its class to it.
  test("前の区画 / 次の区画, a deep link, 9999 and abc @browsers", async ({ page, api }) => {
    await openPlot(page, 12);
    await page.locator("wcs-link.next + a").click();
    await expect(page).toHaveURL(/\/plots\/13$/);
    await expect(page.locator(".plot-title")).toContainText((await api("GET", "/api/plots/13")).data.no);
    await page.locator("wcs-link.prev + a").click();
    await expect(page).toHaveURL(/\/plots\/12$/);
    // the parts of the page that stays work, whatever happened to the ones replaced on the way
    await expect(page.locator(".plot-status .box")).toHaveClass(/k-/);
    await expect(page.locator("midori-toggle.pause .state")).toHaveText(/オン|オフ/);
    await page.goto("/plots/9999");
    await expect(page.getByRole("heading", { name: "見つかりません" })).toBeVisible();
    await page.goto("/plots/abc");
    await expect(page.getByRole("heading", { name: "見つかりません" })).toBeVisible();
  });

  test("a failed save (500) and an offline save are announced; nothing typed is lost", async ({ page, api, context }) => {
    const plot = await findPlot(api, (p) => p.status === "used");
    await openPlot(page, plot.id);
    await page.locator("tenant-editor #phone").fill("090-5555-6666");
    await api("POST", "/api/_test/fail", { path: `/api/plots/${plot.id}`, status: 500, times: 1, method: "PATCH" });
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page)).toContainText(["保存できませんでした（サーバーのエラー 500）"]);
    await expect(page.locator("tenant-editor .dirty")).toBeVisible();
    await context.setOffline(true);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page).last()).toContainText("サーバーにつながりません");
    await context.setOffline(false);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(toast(page).last()).toContainText("保存しました");
    await expect(page.locator("tenant-editor #phone")).toHaveValue("090-5555-6666");
  });
});

// ---------------------------------------------------------------- waiting.spec.js
// 待機者: paging, sorting, two rows open and edited, moving a person while a row is open, deleting, adding.
test.describe("待機者（waiting.spec.js）", () => {
  const toast = (page) => page.locator("midori-toast li .text");
  const rows = (page) => page.locator("tr.person");
  const row = (page, id) => page.locator(`tr.person[data-id="${id}"]`);
  const editorOf = (page, id) => page.locator(`tr.editor-row[data-id="${id}"] tenant-editor`);

  async function openWaiting(page, path = "/waiting") {
    await page.goto(path);
    await expect(rows(page).first()).toBeVisible();
    await expect(page.locator("midori-pager.pager button.num").first()).toBeVisible();
  }

  test("paging: 20 a page, the page in the URL, Back steps through", async ({ page, api, consoleMessages }) => {
    const all = (await api("GET", "/api/waiting?per=100&sort=applied")).data.items;
    await openWaiting(page);
    await expect(rows(page)).toHaveCount(20);
    await expect(rows(page).first().locator(".name")).toHaveText(all[0].name);
    await page.locator("midori-pager.pager button.num", { hasText: "2" }).click();
    await expect(page).toHaveURL(/\/waiting\?page=2&sort=applied$/);
    await expect(rows(page).first().locator(".name")).toHaveText(all[20].name);
    await page.locator("midori-pager.pager button.next").click();
    await expect(page).toHaveURL(/page=3/);
    await expect(rows(page).first().locator(".name")).toHaveText(all[40].name);
    await page.goBack();
    await expect(page).toHaveURL(/page=2/);
    await expect(rows(page).first().locator(".name")).toHaveText(all[20].name);
    // a deep link to the last page
    await page.goto("/waiting?page=4&sort=applied");
    await expect(rows(page)).toHaveCount(all.length - 60);
    await expect(page.locator('midori-pager.pager button[aria-current="page"]')).toHaveText("4");
    expectCleanConsole(consoleMessages);
  });

  test("sorting by 申込日 and by 優先順, in the URL", async ({ page, api, consoleMessages }) => {
    const byPriority = (await api("GET", "/api/waiting?per=100&sort=priority")).data.items;
    await openWaiting(page);
    await page.getByRole("button", { name: "優先順", exact: true }).click();
    await expect(page).toHaveURL(/sort=priority/);
    await expect(rows(page).first().locator(".priority")).toHaveText("1");
    await expect(rows(page).first().locator(".name")).toHaveText(byPriority[0].name);
    await page.reload();
    await expect(rows(page).first().locator(".name")).toHaveText(byPriority[0].name);
    await expect(page.getByRole("button", { name: "優先順", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "申込日順", exact: true }).click();
    await expect(page).toHaveURL(/sort=applied/);
    expectCleanConsole(consoleMessages);
  });

  test("two rows open and edited at once; each saves its own", async ({ page, api, consoleMessages }) => {
    const items = (await api("GET", "/api/waiting?per=20&sort=applied")).data.items;
    const [a, b] = [items[1], items[4]];
    await openWaiting(page);
    await row(page, a.id).getByRole("button", { name: "編集" }).click();
    await row(page, b.id).getByRole("button", { name: "編集" }).click();
    await editorOf(page, a.id).locator("#name").fill("一人目 変更");
    await editorOf(page, b.id).locator("#phone").fill("080-2222-3333");
    await expect(editorOf(page, a.id).locator(".dirty")).toBeVisible();
    await expect(editorOf(page, b.id).locator(".dirty")).toBeVisible();
    await expect(row(page, a.id).locator(".name")).toHaveText("一人目 変更"); // nothing copied: the row shows it
    await page.locator(`tr.editor-row[data-id="${a.id}"]`).getByRole("button", { name: "保存" }).click();
    await expect(toast(page)).toContainText(["一人目 変更 さんの情報を保存しました"]);
    await expect(editorOf(page, a.id)).toHaveCount(0); // saved rows close
    await expect(editorOf(page, b.id).locator("#phone")).toHaveValue("080-2222-3333"); // the other one is untouched
    await page.locator(`tr.editor-row[data-id="${b.id}"]`).getByRole("button", { name: "保存" }).click();
    await expect(editorOf(page, b.id)).toHaveCount(0); // its own save closed it (the first toast proves nothing here)
    await expect(toast(page)).toHaveCount(2);
    const after = (await api("GET", "/api/waiting?per=100")).data.items;
    expect(after.find((w) => w.id === a.id).name).toBe("一人目 変更");
    expect(after.find((w) => w.id === b.id).phone).toBe("080-2222-3333");
    expectCleanConsole(consoleMessages);
  });

  test("moving a person while a row is open keeps the open editor and what it holds @browsers", async ({ page, api, consoleMessages }) => {
    await openWaiting(page, "/waiting?page=1&sort=priority");
    const second = await rows(page).nth(1).getAttribute("data-id");
    const third = await rows(page).nth(2).getAttribute("data-id");
    await row(page, third).getByRole("button", { name: "編集" }).click();
    await editorOf(page, third).locator("#address").fill("編集中の住所");
    // move the second person down: the open row (third) moves up past them
    await row(page, second).getByRole("button", { name: "優先順を下げる" }).click();
    await expect(rows(page).nth(1)).toHaveAttribute("data-id", third);
    await expect(editorOf(page, third).locator("#address")).toHaveValue("編集中の住所");
    await expect(editorOf(page, third).locator(".dirty")).toBeVisible();
    // and move the open row itself
    await row(page, third).getByRole("button", { name: "優先順を上げる" }).click();
    await expect(rows(page).first()).toHaveAttribute("data-id", third);
    await expect(editorOf(page, third).locator("#address")).toHaveValue("編集中の住所");
    expectCleanConsole(consoleMessages);
  });

  test("deleting asks to confirm; the open row itself can be deleted", async ({ page, api, consoleMessages }) => {
    const items = (await api("GET", "/api/waiting?per=20&sort=applied")).data.items;
    const victim = items[2];
    await openWaiting(page);
    await row(page, victim.id).getByRole("button", { name: "編集" }).click();
    await editorOf(page, victim.id).locator("#name").fill("消される人");
    await row(page, victim.id).getByRole("button", { name: "削除" }).click();
    const dialog = page.locator(".delete-dialog dialog");
    await expect(dialog).toBeVisible();
    await expect(page.locator(".delete-text")).toContainText(victim.name); // the saved name, not the one being typed
    await page.locator(".delete-dialog").getByRole("button", { name: "やめる" }).click();
    await expect(row(page, victim.id)).toBeVisible();
    await row(page, victim.id).getByRole("button", { name: "削除" }).click();
    await page.getByRole("button", { name: "削除する" }).click();
    await expect(toast(page)).toContainText([`${victim.name} さんを削除しました`]);
    await expect(row(page, victim.id)).toHaveCount(0);
    await expect(editorOf(page, victim.id)).toHaveCount(0);
    expectCleanConsole(consoleMessages);
  });

  test("adding: a dialog with an editor and the garden; 422 messages at the fields", async ({ page, api, consoleMessages }) => {
    await openWaiting(page);
    await page.getByRole("button", { name: "追加", exact: true }).click();
    const dialog = page.locator(".add-dialog dialog");
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "追加する" }).click(); // nothing filled in
    await expect(page.locator(".add-dialog tenant-editor #name-msg")).toHaveText("氏名を入力してください");
    await expect(page.locator(".add-dialog .field-msg")).toHaveText("希望の農園を選んでください");
    await page.locator(".add-dialog tenant-editor #name").fill("新井 一郎");
    await page.locator(".add-dialog tenant-editor #phone").fill("090-1234-0000");
    await page.locator(".add-dialog select.garden").selectOption({ label: "川沿い農園" });
    await page.getByRole("button", { name: "追加する" }).click();
    await expect(dialog).toBeHidden();
    await expect(toast(page).last()).toContainText("新井 一郎 さんを待機者に追加しました");
    const all = (await api("GET", "/api/waiting?per=100")).data.items;
    const added = all.find((w) => w.name === "新井 一郎");
    expect(added.gardenId).toBe(3);
    expectCleanConsole(consoleMessages);
  });

  test("another member of staff changes the list while a row is open: the typing survives", async ({ page, api, consoleMessages }) => {
    const items = (await api("GET", "/api/waiting?per=20&sort=applied")).data.items;
    const mine = items[5];
    await openWaiting(page);
    await row(page, mine.id).getByRole("button", { name: "編集" }).click();
    await editorOf(page, mine.id).locator("#name").fill("入力中");
    // rows above it are deleted and added by someone else; the list reloads from the server (live event)
    await api("DELETE", `/api/waiting/${items[0].id}`);
    await api("POST", "/api/waiting", { name: "割り込み 太郎", phone: "", postal: "", address: "", gardenId: 1 });
    await expect(rows(page).first().locator(".name")).toHaveText(items[1].name);
    await expect(editorOf(page, mine.id).locator("#name")).toHaveValue("入力中");
    await expect(editorOf(page, mine.id).locator(".dirty")).toBeVisible();
    await page.getByRole("button", { name: "再読み込み" }).click();
    await expect(editorOf(page, mine.id).locator("#name")).toHaveValue("入力中");
    expectCleanConsole(consoleMessages);
  });
});
