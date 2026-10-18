import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/ssr-news — @wcstack/server × router × state × fetch × storage のニュースサイト（継ぎ目アプリ、
// docs/seam-apps.md の ssr-news）。サーバーが全ページを renderToString() で描き（記事とコメントは
// state から url を受ける <wcs-fetch> — サーバーが待つ）、クライアントがハイドレーションして遷移する。
// この spec はアプリのライフイベント — 深いリンク、行のリンク、JavaScript 無し、ハイドレーション前の
// 入力、投稿（成功・422・500・二度押し）、見つからない記事、戻る・進む、設定の再読み込み、ネットワークの
// 失敗と Retry — を、サーバーの HTML に何があるか・クライアントがサーバーのノードを引き取ったか・
// ブラウザが何を取り直したか・状態に何が届いたか・コンソールの静けさで固定する。
//
// WCS_LOCAL=1（サーバーもクライアントも packages/*/dist）で、ワーカーごとに別ポートで立てる。
// 投稿は記事のコメントを変えるので、テストごとに別の記事を使う。
const PORT = Number(process.env.SSR_NEWS_PORT || 5000) + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/ssr-news/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT), QUIET: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error("demo server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("ssr-news:")) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    server.on("error", (err) => { clearTimeout(timer); rejectReady(err); });
    server.on("exit", (code) => { clearTimeout(timer); rejectReady(new Error(`demo server exited with ${code}`)); });
  });
});

// 子プロセスが終わるまで待つ: 同じワーカーで次に立てるサーバーが同じポートを使う。
test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill();
  await exited;
});

// --- helpers -------------------------------------------------------------------

/** console.error / pageerror に加えて console.warning も集める（正しいアプリは警告も出さない） */
function collectConsole(page: Page): string[] {
  const messages = collectErrors(page);
  page.on("console", (msg) => {
    if (msg.type() === "warning") messages.push(`console.warn: ${msg.text()}`);
  });
  return messages;
}

/** ブラウザからの API 要求（サーバーの描画の要求は数えない） */
function collectApi(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/")) calls.push(`${req.method()} ${url.pathname}`);
  });
  return calls;
}

/** クライアントのバンドルを遅らせる（ハイドレーションの前のページを見る・触るため） */
async function delayClient(page: Page, ms: number): Promise<void> {
  await page.route("**/packages/*/dist/auto.min.js", async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/** ハイドレーションが終わるまで: state が初期化を終え、router が outlet を引き取った */
async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => !!customElements.get("wcs-state") && !!customElements.get("wcs-router"));
  await page.evaluate(() => (document.querySelector("wcs-state") as any).connectedCallbackPromise);
  await expect(page.locator("wcs-outlet[data-wcs-ssr]")).toHaveCount(0);
}

const outletOf = (html: string) => html.slice(html.indexOf("<wcs-outlet"));

// --- tests ---------------------------------------------------------------------

