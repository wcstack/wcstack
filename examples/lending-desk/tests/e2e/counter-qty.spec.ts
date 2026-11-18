import { expect, test } from "./fixtures.ts";

test.describe("the counter screen (/counter.html)", () => {
  test("today's pickups and returns for one centre, updated live", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    await page.goto("/counter.html?center=2");
    await expect(page.getByTestId("counter-title")).toHaveText("北地区センター　受付");
    const pickups = page.getByTestId("pickups").locator("li");
    const returns = page.getByTestId("returns").locator("li");
    await expect(pickups).toHaveCount(2);
    await expect(returns).toHaveCount(2);
    await expect(pickups.first()).toContainText("08:00");
    await expect(page.locator("footer")).toContainText("ライブ");
    // a request for today is approved: it appears without a reload
    const bench = await api.itemId(2, "ベンチ");
    const r = await api.reserve("G06", { lines: [{ itemId: bench, from: today, to: today, quantity: 2 }], purpose: "清掃", pickupAt: `${today}T15:00` });
    expect(await api.decide(r.id, "approved")).toBe(200);
    await expect(pickups).toHaveCount(3);
    await expect(pickups.last()).toContainText("15:00");
    await expect(pickups.last()).toContainText("ベンチ × 2");
    await expect(returns).toHaveCount(3);
    expectQuietConsole();
  });

  test("without ?center= it says what to add", async ({ page, api, expectQuietConsole }) => {
    void api;
    await page.goto("/counter.html");
    await expect(page.getByRole("alert")).toContainText("?center=");
    expectQuietConsole();
  });
});

test.describe("the stepper on its own, in a page without wcstack", () => {
  test("buttons, keys, typed digits clamped on blur, aria, the change event", async ({ page, expectQuietConsole }) => {
    await page.goto("/qty-test.html");
    expect(await page.evaluate(() => customElements.get("wcs-state"))).toBeUndefined();
    const qty = page.locator("midori-qty");
    const field = qty.getByRole("spinbutton", { name: "テスト数量" });
    await expect(field).toHaveValue("2");
    await qty.getByRole("button", { name: "テスト数量を増やす" }).click();
    await expect(page.locator("#out")).toHaveText("3");
    await field.press("ArrowUp");
    await field.press("ArrowUp");
    await expect(field).toHaveValue("5");
    await expect(qty.getByRole("button", { name: "テスト数量を増やす" })).toBeDisabled();
    await field.press("Home");
    await expect(field).toHaveValue("1");
    await expect(qty.getByRole("button", { name: "テスト数量を減らす" })).toBeDisabled();
    await field.fill("42");
    await field.blur();
    await expect(field).toHaveValue("5");
    await expect(field).toHaveAttribute("aria-valuenow", "5");
    await expect(field).toHaveAttribute("aria-valuemin", "1");
    await expect(field).toHaveAttribute("aria-valuemax", "5");
    await expect(page.locator("#count")).toHaveText("5");
    // set by a program: no change event
    await page.getByRole("button", { name: "プログラムから 4 にする" }).click();
    await expect(field).toHaveValue("4");
    await page.getByRole("button", { name: "max を 3 にする" }).click();
    await expect(field).toHaveValue("3");
    await expect(page.locator("#count")).toHaveText("5");
    expectQuietConsole();
  });
});
