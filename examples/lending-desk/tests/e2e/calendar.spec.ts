import type { Page } from "@playwright/test";
import { addDaysIso, expect, signIn, test } from "./fixtures.ts";

const day = (page: Page, date: string) => page.locator(`button.day[data-date="${date}"]`);

test.describe("the calendar", () => {
  test("free counts per day, today marked, days before today cannot be chosen", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    const projector = await api.itemId(1, "プロジェクター"); // stock 2; seeds: approved d+10..11 ×1, pending d+10 ×1
    await signIn(page, "G01", `/items/${projector}`);
    await expect(page.getByTestId("item-name")).toHaveText("プロジェクター");
    await expect(day(page, today)).toHaveClass(/today/);
    if (today.slice(8) !== "01") await expect(day(page, addDaysIso(today, -1))).toBeDisabled();
    await expect(day(page, today)).toBeEnabled();
    // d+10 may be next month
    if (addDaysIso(today, 10).slice(0, 7) !== today.slice(0, 7)) await page.getByTestId("next-month").click();
    await expect(day(page, addDaysIso(today, 10))).toContainText("空き 0");
    await expect(day(page, addDaysIso(today, 10))).toHaveClass(/none/);
    await expect(day(page, addDaysIso(today, 11))).toContainText("空き 1");
    expectQuietConsole();
  });

  test("a period by two clicks, then by the two date fields; 数量 up to what is free on every day", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    const projector = await api.itemId(1, "プロジェクター");
    await signIn(page, "G01", `/items/${projector}`);
    await expect(page.getByTestId("pick-problem")).toContainText("カレンダーで期間を選んでください");
    const a = addDaysIso(today, 1);
    const b = addDaysIso(today, 2);
    if (b.slice(0, 7) !== today.slice(0, 7)) test.skip(true, "today is the last days of a month — covered by the month's-end test");
    await day(page, b).click();
    await expect(page.getByTestId("pick-problem")).toHaveText("終了日を選んでください");
    await day(page, a).click(); // before the first: swapped
    await expect(page.getByTestId("pick-from")).toHaveValue(a);
    await expect(page.getByTestId("pick-to")).toHaveValue(b);
    await expect(page.getByTestId("pick-summary")).toContainText("・2日　空き 2");
    await expect(day(page, a)).toHaveClass(/edge/);
    // the fields: a period over the booked day (d+10 has none free)
    await page.getByTestId("pick-from").fill(addDaysIso(today, 9));
    await page.getByTestId("pick-to").fill(addDaysIso(today, 11));
    await expect(page.getByTestId("pick-problem")).toHaveText("この期間は空きがありません");
    await expect(page.getByTestId("add-to-cart")).toBeDisabled();
    await page.getByTestId("pick-from").fill(addDaysIso(today, 11));
    await expect(page.getByTestId("pick-summary")).toContainText("・1日　空き 1");
    const qty = page.getByTestId("pick-qty");
    await expect(qty.getByRole("button", { name: "数量を増やす" })).toBeDisabled(); // max is what is free: 1
    await expect(qty.getByRole("spinbutton")).toHaveValue("1");
    await expect(qty.getByRole("spinbutton")).toHaveAttribute("aria-valuemax", "1");
    await page.getByTestId("add-to-cart").click();
    await expect(page.getByTestId("added")).toHaveText("かごに入れました");
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    expectQuietConsole();
  });

  for (const tz of ["Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"]) {
    test(`a period across a month's end and a year's end; at 23:59 and 00:01 in Japan (browser in ${tz})`, async ({ browser, baseURL, api }) => {
      const context = await browser.newContext({ baseURL, locale: "ja-JP", timezoneId: tz });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
      // 2026-12-28 23:59 in Japan
      await api.reset("2026-12-28");
      await page.clock.setFixedTime(new Date("2026-12-28T23:59:00+09:00"));
      const tent = await api.itemId(2, "イベントテント 3×3m");
      await signIn(page, "G05", `/items/${tent}`);
      await expect(page.getByTestId("cal-title")).toHaveText("2026年12月");
      await expect(page.locator("button.day.today")).toHaveAttribute("data-date", "2026-12-28");
      await expect(day(page, "2026-12-27")).toBeDisabled();
      await day(page, "2026-12-30").click();
      await page.getByTestId("next-month").click();
      await expect(page.getByTestId("cal-title")).toHaveText("2027年1月");
      await day(page, "2027-01-02").click();
      await expect(page.getByTestId("pick-summary")).toContainText("12/30(水)〜1/2(土)・4日");
      await page.getByTestId("add-to-cart").click();
      await page.goto("/cart");
      await expect(page.locator("td.period")).toHaveText(["12/30(水)〜1/2(土)・4日"]);
      await page.getByTestId("purpose").fill("年末年始の夜警");
      await page.getByTestId("pickup").fill("2026-12-30T09:00");
      await page.getByTestId("submit").click();
      await expect(page).toHaveURL(/\/reservations\/\d+$/);
      const sent = (await api.log()).find((l) => l.method === "POST" && l.path === "/api/reservations");
      expect(sent?.body).toMatchObject({ lines: [{ itemId: tent, from: "2026-12-30", to: "2027-01-02", quantity: 1 }], pickupAt: "2026-12-30T09:00" });
      // two minutes later it is 00:01 on the 29th in Japan: the 28th can no longer be chosen
      await api.reset("2026-12-29");
      await page.clock.setFixedTime(new Date("2026-12-29T00:01:00+09:00"));
      await page.goto(`/items/${tent}`);
      await expect(page.locator("button.day.today")).toHaveAttribute("data-date", "2026-12-29");
      await expect(day(page, "2026-12-28")).toBeDisabled();
      expect(errors).toEqual([]);
      await context.close();
    });
  }
});
