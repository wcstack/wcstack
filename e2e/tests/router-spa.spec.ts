import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/router-spa — router + state + fetch の SPA 商品カタログ。
// デモの主題は「URL もただのリアクティブな状態」: <wcs-router> の wc-bindable
// 出力（typedParams / searchParams / routeName / path）が state へ流れ、state の
// navigateUrl / replaceUrl への代入が router の遷移になる。この spec は、その橋が
// 実ブラウザで両方向に効くこと — 一覧・カテゴリ絞り込み（クエリが状態で、
// replace なので履歴を増やさない）・行クリックでの詳細遷移・ディープリンク・
// 戻る/進む・ルーターが刻印する About / 404 ページ・API の 404 — を固定する。
//
// serve.mjs（リポジトリルートを配る共有サーバー）には載せられない。ページは
// ディープリンクのために <base href="/"> でアプリのルートを固定しており
// （router の basename が ""）、`/examples/router-spa/` の下では先頭の
// パスがルートに一致せず fallback に落ちる。/api/products とディープリンク用の
// SPA fallback もデモ自身の server.js が持つ。そこで router-i18n と同じく、
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist の書き換え）で
// ワーカーごとに別ポートで立てる。
const PORT = Number(process.env.ROUTER_SPA_PORT || 4300) + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  description: string;
};

let server: ChildProcess;
// 期待値はページのコードではなく API の応答から組み立てる
let catalog: Product[];

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/router-spa/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
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
  catalog = await (await fetch(`${BASE}/api/products`)).json();
  expect(catalog.length).toBeGreaterThan(0);
});

// 子プロセスが終わるまで待つ: 同じワーカーで次に立てるサーバーが同じポートを使う。
test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill();
  await exited;
});

const yen = (price: number) => "¥" + price.toLocaleString("ja-JP");
const byId = (id: number) => catalog.find((p) => p.id === id)!;
const inCategory = (category: string) => catalog.filter((p) => p.category === category);

const listSection = (page: Page) => page.locator('section[aria-label="Product list"]');
const detailSection = (page: Page) => page.locator('section[aria-label="Product detail"]');
const rows = (page: Page) => page.locator(".product-list .product-item");
const pathChip = (page: Page) => page.locator(".path-chip code");
const navLink = (page: Page, href: string) => page.locator(`.top-nav a[href="${href}"]`);
const categoryButton = (page: Page, name: string) =>
  page.locator(".cat-filter .cat-btn").filter({ hasText: new RegExp(`^${name}$`) });

/** 一覧が指定の商品だけを、この順で、整形済みで描いていること */
async function expectList(page: Page, products: Product[]): Promise<void> {
  await expect(rows(page)).toHaveCount(products.length);
  await expect(rows(page).locator(".product-name")).toHaveText(products.map((p) => p.name));
  await expect(rows(page).locator(".cat-badge")).toHaveText(products.map((p) => p.category));
  await expect(rows(page).locator(".price")).toHaveText(products.map((p) => yen(p.price)));
  await expect(listSection(page).locator("h2")).toHaveText(`Products (${products.length})`);
}

/** 詳細ページがその商品だけを描いていること */
async function expectDetail(page: Page, product: Product): Promise<void> {
  const article = detailSection(page).locator("article.product-detail");
  await expect(article.locator("h2")).toHaveText(product.name);
  await expect(article.locator(".cat-badge")).toHaveText(product.category);
  await expect(article.locator(".price")).toHaveText(yen(product.price));
  await expect(article.locator(".description")).toHaveText(product.description);
  await expect(article.locator(".stock b")).toHaveText(String(product.stock));
  await expect(detailSection(page).locator(".spinner")).toHaveCount(0);
  await expect(listSection(page)).toHaveCount(0);
}

function expectUrl(page: Page, pathAndQuery: string): void {
  const url = new URL(page.url());
  expect(url.pathname + url.search).toBe(pathAndQuery);
}

