import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// ガードを待つ間に追い越されたナビゲーション（docs/seam-apps.md、homeroom の取り込み）。
//
// ガードはルートを置く前の非同期の一歩（データを読み込むガード）。その間に押した別のリンクは
// 2 つ目のナビゲーションを始める。追い越された 1 つ目は、ガードが決着しても何も置かず、
// どこへもリダイレクトしない。4.11 までは、2 つ目の URL の下に両方のルートが出た。

const FIXTURE = "/e2e/fixtures/router-overtaken-guard.html";

/** `first` を押し、そのガードが決着する前（50 ms 後）に `second` を押す */
async function overtake(page: Page, first: string, second: string): Promise<void> {
  await page.getByRole("link", { name: first, exact: true }).click();
  await page.waitForTimeout(50);
  await page.getByRole("link", { name: second, exact: true }).click();
  // 1 つ目のガード（400 ms）が決着した後まで待つ
  await page.waitForTimeout(800);
}

test.describe("router — ガードを待つ間に追い越されたナビゲーション", () => {
  test("遅いガードを待つ間に別のリンクを押すと、画面は後のリンクのルートだけになる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator(".view")).toHaveText("home");

    await overtake(page, "slow", "fast");

    await expect(page).toHaveURL(/\/e2e\/fixtures\/fast$/);
    await expect(page.locator(".view")).toHaveCount(1);
    await expect(page.locator(".view")).toHaveText("fast");
    expect(errors).toEqual([]);
  });

  test("Navigation API の無い経路（pushState / popstate）でも、後のリンクのルートだけになる", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    await context.addInitScript(() => {
      Object.defineProperty(window, "navigation", { value: undefined, configurable: true });
    });
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator(".view")).toHaveText("home");

    await overtake(page, "slow", "fast");

    await expect(page).toHaveURL(/\/e2e\/fixtures\/fast$/);
    await expect(page.locator(".view")).toHaveCount(1);
    await expect(page.locator(".view")).toHaveText("fast");
    expect(errors).toEqual([]);
    await context.close();
  });

  test("拒否するガードを待つ間に別のリンクを押すと、追い越されたガードはリダイレクトしない", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator(".view")).toHaveText("home");

    await overtake(page, "denied", "fast");

    await expect(page).toHaveURL(/\/e2e\/fixtures\/fast$/);
    await expect(page.locator(".view")).toHaveCount(1);
    await expect(page.locator(".view")).toHaveText("fast");
    expect(errors).toEqual([]);
  });

  test("追い越されなければ、遅いガードのルートも拒否のリダイレクトも今までどおり", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(FIXTURE);
    await expect(page.locator(".view")).toHaveText("home");

    await page.getByRole("link", { name: "slow", exact: true }).click();
    await expect(page).toHaveURL(/\/e2e\/fixtures\/slow$/);
    await expect(page.locator(".view")).toHaveText("slow");

    await page.getByRole("link", { name: "denied", exact: true }).click();
    await expect(page).toHaveURL(/\/e2e\/fixtures\/login$/);
    await expect(page.locator(".view")).toHaveCount(1);
    await expect(page.locator(".view")).toHaveText("login");
    expect(errors).toEqual([]);
  });
});
