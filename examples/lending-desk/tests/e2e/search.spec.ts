import { addDaysIso, expect, ready, signIn, test } from "./fixtures.ts";

const names = (page: import("@playwright/test").Page) => page.locator(".item .item-name").allInnerTexts();

test.describe("the search", () => {
  test("keyword: the URL follows, a reload shows the same search", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    await page.getByTestId("q").fill("テント");
    await expect(page).toHaveURL(/\?q=%E3%83%86%E3%83%B3%E3%83%88$/);
    await expect(page.getByTestId("summary")).toContainText("件");
    const list = await names(page);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((n) => n.includes("テント"))).toBe(true);
    await page.reload();
    await ready(page);
    await expect(page.getByTestId("q")).toHaveValue("テント");
    await expect.poll(() => names(page)).toEqual(list);
    expectQuietConsole();
  });

  test("category, centre, sort; Back returns to the previous search", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    await page.getByTestId("category").selectOption("映像・音響");
    await expect(page).toHaveURL(/category=%E6%98%A0%E5%83%8F/);
    await expect(page.locator(".item").first()).toContainText("映像・音響");
    await page.getByTestId("center").selectOption("2");
    await expect(page).toHaveURL(/center=2/);
    await expect(page.locator(".item").first()).toContainText("北地区センター");
    const metas = await page.locator(".item .item-meta").allInnerTexts();
    expect(metas.every((m) => m.includes("映像・音響") && m.includes("北地区センター"))).toBe(true);
    await page.getByTestId("sort").selectOption("deposit");
    await expect(page).toHaveURL(/sort=deposit/);
    await expect(async () => {
      const deposits = (await page.locator(".item .item-meta").allInnerTexts()).map((m) => Number(/保証金 ([\d,]+)円/.exec(m)?.[1]?.replace(/,/g, "")));
      expect(deposits).toEqual([...deposits].sort((a, b) => a - b));
      expect(deposits.at(-1)).toBeGreaterThan(deposits[0]!);
    }).toPass();
    await page.goBack();
    await expect(page).not.toHaveURL(/sort=deposit/);
    await expect(page.getByTestId("sort")).toHaveValue("name");
    await page.goBack();
    await expect(page).not.toHaveURL(/center=2/);
    await expect(page.getByTestId("center")).toHaveValue("");
    await page.goForward();
    await expect(page.getByTestId("center")).toHaveValue("2");
    expectQuietConsole();
  });

  test("a period: each item shows how many are free, the ones with none are marked", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    // book the only ポップコーン機 of centre 1 for two days
    const id = await api.itemId(1, "ポップコーン機");
    await api.reserve("G02", { lines: [{ itemId: id, from: addDaysIso(today, 5), to: addDaysIso(today, 6), quantity: 1 }], purpose: "祭り", pickupAt: `${addDaysIso(today, 5)}T09:00` });
    await signIn(page, "G01", `/?q=${encodeURIComponent("ポップコーン")}&center=1`);
    await expect(page.getByTestId("free")).toHaveText([""]);
    await page.getByTestId("from").fill(addDaysIso(today, 4));
    await page.getByTestId("to").fill(addDaysIso(today, 5));
    await expect(page).toHaveURL(new RegExp(`from=${addDaysIso(today, 4)}&to=${addDaysIso(today, 5)}`));
    await expect(page.getByTestId("free")).toHaveText(["空き 0 / 1"]);
    await expect(page.locator(".item.none")).toHaveCount(1);
    await expect(page.locator(".item-none")).toBeVisible();
    await page.getByTestId("from").fill(addDaysIso(today, 7));
    await page.getByTestId("to").fill(addDaysIso(today, 8));
    await expect(page.getByTestId("free")).toHaveText(["空き 1 / 1"]);
    await expect(page.locator(".item.none")).toHaveCount(0);
    expectQuietConsole();
  });

  test("20 per page with page numbers; the page is in the URL", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    await expect(page.locator(".item")).toHaveCount(20);
    const first = await names(page);
    const pager = page.getByTestId("pager");
    await pager.getByRole("link", { name: "2", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(pager.getByRole("link", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".item")).toHaveCount(20);
    expect(await names(page)).not.toEqual(first);
    await page.goBack();
    await expect(page).not.toHaveURL(/page=2/);
    await expect.poll(() => names(page)).toEqual(first);
    // a link someone sent
    await page.goto(`/?category=${encodeURIComponent("机・椅子")}&page=2`);
    await ready(page);
    await expect(page.getByTestId("category")).toHaveValue("机・椅子");
    await expect(pager.getByRole("link", { name: "2", exact: true })).toHaveAttribute("aria-current", "page");
    expectQuietConsole();
  });

  test("typing fast never leaves an older answer on the screen (a slow answer overtaken by a newer one)", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01");
    // the first search for 机 is made slow on the server (?delay=), the next one is not
    let slowed = false;
    await page.route(/\/api\/items\?/, async (route) => {
      const url = new URL(route.request().url());
      if (!slowed && url.searchParams.get("q") === "机") {
        slowed = true;
        url.searchParams.set("delay", "2500");
        await route.continue({ url: url.toString() });
      } else await route.continue();
    });
    const q = page.getByTestId("q");
    await q.fill("机");
    await expect.poll(() => slowed).toBe(true);
    await q.fill("椅子");
    await expect(page).toHaveURL(/q=%E6%A4%85%E5%AD%90/);
    await expect.poll(async () => (await names(page)).every((n) => n.includes("椅子")) && (await names(page)).length > 0).toBe(true);
    await page.waitForTimeout(3000); // the slow answer would have landed by now
    const after = await names(page);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((n) => n.includes("椅子"))).toBe(true);
    // an aborted request is logged by Firefox as a warning-free cancellation; nothing else may be said
    expectQuietConsole(/wcs\/fetch-request-superseded/);
  });
});
