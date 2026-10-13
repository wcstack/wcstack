import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/router-admin — 英日 2 言語の商品管理画面（seam app、docs/seam-apps.md）。
// 縫い目を跨ぐ意図を固定する: 言語は router の basename（/en・/ja）、一覧の
// ページ・並び・検索は URL（searchParams → state → <wcs-fetch> の url）、
// 編集フォームは取得した商品のコピーを編集し、保存のたびに新しい body を送り、
// 422 の欄エラーを欄の横に出す。未保存の変更は <wcs-router leaveConfirm> が
// 確認し、サイドナビは <wcs-link match="prefix"> が現在のセクションを示す。
//
// router-spa / router-i18n と同じ理由で serve.mjs には載せられない（言語の
// セグメントがオリジンのルートにある前提の head スクリプトと、/api と SPA
// fallback を持つデモ自身のサーバー）。WCS_LOCAL=1 でワーカーごとに別ポートで立てる。
// サーバーは商品をメモリに持つので、各テストの前に POST /api/reset で初期の
// 35 件へ戻し、テストどうしが互いの書き込みを見ないようにする。
const PORT = 4700 + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const TZ = "Asia/Tokyo";

type Product = { id: number; sku: string; name: string; price: number; stock: number; updatedAt: string };
type ListResponse = { items: Product[]; total: number; page: number; size: number };

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/router-admin/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT), DELAY_MS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error("demo server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Demo server running")) {
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
  const res = await fetch(`${BASE}/api/reset`, { method: "POST" });
  expect(res.status).toBe(204);
});

// 日付は書式を言語で変える（2026/10/13 と Oct 13, 2026）: タイムゾーンを固定して決定的にする
test.use({ timezoneId: TZ, locale: "en-US" });

// --- 期待値はページのコードではなく API の応答と Intl から組み立てる ---------
async function api<T>(path: string): Promise<T> {
  return (await fetch(`${BASE}${path}`)).json() as Promise<T>;
}
const yen = (lang: string, n: number) => new Intl.NumberFormat(lang, { style: "currency", currency: "JPY" }).format(n);
const day = (lang: string, iso: string) => new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: TZ }).format(new Date(iso));

// --- ページの部品 ---------------------------------------------------------------
const main = (page: Page) => page.locator("main");
const rowNames = (page: Page) => page.locator("main tbody tr td:first-child a");
const rowCells = (page: Page, col: number) => page.locator(`main tbody tr td:nth-child(${col})`);
const header = (page: Page, i: number) => page.locator("main thead th").nth(i);
const pagerCurrent = (page: Page) => page.locator('.pager a[aria-current="page"]');
const navLinks = (page: Page) => page.locator(".side-nav a");
const saveButton = (page: Page) => page.locator("main form button[type=submit]");
/** 入力欄と、同じ .field の中にあるエラー表示 */
const fieldError = (page: Page, inputId: string) =>
  page.locator(".field", { has: page.locator(`#${inputId}`) }).locator(".field-error");

function pathAndQuery(page: Page): string {
  const url = new URL(page.url());
  return url.pathname + url.search;
}

/** 一覧が API の応答どおりの行を、この順で描いていること */
async function expectRows(page: Page, items: Product[], lang: string): Promise<void> {
  await expect(rowNames(page)).toHaveText(items.map((p) => p.name));
  await expect(rowCells(page, 2)).toHaveText(items.map((p) => yen(lang, p.price)));
  await expect(rowCells(page, 4)).toHaveText(items.map((p) => day(lang, p.updatedAt)));
  await expect(main(page).locator(".loading")).toBeHidden();
}

/** 書き込み要求（GET 以外）の "METHOD path body" を集める */
function trackWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/") && req.method() !== "GET") writes.push(`${req.method()} ${url.pathname} ${req.postData() ?? ""}`.trim());
  });
  return writes;
}

/** ダイアログを type: message で記録し、answer() の答えで閉じる */
function handleDialogs(page: Page) {
  const seen: string[] = [];
  let accept = true;
  page.on("dialog", async (d) => {
    seen.push(`${d.type()}: ${d.message()}`);
    if (accept) await d.accept(); else await d.dismiss();
  });
  return { seen, answer: (yes: boolean) => { accept = yes; } };
}

