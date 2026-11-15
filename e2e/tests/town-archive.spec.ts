// @ts-nocheck — the bodies are the author's JavaScript tests, kept as written
import { test as base, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// examples/town-archive — みどり市 まちの記憶アーカイブ（継ぎ目アプリ、docs/seam-apps.md の town-archive）。写真
// 12,000 点の長い一覧が 2 つ: 公開側（state + router）は 60 件ずつ読み込む一覧 — 絞り込みは URL に、列数は格子の
// 幅から、サムネイルは画面の近くだけ、見た写真はまとめて報告、年代への移動で両端に伸びる — と写真のページ、
// お気に入り。職員の整理台帳（signals）は 12,000 件をメモリに持ち、行の窓だけを描く。初めての作者が 4.23.0 で書き、
// 4.24.0 で要らなくなった回避策を外したもの: url の watch から走らせていた要求（コマンドが url を運ぶ）、
// $connectedCallback で当て直していた最初の幅（アクセサの組を通る値でも $watch が発火する）、state の横に持って
// いた生の配列（一覧を state 越しに回すのは、もともと遅くなかった）。
//
// この spec は、作者のブラウザのテスト（tests/e2e/*.spec.mjs の list / nav / features / staff）を意図として固定
// する。本文は作者が書いたまま: 何を取りに行ったかはサーバーの記録（/api/_test/log）で確かめ、画面に出たものだけ
// では見ない。速さの計測（perf.spec.mjs）は持ってこない — 数字は docs/long-lists.md にある。
// コンソールは wcstack の警告もエラーも無いこと（主な流れで確かめる）。捕まえられなかったページのエラーは、
// どのテストも失敗にする。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）でワーカーごとに 8100 + 10 × index のポートで立てる
// （4199–4900 / 5000–5540 / 5700– / 6100– / 7100– / 7300– / 7500– / 7700– / 7900– は他の spec）。
const PORT = 8100 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

// (a worker runs one test at a time, against its own server and its request log)
base.use({ baseURL: `http://localhost:${PORT}`, viewport: { width: 1200, height: 900 } });

let server: ChildProcess;

base.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/town-archive/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("town-archive server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Demo server running")) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`town-archive server exited with ${code}`)); });
  });
});

base.afterAll(() => {
  server?.kill();
});

// ---------------------------------------------------------------- 作者の fixtures（tests/e2e/fixtures.mjs）
// Shared fixtures: every page fails its test on an uncaught page error, and collects the
// console so the main flows can assert that there were no errors and no warnings.

const test = base.extend<any>({
  consoleLog: async ({}, use) => { await use([]); },
  page: async ({ page, consoleLog }, use, testInfo) => {
    const errors = [];
    watch(page, consoleLog, errors);
    await use(page);
    if (errors.length) throw new Error(`uncaught page error(s):\n${errors.join("\n")}`);
  },
});

function watch(page, consoleLog, errors) {
  page.on("console", (m) => consoleLog.push({ type: m.type(), text: m.text() }));
  page.on("pageerror", (e) => errors.push(e.message));
}

/** Console errors and warnings (the main flows assert there are none). */
function problems(consoleLog) {
  return consoleLog.filter((m) => m.type === "error" || m.type === "warning").map((m) => `${m.type}: ${m.text}`);
}

async function api(request, method, path, data) {
  const res = await request.fetch(path, { method, data, headers: data ? { "content-type": "application/json" } : undefined });
  if (res.status() >= 400) throw new Error(`${method} ${path} → ${res.status()}`);
  return res.status() === 204 ? null : res.json();
}
const reset = (request) => api(request, "POST", "/api/_test/reset");
const getLog = (request) => api(request, "GET", "/api/_test/log");
const failNext = (request, rule) => api(request, "POST", "/api/_test/fail", rule);

/** The list requests in the log (GET /api/photos), parsed. */
function listRequests(log) {
  return log.filter((e) => e.method === "GET" && e.path === "/api/photos").map((e) => {
    const p = new URLSearchParams(e.query);
    return { q: p.get("q"), area: p.get("area"), sort: p.get("sort"), offset: Number(p.get("offset")), limit: Number(p.get("limit")) };
  });
}

/** Ids of the cards in the document (the list renders only the rows near the screen). */
async function cardIds(page) {
  return page.locator(".card").evaluateAll((els) => els.map((e) => Number(e.dataset.id)));
}

/** How many photos the list holds (the line above the grid: "n 点中 m 点を表示" → m). */
async function heldCount(page) {
  return page.evaluate(() => Number((document.querySelector(".count").textContent.split("中")[1] || "").split("点")[0].replace(/[^0-9]/g, "") || 0));
}

/** Every card of the list, in order, by scrolling through it from the top (windowed rendering). */
async function allCardIds(page) {
  await page.evaluate(() => scrollTo(0, 0));
  const seen = [];
  const set = new Set();
  for (let i = 0; i < 500; i++) {
    await page.waitForTimeout(60);
    const ids = await cardIds(page);
    for (const id of ids) if (!set.has(id)) { set.add(id); seen.push(id); }
    const atEnd = await page.evaluate(() => innerHeight + scrollY >= document.documentElement.scrollHeight - 2);
    if (atEnd) break;
    await page.evaluate(() => scrollBy(0, Math.round(innerHeight * 0.8)));
  }
  return seen;
}

