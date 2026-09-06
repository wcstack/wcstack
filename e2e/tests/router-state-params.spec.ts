import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// Phase 1 / 2 of docs/router-state-contract-design.md — the router × state path
// contract. The router's parsed observation surface (typedParams / searchParams /
// routeName) flows into state over the generic wc-bindable binding, and the
// write surfaces (navigateUrl / replaceUrl) flow back. State-side code changes:
// none — that zero is the design's own acceptance criterion (§6).

const FIXTURE = "/e2e/fixtures/router-state-params.html";

test.describe("router-state-params — 観測面が state へ流れる", () => {
  test("typedParams / routeName がバインド経由で流れ、regex なしで param が読める", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator("#view")).toHaveText("list");
    await expect(page.locator("#route-name")).toHaveText("list");
    await expect(page.locator("#product-id")).toHaveText("");

    // attach 済みバインドへの event-driven 更新（:productId(int) の型付き解析結果）
    await page.getByRole("link", { name: "product 5" }).click();
    await expect(page.locator("#view")).toHaveText("detail");
    await expect(page.locator("#route-name")).toHaveText("detail");
    await expect(page.locator("#product-id")).toHaveText("5");
    expect(errors).toEqual([]);
  });

  test("初期 URL のクエリが attach 時読み取り + 初回 commit で届く", async ({ page }) => {
    const errors = collectErrors(page);
    // バインド attach と router 初期化の順序がどちらでも、初回 commit の変化判定
    // （内部初期値 {} との比較）が初回イベントを保証する（design §3.4）
    await page.goto(`${FIXTURE}?page=9`);
    await expect(page.locator("#view")).toHaveText("list");
    await expect(page.locator("#page")).toHaveText("9");
    expect(errors).toEqual([]);
  });

  test("state からの書き込み（navigateUrl）で遷移し、params が更新される", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator("#view")).toHaveText("list");

    await page.locator("#go-detail").click();
    await expect(page.locator("#view")).toHaveText("detail");
    await expect(page.locator("#product-id")).toHaveText("7");
    expect(page.url()).toContain("/e2e/fixtures/products/7");
    expect(errors).toEqual([]);
  });
});

test.describe("router-state-params — クエリのみ遷移 (same-match)", () => {
  test("クエリのみリンクで searchParams だけが更新され、ルート内容は再スタンプされない", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator("#view")).toHaveText("list");
    await expect(page.locator("#page")).toHaveText("-");

    // same-match で DOM を触らないことの目印（再スタンプで消える）
    await page.evaluate(() => {
      document.querySelector("#view")!.setAttribute("data-marker", "kept");
    });

    await page.getByRole("link", { name: "page 2" }).click();
    await expect(page.locator("#page")).toHaveText("2");
    expect(page.url()).toContain("?page=2");
    // ルート内容はそのまま（guard / transition / 再スタンプをスキップ — §4.4）
    await expect(page.locator("#view")).toHaveAttribute("data-marker", "kept");
    // 他の観測面は不変
    await expect(page.locator("#route-name")).toHaveText("list");
    expect(errors).toEqual([]);
  });

  test("戻る操作（traverse）でも searchParams が追従する", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator("#page")).toHaveText("-");

    await page.getByRole("link", { name: "page 2" }).click();
    await expect(page.locator("#page")).toHaveText("2");

    await page.goBack();
    await expect(page.locator("#page")).toHaveText("-");
    expect(errors).toEqual([]);
  });

  test("replaceUrl はクエリ全体を置き換え、履歴を増やさない", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await page.getByRole("link", { name: "page 2" }).click();
    await expect(page.locator("#page")).toHaveText("2");

    // replaceUrl = "?q=hello" — ?page=2 のエントリを置き換える（暗黙マージしない）
    await page.locator("#set-query").click();
    await expect(page.locator("#q")).toHaveText("hello");
    await expect(page.locator("#page")).toHaveText("-");
    expect(page.url()).toContain("?q=hello");
    expect(page.url()).not.toContain("page=2");

    // replace なので back は ?page=2 ではなくその前（クエリ無し）へ戻る
    await page.goBack();
    await expect(page.locator("#q")).toHaveText("");
    await expect(page.locator("#page")).toHaveText("-");
    expect(page.url()).not.toContain("?");
    expect(errors).toEqual([]);
  });
});