const expected422 = (e: string) => !/Failed to load resource: the server responded with a status of 422/.test(e);

test.describe("examples/router-admin", () => {
  test("/ は /en/ へ、言語の無いパスは /en を付けて置き換わる。ダッシュボードは API の数字と最近の 5 件を両言語の書式で描く", async ({ page }) => {
    const errors = collectErrors(page);
    const stats = await api<{ count: number; totalStock: number; recent: Product[] }>("/api/stats");

    await page.goto(`${BASE}/`);
    await expect.poll(() => pathAndQuery(page)).toBe("/en/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle("Dashboard");
    await expect(main(page).locator("h1")).toHaveText("Dashboard");
    await expect(main(page).locator(".stat b")).toHaveText([stats.count.toLocaleString("en"), stats.totalStock.toLocaleString("en")]);
    await expect(rowNames(page)).toHaveText(stats.recent.map((p) => p.name));
    await expect(rowCells(page, 3)).toHaveText(stats.recent.map((p) => day("en", p.updatedAt)));
    expect(day("en", stats.recent[0].updatedAt)).toBe("Oct 13, 2026");

    await page.goto(`${BASE}/products`);
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products");

    await page.goto(`${BASE}/ja/`);
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(main(page).locator("h1")).toHaveText("ダッシュボード");
    await expect(main(page).locator(".stat span")).toHaveText(["商品数", "在庫の合計"]);
    await expect(rowCells(page, 3)).toHaveText(stats.recent.map((p) => day("ja", p.updatedAt)));
    expect(day("ja", stats.recent[0].updatedAt)).toBe("2026/10/13");
    await expect(rowCells(page, 2).first()).toHaveText(yen("ja", stats.recent[0].price));

    expect(errors).toEqual([]);
  });

  test("ディープリンク /ja/products?page=3&sort=price&dir=desc: 日本語で、価格の降順の 3 ページ目", async ({ page }) => {
    const errors = collectErrors(page);
    const expected = await api<ListResponse>("/api/products?page=3&sort=price&dir=desc");

    await page.goto(`${BASE}/ja/products?page=3&sort=price&dir=desc`);
    await expectRows(page, expected.items, "ja");
    expect(pathAndQuery(page)).toBe("/ja/products?page=3&sort=price&dir=desc");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page).toHaveTitle("商品");
    await expect(header(page, 1)).toHaveAttribute("aria-sort", "descending");
    await expect(header(page, 1)).toContainText("価格");
    await expect(header(page, 0)).not.toHaveAttribute("aria-sort", /.+/);
    await expect(pagerCurrent(page)).toHaveText("3");
    await expect(main(page).locator(".toolbar")).toContainText(`${expected.total} 件`);
    // 前後のリンクはページ番号を数として足し引きする（"3" + 1 = "31" にならない）
    await expect(page.locator(".pager a", { hasText: "次へ" })).toHaveAttribute("href", "/ja/products?page=4&sort=price&dir=desc");
    await expect(page.locator(".pager a", { hasText: "前へ" })).toHaveAttribute("href", "/ja/products?page=2&sort=price&dir=desc");

    expect(errors).toEqual([]);
  });

  test("列見出しでソートすると 1 ページ目に戻り（もう一度で逆順）、戻るで価格降順の 3 ページ目に戻る", async ({ page }) => {
    const errors = collectErrors(page);
    const byName = await api<ListResponse>("/api/products?sort=name&dir=asc");
    const byNameDesc = await api<ListResponse>("/api/products?sort=name&dir=desc");
    const priceDesc3 = await api<ListResponse>("/api/products?page=3&sort=price&dir=desc");

    await page.goto(`${BASE}/ja/products?page=3&sort=price&dir=desc`);
    await expectRows(page, priceDesc3.items, "ja");

    await header(page, 0).locator("a").click();
    await expect.poll(() => pathAndQuery(page)).toBe("/ja/products");
    await expectRows(page, byName.items, "ja");
    await expect(header(page, 0)).toHaveAttribute("aria-sort", "ascending");
    await expect(pagerCurrent(page)).toHaveText("1");

    await header(page, 0).locator("a").click();
    await expect.poll(() => pathAndQuery(page)).toBe("/ja/products?dir=desc");
    await expectRows(page, byNameDesc.items, "ja");

    await page.goBack();
    await page.goBack();
    await expect.poll(() => pathAndQuery(page)).toBe("/ja/products?page=3&sort=price&dir=desc");
    await expectRows(page, priceDesc3.items, "ja");
    await expect(header(page, 1)).toHaveAttribute("aria-sort", "descending");
    await expect(pagerCurrent(page)).toHaveText("3");

    expect(errors).toEqual([]);
  });

  test("検索はサーバーで名前か SKU を絞り込み、並びは保ったまま 1 ページ目に戻す", async ({ page }) => {
    const errors = collectErrors(page);
    const tea = await api<ListResponse>("/api/products?q=tea&sort=stock");
    expect(tea.items.length).toBeGreaterThan(1);

    await page.goto(`${BASE}/en/products?page=2&sort=stock`);
    await expect(pagerCurrent(page)).toHaveText("2");
    await page.locator("input[name=q]").fill("tea");
    await page.locator("input[name=q]").press("Enter");
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products?sort=stock&q=tea");
    await expectRows(page, tea.items, "en");
    await expect(main(page).locator(".toolbar")).toContainText(`${tea.total} products`);
    await expect(page.locator("input[name=q]")).toHaveValue("tea");

    // 一致なし: 空の案内。英語の件数は複数形の規則で（1 件なら product）
    await page.goto(`${BASE}/en/products?q=zzz`);
    await expect(main(page)).toContainText("No products match.");
    await expect(main(page).locator(".toolbar")).toContainText("0 products");
    await page.goto(`${BASE}/en/products?q=moka`);
    await expect(rowNames(page)).toHaveCount(0);
    await page.goto(`${BASE}/en/products?q=sku-007`);
    await expect(main(page).locator(".toolbar")).toContainText("1 product");
    await expect(main(page).locator(".toolbar")).not.toContainText("1 products");

    expect(errors).toEqual([]);
  });

  test("一覧から詳細を開いて戻ると、同じページ・並び・検索とスクロール位置に戻る。詳細の「一覧へ戻る」も同じ一覧へ", async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1000, height: 380 });
    const list = await api<ListResponse>("/api/products?page=2&sort=stock&q=e");
    const target = list.items[7];

    await page.goto(`${BASE}/en/products?page=2&sort=stock&q=e`);
    await expectRows(page, list.items, "en");
    const link = rowNames(page).nth(7);
    await link.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => scrollY);
    expect(scrollBefore).toBeGreaterThan(0);

    await link.click();
    await expect.poll(() => pathAndQuery(page)).toBe(`/en/products/${target.id}`);
    await expect(main(page).locator("h1")).toHaveText(target.name);
    await expect(page).toHaveTitle(`${target.name} — Product`);
    await expect(main(page).locator("dd")).toHaveText([target.sku, yen("en", target.price), String(target.stock), day("en", target.updatedAt)]);
    const backLink = main(page).locator("section > p > a").first();
    await expect(backLink).toHaveAttribute("href", "/en/products?page=2&sort=stock&q=e");

    await page.goBack();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products?page=2&sort=stock&q=e");
    await expectRows(page, list.items, "en");
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(scrollBefore);
    await expect(page.locator("input[name=q]")).toHaveValue("e");

    await rowNames(page).nth(0).click();
    await expect(main(page).locator("h1")).toHaveText(list.items[0].name);
    await backLink.click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products?page=2&sort=stock&q=e");
    await expectRows(page, list.items, "en");

    // 一覧から来ていない詳細（直接開いた）の「一覧へ戻る」は 1 ページ目
    await page.goto(`${BASE}/en/products/5`);
    await expect(main(page).locator("h1")).toHaveText((await api<Product>("/api/products/5")).name);
    await expect(backLink).toHaveAttribute("href", "/en/products");

    expect(errors).toEqual([]);
  });

  test("編集: 名前を空にして保存すると欄の横にエラー、直して保存で詳細へ。もう一度の編集と保存もフォームを送る", async ({ page }) => {
    const errors = collectErrors(page);
    const writes = trackWrites(page);
    const before = await api<Product>("/api/products/3");

    await page.goto(`${BASE}/en/products/3`);
    await main(page).getByRole("link", { name: "Edit" }).click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products/3/edit");
    await expect(page).toHaveTitle(`Edit: ${before.name}`);
    await expect(page.locator("#edit-name")).toHaveValue(before.name);
    await expect(page.locator("#edit-price")).toHaveValue(String(before.price));

    await page.locator("#edit-name").fill("");
    await saveButton(page).click();
    await expect(fieldError(page, "edit-name")).toHaveText("Required.");
    await expect(page.locator("#edit-name")).toHaveAttribute("aria-invalid", "true");
    await expect(fieldError(page, "edit-sku")).toBeEmpty();
    await expect(page.locator("main form .error")).toHaveText("Please correct the fields marked below.");
    expect(pathAndQuery(page)).toBe("/en/products/3/edit");

    await page.locator("#edit-name").fill("Walnut Serving Tray");
    await saveButton(page).click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products/3");
    await expect(main(page).locator("h1")).toHaveText("Walnut Serving Tray");

    await main(page).getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("#edit-name")).toHaveValue("Walnut Serving Tray");
    await expect(fieldError(page, "edit-name")).toBeEmpty();
    await page.locator("#edit-stock").fill("99");
    await saveButton(page).click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products/3");
    await expect(main(page).locator("dd").nth(2)).toHaveText("99");

    // 3 回とも、その時のフォームの内容を本文に載せて送った（body は使い捨て）
    expect(writes).toEqual([
      `PUT /api/products/3 ${JSON.stringify({ sku: before.sku, name: "", price: before.price, stock: before.stock })}`,
      `PUT /api/products/3 ${JSON.stringify({ sku: before.sku, name: "Walnut Serving Tray", price: before.price, stock: before.stock })}`,
      `PUT /api/products/3 ${JSON.stringify({ sku: before.sku, name: "Walnut Serving Tray", price: before.price, stock: 99 })}`,
    ]);
    expect((await api<Product>("/api/products/3")).stock).toBe(99);
    // 保存は replace: 戻るで保存済みのフォームには戻らない
    await page.goBack();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products/3");

    expect(errors.filter(expected422)).toEqual([]);
  });

  test("新規: 既存の SKU は SKU 欄のエラー、直すと作成されて一覧の検索に出る", async ({ page }) => {
    const errors = collectErrors(page);
    const writes = trackWrites(page);

    await page.goto(`${BASE}/en/`);
    await navLinks(page).filter({ hasText: "New product" }).click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products/new");
    await expect(page.locator("#new-name")).toHaveValue("");

    await page.locator("#new-sku").fill("sku-001");
    await page.locator("#new-name").fill("Moka Pot");
    await page.locator("#new-price").fill("3800");
    await page.locator("#new-stock").fill("5");
    await saveButton(page).click();
    await expect(fieldError(page, "new-sku")).toHaveText("This SKU is already used by another product.");
    await expect(page.locator("#new-sku")).toHaveAttribute("aria-invalid", "true");
    await expect(fieldError(page, "new-name")).toBeEmpty();

    await page.locator("#new-sku").fill("SKU-100");
    await saveButton(page).click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products/36");
    await expect(main(page).locator("h1")).toHaveText("Moka Pot");
    expect(writes).toEqual([
      'POST /api/products {"sku":"sku-001","name":"Moka Pot","price":3800,"stock":5}',
      'POST /api/products {"sku":"SKU-100","name":"Moka Pot","price":3800,"stock":5}',
    ]);

    await navLinks(page).filter({ hasText: "Products" }).click();
    await page.locator("input[name=q]").fill("moka");
    await page.locator("input[name=q]").press("Enter");
    await expect(rowNames(page)).toHaveText(["Moka Pot"]);

    expect(errors.filter(expected422)).toEqual([]);
  });

  test("削除: 確認を断ると何も送らず、受けると来た一覧へ。最終ページの唯一の商品を消すと存在する最後のページへ", async ({ page }) => {
    const errors = collectErrors(page);
    const writes = trackWrites(page);
    const dialogs = handleDialogs(page);
    // 35 件を 31 件にして、4 ページ目に 1 件だけ残す
    for (const id of [11, 12, 13, 14]) await fetch(`${BASE}/api/products/${id}`, { method: "DELETE" });
    const page4 = await api<ListResponse>("/api/products?page=4");
    expect(page4.items).toHaveLength(1);
    const last = page4.items[0];

    await page.goto(`${BASE}/en/products?page=4`);
    await expect(rowNames(page)).toHaveText([last.name]);
    await rowNames(page).first().click();
    await expect(main(page).locator("h1")).toHaveText(last.name);

    dialogs.answer(false);
    await main(page).getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => dialogs.seen.length).toBe(1);
    expect(dialogs.seen[0]).toBe(`confirm: Delete “${last.name}”? This cannot be undone.`);
    expect(pathAndQuery(page)).toBe(`/en/products/${last.id}`);
    expect(writes).toEqual([]);

    dialogs.answer(true);
    await main(page).getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products?page=3");
    await expect(rowNames(page)).toHaveCount(10);
    await expect(pagerCurrent(page)).toHaveText("3");
    await expect(main(page).locator(".toolbar")).toContainText("30 products");
    expect(writes).toEqual([`DELETE /api/products/${last.id}`]);

    // 直接開いた詳細から消すと 1 ページ目へ
    await page.goto(`${BASE}/en/products/20`);
    await main(page).getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products");
    await expect(main(page).locator(".toolbar")).toContainText("29 products");

    expect(errors).toEqual([]);
  });

  test("未保存の変更: サイドナビ・戻る・取り消しリンクでは leaveConfirm が確認し、断ると変更ごと残り、受けると離れる", async ({ page }) => {
    const errors = collectErrors(page);
    const dialogs = handleDialogs(page);

    await page.goto(`${BASE}/en/products/2`);
    await main(page).getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("#edit-name")).toHaveValue("Glass Teapot");
    // 変更が無ければ聞かない
    await navLinks(page).filter({ hasText: "Dashboard" }).click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/");
    expect(dialogs.seen).toEqual([]);

    await page.goto(`${BASE}/en/products/2`);
    await main(page).getByRole("link", { name: "Edit" }).click();
    await page.locator("#edit-name").fill("Glass Teapot XL");

    dialogs.answer(false);
    await navLinks(page).filter({ hasText: "Products" }).click();
    await expect.poll(() => dialogs.seen.length).toBe(1);
    await expect(page.locator("#edit-name")).toHaveValue("Glass Teapot XL");
    expect(pathAndQuery(page)).toBe("/en/products/2/edit");

    // 戻る（断る）
    await page.evaluate(() => history.back());
    await expect.poll(() => dialogs.seen.length).toBe(2);
    await expect(page.locator("#edit-name")).toHaveValue("Glass Teapot XL");
    expect(pathAndQuery(page)).toBe("/en/products/2/edit");

    // フォームの取り消しリンク（断る）
    await main(page).locator("form .actions a").click();
    await expect.poll(() => dialogs.seen.length).toBe(3);
    expect(pathAndQuery(page)).toBe("/en/products/2/edit");
    expect(dialogs.seen).toEqual(Array(3).fill("confirm: Discard your changes?"));

    // 受けると離れ、変更は保存されない
    dialogs.answer(true);
    await navLinks(page).filter({ hasText: "Products" }).click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products");
    expect(dialogs.seen).toHaveLength(4);
    // 離れたフォームの変更はもう未保存の変更ではない: leaveConfirm は外れる
    // （外れる前に別ページへ goto すると beforeunload が出る）
    await expect(page.locator("wcs-router")).not.toHaveAttribute("leave-confirm", /.*/);
    expect((await api<Product>("/api/products/2")).name).toBe("Glass Teapot");

    // 保存した直後の遷移は聞かない
    await page.goto(`${BASE}/ja/products/2/edit`);
    await page.locator("#edit-stock").fill("40");
    await saveButton(page).click();
    await expect.poll(() => pathAndQuery(page)).toBe("/ja/products/2");
    expect(dialogs.seen).toHaveLength(4);
    // 日本語のページでは日本語で聞く
    await main(page).getByRole("link", { name: "編集" }).click();
    await page.locator("#edit-stock").fill("41");
    dialogs.answer(false);
    await navLinks(page).filter({ hasText: "ダッシュボード" }).click();
    await expect.poll(() => dialogs.seen.length).toBe(5);
    expect(dialogs.seen[4]).toBe("confirm: 変更を破棄しますか？");

    expect(errors).toEqual([]);
  });

  test("編集ページで言語切替: 同じ編集ページの別言語版へ。未保存の変更があればブラウザの beforeunload が確認する", async ({ page }) => {
    const errors = collectErrors(page);
    const dialogs = handleDialogs(page);

    await page.goto(`${BASE}/en/products/2/edit`);
    await expect(page.locator("#edit-name")).toHaveValue("Glass Teapot");
    await expect(page.locator(".lang-switch")).toHaveAttribute("href", "/ja/products/2/edit");
    await expect(page.locator(".lang-switch")).toHaveAttribute("hreflang", "ja");

    await page.locator("#edit-name").fill("Changed");
    await expect(page.locator("wcs-router")).toHaveAttribute("leave-confirm", "Discard your changes?");
    dialogs.answer(false);
    await page.locator(".lang-switch").click();
    await expect.poll(() => dialogs.seen.length).toBe(1);
    expect(dialogs.seen[0]).toMatch(/^beforeunload:/);
    expect(pathAndQuery(page)).toBe("/en/products/2/edit");
    await expect(page.locator("#edit-name")).toHaveValue("Changed");

    dialogs.answer(true);
    await page.locator(".lang-switch").click();
    await expect.poll(() => pathAndQuery(page)).toBe("/ja/products/2/edit");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page).toHaveTitle("編集: Glass Teapot");
    await expect(page.locator("main label")).toHaveText(["SKU", "商品名", "価格", "在庫"]);
    await expect(page.locator("#edit-name")).toHaveValue("Glass Teapot");
    await expect(saveButton(page)).toHaveText("保存");

    // クエリ付きのページでも、同じページ・同じクエリの別言語版へ
    await page.goto(`${BASE}/ja/products?page=2&sort=price&q=e`);
    await expect(page.locator(".lang-switch")).toHaveAttribute("href", "/en/products?page=2&sort=price&q=e");
    await page.locator(".lang-switch").click();
    await expect.poll(() => pathAndQuery(page)).toBe("/en/products?page=2&sort=price&q=e");
    await expect(page.locator("input[name=q]")).toHaveValue("e");

    expect(errors).toEqual([]);
  });

  test("編集ページの再読み込み: 保存済みの商品がフォームに出る（未保存の変更は beforeunload を経て失われる）", async ({ page }) => {
    const errors = collectErrors(page);
    const dialogs = handleDialogs(page);
    const stored = await api<Product>("/api/products/4");

    await page.goto(`${BASE}/en/products/4/edit`);
    await expect(page.locator("#edit-name")).toHaveValue(stored.name);
    await page.locator("#edit-name").fill("unsaved");
    await page.reload();
    await expect(page.locator("#edit-name")).toHaveValue(stored.name);
    await expect(page.locator("#edit-sku")).toHaveValue(stored.sku);
    await expect(page.locator("#edit-stock")).toHaveValue(String(stored.stock));
    await expect(page).toHaveTitle(`Edit: ${stored.name}`);
    expect(dialogs.seen.every((d) => d.startsWith("beforeunload:"))).toBe(true);

    // 再読み込みした新規フォームからも保存できる
    await page.goto(`${BASE}/en/products/new`);
    await page.locator("#new-sku").fill("SKU-500");
    await page.locator("#new-name").fill("Reloaded");
    await page.locator("#new-price").fill("100");
    await page.locator("#new-stock").fill("1");
    await saveButton(page).click();
    await expect(main(page).locator("h1")).toHaveText("Reloaded");

    expect(errors).toEqual([]);
  });

  test("サイドナビは現在のセクションを示す: 商品の詳細と編集でも Products（match=prefix）、新規では New product だけ", async ({ page }) => {
    const errors = collectErrors(page);
    const marked = () => navLinks(page).evaluateAll((links) =>
      links.map((a) => `${a.textContent!.trim()}:${a.getAttribute("aria-current") ?? "-"}:${getComputedStyle(a).fontWeight}`));

    await page.goto(`${BASE}/en/`);
    await expect(navLinks(page).nth(0)).toHaveAttribute("aria-current", "page");
    expect(await marked()).toEqual(["Dashboard:page:600", "Products:-:400", "New product:-:400"]);

    for (const path of ["/en/products?page=2", "/en/products/3", "/en/products/3/edit"]) {
      await page.goto(`${BASE}${path}`);
      await expect(navLinks(page).nth(1)).toHaveClass(/\bactive\b/);
      const [, products, newProduct] = await marked();
      expect(products).toBe(`Products:${path.includes("/3") ? "true" : "page"}:600`);
      expect(newProduct).toBe("New product:-:400");
    }

    // /products/new も /products の下なので Products にも aria-current="true" が付くが、
    // 見た目で示すのはページそのものの New product だけ
    await page.goto(`${BASE}/en/products/new`);
    await expect(navLinks(page).nth(2)).toHaveAttribute("aria-current", "page");
    expect(await marked()).toEqual(["Dashboard:-:400", "Products:true:400", "New product:page:600"]);

    // 日本語でも、アプリ内の遷移でも追従する
    await page.goto(`${BASE}/ja/products`);
    await rowNames(page).first().click();
    await expect(main(page).locator("h1")).not.toBeEmpty();
    expect((await marked())[1]).toBe("商品:true:600");

    expect(errors).toEqual([]);
  });

  test("遅い応答: 読み込み中が見え、前の商品を次の商品の URL で見せず、保存のダブルクリックは 1 リクエストだけ送る", async ({ page }) => {
    const errors = collectErrors(page);
    const writes = trackWrites(page);
    const slow = (ms: number) => async (route: import("@playwright/test").Route) => {
      await new Promise((r) => setTimeout(r, ms));
      await route.continue();
    };
    await page.route(`${BASE}/api/**`, slow(800));

    await page.goto(`${BASE}/en/products`);
    await expect(main(page).locator(".loading")).toBeVisible();
    await expect(rowNames(page)).toHaveCount(10);
    await expect(main(page).locator(".loading")).toBeHidden();

    await page.locator(".pager a", { hasText: "Next" }).click();
    await expect(main(page).locator(".loading")).toBeVisible();
    await expect(main(page).locator("table")).toHaveClass(/\bis-loading\b/);
    await expect(main(page).locator(".loading")).toBeHidden();

    const first = (await rowNames(page).first().textContent())!;
    await rowNames(page).first().click();
    await expect(main(page).locator(".loading")).toBeVisible();
    await expect(main(page).locator("h1")).toHaveText(first);
    await page.goBack();
    const second = (await rowNames(page).nth(1).textContent())!;
    await rowNames(page).nth(1).click();
    // 取得中は前の商品（first）を見せない
    await expect(main(page).locator(".loading")).toBeVisible();
    await expect(main(page).locator("h1")).toHaveCount(0);
    await expect(main(page).locator("h1")).toHaveText(second);

    await main(page).getByRole("link", { name: "Edit" }).click();
    await page.locator("#edit-stock").fill("7");
    await saveButton(page).dblclick();
    await expect(saveButton(page)).toHaveText("Saving…");
    await expect(saveButton(page)).toBeDisabled();
    await expect(main(page).locator("h1")).toHaveText(second);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^PUT \/api\/products\/\d+ .*"stock":7/);

    expect(errors).toEqual([]);
  });

  test("ビュー遷移: ページの切り替えと並べ替えは遷移の中で行が動き、フォームへの入力は遷移を始めず直後のクリックも届く", async ({ page }) => {
    const errors = collectErrors(page);
    const writes = trackWrites(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __vt: number };
      w.__vt = 0;
      const original = Document.prototype.startViewTransition;
      if (original) Document.prototype.startViewTransition = function (this: Document, arg: never) {
        w.__vt++;
        return original.call(this, arg);
      };
    });
    const started = () => page.evaluate(() => (window as unknown as { __vt: number }).__vt);
    const tea = await api<ListResponse>("/api/products?q=tea");
    expect(tea.items.length).toBeGreaterThan(1);

    await page.goto(`${BASE}/en/products?q=tea`);
    await expect(rowNames(page)).toHaveText(tea.items.map((p) => p.name));
    // 行は自動で命名される（naming="auto"）
    const names = await page.locator("main tbody tr").evaluateAll((trs) => trs.map((tr) => getComputedStyle(tr).viewTransitionName));
    expect(names.every((n) => /^wcs-row-\d+$/.test(n))).toBe(true);

    // 同じ行要素に印を付けて逆順にソート: 行は作り直されず、印ごと動く（$listKeys）
    await page.locator("main tbody tr").evaluateAll((trs) => trs.forEach((tr) => { (tr as HTMLElement).dataset.mark = tr.querySelector("a")!.textContent!; }));
    const beforeSort = await started();
    await header(page, 0).locator("a").click();
    await expect(rowNames(page)).toHaveText(tea.items.map((p) => p.name).reverse());
    const marks = await page.locator("main tbody tr").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.mark ?? "NEW"));
    expect(marks).toEqual(tea.items.map((p) => p.name).reverse());
    expect(await started()).toBeGreaterThan(beforeSort);

    // ルートの切り替えも遷移の中で
    const beforeRoute = await started();
    await rowNames(page).first().click();
    await expect(main(page).locator("h1")).toHaveText(tea.items.at(-1)!.name);
    expect(await started()).toBeGreaterThan(beforeRoute);

    // 入力（値だけの更新）は遷移を始めない。打鍵の直後のクリックがページに届く
    await main(page).getByRole("link", { name: "Edit" }).click();
    await expect(page.locator("#edit-name")).toHaveValue(tea.items.at(-1)!.name);
    const beforeTyping = await started();
    await page.locator("#edit-stock").click();
    await page.keyboard.press("End");
    await page.keyboard.type("5", { delay: 30 });
    expect(await started()).toBe(beforeTyping);
    const box = (await saveButton(page).boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => writes.length).toBe(1);
    await expect(main(page).locator("h1")).toHaveText(tea.items.at(-1)!.name);

    expect(errors).toEqual([]);
  });

  test("Not found: 未知のパスと整数でない id はレイアウトの中の Not found、API が 404 の商品は詳細の中の案内（両言語）", async ({ page }) => {
    const errors = collectErrors(page);
    for (const [path, heading, title] of [
      ["/en/nope", "Page not found", "Not found"],
      ["/en/products/abc", "Page not found", "Not found"],
      ["/ja/products/1/edit/extra", "ページが見つかりません", "見つかりません"],
    ]) {
      await page.goto(`${BASE}${path}`);
      await expect(main(page).locator("h1")).toHaveText(heading);
      await expect(page).toHaveTitle(title);
      // レイアウト（ヘッダーとサイドナビ）の中に出る
      await expect(page.locator(".app-header .store")).not.toBeEmpty();
      await expect(navLinks(page)).toHaveCount(3);
    }
    await page.goto(`${BASE}/en/nope`);
    await expect(main(page).locator("h1")).toHaveText("Page not found");
    await expect(page.locator(".side-nav a[aria-current]")).toHaveCount(0);
    await page.goto(`${BASE}/ja/products/1/edit/extra`);
    await main(page).getByRole("link").click();
    await expect.poll(() => pathAndQuery(page)).toBe("/ja/");

    await page.goto(`${BASE}/en/products/999`);
    await expect(main(page)).toContainText("This product does not exist (it may have been deleted).");
    await expect(main(page).locator("h1")).toHaveCount(0);
    await page.goto(`${BASE}/ja/products/999`);
    await expect(main(page)).toContainText("この商品はありません");

    // デモが意図して起こす 404 応答を Chromium がネットワークのログとして出すものだけを除く
    expect(errors.filter((e) => !/Failed to load resource: the server responded with a status of 404/.test(e))).toEqual([]);
  });
});