/** Scroll the window to the bottom until `done()` or no more growth. */
async function scrollToEnd(page, { until, max = 40 } = {}) {
  for (let i = 0; i < max; i++) {
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
    if (until && (await until())) return;
  }
}

/** The thumbnail size for a column (the app's lib/grid.js thumbSizeFor). */
function thumbSizeFor(cssWidth: number, dpr = 1, sizes = [160, 320, 640, 1280]): number {
  const need = Math.ceil((Number(cssWidth) || 0) * (Number(dpr) || 1));
  for (const s of sizes) if (s >= need) return s;
  return sizes[sizes.length - 1];
}

test.beforeEach(async ({ request }) => { await reset(request); });

test.describe("一覧: 読み込みと終わり", () => {

  const Q150 = "路面電車"; // 150 public photos
  const Q61 = "雪まつり"; // 61
  const Q60 = "花火大会"; // 60
  const Q3 = "蒸気機関車"; // 3
  const Q0 = "恐竜"; // 0
  const enc = encodeURIComponent;


  test("150 点を最後までスクロール: 要求は順に 3 回、カードは 150 枚とも別、「これで全部です」 @browsers", async ({ page, request, consoleLog }) => {
    await page.goto(`/?q=${enc(Q150)}`);
    await expect(page.locator(".count")).toContainText("150 点中 60 点を表示");
    await scrollToEnd(page, { until: async () => (await page.locator(".end").isVisible()) });
    await expect(page.locator(".end")).toBeVisible();
    await expect(page.locator(".end")).toHaveText("これで全部です");
    expect(await heldCount(page)).toBe(150);
    const ids = await allCardIds(page); // the list renders the rows near the screen: walk it
    expect(ids.length).toBe(150);
    expect(new Set(ids).size).toBe(150);
    await page.waitForTimeout(500);
    const reqs = listRequests(await getLog(request));
    expect(reqs.map((r) => r.offset)).toEqual([0, 60, 120]);
    expect(reqs.every((r) => r.q === Q150)).toBe(true);
    await expect(page.locator(".count")).toContainText("150 点中 150 点を表示");
    expect(problems(consoleLog)).toEqual([]);
  });

  test("高さ 4,000 px のウィンドウは、スクロールしなくても埋まる", async ({ page, request, consoleLog }) => {
    await page.setViewportSize({ width: 1200, height: 4000 });
    await page.goto("/");
    // the end sentinel must stay more than a screen below the bottom of the window
    await expect.poll(async () => page.evaluate(() => document.querySelector(".sentinel-end").getBoundingClientRect().top - innerHeight), { timeout: 15000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(800);
    const reqs = listRequests(await getLog(request));
    expect(reqs.length).toBeGreaterThan(1);
    expect(reqs.map((r) => r.offset)).toEqual(reqs.map((_, i) => i * 60));
    const sentinelBelow = await page.evaluate(() => document.querySelector(".sentinel-end").getBoundingClientRect().top - innerHeight);
    expect(sentinelBelow).toBeGreaterThan(0);
    expect(problems(consoleLog)).toEqual([]);
  });

  for (const [q, n] of [[Q3, 3], [Q60, 60], [Q61, 61], [Q0, 0]]) {
    test(`${n} 点の結果は、正しく終わる（高さ 4,000 px のウィンドウ）`, async ({ page, request, consoleLog }) => {
      await page.setViewportSize({ width: 1200, height: 4000 });
      await page.goto(`/?q=${enc(q)}`);
      if (n === 0) {
        await expect(page.locator(".empty")).toBeVisible();
        await expect(page.locator(".end")).toBeHidden();
      } else {
        await expect(page.locator(".end")).toBeVisible();
        await expect(page.locator(".empty")).toBeHidden();
      }
      await page.waitForTimeout(800);
      expect(await heldCount(page)).toBe(n);
      expect((await allCardIds(page)).length).toBe(n);
      const reqs = listRequests(await getLog(request));
      expect(reqs.map((r) => r.offset)).toEqual(n > 60 ? [0, 60] : [0]);
      expect(problems(consoleLog)).toEqual([]);
    });
  }

  test("遅いページの読み込み中に絞り込みを打つ: 最後の絞り込みの写真だけ、先頭から、URL も合う", async ({ page, request, consoleLog }) => {
    await page.goto("/?delay=1500");
    await expect(page.locator(".card").first()).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); // ask for page 2 (slow)
    await page.waitForTimeout(200);
    const box = page.getByRole("searchbox");
    await box.fill(Q150.slice(0, 2)); // 路面
    await page.waitForTimeout(150);
    await box.fill(Q61); // changed quickly while pages are on their way
    await box.press("Enter");
    await expect(page).toHaveURL(new RegExp(`\\?q=${enc(Q61)}$`));
    await expect(page.locator(".count")).toContainText("61 点中", { timeout: 15000 });
    await page.waitForTimeout(2500); // let any old answer arrive
    const titles = await allCardIds(page);
    // every card shown belongs to the 61-result
    const res = await (await request.get(`/api/photos?q=${enc(Q61)}&limit=60`)).json();
    const res2 = await (await request.get(`/api/photos?q=${enc(Q61)}&offset=60&limit=60`)).json();
    const allowed = new Set([...res.items, ...res2.items].map((p) => p.id));
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every((id) => allowed.has(id))).toBe(true);
    // (the list was at its top when the filter applied; allCardIds scrolled it since)
    expect(problems(consoleLog)).toEqual([]);
  });

  test("3 ページ目が失敗: 120 点は残り、知らせが出て、「もう一度」は offset 120 を取りに行き、一覧は続く", async ({ page, request, consoleLog }) => {
    await failNext(request, { path: "/api/photos", status: 500, times: 1, match: "offset=120" });
    await page.goto(`/?q=${enc(Q150)}`);
    await scrollToEnd(page, { until: async () => (await page.locator(".error").isVisible()), max: 20 });
    await expect(page.getByText("読み込めませんでした")).toBeVisible();
    expect(await heldCount(page)).toBe(120);
    await scrollToEnd(page, { max: 4 }); // scrolling does not retry by itself
    expect(listRequests(await getLog(request)).map((r) => r.offset)).toEqual([0, 60, 120]);
    await page.getByRole("button", { name: "もう一度" }).click();
    await expect(page.locator(".end")).toBeVisible();
    expect(await heldCount(page)).toBe(150);
    expect(listRequests(await getLog(request)).map((r) => r.offset)).toEqual([0, 60, 120, 120]);
    // a failed request is a console error in the browser itself; nothing else may be logged
    expect(problems(consoleLog).filter((t) => !/500|Failed to load resource/.test(t))).toEqual([]);
  });

  test("スクロールバーを一気に下へ: 読み込むのは 1 ページだけで、連鎖しない", async ({ page, request, consoleLog }) => {
    await page.goto("/");
    await expect(page.locator(".count")).toContainText("点中 60 点を表示");
    await page.waitForTimeout(500);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1500);
    const reqs = listRequests(await getLog(request)).map((r) => r.offset);
    expect(reqs).toEqual([0, 60]);
    expect(await heldCount(page)).toBe(120);
    expect(problems(consoleLog)).toEqual([]);
  });
});

