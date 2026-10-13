import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/signals-shop — チュートリアルの店「Little Roastery」（state 版はステップ 14）を
// @wcstack/signals で書き直したもの。signal / computed / h() が、state と同じ I/O 要素
// （<wcs-fetch> / <wcs-storage> / <wcs-router>）を wc-bindable の橋（mountNode / bindNode）
// 越しに動かす。この spec は、その橋が実ブラウザで渡るつなぎ目を固定する:
//   - <wcs-storage>: 再読み込みで戻るカート（bindInput の前に読み込み値で種を蒔く）と、
//     2 つ目のタブとの双方向の同期（storage イベント → value → signal）
//   - <wcs-router>: ルートの中身は SignalsElement のページで、ルーターが同じノードを
//     出し入れする。typedParams は bindNode で signal になる。戻るで検索語とカテゴリが残る
//   - For: キーで行を使い回したまま、イミュータブルな更新を current() で描く
//   - <wcs-fetch>: 読み込み失敗と「Try again」
//
// serve.mjs（リポジトリルートを配る共有サーバー）には載せられない。ページは
// <base href="/"> でアプリのルートを固定しており、ディープリンク用の SPA fallback と
// FAIL_CATALOG もデモ自身の server.js が持つ。そこで router-spa と同じく、デモの
// サーバーを WCS_LOCAL=1（import map の esm.run → packages/*/dist の書き換え。
// @wcstack/signals/dom も含む）でワーカーごとに別ポートに立てる。失敗の試験だけは
// FAIL_CATALOG=1 のサーバーをその試験の中で立て直す（失敗は 1 プロセスに 1 回だけなので、
// 再試行でも毎回最初の要求が 500 になるように）。
const PORT = Number(process.env.SIGNALS_SHOP_PORT || 4900) + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const FAIL_PORT = PORT + 50;
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const CART_KEY = "little-roastery-cart";

type Product = { id: number; name: string; category: string; description: string; price: number; stock: number; icon: string };

// 期待値はページのコードではなく、デモが配るカタログから組み立てる
const catalog: Product[] = JSON.parse(readFileSync(resolve(REPO_ROOT, "examples/signals-shop/products.json"), "utf8"));
const byId = (id: number) => catalog.find((p) => p.id === id)!;
const money = (n: number) => "$" + n.toFixed(2);

function startServer(port: number, env: Record<string, string> = {}): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["examples/signals-shop/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(port), FAIL_CATALOG: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise<ChildProcess>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error("demo server did not start in 30s")), 30_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Demo server running")) {
        clearTimeout(timer);
        resolveReady(child);
      }
    });
    child.on("error", (err) => { clearTimeout(timer); rejectReady(err); });
    child.on("exit", (code) => { clearTimeout(timer); rejectReady(new Error(`demo server exited with ${code}`)); });
  });
}

// 子プロセスが終わるまで待つ: 同じワーカーで次に立てるサーバーが同じポートを使う。
async function stopServer(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((done) => child.once("exit", done));
  child.kill();
  await exited;
}

let server: ChildProcess;
test.beforeAll(async () => { server = await startServer(PORT); });
test.afterAll(async () => { await stopServer(server); });

/** pageerror・console.error（helpers.ts）に加えて console.warning も集める */
function collectProblems(page: Page): string[] {
  const problems = collectErrors(page);
  page.on("console", (msg) => {
    if (msg.type() === "warning") problems.push(`console.warning: ${msg.text()}`);
  });
  return problems;
}

const cards = (page: Page) => page.locator(".grid product-card");
const card = (page: Page, name: string) => cards(page).filter({ hasText: name });
const lines = (page: Page) => page.locator(".cart-lines li");
const line = (page: Page, name: string) => lines(page).filter({ hasText: name });
const search = (page: Page) => page.getByRole("searchbox", { name: "Search products" });
const categoryRadio = (page: Page, label: string) => page.getByRole("radio", { name: label });
const productPage = (page: Page) => page.locator("wcs-outlet .product-page");

/** カタログが読み込まれ、指定の商品だけをこの順でカードに描いていること */
async function expectCards(page: Page, products: Product[]): Promise<void> {
  await expect(cards(page)).toHaveCount(products.length);
  await expect(cards(page).locator("h3")).toHaveText(products.map((p) => p.name));
}