test.describe("examples/router-spa", () => {
  test("一覧: /api/products の全件を描き、価格は ja-JP で整形され、ナビの Products が active になる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${BASE}/`);

    await expectList(page, catalog);
    await expect(listSection(page).locator(".spinner")).toHaveCount(0);
    await expect(detailSection(page)).toHaveCount(0);
    await expect(page).toHaveTitle("Products — wcstack router-spa");
    // router → state の橋: path がそのまま state に入り、ナビ外のチップに出る
    await expect(pathChip(page)).toHaveText("/");

    // <wcs-link> は <a> を描き、現在地のリンクに active と aria-current を付ける
    await expect(navLink(page, "/")).toHaveClass(/\bactive\b/);
    await expect(navLink(page, "/")).toHaveAttribute("aria-current", "page");
    await expect(navLink(page, "/about")).not.toHaveClass(/\bactive\b/);

    // クエリが無い = 絞り込み無し: All だけが選択状態
    await expect(categoryButton(page, "All")).toHaveClass(/\bselected\b/);
    await expect(page.locator(".cat-filter .cat-btn.selected")).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test("カテゴリ絞り込み: クエリ（?category=）が状態で、replaceUrl なので履歴を増やさない", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${BASE}/`);
    await expectList(page, catalog);
    const historyLength = await page.evaluate(() => history.length);

    await categoryButton(page, "audio").click();
    await expect.poll(() => new URL(page.url()).search).toBe("?category=audio");
    expectUrl(page, "/?category=audio");
    await expectList(page, inCategory("audio"));
    await expect(categoryButton(page, "audio")).toHaveClass(/\bselected\b/);
    await expect(categoryButton(page, "All")).not.toHaveClass(/\bselected\b/);
    // active の判定はパス名だけ: クエリが付いても Products は active のまま
    await expect(navLink(page, "/")).toHaveClass(/\bactive\b/);

    await categoryButton(page, "displays").click();
    await expect.poll(() => new URL(page.url()).search).toBe("?category=displays");
    await expectList(page, inCategory("displays"));
    await expect(page.locator(".cat-filter .cat-btn.selected")).toHaveText(["displays"]);

    // 選択中のカテゴリをもう一度押すと絞り込みが外れる（"?" はクエリだけを消す）
    await categoryButton(page, "displays").click();
    await expect.poll(() => new URL(page.url()).search).toBe("");
    expectUrl(page, "/");
    await expectList(page, catalog);
    await expect(categoryButton(page, "All")).toHaveClass(/\bselected\b/);

    await categoryButton(page, "peripherals").click();
    await expectList(page, inCategory("peripherals"));
    await categoryButton(page, "All").click();
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expectList(page, catalog);

    // 5 回の絞り込みはどれも履歴を置き換えただけ
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    expect(errors).toEqual([]);
  });

  test("行のクリックで詳細へ遷移し（navigateUrl）、戻るボタンで一覧へ。同じ商品の再訪は取り直さない", async ({ page }) => {
    const errors = collectErrors(page);
    const detailRequests: string[] = [];
    page.on("request", (req) => {
      if (/\/api\/products\/\d+$/.test(new URL(req.url()).pathname)) detailRequests.push(new URL(req.url()).pathname);
    });
    await page.goto(`${BASE}/`);
    await expectList(page, catalog);

    const target = catalog[2];
    await rows(page).filter({ hasText: target.name }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/products/${target.id}`);
    await expectDetail(page, target);
    await expect(pathChip(page)).toHaveText(`/products/${target.id}`);
    await expect(page).toHaveTitle("Product detail — wcstack router-spa");
    // 詳細ページはどのナビリンクにも一致しない
    await expect(page.locator(".top-nav a.active")).toHaveCount(0);
    // navigateUrl は遷移が終わると自分で null に戻る
    expect(await page.evaluate(() => (document.querySelector("wcs-router") as unknown as { navigateUrl: unknown }).navigateUrl)).toBeNull();

    await detailSection(page).getByRole("button", { name: /Back to products/ }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expectList(page, catalog);
    await expect(pathChip(page)).toHaveText("/");

    // 同じ目標をもう一度代入しても遷移する（null に戻っているので同値ガードに掛からない）。
    // 一覧にいる間 url は undefined（書かない）なので、<wcs-fetch> は前の url のまま —
    // 同じ商品の再訪はキャッシュした値をそのまま出し、取り直さない
    await rows(page).filter({ hasText: target.name }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/products/${target.id}`);
    await expectDetail(page, target);
    expect(detailRequests).toEqual([`/api/products/${target.id}`]);

    expect(errors).toEqual([]);
  });

  test("絞り込みは詳細ページを行き来しても保たれる（categorySuffix）", async ({ page }) => {
    const errors = collectErrors(page);
    // クエリ付きのディープリンクでも絞り込みが復元される
    await page.goto(`${BASE}/?category=audio`);
    const audio = inCategory("audio");
    await expectList(page, audio);
    await expect(categoryButton(page, "audio")).toHaveClass(/\bselected\b/);

    const target = audio[audio.length - 1];
    await rows(page).filter({ hasText: target.name }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/products/${target.id}`);
    expectUrl(page, `/products/${target.id}?category=audio`);
    await expectDetail(page, target);

    await detailSection(page).getByRole("button", { name: /Back to products/ }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    expectUrl(page, "/?category=audio");
    await expectList(page, audio);
    await expect(categoryButton(page, "audio")).toHaveClass(/\bselected\b/);

    expect(errors).toEqual([]);
  });

  test("ディープリンク: /products/:id を直接開いても（再読み込みしても）詳細が描かれる", async ({ page }) => {
    const errors = collectErrors(page);
    const target = byId(3);
    await page.goto(`${BASE}/products/${target.id}`);
    await expectDetail(page, target);
    await expect(pathChip(page)).toHaveText(`/products/${target.id}`);
    await expect(page).toHaveTitle("Product detail — wcstack router-spa");

    await page.reload();
    await expectDetail(page, target);

    // そこからナビで一覧へ: 一覧はページ読み込み時に取得済み
    await navLink(page, "/").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expectList(page, catalog);

    // クエリだけのディープリンク
    await page.goto(`${BASE}/?category=displays`);
    await expectList(page, inCategory("displays"));
    await expect(page.locator(".cat-filter .cat-btn.selected")).toHaveText(["displays"]);

    expect(errors).toEqual([]);
  });

  test("ブラウザの戻る/進むで一覧・詳細・About を行き来し、state が URL に追従する", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${BASE}/`);
    await expectList(page, catalog);

    const first = catalog[0];
    await rows(page).filter({ hasText: first.name }).click();
    await expectDetail(page, first);
    await navLink(page, "/about").click();
    await expect(page.locator(".page h2")).toHaveText("About this demo");

    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/products/${first.id}`);
    await expect(pathChip(page)).toHaveText(`/products/${first.id}`);
    await expectDetail(page, first);
    await expect(page.locator(".page h2")).toHaveCount(0);

    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect(pathChip(page)).toHaveText("/");
    await expectList(page, catalog);
    await expect(detailSection(page)).toHaveCount(0);

    await page.goForward();
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/products/${first.id}`);
    await expectDetail(page, first);

    await page.goForward();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/about");
    await expect(page.locator(".page h2")).toHaveText("About this demo");
    await expect(pathChip(page)).toHaveText("/about");
    await expect(detailSection(page)).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("A → B の遷移中に、A のデータを B の URL で見せない（取得中はスピナー）", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${BASE}/`);
    await expectList(page, catalog);

    const [a, b] = [catalog[0], catalog[1]];
    await rows(page).filter({ hasText: a.name }).click();
    await expectDetail(page, a);
    await detailSection(page).getByRole("button", { name: /Back to products/ }).click();
    await expectList(page, catalog);

    // B に入ってから描き終わるまでの間に詳細欄に現れたものを、その時点の URL と一緒に記録する
    await page.evaluate(() => {
      const seen: { path: string; title: string | null; spinner: boolean }[] = [];
      (window as unknown as { __seen: typeof seen }).__seen = seen;
      new MutationObserver(() => {
        const section = document.querySelector('section[aria-label="Product detail"]');
        if (section === null) return;
        seen.push({
          path: location.pathname,
          title: section.querySelector("article.product-detail h2")?.textContent ?? null,
          spinner: section.querySelector(".spinner") !== null,
        });
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await rows(page).filter({ hasText: b.name }).click();
    await expectDetail(page, b);

    const seen = await page.evaluate(() => (window as unknown as { __seen: { path: string; title: string | null; spinner: boolean }[] }).__seen);
    const onB = seen.filter((s) => s.path === `/products/${b.id}`);
    expect(onB.length).toBeGreaterThan(0);
    // B の URL の下で詳細欄に出た見出しは B のものだけ（A は一度も出ない）
    expect(onB.map((s) => s.title).filter((t) => t !== null && t !== b.name)).toEqual([]);
    // 取得中はスピナーが出ていた（サーバーは 250ms 遅延して応答する）
    expect(onB.some((s) => s.spinner)).toBe(true);

    expect(errors).toEqual([]);
  });

  test("About: ルーターが <wcs-outlet> に刻印する静的ページと、ページごとの <title>", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(`${BASE}/`);
    await expectList(page, catalog);

    await navLink(page, "/about").click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/about");
    const about = page.locator("wcs-outlet .page");
    await expect(about.locator("h2")).toHaveText("About this demo");
    await expect(about).toContainText("stamped by the router");
    await expect(page).toHaveTitle("About — wcstack router-spa");
    await expect(pathChip(page)).toHaveText("/about");
    await expect(navLink(page, "/about")).toHaveClass(/\bactive\b/);
    await expect(navLink(page, "/about")).toHaveAttribute("aria-current", "page");
    await expect(navLink(page, "/")).not.toHaveClass(/\bactive\b/);
    // state 側のページ（if: isList / isDetail）はどちらも描かれない
    await expect(listSection(page)).toHaveCount(0);
    await expect(detailSection(page)).toHaveCount(0);

    // 戻るとルートの内容は outlet から外れ、タイトルも戻る
    await navLink(page, "/").click();
    await expectList(page, catalog);
    await expect(about).toHaveCount(0);
    await expect(page).toHaveTitle("Products — wcstack router-spa");

    expect(errors).toEqual([]);
  });

  test("404 その 1: 型制約（:productId(int)）に合わないパスと未知のパスは fallback ルートへ落ちる", async ({ page }) => {
    const errors = collectErrors(page);
    for (const path of ["/products/abc", "/nope"]) {
      await page.goto(`${BASE}${path}`);
      await expect(page.locator("wcs-outlet .page h2")).toHaveText("404 — Nothing routes here");
      await expect(page).toHaveTitle("Not found — wcstack router-spa");
      await expect(pathChip(page)).toHaveText(path);
      await expect(listSection(page)).toHaveCount(0);
      await expect(detailSection(page)).toHaveCount(0);
      await expect(page.locator(".top-nav a.active")).toHaveCount(0);
    }

    // fallback ルートの中の <wcs-link> も刻印された先で SPA 遷移になる
    await page.locator("wcs-outlet .page a", { hasText: "Back to the products" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expectList(page, catalog);
    await expect(page.locator("wcs-outlet .page")).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("404 その 2: ルートには一致するが API が 404 を返す商品は、詳細ページの中で not found を出す", async ({ page }) => {
    const errors = collectErrors(page);
    const missing = Math.max(...catalog.map((p) => p.id)) + 991;
    await page.goto(`${BASE}/products/${missing}`);

    await expect(detailSection(page).locator(".empty")).toHaveText(
      "Product not found — the route matched, but the API says 404.",
    );
    await expect(detailSection(page).locator("article")).toHaveCount(0);
    await expect(detailSection(page).locator(".spinner")).toHaveCount(0);
    await expect(page.locator("wcs-outlet .page")).toHaveCount(0);
    // 「別の何かがおかしい」の枝には入らない
    await expect(detailSection(page)).not.toContainText("Something went wrong.");

    // 実在する商品へ戻れば普通に描く
    await detailSection(page).getByRole("button", { name: /Back to products/ }).click();
    await expectList(page, catalog);

    // デモが意図して起こす 404 応答を Chromium がコンソールに出すもの（ネットワークの
    // ログで、ページのコードのエラーではない）だけを除く
    expect(errors.filter((e) => !/Failed to load resource: the server responded with a status of 404/.test(e))).toEqual([]);
  });

  test("取得の失敗: 一覧が取れなければ Failed to load the catalog.、詳細の 500 は Something went wrong.", async ({ page }) => {
    const errors = collectErrors(page);
    // 失敗はテストごとに page.route で注入する（デモのサーバーは失敗しない）
    await page.route(`${BASE}/api/products`, (route) => route.abort());
    await page.route(`${BASE}/api/products/2`, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }));

    await page.goto(`${BASE}/`);
    await expect(listSection(page).locator(".empty")).toHaveText("Failed to load the catalog.");
    await expect(listSection(page).locator(".spinner")).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);
    await expect(listSection(page).locator("h2")).toHaveText("Products (0)");

    await page.goto(`${BASE}/products/2`);
    await expect(detailSection(page).locator(".empty")).toHaveText("Something went wrong.");
    await expect(detailSection(page).locator("article")).toHaveCount(0);
    await expect(detailSection(page).locator(".spinner")).toHaveCount(0);
    await expect(detailSection(page)).not.toContainText("Product not found");

    // 注入した失敗を Chromium がネットワークのログとしてコンソールに出すもの
    // （中断した要求と 500 応答）だけを除く
    expect(errors.filter((e) => !/Failed to load resource: (net::ERR_FAILED|the server responded with a status of 500)/.test(e))).toEqual([]);
  });
});