test.describe("写真のページと、一覧へ戻る", () => {


  /** Scroll until card number `n` (1-based, in the default list) exists, then put it on the screen. */
  async function showCard(page, n, request) {
    for (let i = 0; i < 60 && (await heldCount(page)) < n; i++) {
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(200);
    }
    // the list renders only the rows near the screen: walk down from the top until card n is there
    const id = (await (await request.get(`/api/photos?offset=${n - 1}&limit=1`)).json()).items[0].id;
    const card = page.locator(`.card[data-id="${id}"]`);
    await page.evaluate(() => scrollTo(0, 0));
    for (let i = 0; i < 400 && !(await card.count()); i++) {
      await page.evaluate(() => scrollBy(0, Math.round(innerHeight * 0.8)));
      await page.waitForTimeout(40);
    }
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    return card;
  }
  const photoTitle = (page) => page.locator("#photo-title");

  test("150 枚目の写真、「次へ」を 2 回、「戻る」を 3 回: 同じカード、同じ位置、フォーカス付き、一覧の要求は出ない @browsers", async ({ page, request, consoleLog }) => {
    await page.goto("/");
    const card = await showCard(page, 150, request);
    const id = Number(await card.getAttribute("data-id"));
    const top = await card.evaluate((el) => el.getBoundingClientRect().top);
    const title = await card.locator(".card-title").innerText();
    const before = listRequests(await getLog(request)).length;

    await card.locator(".card-link").click();
    await expect(page).toHaveURL(new RegExp(`/photos/${id}$`));
    await expect(photoTitle(page)).toHaveText(title);
    await expect(page).toHaveTitle(new RegExp(title));
    const next = page.getByRole("button", { name: "次へ →" });
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page).not.toHaveURL(new RegExp(`/photos/${id}$`));
    await expect(next).toBeEnabled();
    const url2 = page.url();
    await next.click();
    await expect(page).not.toHaveURL(url2);
    await expect(photoTitle(page)).not.toHaveText("読み込み中…");

    await page.goBack();
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(".list-page")).toBeVisible();
    await expect.poll(() => card.evaluate((el, t) => Math.abs(el.getBoundingClientRect().top - t), top)).toBeLessThanOrEqual(1); // same place (±1 px)
    await expect(card.locator(".card-link")).toBeFocused();
    expect(listRequests(await getLog(request)).length).toBe(before);
    expect(problems(consoleLog)).toEqual([]);
  });

  test("読み込んだ範囲の先まで「次へ」で進んでから「一覧へ戻る」: 最後に見た写真の所の一覧、フォーカス付き", async ({ page, request, consoleLog }) => {
    await page.goto(`/?q=${encodeURIComponent("雪まつり")}`); // 61 photos: page 1 holds 60
    await expect(page.locator(".count")).toContainText("61 点中 60 点を表示");
    const r59 = (await (await request.get(`/api/photos?q=${encodeURIComponent("雪まつり")}&offset=58&limit=1`)).json()).items[0];
    const card = page.locator(`.card[data-id="${r59.id}"]`);
    for (let i = 0; i < 100 && !(await card.count()); i++) { await page.evaluate(() => scrollBy(0, 600)); await page.waitForTimeout(40); }
    await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await card.locator(".card-link").click();
    const next = page.getByRole("button", { name: "次へ →" });
    await expect(next).toBeEnabled();
    await next.click(); // 60th
    await expect(next).toBeEnabled();
    await next.click(); // 61st — not loaded in the list (unless the list grew)
    await expect(photoTitle(page)).not.toHaveText("読み込み中…");
    await expect(next).toBeDisabled(); // the last of 61
    const lastId = Number(page.url().match(/photos\/(\d+)/)[1]);
    await page.getByRole("link", { name: "一覧へ戻る" }).click();
    await expect(page).toHaveURL(new RegExp(`\\?q=${encodeURIComponent("雪まつり")}$`));
    const target = page.locator(`.card[data-id="${lastId}"]`);
    await expect(target).toBeVisible();
    await expect(target.locator(".card-link")).toBeFocused();
    const inView = await target.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    expect(inView).toBe(true);
    expect(problems(consoleLog)).toEqual([]);
  });

  test("写真を直接開くとアーカイブ全体を歩ける。「一覧へ戻る」は既定の一覧をその写真の所で開く", async ({ page, request, consoleLog }) => {
    // the 500th photo of the default order
    const r = await (await request.get("/api/photos?offset=499&limit=3")).json();
    const [prev, self, next] = r.items;
    await page.goto(`/photos/${self.id}`);
    await expect(photoTitle(page)).toHaveText(self.title);
    await expect(page.getByRole("button", { name: "← 前へ" })).toBeEnabled();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(new RegExp(`/photos/${next.id}$`));
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(new RegExp(`/photos/${prev.id}$`));
    await page.getByRole("link", { name: "一覧へ戻る" }).click();
    await expect(page).toHaveURL(/\/$/);
    const target = page.locator(`.card[data-id="${prev.id}"]`);
    await expect(target).toBeVisible();
    await expect(target.locator(".card-link")).toBeFocused();
    const reqs = listRequests(await getLog(request)).filter((x) => x.limit === 60);
    expect(reqs[0].offset).toBe(480); // the page that holds the 499th photo, not the top
    expect(problems(consoleLog)).toEqual([]);
  });

  test("写真のページはそのレコードを見せる。タグは絞り込んだ一覧へのリンク", async ({ page, request, consoleLog }) => {
    const rec = await (await request.get("/api/photos/42")).json();
    await page.goto("/photos/42");
    await expect(photoTitle(page)).toHaveText(rec.title);
    await expect(page.locator(".photo-meta")).toContainText(`${rec.year}年${rec.month}月`);
    await expect(page.locator(".photo-meta")).toContainText(rec.donor);
    await expect(page.locator(".photo-desc")).toHaveText(rec.description);
    await page.locator(".tags a").first().click();
    await expect(page).toHaveURL(new RegExp(`\\?q=${encodeURIComponent(rec.tags[0])}$`));
    await expect(page.locator(".card").first()).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveValue(rec.tags[0]);
    expect(problems(consoleLog)).toEqual([]);
  });
});