/** カートの行（名前・行合計・数量）と小計・送料・合計・バッジ */
async function expectCart(page: Page, want: { id: number; quantity: number }[]): Promise<void> {
  const subtotal = want.reduce((sum, l) => sum + byId(l.id).price * l.quantity, 0);
  const shipping = subtotal >= 50 ? 0 : 5;
  await expect(lines(page).locator(".line-name")).toHaveText(want.map((l) => byId(l.id).name));
  await expect(lines(page).locator(".line-total")).toHaveText(want.map((l) => money(byId(l.id).price * l.quantity)));
  await expect(lines(page).locator(".stepper span")).toHaveText(want.map((l) => String(l.quantity)));
  await expect(page.locator(".cart .totals dd")).toHaveText([money(subtotal), money(shipping), money(subtotal + shipping)]);
  await expect(page.locator(".cart-badge")).toHaveText(`Cart: ${want.reduce((n, l) => n + l.quantity, 0)}`);
  await expect(page.locator(".cart .hint")).toBeVisible({ visible: shipping !== 0 });
}

const stored = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), CART_KEY);

test.describe("examples/signals-shop", () => {
  test("カタログ: products.json の全商品を <product-card> で描き、在庫 0 は Sold out で押せない。読み込みはローカルの dist", async ({ page }) => {
    const problems = collectProblems(page);
    const scripts: string[] = [];
    page.on("request", (req) => { if (req.resourceType() === "script") scripts.push(new URL(req.url()).href); });
    await page.goto(`${BASE}/`);

    await expectCards(page, catalog);
    for (const p of catalog) {
      const c = card(page, p.name);
      await expect(c.locator("h3 a")).toHaveAttribute("href", `products/${p.id}`);
      await expect(c.locator(".price")).toHaveText(money(p.price));
      await expect(c.locator(".badge")).toBeVisible({ visible: p.stock === 0 });
      await expect(c.getByRole("button", { name: "Add to cart" })).toBeEnabled({ enabled: p.stock !== 0 });
    }
    await expect(page.locator(".cart .empty")).toHaveText("Your cart is empty.");
    await expect(page.locator(".cart-badge")).toHaveText("Cart: 0");

    // WCS_LOCAL=1: signals の /dom（とその共有コアのチャンク）も /auto も、CDN ではなくリポジトリの dist から
    expect(scripts.filter((u) => u.includes("esm.run") || u.includes("jsdelivr"))).toEqual([]);
    expect(scripts.map((u) => new URL(u).pathname)).toEqual(expect.arrayContaining([
      "/packages/signals/dist/dom.esm.js",
      "/packages/fetch/dist/auto.min.js",
      "/packages/storage/dist/auto.min.js",
      "/packages/router/dist/auto.min.js",
    ]));
    expect(scripts.some((u) => /\/packages\/signals\/dist\/core-[\w-]+\.esm\.js$/.test(new URL(u).pathname))).toBe(true);
    expect(problems).toEqual([]);
  });

  test("カート: コーヒー 2 つと紅茶 1 つを入れて再読み込みしても、行と合計とバッジが同じで、保存されるのは id と数量だけ", async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto(`${BASE}/`);
    await expectCards(page, catalog);

    const coffee = byId(3), tea = byId(4);
    await card(page, coffee.name).getByRole("button", { name: "Add to cart" }).click();
    await card(page, coffee.name).getByRole("button", { name: "Add to cart" }).click();
    await card(page, tea.name).getByRole("button", { name: "Add to cart" }).click();
    const want = [{ id: coffee.id, quantity: 2 }, { id: tea.id, quantity: 1 }];
    await expectCart(page, want);
    expect(await stored(page)).toEqual(want);

    await page.reload();
    await expectCards(page, catalog);
    await expectCart(page, want);
    expect(await stored(page)).toEqual(want);
    expect(problems).toEqual([]);
  });

  test("数量の +/− はカートを置き換える（イミュータブルな更新）が、同じ行がそのまま新しい数量を描く（For の current()）", async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto(`${BASE}/`);
    await expectCards(page, catalog);
    const coffee = byId(3), tea = byId(4);
    await card(page, coffee.name).getByRole("button", { name: "Add to cart" }).click();
    await card(page, tea.name).getByRole("button", { name: "Add to cart" }).click();
    await expectCart(page, [{ id: coffee.id, quantity: 1 }, { id: tea.id, quantity: 1 }]);

    // 行の要素に印を付けておく: 行が作り直されれば印は消える
    await line(page, tea.name).evaluate((li) => { (li as unknown as { __kept: boolean }).__kept = true; });
    await expect(line(page, tea.name).getByRole("button", { name: "Decrease" })).toBeDisabled();

    await line(page, tea.name).getByRole("button", { name: "Increase" }).click();
    await line(page, tea.name).getByRole("button", { name: "Increase" }).click();
    await line(page, coffee.name).getByRole("button", { name: "Increase" }).click();
    // 16×2 + 12×3 = 68: 50 以上で送料無料、案内は消える
    await expectCart(page, [{ id: coffee.id, quantity: 2 }, { id: tea.id, quantity: 3 }]);
    await expect(line(page, tea.name).getByRole("button", { name: "Decrease" })).toBeEnabled();
    expect(await line(page, tea.name).evaluate((li) => (li as unknown as { __kept?: boolean }).__kept)).toBe(true);

    await line(page, tea.name).getByRole("button", { name: "Decrease" }).click();
    await expectCart(page, [{ id: coffee.id, quantity: 2 }, { id: tea.id, quantity: 2 }]);
    expect(await line(page, tea.name).evaluate((li) => (li as unknown as { __kept?: boolean }).__kept)).toBe(true);

    await line(page, coffee.name).getByRole("button", { name: "Remove" }).click();
    await expectCart(page, [{ id: tea.id, quantity: 2 }]);
    expect(await stored(page)).toEqual([{ id: tea.id, quantity: 2 }]);
    expect(problems).toEqual([]);
  });

  test("2 つ目のタブが同じカートを描き、どちらのタブの変更ももう一方に届く", async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto(`${BASE}/`);
    await expectCards(page, catalog);
    const blend = byId(1), tea = byId(4), pitcher = byId(7);
    await card(page, blend.name).getByRole("button", { name: "Add to cart" }).click();
    await card(page, blend.name).getByRole("button", { name: "Add to cart" }).click();
    await card(page, tea.name).getByRole("button", { name: "Add to cart" }).click();
    await expectCart(page, [{ id: blend.id, quantity: 2 }, { id: tea.id, quantity: 1 }]);

    const second = await page.context().newPage();
    const secondProblems = collectProblems(second);
    await second.goto(`${BASE}/`);
    await expectCards(second, catalog);
    await expectCart(second, [{ id: blend.id, quantity: 2 }, { id: tea.id, quantity: 1 }]);

    // 2 つ目 → 1 つ目
    await line(second, blend.name).getByRole("button", { name: "Increase" }).click();
    await expectCart(page, [{ id: blend.id, quantity: 3 }, { id: tea.id, quantity: 1 }]);
    // 1 つ目 → 2 つ目
    await line(page, tea.name).getByRole("button", { name: "Increase" }).click();
    await card(page, pitcher.name).getByRole("button", { name: "Add to cart" }).click();
    await expectCart(second, [{ id: blend.id, quantity: 3 }, { id: tea.id, quantity: 2 }, { id: pitcher.id, quantity: 1 }]);
    // 削除も届く
    await line(second, blend.name).getByRole("button", { name: "Remove" }).click();
    await expectCart(page, [{ id: tea.id, quantity: 2 }, { id: pitcher.id, quantity: 1 }]);
    // 両方のタブが落ち着いた後も、保存されているのは同じカート
    await expectCart(second, [{ id: tea.id, quantity: 2 }, { id: pitcher.id, quantity: 1 }]);
    expect(await stored(page)).toEqual([{ id: tea.id, quantity: 2 }, { id: pitcher.id, quantity: 1 }]);
    expect([...problems, ...secondProblems]).toEqual([]);
  });

  test("ディープリンク /products/3 から入り、カタログで絞り込んで商品へ、カートに入れて戻ると検索語とカテゴリが残っている", async ({ page }) => {
    const problems = collectProblems(page);
    const target = byId(3);
    await page.goto(`${BASE}/products/${target.id}`);
    await expect(productPage(page).locator("h2")).toHaveText(target.name);
    await expect(productPage(page).locator(".price")).toHaveText(money(target.price));
    await expect(cards(page)).toHaveCount(0);

    // 再読み込みしても同じ商品（サーバーの SPA fallback + <base href="/">）
    await page.reload();
    await expect(productPage(page).locator("h2")).toHaveText(target.name);
    await productPage(page).getByRole("button", { name: "Add to cart" }).click();
    await expectCart(page, [{ id: target.id, quantity: 1 }]);

    await productPage(page).getByRole("link", { name: "← All products" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expectCards(page, catalog);

    await search(page).fill("o");
    await categoryRadio(page, "Coffee").check();
    const shown = catalog.filter((p) => p.category === "coffee" && p.name.toLowerCase().includes("o"));
    await expectCards(page, shown);

    await card(page, target.name).getByRole("link", { name: target.name }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/products/${target.id}`);
    await expect(productPage(page).locator("h2")).toHaveText(target.name);
    await productPage(page).getByRole("button", { name: "Add to cart" }).click();
    await expectCart(page, [{ id: target.id, quantity: 2 }]);

    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expectCards(page, shown);
    await expect(search(page)).toHaveValue("o");
    await expect(categoryRadio(page, "Coffee")).toBeChecked();
    await expect(productPage(page)).toHaveCount(0);
    await expectCart(page, [{ id: target.id, quantity: 2 }]);

    // もう一度戻ると、ディープリンクで開いた商品ページ
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/products/${target.id}`);
    await expect(productPage(page).locator("h2")).toHaveText(target.name);
    expect(problems).toEqual([]);
  });

  test("知らない id は商品ページの中で No such product.、型に合わないパスと未知のパスは fallback", async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto(`${BASE}/products/99`);
    await expect(productPage(page).locator(".no-results")).toHaveText("No such product.");
    await expect(productPage(page).locator("h2")).toHaveCount(0);

    for (const path of ["/products/abc", "/nope"]) {
      await page.goto(`${BASE}${path}`);
      await expect(page.locator("wcs-outlet .no-results")).toHaveText("Page not found. Back to the shop");
      await expect(productPage(page)).toHaveCount(0);
    }
    await page.getByRole("link", { name: "Back to the shop" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expectCards(page, catalog);
    expect(problems).toEqual([]);
  });

  test("検索 zzz は No products match.、消すと全商品。カテゴリで絞り込める", async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto(`${BASE}/`);
    await expectCards(page, catalog);
    await expect(page.locator(".no-results")).toBeHidden();

    await search(page).fill("zzz");
    await expect(cards(page)).toHaveCount(0);
    await expect(page.locator(".no-results")).toHaveText("No products match.");
    await expect(page.locator(".no-results")).toBeVisible();

    await search(page).fill("");
    await expectCards(page, catalog);
    await expect(page.locator(".no-results")).toBeHidden();

    for (const [label, value] of [["Tea", "tea"], ["Tools", "tools"], ["Coffee", "coffee"], ["All", "all"]]) {
      await categoryRadio(page, label).check();
      await expectCards(page, value === "all" ? catalog : catalog.filter((p) => p.category === value));
    }
    expect(problems).toEqual([]);
  });

  test("読み込みの失敗: FAIL_CATALOG=1 で最初の products.json が 500 だとエラーと Try again、押すとカタログが出る", async ({ page }) => {
    const problems = collectProblems(page);
    const failing = await startServer(FAIL_PORT, { FAIL_CATALOG: "1" });
    try {
      await page.goto(`http://127.0.0.1:${FAIL_PORT}/`);
      const error = page.locator(".status.error");
      await expect(error).toBeVisible();
      await expect(error).toContainText("Couldn't load the products.");
      await expect(page.locator("main.shop")).toBeHidden();
      await expect(page.locator(".status:not(.error)")).toBeHidden();

      await error.getByRole("button", { name: "Try again" }).click();
      await expectCards(page, catalog);
      await expect(error).toBeHidden();
      await expect(page.locator("main.shop")).toBeVisible();
    } finally {
      await stopServer(failing);
    }
    // デモが意図して起こす 500 応答を Chromium がネットワークのログとしてコンソールに出すものだけを除く
    expect(problems.filter((e) => !/Failed to load resource: the server responded with a status of 500/.test(e))).toEqual([]);
  });
});
