import { addDaysIso, API, expect, otherBrowser, ready, signIn, test } from "./fixtures.ts";

test.describe("when things go wrong", () => {
  test("/items/9999 and /items/abc show 見つかりません", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/items/9999");
    await expect(page.locator("h1")).toHaveText("見つかりません");
    await page.goto("/items/abc");
    await expect(page.locator("h1")).toHaveText("見つかりません");
    await page.goto("/no/such/page");
    await expect(page.locator("h1")).toHaveText("見つかりません");
    expectQuietConsole(/status of 404/);
  });

  test("reload on every route", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "S01");
    for (const [path, h1] of [["/", "備品をさがす"], ["/items/1", "イベントテント 3×3m"], ["/cart", "申込かご"], ["/reservations", "申込"],
      ["/reservations/2", "申込 #2"], ["/admin", "管理 — 申請中の申込"], ["/login", "備品をさがす"] /* signed in: sent on */] as const) {
      await page.goto(path);
      await ready(page);
      await page.reload();
      await ready(page);
      await expect(page.locator("h1").first(), path).toHaveText(h1);
    }
    expectQuietConsole();
  });

  test("Back and Forward through a search, an item and the cart", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    await page.getByTestId("q").fill("机");
    await expect(page).toHaveURL(/q=%E6%9C%BA/);
    await page.locator(".item a").first().click();
    await expect(page).toHaveURL(/\/items\/\d+$/);
    await expect(page.getByTestId("item-name")).toContainText("机");
    await page.getByRole("link", { name: "申込かご" }).click();
    await expect(page.locator("h1")).toHaveText("申込かご");
    await page.goBack();
    await expect(page.getByTestId("item-name")).toContainText("机");
    await page.goBack();
    await expect(page.getByTestId("q")).toHaveValue("机");
    await expect(page.locator(".item").first()).toContainText("机");
    await page.goForward();
    await expect(page.getByTestId("item-name")).toContainText("机");
    await page.goForward();
    await expect(page.locator("h1")).toHaveText("申込かご");
    expectQuietConsole();
  });

  test("the token is no longer accepted (401) while filling the cart: sign in again and come back, the cart kept", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    await signIn(page, "G01");
    const tent = await api.itemId(1, "イベントテント 3×3m");
    await page.goto(`/items/${tent}`);
    await ready(page);
    await page.getByTestId("pick-from").fill(addDaysIso(today, 3));
    await page.getByTestId("pick-to").fill(addDaysIso(today, 3));
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    await api.fail("/api/items", 401);
    await page.getByRole("link", { name: "備品をさがす" }).first().click();
    await expect(page).toHaveURL(/\/login\?next=%2F/);
    await expect(page.getByRole("alert")).toContainText("もう一度サインインしてください");
    await page.getByLabel("団体番号").fill("G01");
    await page.getByLabel("あいことば").fill("midori-g01");
    await page.getByRole("button", { name: "サインイン" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    expectQuietConsole(/status of 401/);
  });

  test("a 500 on 申し込む, and offline while sending: the cart stays, a message says so, sending again works", async ({ page, context, api, expectQuietConsole }) => {
    const today = await api.today();
    const tent = await api.itemId(1, "イベントテント 3×3m");
    await signIn(page, "G01");
    await page.evaluate((l) => localStorage.setItem("midori.cart", JSON.stringify(l)),
      [{ key: `${tent}:${addDaysIso(today, 3)}:${addDaysIso(today, 3)}`, itemId: tent, name: "イベントテント 3×3m", centerId: 1, deposit: 3000, max: 4, from: addDaysIso(today, 3), to: addDaysIso(today, 3), quantity: 1 }]);
    await page.goto("/cart");
    await ready(page);
    await page.getByTestId("purpose").fill("夏祭り");
    await page.getByTestId("pickup").fill(`${addDaysIso(today, 3)}T09:00`);
    await api.fail("/api/reservations", 500);
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("submit-message")).toHaveText("送信できませんでした（500）。もう一度お試しください。");
    await expect(page.locator("tr.line")).toHaveCount(1);
    await context.setOffline(true);
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("submit-message")).toHaveText("送信できませんでした。接続を確かめてもう一度お試しください。");
    await context.setOffline(false);
    await page.getByTestId("submit").click();
    await expect(page).toHaveURL(/\/reservations\/\d+$/);
    expectQuietConsole(/status of 500|ERR_INTERNET_DISCONNECTED|NetworkError|Failed to fetch|Load failed|network connection was lost|WebKit encountered an internal error|io-error-unobserved/);
  });

  test("a 500 on a decision: the request stays pending, a message says so", async ({ page, api, expectQuietConsole }) => {
    await signIn(page, "S01", "/admin");
    await api.fail("/api/reservations/7/decision", 500);
    const card = page.locator('li.res[data-id="7"]');
    await card.getByTestId("approve").click();
    await expect(page.getByTestId("admin-message")).toHaveText("決定を送れませんでした（500）。もう一度お試しください。");
    await expect(card).toBeVisible();
    await card.getByTestId("approve").click();
    await expect(card).toHaveCount(0);
    expectQuietConsole(/status of 500/);
  });

  test("the server slow (?delay=2000): the list says it is loading, then shows", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/?delay=2000");
    await expect(page.locator(".summary .loading")).toBeVisible();
    await expect(page.locator(".item")).toHaveCount(20, { timeout: 6000 });
    await expect(page.locator(".summary .loading")).toBeHidden();
    expectQuietConsole();
  });

  test("the live updates come back after the API restarts (the connection drops, then reconnects)", async ({ page, api, browser, baseURL, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/reservations");
    // dropping every stream is what a restart looks like to the browser
    await fetch(`${API}/api/_test/reset`, { method: "POST" });
    // the page resyncs on reconnect; a decision made after it arrives live
    await page.waitForTimeout(3000);
    const staff = await otherBrowser(browser, baseURL!, "S01");
    await staff.page.goto("/admin");
    await ready(staff.page);
    await staff.page.locator('li.res[data-id="7"]').getByTestId("approve").click();
    await expect(page.locator('li.res[data-id="7"]').getByTestId("status")).toHaveText("承認", { timeout: 10_000 });
    await staff.context.close();
    expectQuietConsole(/api\/events|ERR_INCOMPLETE_CHUNKED_ENCODING|interrupted|io-error-unobserved/);
  });
});
