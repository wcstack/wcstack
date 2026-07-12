import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// state + storage + broadcast: 同一コンテキストの2ページ(=2タブ)で、localStorage
// 経由の永続リスト同期と BroadcastChannel 経由の live シグナルを検証する。
test.describe("examples/state-cross-tab-todo", () => {
  test("追加した todo が別タブへ同期され、live シグナルが届く", async ({ context }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const errorsA = collectErrors(pageA);
    const errorsB = collectErrors(pageB);
    await pageA.goto("/examples/state-cross-tab-todo/");
    await pageB.goto("/examples/state-cross-tab-todo/");

    // 両タブとも初期状態(空リスト)まで描画される
    await expect(pageA.locator(".empty")).toBeVisible();
    await expect(pageB.locator(".empty")).toBeVisible();

    // タブ A で todo を追加
    await pageA.locator(".add-form input").fill("buy milk");
    await pageA.locator(".add-form button").click();
    await expect(pageA.locator(".todo-item .text")).toHaveText("buy milk");
    await expect(pageA.locator(".footer b")).toHaveText("1");

    // タブ B: storage イベント同期でリストが更新され、broadcast でバナーが動く
    await expect(pageB.locator(".todo-item .text")).toHaveText("buy milk");
    await expect(pageB.locator(".live")).toContainText("added");
    await expect(pageB.locator(".live")).toContainText("buy milk");
    await expect(pageB.locator(".live .count span")).toHaveText("1");

    expect(errorsA).toEqual([]);
    expect(errorsB).toEqual([]);
  });

  // load-before-bind clobber の回帰テスト (docs/state-binding-init-races.md §1)。
  // storage の load はバインディング確立前に発火しうるため、state 初期値が
  // null/[] だと write-through 保存がリロードのたびに永続値を上書き消去する。
  // デモは「undefined 初期値 + $connectedCallback pull」の idiom で回避している。
  test("リロードしても todo が消えない(load-before-bind clobber 回帰)", async ({ context }) => {
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.goto("/examples/state-cross-tab-todo/");

    await page.locator(".add-form input").fill("survive reload");
    await page.locator(".add-form button").click();
    await expect(page.locator(".todo-item .text")).toHaveText("survive reload");

    await page.reload();

    // 永続値がそのまま復元される(以前は初期値 [] で上書きされ全消失していた)
    await expect(page.locator(".todo-item .text")).toHaveText("survive reload");
    const stored = await page.evaluate(() => localStorage.getItem("wcs-cross-tab-todos"));
    expect(stored).toContain("survive reload");

    expect(errors).toEqual([]);
  });
});
