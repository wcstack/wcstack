import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// Phase 4 of docs/ssr-router-design.md — router SSR in a real browser.
// serve.mjs renders /ssr-router/* per request through @wcstack/server's
// renderToString (local dists), the page then boots the client bundles and the
// router adopts the server-rendered DOM. The suite asserts the whole promise:
// content is in the initial HTML, the client resumes on the same nodes without
// double-rendering, adopted bindings stay live, and navigation works after.

const BASE = "/ssr-router/";

test.describe("ssr-router — サーバー描画", () => {
  test("初期ルートの内容・展開済み for・スナップショットが生 HTML に載る", async ({ request }) => {
    const res = await request.get(BASE);
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    // 初期ルートが描画済み（構造テンプレートは route 内で展開されている）
    expect(html).toContain(">list<");
    expect(html).toContain("Keyboard");
    expect(html).toContain("Monitor");
    // ハイドレーション面: outlet マーカー・ルート境界・Link の目印・スナップショット
    expect(html).toContain("data-wcs-ssr");
    expect(html).toContain("@@wcs-route-start:/");
    expect(html).toContain("data-wcs-ssr-link");
    expect(html).toContain("<wcs-ssr");
    // orchestrated スナップショットに構造テンプレートが載っている
    expect(html).toMatch(/<wcs-ssr[\s\S]*<template id=/);
  });

  test("深い URL（typed param）もサーバーで描ける", async ({ request }) => {
    const html = await (await request.get(`${BASE}products/2`)).text();
    expect(html).toContain(">detail<");
    expect(html).toContain('<output id="product-id"');
    expect(html).toMatch(/<output id="product-id"[^>]*>2</);
  });
});

test.describe("ssr-router — クライアント採用", () => {
  test("採用が成立し、二重描画なし・マーカー撤去・エラーゼロ", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(BASE);
    await expect(page.locator("#view")).toHaveText("list");
    // 採用完了 = outlet の目印が撤去される
    await expect(page.locator("wcs-outlet[data-wcs-ssr]")).toHaveCount(0);
    // 二重描画なし
    await expect(page.locator("#view")).toHaveCount(1);
    await expect(page.locator("#product-list li")).toHaveCount(3);
    // Link 採用: anchor は 1 リンクにつき 1 つ・目印は撤去済み
    await expect(page.locator("nav a")).toHaveCount(3);
    await expect(page.locator("a[data-wcs-ssr-link]")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("採用ノード上のバインドが生きている（same-match クエリ遷移）", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(BASE);
    await expect(page.locator("#q")).toHaveText("");
    await page.getByRole("link", { name: "query" }).click();
    // 内容は据え置き（same-match）のまま、採用済み DOM のバインドが更新される
    await expect(page.locator("#q")).toHaveText("hello");
    await expect(page.locator("#view")).toHaveText("list");
    expect(page.url()).toContain("q=hello");
    expect(errors).toEqual([]);
  });

  test("採用後の SPA ナビゲーションと深い URL の直リロード", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(BASE);
    await page.getByRole("link", { name: "product 2" }).click();
    await expect(page.locator("#view")).toHaveText("detail");
    await expect(page.locator("#product-id")).toHaveText("2");
    expect(page.url()).toContain("/ssr-router/products/2");
    // 深い URL のフルリロード — SSR が detail を直に描き、そのまま採用される
    await page.reload();
    await expect(page.locator("#view")).toHaveText("detail");
    await expect(page.locator("#product-id")).toHaveText("2");
    await expect(page.locator("wcs-outlet[data-wcs-ssr]")).toHaveCount(0);
    // 戻る遷移も従来どおり
    await page.getByRole("link", { name: "list" }).click();
    await expect(page.locator("#view")).toHaveText("list");
    await expect(page.locator("#product-list li")).toHaveCount(3);
    expect(errors).toEqual([]);
  });
});