test.describe("ssr-news — サーバーの HTML", () => {
  test("記事への深いリンク: 記事とコメントがサーバーの HTML に入り、状態 200 と題名はサーバーが書く", async ({ request }) => {
    const res = await request.get(`${BASE}/articles/3`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("<title>Harvest festival this weekend — SSR News</title>");
    const outlet = outletOf(html);
    // the request a binding started (<wcs-fetch url: articleUrl>) was waited for — not "Loading…"
    expect(outlet).toContain("<h1>Harvest festival this weekend</h1>");
    expect(outlet).not.toMatch(/<p>Loading…<\/p>/);
    expect(outlet).toMatch(/Comments \(<span>0<\/span>\)/);
    // the snapshot holds the article and the id it belongs to (hydration fetches nothing)
    expect(html).toContain('"articleFor":3');
    expect(html).toContain('"commentsFor":3');
    // the route's <wcs-head> keeps its children for the client (4.3)
    expect(outlet).toMatch(/<wcs-head>\s*<title[^>]*>Harvest festival this weekend — SSR News<\/title>/);
  });

  test("一覧の行の <wcs-link> は <a> と題名ごとサーバーで描かれる", async ({ request }) => {
    const html = await (await request.get(`${BASE}/`)).text();
    const links = outletOf(html).match(/<a href="\/articles\/\d"[^>]*data-wcs-ssr-link[^>]*><span>[^<]+<\/span><\/a>/g) ?? [];
    expect(links.length).toBe(5);
    expect(links[0]).toContain("<span>City opens a new library</span>");
  });

  test("見つからない記事と、無いページは 404", async ({ request }) => {
    const missing = await request.get(`${BASE}/articles/999`);
    expect(missing.status()).toBe(404);
    expect(outletOf(await missing.text())).toContain("<h1>Article not found</h1>");
    const nope = await request.get(`${BASE}/no/such/page`);
    expect(nope.status()).toBe(404);
    expect(outletOf(await nope.text())).toContain("<h1>Page not found</h1>");
  });
});

test.describe("ssr-news — ハイドレーション", () => {
  test("一覧: サーバーの行とリンクのノードをそのまま引き取り、ブラウザは何も取り直さない", async ({ page }) => {
    const messages = collectConsole(page);
    const api = collectApi(page);
    await delayClient(page, 800);
    await page.goto(`${BASE}/`, { waitUntil: "commit" });
    await page.waitForSelector("ul.articles li a");
    await page.evaluate(() => {
      (window as any).__server = Array.from(document.querySelectorAll("ul.articles li, ul.articles a, ul.articles span"));
    });
    await hydrated(page);
    const kept = await page.evaluate(() => {
      const before = (window as any).__server as Element[];
      return before.length > 0 && before.every((n) => n.isConnected);
    });
    expect(kept).toBe(true);
    await expect(page.locator("ul.articles a")).toHaveCount(5);
    await expect(page.locator("a[data-wcs-ssr-link]")).toHaveCount(0);
    expect(api).toEqual([]);
    expect(messages).toEqual([]);
  });

  test("記事への深いリンク: 取り直さず、題名はルートの <wcs-head> が持ち、遷移のたびに変わる", async ({ page }) => {
    const messages = collectConsole(page);
    const api = collectApi(page);
    await page.goto(`${BASE}/articles/3`);
    await hydrated(page);
    await expect(page.locator("article h1")).toHaveText("Harvest festival this weekend");
    await expect(page).toHaveTitle("Harvest festival this weekend — SSR News");
    expect(api).toEqual([]);
    // a sidebar link (a row of the layout) navigates without a reload
    await page.evaluate(() => { (window as any).__sameDocument = true; });
    await page.getByRole("link", { name: "Storm warning for the coast" }).click();
    await expect(page.locator("article h1")).toHaveText("Storm warning for the coast");
    await expect(page).toHaveTitle("Storm warning for the coast — SSR News");
    expect(await page.evaluate(() => (window as any).__sameDocument)).toBe(true);
    expect(api).toEqual(["GET /api/articles/5", "GET /api/articles/5/comments"]);
    expect(messages).toEqual([]);
  });

  test("ハイドレーションの前に選んだ文字の大きさは残り、状態と保存に届く（ページ直下の部品）", async ({ page }) => {
    const messages = collectConsole(page);
    await delayClient(page, 1500);
    await page.goto(`${BASE}/`, { waitUntil: "commit" });
    await page.waitForSelector("header select");
    await page.selectOption("header select", "l");
    await hydrated(page);
    // the reader's choice, not the state's "m": given back after binding, so the two-way binding wrote it
    await expect(page.locator("header select")).toHaveValue("l");
    await expect(page.locator(".page")).toHaveCSS("font-size", "20px");
    expect(await page.evaluate(() => localStorage.getItem("ssr-news.fontSize"))).toBe("l");
    expect(messages).toEqual([]);
    // (the comment form is in a <wcs-layout> route, which the client renders again: what was typed
    // there before hydration is lost — README "Known limits")
  });
});

test.describe("ssr-news — 使う", () => {
  test("投稿: 成功は保留の行から本物に、空は 422 で取り消し、失敗は 500 で取り消し、二度押しは 1 回", async ({ page }) => {
    const messages = collectConsole(page);
    const posts: string[] = [];
    page.on("request", (req) => { if (req.method() === "POST") posts.push(new URL(req.url()).pathname + new URL(req.url()).search); });
    await page.goto(`${BASE}/articles/4`);
    await hydrated(page);
    const rows = page.locator(".comments li");
    await expect(rows).toHaveCount(0);
    // empty → 422: the pending row is taken back, the field says why
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.locator(".field-error")).toHaveText("required");
    await expect(page.locator(".comments .form-error")).toHaveText("Please fix the comment.");
    await expect(rows).toHaveCount(0);
    // the server fails → 500: taken back, the text stays
    await page.fill("article textarea", "will fail");
    await page.getByLabel("(test) make the server fail").check();
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page.locator(".comments .form-error")).toHaveText("The comment could not be posted (HTTP 500). Try again.");
    await expect(rows).toHaveCount(0);
    await expect(page.locator("article textarea")).toHaveValue("will fail");
    // success, clicked twice: one POST, one comment
    await page.getByLabel("(test) make the server fail").uncheck();
    await page.fill("article input[name=author]", "bob");
    await page.fill("article textarea", "First!");
    await page.getByRole("button", { name: "Post comment" }).dblclick();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("bob: First!");
    await expect(rows.first()).not.toHaveClass(/pending/);
    expect(posts.filter((p) => p === "/api/articles/4/comments")).toHaveLength(2);   // the 422 and the success
    // a reload brings it from the server (the article's cached pages were dropped)
    await page.reload();
    await hydrated(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("bob: First!");
    // (the browser's own lines for the 422 and the 500 the test asked for)
    expect(messages.filter((m) => !m.includes("Failed to load resource"))).toEqual([]);
  });

  test("利用者の内容は状態としてテキストのまま: {{ }} もタグも読まれない", async ({ page }) => {
    const messages = collectConsole(page);
    await page.goto(`${BASE}/articles/1`);
    await hydrated(page);
    const texts = await page.locator(".comments .text").allTextContents();
    expect(texts.slice(0, 3)).toEqual(["{{ apiKey }}", "<b>bold</b>", '<button data-wcs="onclick: wipe">x</button>']);
    await expect(page.locator("body")).not.toContainText("pk_live_reader_7f3a");
    await expect(page.locator(".comments li button")).toHaveCount(0);
    expect(messages).toEqual([]);
  });

  test("戻る・進む: URL・題名・見出しが合う", async ({ page }) => {
    const messages = collectConsole(page);
    await page.goto(`${BASE}/`);
    await hydrated(page);
    await page.getByRole("link", { name: "City opens a new library" }).click();
    await expect(page.locator("article h1")).toHaveText("City opens a new library");
    await page.getByRole("link", { name: "School meals go local" }).click();
    await expect(page.locator("article h1")).toHaveText("School meals go local");
    await page.goBack();
    await expect(page).toHaveURL(`${BASE}/articles/1`);
    await expect(page.locator("article h1")).toHaveText("City opens a new library");
    await expect(page).toHaveTitle("City opens a new library — SSR News");
    await page.goBack();
    await expect(page).toHaveURL(`${BASE}/`);
    await expect(page.locator("ul.articles li")).toHaveCount(5);
    await page.goForward();
    await expect(page.locator("article h1")).toHaveText("City opens a new library");
    expect(messages).toEqual([]);
  });

  test("設定と既読は再読み込みで残る（サーバーには見えない — ハイドレーションの後に効く）", async ({ page }) => {
    const messages = collectConsole(page);
    await page.goto(`${BASE}/`);
    await hydrated(page);
    await page.getByLabel("Text size").selectOption("l");
    await expect(page.locator(".page")).toHaveCSS("font-size", "20px");
    await page.getByRole("link", { name: "Rail strike called off" }).click();
    await expect(page.locator("article h1")).toHaveText("Rail strike called off");
    await page.getByRole("link", { name: "Latest" }).click();
    await expect(page.locator("ul.articles li.read")).toHaveCount(1);
    await page.reload();
    await hydrated(page);
    await expect(page.locator(".page")).toHaveCSS("font-size", "20px");
    await expect(page.locator("ul.articles li.read h2")).toHaveText("Rail strike called off");
    await expect(page.getByLabel("Text size")).toHaveValue("l");
    expect(messages).toEqual([]);
  });

  test("記事の要求がネットワークで失敗すると Retry を出し、戻ったら読み込む", async ({ page }) => {
    const messages = collectErrors(page);
    await page.goto(`${BASE}/`);
    await hydrated(page);
    await page.route("**/api/articles/3", (route) => route.abort());
    await page.getByRole("link", { name: "Harvest festival this weekend" }).click();
    await expect(page.locator("article .form-error")).toContainText("The article could not be loaded.");
    await page.unroute("**/api/articles/3");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator("article h1")).toHaveText("Harvest festival this weekend");
    // the aborted request is the only error the browser reports
    expect(messages.filter((m) => !m.includes("net::ERR_FAILED"))).toEqual([]);
  });

  test("見つからない記事へ遷移すると、その旨と一覧へのリンク", async ({ page }) => {
    const messages = collectConsole(page);
    await page.goto(`${BASE}/`);
    await hydrated(page);
    await page.evaluate(() => (document.querySelector("wcs-router") as any).navigate("/articles/999"));
    await expect(page.locator(".not-found h1")).toHaveText("Article not found");
    await expect(page).toHaveTitle("Article not found — SSR News");
    await page.getByRole("link", { name: "Back to the latest news" }).click();
    await expect(page.locator("ul.articles li")).toHaveCount(5);
    expect(messages.filter((m) => !m.includes("404"))).toEqual([]);
  });
});

test.describe("ssr-news — JavaScript 無し", () => {
  test("一覧と記事が読め、リンクで移れ、コメントもフォームで投稿できる", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${BASE}/`);
    await expect(page.locator("ul.articles li a")).toHaveCount(5);
    await page.getByRole("link", { name: "Storm warning for the coast" }).click();
    await expect(page).toHaveURL(`${BASE}/articles/5`);
    await expect(page.locator("article h1")).toHaveText("Storm warning for the coast");
    await page.fill("article input[name=author]", "no-js reader");
    await page.fill("article textarea", "posted by the form");
    await page.getByRole("button", { name: "Post comment" }).click();
    await expect(page).toHaveURL(`${BASE}/articles/5`);
    await expect(page.locator(".comments li").last()).toContainText("no-js reader: posted by the form");
    await context.close();
  });
});
