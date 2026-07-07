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
});
