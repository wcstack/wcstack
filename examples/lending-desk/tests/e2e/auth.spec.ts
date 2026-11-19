import type { Page } from "@playwright/test";
import type { WcsSse } from "@wcstack/sse";
import { expect, otherBrowser, ready, signIn, test } from "./fixtures.ts";

test.describe("signing in", () => {
  test("an association signs in; the header shows its name, the cart and ログアウト", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("who")).toHaveText("みどり町一丁目町内会");
    await expect(page.getByTestId("cart-count")).toHaveText("0");
    await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
    await expect(page.getByRole("link", { name: "管理" })).toHaveCount(0);
    await expect(page.locator("h1")).toHaveText("備品をさがす");
    expectQuietConsole();
  });

  test("a wrong あいことば is refused", async ({ page, api, expectQuietConsole }) => {
    void api;
    await page.goto("/login");
    await ready(page);
    await page.getByLabel("団体番号").fill("G01");
    await page.getByLabel("あいことば").fill("nope");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page.getByRole("alert")).toHaveText("団体番号かあいことばが違います");
    await expect(page).toHaveURL(/\/login/);
    expectQuietConsole(/status of 401/);
  });

  test("a deep link while signed out comes back to that page after signing in", async ({ page, api, expectQuietConsole }) => {
    void api;
    await page.goto("/cart");
    await expect(page).toHaveURL(/\/login\?next=%2Fcart/);
    await ready(page);
    await page.getByLabel("団体番号").fill("G02");
    await page.getByLabel("あいことば").fill("midori-g02");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.locator("h1")).toHaveText("申込かご");
    // with a query too
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/?q=%E3%83%86%E3%83%B3%E3%83%88&center=2");
    await expect(page).toHaveURL(/next=/);
    await ready(page);
    await page.getByLabel("団体番号").fill("G02");
    await page.getByLabel("あいことば").fill("midori-g02");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page).toHaveURL(/\/\?q=%E3%83%86%E3%83%B3%E3%83%88&center=2$/);
    await expect(page.getByTestId("q")).toHaveValue("テント");
    expectQuietConsole();
  });

  test("a reload stays signed in", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G03", "/reservations");
    await page.reload();
    await ready(page);
    await expect(page).toHaveURL(/\/reservations$/);
    await expect(page.getByTestId("who")).toHaveText("みどり市子ども会連合");
    expectQuietConsole();
  });

  test("/admin: staff get in, an association is sent to /", async ({ page, api, browser, baseURL, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/admin");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("h1")).toHaveText("備品をさがす");
    const staff = await otherBrowser(browser, baseURL!, "S01");
    await staff.page.goto("/admin");
    await ready(staff.page);
    await expect(staff.page.locator("h1")).toHaveText("管理 — 申請中の申込");
    await expect(staff.page.getByTestId("who")).toHaveText("職員");
    await expect(staff.page.getByRole("link", { name: "管理" })).toBeVisible();
    await staff.context.close();
    expectQuietConsole();
  });

  test("two tabs: one signs out, the other leaves the member pages", async ({ page, context, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/cart");
    const tab2 = await context.newPage();
    await tab2.goto("/reservations");
    await ready(tab2);
    await expect(tab2.locator("h1")).toHaveText("申込");
    const streamOpen = (p: Page) => p.evaluate(() => document.querySelector<WcsSse>("wcs-sse")?.connected);
    await expect.poll(() => streamOpen(tab2)).toBe(true);
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(tab2).toHaveURL(/\/login\?next=%2Freservations/);
    await expect(tab2.getByTestId("who")).toHaveCount(0);
    // signed out, the stream's url is cleared, and that closes it — in this tab and in the other (the page calls no close())
    await expect.poll(() => streamOpen(page)).toBe(false);
    await expect.poll(() => streamOpen(tab2)).toBe(false);
    expectQuietConsole();
  });
});