test.describe("年代・お気に入り・サムネイル・見た写真・絞り込み", () => {


  /** The card just under the sticky header. */
  async function topCard(page) {
    return page.evaluate(() => {
      const hb = document.querySelector(".site-header").getBoundingClientRect().bottom;
      const cards = [...document.querySelectorAll(".card")];
      let best = null;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        if (r.bottom > hb + 1 && (best === null || r.top < best.top || (r.top === best.top && r.left < best.left))) best = { id: Number(c.dataset.id), top: r.top, left: r.left };
      }
      return best;
    });
  }

  test("年代 → 1990年代（先頭から）: 最初のカードは 1990 年、前の写真が上に読み込まれても動かず、パネルが年代を示す", async ({ page, request, consoleLog }) => {
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();
    await page.getByRole("button", { name: "1990年代" }).click();
    const pos = await (await request.get("/api/photos/position?q=&area=&sort=old&decade=1990")).json();
    const first = (await (await request.get(`/api/photos?offset=${pos.offset}&limit=1`)).json()).items[0];
    await expect.poll(async () => (await topCard(page))?.id, { timeout: 15000 }).toBe(first.id);
    await expect(page.locator(".decade.current")).toHaveText("1990年代");
    // the list did not load everything from the top
    expect(listRequests(await getLog(request)).some((r) => r.offset === pos.offset)).toBe(true);

    // scroll up: earlier photos arrive, the card under the pointer does not move
    let arrivals = 0;
    for (let step = 0; step < 40 && arrivals < 3; step++) {
      const before = await heldCount(page);
      await page.evaluate(() => scrollBy(0, -Math.round(innerHeight * 0.5)));
      await page.mouse.move(600, 450);
      const probe = await page.evaluate(() => {
        const el = document.elementFromPoint(600, 450)?.closest(".card");
        return el ? { id: el.dataset.id, top: el.getBoundingClientRect().top } : null;
      });
      await page.waitForTimeout(400);
      if ((await heldCount(page)) > before) {
        arrivals++;
        if (probe) {
          const after = await page.locator(`.card[data-id="${probe.id}"]`).evaluate((el) => el.getBoundingClientRect().top);
          expect(Math.abs(after - probe.top)).toBeLessThan(2);
        }
      }
    }
    expect(arrivals).toBe(3);
    const ids = await cardIds(page);
    expect(new Set(ids).size).toBe(ids.length);
    await expect(page.locator(".decade.current")).toHaveText("1980年代");
    expect(problems(consoleLog)).toEqual([]);
  });

  test("並び順が題名順のとき、年代は何も言わない", async ({ page }) => {
    await page.goto("/?sort=title");
    await expect(page.locator(".card").first()).toBeVisible();
    await expect(page.locator(".decade")).toHaveCount(0);
    await expect(page.locator(".decade-note")).toBeVisible();
  });

  test("カードの ★: 遷移しない、お気に入りに入る、別のタブにも出る", async ({ page, context, consoleLog }) => {
    await page.goto("/");
    const card = page.locator(".card").nth(2);
    await expect(card).toBeVisible();
    const id = await card.getAttribute("data-id");
    const title = await card.locator(".card-title").innerText();
    const other = await context.newPage();
    const otherErrors = [];
    watch(other, [], otherErrors);
    await other.goto("/");
    const otherStar = other.locator(`.card[data-id="${id}"] .star`);
    await expect(otherStar).toHaveAttribute("aria-pressed", "false");

    await card.locator(".star").click();
    await expect(card.locator(".star")).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/\/$/);
    await expect(otherStar).toHaveAttribute("aria-pressed", "true"); // the other tab follows
    await card.locator(".star").focus();
    await page.keyboard.press("Enter"); // the keyboard reaches ★ too, and takes it out
    await expect(card.locator(".star")).toHaveAttribute("aria-pressed", "false");
    await expect(otherStar).toHaveAttribute("aria-pressed", "false");
    await card.locator(".star").click();

    await page.getByRole("link", { name: "お気に入り" }).click();
    await expect(page).toHaveURL(/\/favorites$/);
    await expect(page.locator(".fav-item")).toHaveCount(1);
    await expect(page.locator(".fav-item .card-title")).toHaveText(title);
    // unstar in お気に入り while the other tab shows the card
    await page.locator(".fav-item .star").click();
    await expect(page.locator(".fav-item")).toHaveCount(0);
    await expect(otherStar).toHaveAttribute("aria-pressed", "false");
    expect(otherErrors).toEqual([]);
    expect(problems(consoleLog)).toEqual([]);
  });

  test("「すべて外す」は先に尋ねる。★ 300 個でも動く", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();
    await page.evaluate(() => {
      const favs = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, title: `写真${i + 1}`, year: 1960, month: 1, area: "kita", w: 1200, h: 900, color: "#888888", at: Date.now() - i }));
      localStorage.setItem("midori-archive.favorites", JSON.stringify(favs));
    });
    await page.goto("/favorites");
    await expect(page.locator(".fav-item")).toHaveCount(300);
    page.once("dialog", (d) => d.dismiss());
    await page.getByRole("button", { name: "すべて外す" }).click();
    await expect(page.locator(".fav-item")).toHaveCount(300);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "すべて外す" }).click();
    await expect(page.locator(".fav-item")).toHaveCount(0);
  });

  test("サムネイル: 画面の近くだけ、列に合う大きさで。パネルを畳むと列数と大きさが追う @browsers", async ({ page, request }) => {
    await page.setViewportSize({ width: 2800, height: 900 });
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();
    await page.waitForTimeout(800);
    const geo = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".card")];
      const lefts = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)));
      return { cols: lefts.size, width: cards[0].getBoundingClientRect().width, near: cards.filter((c) => c.getBoundingClientRect().top < innerHeight * 2).map((c) => Number(c.dataset.id)) };
    });
    const imgs = (await getLog(request)).filter((e) => e.path.startsWith("/img/"));
    const ids = imgs.map((e) => Number(e.path.split("/")[2]));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => geo.near.includes(id))).toBe(true); // nothing far below was asked for
    // the device's pixel ratio, as the page buckets it (WebKit's "Desktop Safari" profile has 2)
    const dpr = await page.evaluate(() => { const d = devicePixelRatio; return d <= 1 ? 1 : d <= 1.5 ? 1.5 : d <= 2 ? 2 : d <= 3 ? 3 : 4; });
    const want = thumbSizeFor(geo.width, dpr);
    expect(new Set(imgs.map((e) => new URLSearchParams(e.query).get("w")))).toEqual(new Set([String(want)]));
    expect(geo.cols).toBe(8);

    await page.locator(".panel-toggle").click(); // fold the panel: the grid gets wider
    await page.waitForTimeout(800);
    const geo2 = await page.evaluate(() => document.querySelector(".card").getBoundingClientRect().width);
    expect(geo2).toBeGreaterThan(geo.width);
    const want2 = thumbSizeFor(geo2, dpr);
    expect(want2).toBeGreaterThan(want); // the column grew past a size: a larger one is asked for
    const imgs2 = (await getLog(request)).filter((e) => e.path.startsWith("/img/")).slice(imgs.length);
    expect(imgs2.length).toBeGreaterThan(0);
    expect(new Set(imgs2.map((e) => new URLSearchParams(e.query).get("w")))).toEqual(new Set([String(want2)]));
    // and the images shown are the larger ones
    const srcs = await page.locator(".card img[src]").evaluateAll((els) => els.map((e) => new URL(e.src).searchParams.get("w")));
    expect(new Set(srcs)).toEqual(new Set([String(want2)]));
  });

  test("見た写真: まとめて送る、id は 1 回ずつ、待っている分は離れるときに送る", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();
    await page.waitForTimeout(2500); // the first batch (cards on the first screen) goes after a pause
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(150); }
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -700); await page.waitForTimeout(150); } // the same cards again
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(300); // a batch is waiting (the debounce has not fired yet)
    await page.goto("about:blank"); // leave: pagehide → sendBeacon
    await expect.poll(async () => (await getLog(request)).filter((e) => e.path === "/api/seen").length, { timeout: 5000 }).toBeGreaterThan(1);
    await page.waitForTimeout(500);
    const posts = (await getLog(request)).filter((e) => e.path === "/api/seen");
    const all = posts.flatMap((p) => p.body.ids);
    expect(all.length).toBe(new Set(all).size); // each id once
    expect(posts.length).toBeLessThan(all.length); // in batches, not one request per photo
    expect(posts.every((p) => p.body.ids.length <= 100)).toBe(true);
  });

  test("「トップへ」は最初の画面を過ぎると出て、先頭へ戻る", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "トップへ" })).toBeHidden();
    await page.evaluate(() => scrollTo(0, innerHeight * 1.5));
    await expect(page.getByRole("button", { name: "トップへ" })).toBeVisible();
    await page.getByRole("button", { name: "トップへ" }).click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(2);
    await expect(page.getByRole("button", { name: "トップへ" })).toBeHidden();
  });

  test("絞り込み: 地区と並び順は履歴に残り、打鍵ごとには残らない。「条件をクリア」", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();
    await page.getByLabel("地区").selectOption({ label: "港" });
    await expect(page).toHaveURL(/\?area=minato$/);
    await page.getByLabel("並び順").selectOption("new");
    await expect(page).toHaveURL(/\?area=minato&sort=new$/);
    const box = page.getByRole("searchbox");
    await box.pressSequentially("夕暮れ", { delay: 50 });
    await expect(page).toHaveURL(/q=%E5%A4%95%E6%9A%AE%E3%82%8C/);
    await expect(page.locator(".count")).toContainText("点中");
    await page.goBack(); // one Back undoes the whole search
    await expect(page).toHaveURL(/\?area=minato&sort=new$/);
    await expect(box).toHaveValue("");
    await page.goBack();
    await expect(page).toHaveURL(/\?area=minato$/);
    await page.getByRole("button", { name: "条件をクリア" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByLabel("地区")).toHaveValue("");
  });
});

