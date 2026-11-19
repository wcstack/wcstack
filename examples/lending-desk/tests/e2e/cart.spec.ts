import type { Page } from "@playwright/test";
import { addDaysIso, expect, ready, signIn, test, type Api } from "./fixtures.ts";
import type { CartLine } from "../../src/lib/cart.ts";

async function addFromItemPage(page: Page, itemId: number, from: string, to: string): Promise<void> {
  await page.goto(`/items/${itemId}`);
  await ready(page);
  await expect(page.getByTestId("item-name")).not.toBeEmpty();
  await page.getByTestId("pick-from").fill(from);
  await page.getByTestId("pick-to").fill(to);
  await expect(page.getByTestId("add-to-cart")).toBeEnabled();
  await page.getByTestId("add-to-cart").click();
  await expect(page.getByTestId("added")).not.toBeEmpty();
}

async function lines(api: Api, today: string): Promise<CartLine[]> {
  const mk = async (center: number, name: string, deposit: number, max: number, quantity: number): Promise<CartLine> => {
    const itemId = await api.itemId(center, name);
    const from = addDaysIso(today, 3);
    const to = addDaysIso(today, 4);
    return { key: `${itemId}:${from}:${to}`, itemId, name, centerId: center, deposit, max, from, to, quantity };
  };
  return [await mk(1, "折りたたみ長机", 0, 20, 2), await mk(1, "ワイヤレスマイク", 3000, 4, 1), await mk(1, "プロジェクター", 10000, 2, 2)];
}

test.describe("the cart", () => {
  test("adding, merging the same item and period, the stepper, deleting, the totals, a reload", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    const tent = await api.itemId(1, "イベントテント 3×3m"); // stock 4, deposit 3000
    const mic = await api.itemId(1, "ワイヤレスマイク"); // stock 4, deposit 3000
    await signIn(page, "G04");
    await addFromItemPage(page, tent, addDaysIso(today, 3), addDaysIso(today, 4));
    await addFromItemPage(page, tent, addDaysIso(today, 3), addDaysIso(today, 4));
    await expect(page.getByTestId("added")).toHaveText("かごの同じ行に追加しました");
    await addFromItemPage(page, mic, addDaysIso(today, 5), addDaysIso(today, 5));
    await expect(page.getByTestId("cart-count")).toHaveText("2");
    await page.getByRole("link", { name: "申込かご" }).click();
    await expect(page.locator("h1")).toHaveText("申込かご");
    const rows = page.locator("tr.line");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator("td.period")).toContainText("・2日");
    const totals = page.getByTestId("totals");
    await expect(totals).toContainText("2行");
    await expect(totals).toContainText("3点");
    await expect(totals).toContainText("9,000円");
    // the stepper: buttons
    const qty = rows.nth(0).locator("midori-qty");
    const field = qty.getByRole("spinbutton");
    await expect(field).toHaveValue("2");
    await qty.getByRole("button", { name: "数量を増やす" }).click();
    await expect(field).toHaveValue("3");
    await expect(totals).toContainText("4点");
    await expect(totals).toContainText("12,000円");
    // keys
    await field.focus();
    await field.press("ArrowUp");
    await expect(field).toHaveValue("4");
    await expect(qty.getByRole("button", { name: "数量を増やす" })).toBeDisabled(); // max: what was free
    await field.press("ArrowDown");
    await field.press("ArrowDown");
    await expect(field).toHaveValue("2");
    // typed, clamped on blur
    await field.fill("９");
    await field.blur();
    await expect(field).toHaveValue("4");
    await expect(totals).toContainText("5点");
    await field.fill("0");
    await field.press("Tab");
    await expect(field).toHaveValue("1");
    await expect(totals).toContainText("2点");
    await expect(field).toHaveAttribute("aria-valuenow", "1");
    // deleting
    await rows.nth(0).getByRole("button", { name: "削除" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText("ワイヤレスマイク");
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    // a reload
    await page.reload();
    await ready(page);
    await expect(rows).toHaveCount(1);
    await expect(totals).toContainText("1行");
    await expect(totals).toContainText("3,000円");
    expectQuietConsole();
  });

  test("the same cart in two tabs: a change in one shows in the other", async ({ page, context, api, expectQuietConsole }) => {
    const today = await api.today();
    await signIn(page, "G04");
    await page.evaluate((l) => localStorage.setItem("midori.cart", JSON.stringify(l)), await lines(api, today));
    await page.goto("/cart");
    await ready(page);
    const tab2 = await context.newPage();
    await tab2.goto("/cart");
    await ready(tab2);
    await expect(tab2.locator("tr.line")).toHaveCount(3);
    await page.locator("tr.line").nth(0).locator("midori-qty").getByRole("button", { name: "数量を増やす" }).click();
    await expect(tab2.locator("tr.line").nth(0).getByRole("spinbutton")).toHaveValue("3");
    await expect(tab2.getByTestId("totals")).toContainText("6点");
    await tab2.locator("tr.line").nth(1).getByRole("button", { name: "削除" }).click();
    await expect(page.locator("tr.line")).toHaveCount(2);
    await expect(page.getByTestId("cart-count")).toHaveText("2");
    expectQuietConsole();
  });

  test("a 422 on the third line is shown at that line, and stays with it after the first line is deleted", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    const cart = await lines(api, today);
    await signIn(page, "G04");
    await page.evaluate((l) => localStorage.setItem("midori.cart", JSON.stringify(l)), cart);
    // meanwhile someone else books one of the two projectors for those days
    await api.reserve("G06", { lines: [{ itemId: cart[2]!.itemId, from: cart[2]!.from, to: cart[2]!.to, quantity: 1 }], purpose: "上映会", pickupAt: `${cart[2]!.from}T09:00` });
    await page.goto("/cart");
    await ready(page);
    await page.getByTestId("purpose").fill("地区の防災訓練");
    await page.getByTestId("pickup").fill(`${cart[0]!.from}T09:00`);
    await page.getByTestId("submit").click();
    const rowErrors = page.getByTestId("line-error");
    await expect(rowErrors).toHaveText(["", "", "数量: この期間の空きは1です"]);
    await expect(page.locator("tr.line").nth(2)).toHaveClass(/has-error/);
    await expect(page.getByTestId("submit-message")).toHaveText("入力内容を確かめてください");
    await page.locator("tr.line").nth(0).getByRole("button", { name: "削除" }).click();
    await expect(rowErrors).toHaveText(["", "数量: この期間の空きは1です"]);
    await expect(page.locator("tr.line").nth(1)).toContainText("プロジェクター");
    // fix it and send again: success empties the cart and goes to the new request
    await page.locator("tr.line").nth(1).locator("midori-qty").getByRole("button", { name: "数量を減らす" }).click();
    await page.getByTestId("submit").click();
    await expect(page).toHaveURL(/\/reservations\/\d+$/);
    await expect(page.getByTestId("detail-status")).toHaveText("申請中");
    await expect(page.getByTestId("cart-count")).toHaveText("0");
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("midori.cart"))) ?? "null")).toEqual([]);
    expectQuietConsole(/status of 422/);
  });
});
