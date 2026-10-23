import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/fw-inventory — 在庫の道具（継ぎ目アプリ、docs/seam-apps.md の fw-inventory）。React 19 の管理画面と
// Vue 3 の倉庫のパネルが、I/O ノードを @wc-bindable/react / vue のアダプター越しに使う。@wcstack/state は無い。
// 主題は継ぎ目: アダプターの values（状態）と要素のイベント（出来事）、React 19 の props の順と属性、
// フレームワークが取る名前（`key` → `storage-key`）、structured clone とリアクティブなプロキシ、
// 2 つのタブの間の storage / BroadcastChannel。
//
// この spec はその意図を実ブラウザで固定する: 続けて届く 5 件の在庫がすべて表に届く、保存したフィルタが
// 最初の描画に上書きされず再読み込みで戻る、片方のタブの検索がもう片方に届く、ファイルを先に渡しても
// アップロードされる、Vue と React の取り置きの一覧が互いに届く、同じ "pong" が 2 回数えられる。
//
// アプリは Vite のビルド（dist/）。CI は e2e.yml で `npm ci && WCS_LOCAL=1 npm run build`（@wcstack/* を
// src から作り直した packages/*/dist に向ける）を先に走らせる。手元では同じことを先にする。
// デモのサーバーを TICK=0（乱数の在庫の変化なし）でワーカーごとに別ポートで立てる。
const PORT = Number(process.env.FW_INVENTORY_PORT || 5200) + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const APP = `http://localhost:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const EXAMPLE = resolve(REPO_ROOT, "examples/fw-inventory");

let server: ChildProcess;

test.beforeAll(async () => {
  if (!existsSync(resolve(EXAMPLE, "dist/index.html"))) {
    throw new Error("examples/fw-inventory is not built: cd examples/fw-inventory && npm ci && WCS_LOCAL=1 npm run build");
  }
  server = spawn(process.execPath, ["examples/fw-inventory/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(PORT), TICK: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error("demo server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("fw-inventory server running")) {
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

test.beforeEach(async () => {
  expect((await api("POST", "/api/test/reset")).status).toBe(200);
});

// --- helpers -------------------------------------------------------------------

async function api(method: string, path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(APP + path, { method });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** console.error / pageerror / console.warning を集める。HTTP の失敗を見せるテストは allow で期待する行を外す */
function collectConsole(page: Page): string[] {
  const messages = collectErrors(page);
  page.on("console", (msg) => {
    if (msg.type() === "warning") messages.push(`console.warn: ${msg.text()}`);
  });
  return messages;
}
const unexpected = (messages: string[], ...allow: RegExp[]) =>
  messages.filter((m) => !allow.some((re) => re.test(m)));
const FAILED_RESOURCE = /Failed to load resource: the server responded with a status of (404|413|422|500)/;

const rowNames = (page: Page) => page.getByTestId("rows").locator("tr td:nth-child(2)").allTextContents();

async function openList(page: Page, path = "/"): Promise<void> {
  await page.goto(APP + path);
  await expect(page.getByTestId("sse-status")).toHaveText("stock: live");
  await expect(page.getByTestId("rows").locator("tr")).not.toHaveCount(0);
}

const png = (name: string, bytes = 2048) => ({ name, mimeType: "image/png", buffer: Buffer.alloc(bytes, 7) });

// --- the list ------------------------------------------------------------------

test("一覧: 検索・ページ送り・並べ替えが url の問い合わせになり、速く打っても最後の検索が勝つ", async ({ page }) => {
  const messages = collectConsole(page);
  await openList(page);
  await expect(page.getByTestId("rows").locator("tr")).toHaveCount(10);
  await expect(page.getByTestId("total")).toHaveText("40 products");

  await page.getByTestId("search").pressSequentially("bolt", { delay: 20 });
  await expect.poll(() => rowNames(page)).toEqual(["Bolt S", "Bolt XL"]);

  await page.getByTestId("search").fill("");
  await expect(page.getByTestId("page")).toHaveText("Page 1 / 4");
  await page.getByTestId("next").click();
  await expect(page.getByTestId("page")).toHaveText("Page 2 / 4");
  await page.getByTestId("sort").selectOption("-stock");
  await expect(page.getByTestId("page")).toHaveText("Page 1 / 4");
  await expect.poll(async () => {
    const stocks = (await page.getByTestId("stock").allTextContents()).map(Number);
    return stocks.length === 10 && stocks.every((s, i) => i === 0 || stocks[i - 1] >= s) && stocks[0] === 49;
  }).toBe(true);

  await page.getByTestId("search").fill("zzzz");
  await expect(page.getByTestId("empty")).toHaveText("No products match “zzzz”.");
  expect(unexpected(messages)).toEqual([]);
});

test("一覧: 失敗は error と Retry で出て、Retry（命令）で読み直す", async ({ page }) => {
  const messages = collectConsole(page);
  await api("POST", "/api/test/fail-next?kind=products");
  await page.goto(APP + "/");
  await expect(page.getByTestId("error")).toContainText("Could not load products (500)");
  await page.getByTestId("retry").click();
  await expect(page.getByTestId("rows").locator("tr")).toHaveCount(10);
  await expect(page.getByTestId("error")).toHaveCount(0);
  expect(unexpected(messages, FAILED_RESOURCE)).toEqual([]);
});

// --- live stock ------------------------------------------------------------------

test("在庫: 1 回の書き込みで届く 5 件のイベントが、5 件とも表に届く", async ({ page }) => {
  const messages = collectConsole(page);
  await openList(page);
  const { json } = await api("POST", "/api/test/burst?n=5");
  expect(json.pushed).toHaveLength(5);
  for (const { id, stock } of json.pushed) {
    await expect(page.locator(`tr[data-id="${id}"] [data-testid=stock]`)).toHaveText(String(stock));
  }
  expect(unexpected(messages)).toEqual([]);
});

// --- filters in <wcs-storage storage-key> -------------------------------------------

test("フィルタ: 保存した値は最初の描画に上書きされず、変えたフィルタは再読み込みで戻る", async ({ page }) => {
  const messages = collectConsole(page);
  // a first visit with a stored value: it is restored, not overwritten by the empty filters
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("inv-filters", JSON.stringify({ q: "bolt", page: 1, sort: "name" }));
    }
  });
  await page.goto(APP + "/");
  await expect(page.getByTestId("search")).toHaveValue("bolt");
  await expect.poll(() => rowNames(page)).toEqual(["Bolt S", "Bolt XL"]);

  await page.getByTestId("search").fill("cable");
  await page.getByTestId("sort").selectOption("stock");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("inv-filters") ?? "null")))
    .toEqual({ q: "cable", page: 1, sort: "stock" });

  await page.reload();
  await expect(page.getByTestId("search")).toHaveValue("cable");
  await expect(page.getByTestId("sort")).toHaveValue("stock");
  await expect.poll(async () => (await rowNames(page)).sort()).toEqual(["Cable S", "Cable XL"]);
  expect(unexpected(messages)).toEqual([]);
});

test("フィルタ: 片方のタブの検索が、もう片方のタブの検索欄と一覧に届く", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  const messages = [...collectConsole(a), ...collectConsole(b)];
  await openList(a);
  await openList(b);
  await a.getByTestId("search").fill("drill");
  await expect(b.getByTestId("search")).toHaveValue("drill");
  await expect.poll(async () => (await rowNames(b)).sort()).toEqual(["Drill S", "Drill XL"]);
  expect(unexpected(messages)).toEqual([]);
});

// --- product pages (react-router) ------------------------------------------------

test("商品のページ: 深いリンク・再読み込み・無い商品・一覧へ戻る", async ({ page }) => {
  const messages = collectConsole(page);
  await page.goto(APP + "/products/3");
  await expect(page.getByTestId("detail-name")).toHaveText("Cable S");
  await page.reload();
  await expect(page.getByTestId("detail-name")).toHaveText("Cable S");

  await page.goto(APP + "/products/999");
  await expect(page.getByTestId("not-found")).toHaveText("Product 999 does not exist.");

  await openList(page);
  await page.getByTestId("product-link").first().click();
  await expect(page.getByTestId("detail-name")).toHaveText("Anchor S");
  await page.getByTestId("back").click();
  await expect(page.getByTestId("total")).toHaveText("40 products");
  expect(unexpected(messages, FAILED_RESOURCE)).toEqual([]);
});

// --- photo uploads (<wcs-upload files={…} url={…}>, files written first) ----------------

test("写真: 1 ファイルに 1 つの <wcs-upload>。2 つとも送られ、失敗は Retry で、1 MB 超は 413 で知らせる", async ({ page }) => {
  const messages = collectConsole(page);
  await page.goto(APP + "/products/4");
  await expect(page.getByTestId("detail-name")).toHaveText("Drill S");

  await page.getByTestId("photo-input").setInputFiles([png("a.png"), png("b.png")]);
  await expect(page.locator('[data-testid=upload-row][data-state="done"]')).toHaveCount(2);
  await expect(page.getByTestId("photos").locator("img")).toHaveCount(2);

  await api("POST", "/api/test/fail-next?kind=upload");
  await page.getByTestId("photo-input").setInputFiles([png("c.png")]);
  const c = page.locator('[data-testid=upload-row][data-file="c.png"]');
  await expect(c.getByTestId("upload-state")).toHaveText("failed: server error 500");
  await c.getByTestId("upload-retry").click();
  await expect(c).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("photos").locator("img")).toHaveCount(3);

  await page.getByTestId("photo-input").setInputFiles([png("big.png", 1024 * 1024 + 10)]);
  await expect(page.locator('[data-testid=upload-row][data-file="big.png"]').getByTestId("upload-state"))
    .toHaveText("failed: too large (over 1 MB)");
  expect((await api("GET", "/api/products/4")).json.photos).toHaveLength(3);
  expect(unexpected(messages, FAILED_RESOURCE)).toEqual([]);
});

// --- the Vue warehouse panel ------------------------------------------------------

const csv = (lines: string[]) => ({ name: "stock.csv", mimeType: "text/csv", buffer: Buffer.from(["sku,stock", ...lines].join("\n")) });

test("倉庫（Vue）: CSV を worker で読み、取り込み、422 は行ごとに出る。同じ \"pong\" は 2 回数える", async ({ page }) => {
  const messages = collectConsole(page);
  await page.goto(APP + "/warehouse.html");
  await expect(page.getByTestId("worker-status")).toHaveText("worker: ready");

  await page.getByTestId("ping").click();
  await page.getByTestId("ping").click();
  await expect(page.getByTestId("pongs")).toHaveText("2 pong(s)");

  const lines = Array.from({ length: 24 }, (_, i) => `SKU-${String(i + 1).padStart(4, "0")},${100 + i}`);
  await page.getByTestId("csv-input").setInputFiles(csv([...lines.slice(0, 10), "SKU-0011,many", ...lines.slice(10)]));
  await expect(page.getByTestId("parsed")).toHaveText("24 rows parsed from stock.csv, 1 lines skipped");
  await expect(page.getByTestId("progress").locator("li")).toHaveCount(5);
  await page.getByTestId("import").click();
  await expect(page.getByTestId("import-done")).toHaveText("Updated 24 products.");
  expect((await api("GET", "/api/products/1")).json.stock).toBe(100);

  await page.getByTestId("csv-input").setInputFiles(csv(["SKU-0001,1", "NOPE-1,2"]));
  await expect(page.getByTestId("parsed")).toHaveText("2 rows parsed from stock.csv");
  await page.getByTestId("import").click();
  await expect(page.getByTestId("import-error")).toContainText("Import refused (422).");
  await expect(page.getByTestId("import-error")).toContainText("row 2: unknown sku NOPE-1");
  expect(unexpected(messages, FAILED_RESOURCE)).toEqual([]);
});

// --- the picked list, React ⇄ Vue over <wcs-broadcast> --------------------------------

test("取り置き: React と Vue のタブの一覧が互いに届き、新しいタブは今の一覧を受け取る", async ({ context }) => {
  const react = await context.newPage();
  const messages = collectConsole(react);
  await openList(react);
  await react.locator('tr[data-id="1"]').getByTestId("pick").click();
  await react.locator('tr[data-id="2"]').getByTestId("pick").click();
  await react.locator('tr[data-id="2"]').getByTestId("pick").click();

  const vue = await context.newPage();
  messages.push(...collectConsole(vue));
  await vue.goto(APP + "/warehouse.html");
  const vueList = vue.getByTestId("picked-list");
  await expect(vueList.locator("li")).toHaveCount(2);
  await expect(vueList.locator('li[data-sku="SKU-0002"]')).toContainText("× 2");

  // a list built with `filter` / a spread over Vue's reactive rows: posted as a deep plain copy
  await vueList.locator('li[data-sku="SKU-0001"]').getByTestId("picked-done").click();
  await vue.getByTestId("pick-sku").fill("SKU-0005");
  await vue.getByTestId("pick-add").click();
  const reactList = react.getByTestId("picked-list");
  await expect(reactList.locator("li")).toHaveCount(2);
  await expect(reactList.locator('li[data-sku="SKU-0001"]')).toHaveCount(0);
  await expect(reactList.locator('li[data-sku="SKU-0005"]')).toHaveCount(1);
  await expect(vue.getByTestId("picked-error")).toHaveCount(0);

  const third = await context.newPage();
  messages.push(...collectConsole(third));
  await openList(third);
  await expect(third.getByTestId("picked-list").locator("li")).toHaveCount(2);
  expect(unexpected(messages)).toEqual([]);
});