test.describe("整理台帳（signals）", () => {


  const staff = (page, key) => page.evaluate((k) => globalThis.__staff[k], key);
  async function open(page) {
    await page.goto("/staff");
    await expect(page.locator(".t-count")).toHaveText("12,000 件中 12,000 件", { timeout: 15000 });
  }
  const body = (page) => page.locator(".t-body");
  const rowById = (page, id) => page.locator(`.t-row[data-id="${id}"]`);
  async function scrollBody(page, top) {
    await body(page).evaluate((el, t) => { el.scrollTop = t; }, top);
    await page.waitForTimeout(80);
  }

  test("12,000 件で、行の要素は数百まで。スクロールバーは結果の全体に渡る", async ({ page, consoleLog }) => {
    await open(page);
    expect(await staff(page, "rowsInDocument")).toBeLessThan(300);
    const spans = await body(page).evaluate((el) => el.scrollHeight);
    expect(spans).toBe(12000 * 32);
    await scrollBody(page, 12000 * 32);
    await expect(rowById(page, 12000)).toBeVisible();
    expect(await staff(page, "rowsInDocument")).toBeLessThan(300);
    await page.setViewportSize({ width: 1300, height: 500 }); // the visible part follows the window
    await page.waitForTimeout(200);
    const shorter = await staff(page, "rowsInDocument");
    await page.setViewportSize({ width: 1300, height: 1400 });
    await page.waitForTimeout(200);
    expect(await staff(page, "rowsInDocument")).toBeGreaterThan(shorter);
    expect(problems(consoleLog)).toEqual([]);
  });

  test("絞り込みを打つ: 1 打鍵ごと、タイトルとタグ、地区と一緒に。要求は出ない", async ({ page, request, consoleLog }) => {
    await open(page);
    const before = (await getLog(request)).length;
    const box = page.getByPlaceholder("題名・タグで絞り込み");
    await box.pressSequentially("路面", { delay: 30 });
    await expect(page.locator(".t-count")).toContainText("12,000 件中");
    await box.pressSequentially("電車");
    await expect(page.locator(".t-count")).toHaveText(/12,000 件中 1\d\d 件/);
    await page.getByLabel("地区").selectOption({ label: "港" });
    await expect(page.locator(".t-count")).toHaveText(/12,000 件中 \d{1,2} 件/);
    expect((await getLog(request)).slice(before).filter((e) => e.path.startsWith("/api/staff/photos"))).toEqual([]);
    expect(problems(consoleLog)).toEqual([]);
  });

  test("見出しのクリックで並べ替え、もう一度で逆順", async ({ page, consoleLog }) => {
    await open(page);
    await page.getByRole("button", { name: "年" }).click();
    await expect(page.getByRole("columnheader", { name: /年/ })).toHaveAttribute("aria-sort", "ascending");
    const years = () => page.locator(".t-row .c-year").evaluateAll((els) => els.map((e) => Number(e.textContent)));
    let ys = await years();
    expect(ys[0]).toBe(1950);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    await page.getByRole("button", { name: "年" }).click();
    await expect(page.getByRole("columnheader", { name: /年/ })).toHaveAttribute("aria-sort", "descending");
    ys = await years();
    expect(ys[0]).toBe(2019);
    expect(problems(consoleLog)).toEqual([]);
  });

  test("Shift+クリックで 1,000 行を選ぶ。見出しのチェックは「一部」を示す。一括変更は要求 1 回", async ({ page, request, consoleLog }) => {
    await open(page);
    await rowById(page, 1).locator("input[type=checkbox]").click();
    await scrollBody(page, 999 * 32 - 200);
    await rowById(page, 1000).locator("input[type=checkbox]").click({ modifiers: ["Shift"] });
    await expect(page.locator(".t-selcount")).toHaveText("1,000 件選択中");
    const all = page.locator(".check-all");
    expect(await all.evaluate((el) => el.indeterminate)).toBe(true);
    // survives sorting and scrolling
    await page.getByRole("button", { name: "タイトル" }).click();
    await scrollBody(page, 5000 * 32);
    await expect(page.locator(".t-selcount")).toHaveText("1,000 件選択中");
    const before = (await getLog(request)).length;
    await page.getByRole("button", { name: "非公開にする" }).click();
    await expect(page.locator(".t-notice")).toHaveText("1,000 件を非公開にしました");
    const patches = (await getLog(request)).slice(before).filter((e) => e.method === "PATCH");
    expect(patches.length).toBe(1);
    expect(patches[0].body.ids.length).toBe(1000);
    await page.getByRole("button", { name: "ID" }).click();
    await scrollBody(page, 0);
    await expect(rowById(page, 1).locator(".c-public")).toHaveText("非公開");
    expect(problems(consoleLog)).toEqual([]);
  });

  test("一括変更が 500 で返ると、そう知らせ、選択は残る", async ({ page, request, consoleLog }) => {
    await open(page);
    await page.locator(".check-all").click();
    await expect(page.locator(".t-selcount")).toHaveText("12,000 件選択中");
    await failNext(request, { path: "/api/staff/photos", status: 500, times: 1 });
    await page.getByRole("button", { name: "公開にする", exact: true }).click();
    await expect(page.locator(".t-notice")).toContainText("一括変更できませんでした");
    await expect(page.locator(".t-selcount")).toHaveText("12,000 件選択中");
    // the filter cleared with everything selected: still all; a filter keeps only what is listed
    await page.getByPlaceholder("題名・タグで絞り込み").fill("路面電車");
    await expect(page.locator(".t-selcount")).toHaveText(/^1\d\d 件選択中$/);
    await page.getByPlaceholder("題名・タグで絞り込み").fill("");
    await expect(page.locator(".t-selcount")).toHaveText(/^1\d\d 件選択中$/);
    expect(problems(consoleLog).filter((t) => !/500|Failed to load resource/.test(t))).toEqual([]);
  });

  test("「タグを付ける…」はタグを尋ね、選んだ行を要求 1 回で変える", async ({ page, request }) => {
    await open(page);
    await rowById(page, 3).locator("input[type=checkbox]").click();
    await rowById(page, 5).locator("input[type=checkbox]").click();
    page.once("dialog", (d) => d.accept("要確認"));
    await page.getByRole("button", { name: "タグを付ける…" }).click();
    await expect(rowById(page, 3).locator(".c-tags")).toContainText("要確認");
    await expect(rowById(page, 5).locator(".c-tags")).toContainText("要確認");
    const patches = (await getLog(request)).filter((e) => e.method === "PATCH");
    expect(patches.map((p) => p.body)).toEqual([{ ids: [3, 5], patch: { addTag: "要確認" } }]);
  });

  test("編集中のタイトルは、並べ替え・スクロールで離れて戻る・ほかの職員の変更を越えて残り、その後で保存できる", async ({ page, request, consoleLog }) => {
    await open(page);
    await rowById(page, 7).locator(".c-title").dblclick();
    const editor = page.locator(".title-editor");
    await expect(editor).toBeFocused();
    await editor.fill("書きかけの題名");
    // a sort
    await page.getByRole("button", { name: "年" }).click();
    await expect(page.locator(".title-editor")).toHaveCount(0); // its row went elsewhere in the order…
    await page.getByRole("button", { name: "ID" }).click(); // …and comes back
    await scrollBody(page, 0);
    await expect(page.locator(".title-editor")).toHaveValue("書きかけの題名");
    await page.locator(".title-editor").click(); // (the sort header had the focus)
    // a scroll away and back
    await scrollBody(page, 6000 * 32);
    await expect(page.locator(".title-editor")).toHaveCount(0);
    await scrollBody(page, 0);
    await expect(page.locator(".title-editor")).toHaveValue("書きかけの題名");
    await expect(page.locator(".title-editor")).toBeFocused();
    // another staff member changes the record
    await api(request, "POST", "/api/_test/staff-event", { type: "updated", record: { id: 7, title: "他の人の題名", public: false } });
    await expect(rowById(page, 7).locator(".c-public")).toHaveText("非公開");
    await expect(page.locator(".title-editor")).toHaveValue("書きかけの題名");
    await expect(page.locator(".edit-msg")).toContainText("他の人が変更しました");
    // refused, then saved
    await page.locator(".title-editor").fill("");
    await page.locator(".title-editor").press("Enter");
    await expect(page.locator(".edit-msg")).toHaveText("タイトルを入力してください。");
    await expect(page.locator(".title-editor")).toHaveAttribute("aria-invalid", "true");
    await page.locator(".title-editor").fill("新しい題名");
    await page.locator(".title-editor").press("Enter");
    await expect(page.locator(".title-editor")).toHaveCount(0);
    await expect(rowById(page, 7).locator(".c-title")).toHaveText("新しい題名");
    expect(problems(consoleLog).filter((t) => !/422|Failed to load resource/.test(t))).toEqual([]);
  });

  test("キーボード: ↑ ↓ PageDown End Home で今の行が動き、見える所に保たれる。Space、Enter で編集、Escape", async ({ page, consoleLog }) => {
    await open(page);
    await body(page).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".t-row.current")).toHaveAttribute("data-id", "3");
    await page.keyboard.press(" ");
    await expect(page.locator(".t-selcount")).toHaveText("1 件選択中");
    await page.keyboard.press("End");
    await expect(page.locator(".t-row.current")).toHaveAttribute("data-id", "12000");
    await expect(rowById(page, 12000)).toBeInViewport();
    await page.keyboard.press("PageUp");
    await expect(page.locator(".t-row.current")).toBeInViewport();
    await page.keyboard.press("Home");
    await expect(page.locator(".t-row.current")).toHaveAttribute("data-id", "1");
    await page.keyboard.press("Enter");
    await expect(page.locator(".title-editor")).toBeFocused();
    await page.keyboard.type("x");
    await page.keyboard.press("Escape");
    await expect(page.locator(".title-editor")).toHaveCount(0);
    await expect(body(page)).toBeFocused();
    await page.keyboard.press("F2");
    await expect(page.locator(".title-editor")).toBeFocused();
    expect(problems(consoleLog)).toEqual([]);
  });

  test("ほかの職員の変更: その場で変わり、新しいレコードは順序どおりの場所に入り、見ている所は飛ばない", async ({ page, request, consoleLog }) => {
    await open(page);
    await page.getByRole("button", { name: "タイトル" }).click();
    await scrollBody(page, 3000 * 32 + 10);
    const topId = await page.evaluate(() => {
      const b = document.querySelector(".t-body").getBoundingClientRect().top;
      return [...document.querySelectorAll(".t-row")].find((r) => r.getBoundingClientRect().bottom > b + 1).dataset.id;
    });
    const topBefore = await rowById(page, topId).evaluate((el) => el.getBoundingClientRect().top);
    // records whose new title sorts above the view, and a new record
    await api(request, "POST", "/api/_test/staff-event", { type: "updated", record: { id: 11999, title: "あああ最初の写真" } });
    await api(request, "POST", "/api/_test/staff-event", { type: "added", record: { id: 12001, title: "ああ新しい写真", tags: ["新着"] } });
    await expect(page.locator(".t-count")).toHaveText("12,001 件中 12,001 件");
    await page.waitForTimeout(200);
    const topAfter = await rowById(page, topId).evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(topAfter - topBefore)).toBeLessThan(1);
    await scrollBody(page, 0);
    await expect(page.locator(".t-row").first()).toHaveAttribute("data-id", "11999"); // あああ… < ああ新…
    await expect(page.locator(".t-row").nth(1)).toHaveAttribute("data-id", "12001");
    expect(problems(consoleLog)).toEqual([]);
  });

  test("毎秒 10 件の変更でも表は使える", async ({ page, request, consoleLog }) => {
    await open(page);
    await api(request, "POST", "/api/_test/staff-event", { burst: { perSecond: 10, seconds: 3 } });
    await page.waitForTimeout(3500);
    await body(page).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".t-row.current")).toHaveAttribute("data-id", "1");
    const titles = await page.locator(".t-row .c-title").allTextContents();
    expect(titles.length).toBeGreaterThan(5);
    expect(problems(consoleLog)).toEqual([]);
  });

  test("職員のタブ 2 つ: 片方の変更がもう片方に出る", async ({ page, context }) => {
    await open(page);
    const other = await context.newPage();
    await open(other);
    await rowById(page, 2).locator("input[type=checkbox]").click();
    await page.getByRole("button", { name: "非公開にする" }).click();
    await expect(rowById(other, 2).locator(".c-public")).toHaveText("非公開");
  });
});
