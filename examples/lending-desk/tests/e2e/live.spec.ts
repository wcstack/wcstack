import { addDaysIso, expect, otherBrowser, ready, signIn, test, type ConsoleEntry } from "./fixtures.ts";

test.describe("live updates, cancelling, deciding", () => {
  test("staff approve in another browser → the association's list changes without a reload, and the header counts it", async ({ page, api, browser, baseURL, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/reservations");
    const row7 = page.locator('li.res[data-id="7"]');
    await expect(row7.getByTestId("status")).toHaveText("申請中");
    await expect(page.getByTestId("unseen")).toBeHidden();
    // the association goes elsewhere; staff decide meanwhile
    await page.getByRole("link", { name: "備品をさがす" }).first().click();
    const staffLog: ConsoleEntry[] = [];
    const staff = await otherBrowser(browser, baseURL!, "S01", staffLog);
    await staff.page.goto("/admin");
    await ready(staff.page);
    const card = staff.page.locator('li.res[data-id="7"]');
    await card.getByTestId("approve").click();
    await expect(staff.page.getByTestId("admin-message")).toHaveText("申込 #7 を承認しました");
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("unseen")).toHaveText("1");
    // opening /reservations counts as seen
    await page.getByRole("link", { name: "申込", exact: true }).click();
    await expect(row7.getByTestId("status")).toHaveText("承認");
    await expect(page.getByTestId("unseen")).toBeHidden();
    // while on the list: a decision changes the row and is seen at once
    await staff.page.locator('li.res[data-id="2"]').getByTestId("reason").fill("在庫が足りません");
    await expect(page.locator('li.res[data-id="2"]')).toHaveCount(0); // G02's request is not in G01's list
    await staff.context.close();
    expect(staffLog.filter((l) => l.type === "error" || l.type === "warning" || l.type === "pageerror")).toEqual([]);
    expectQuietConsole();
  });

  test("a new request appears on /admin without a reload; a request that would exceed the stock is marked", async ({ page, api, expectQuietConsole }) => {
    const today = await api.today();
    await signIn(page, "S01", "/admin");
    await expect(page.locator("li.res")).toHaveCount(4);
    // #9 (screen ×1 on d+14..15) together with the approved #8 (×2 on d+15) exceeds the stock of 2
    const d15 = addDaysIso(today, 15);
    const marked = page.locator('li.res[data-id="9"]');
    await expect(marked.getByTestId("conflict")).toHaveText(`在庫を超えます: スクリーン 100型 ${Number(d15.slice(5, 7))}/${Number(d15.slice(8, 10))}`);
    await expect(marked).toHaveClass(/conflict/);
    await expect(page.locator('li.res[data-id="6"]').getByTestId("conflict")).toBeHidden();
    // a new request arrives live, last (oldest first)
    const chairs = await api.itemId(3, "パイプ椅子");
    const r = await api.reserve("G03", { lines: [{ itemId: chairs, from: addDaysIso(today, 9), to: addDaysIso(today, 9), quantity: 10 }], purpose: "研修", pickupAt: `${addDaysIso(today, 9)}T09:00` });
    const card = page.locator(`li.res[data-id="${r.id}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("パイプ椅子×10");
    const ids = await page.locator("li.res").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-id"))));
    expect(ids.at(-1)).toBe(r.id);
    expectQuietConsole();
  });

  test("却下 needs a reason; the association sees the reason on the request", async ({ page, api, browser, baseURL, expectQuietConsole }) => {
    void api;
    await signIn(page, "S01", "/admin");
    const card = page.locator('li.res[data-id="7"]');
    await card.getByTestId("deny").click();
    await expect(page.getByTestId("admin-message")).toHaveText("申込 #7: 却下の理由を入力してください");
    await card.getByTestId("reason").fill("同じ日に市の行事があります");
    await card.getByTestId("deny").click();
    await expect(page.getByTestId("admin-message")).toHaveText("申込 #7 を却下しました");
    const g = await otherBrowser(browser, baseURL!, "G01");
    await g.page.goto("/reservations/7");
    await ready(g.page);
    await expect(g.page.getByTestId("detail-status")).toHaveText("却下");
    await expect(g.page.getByTestId("reason")).toHaveText("却下の理由: 同じ日に市の行事があります");
    await expect(g.page.getByTestId("steps")).toContainText("却下");
    await g.context.close();
    expectQuietConsole();
  });

  test("cancelling a request in 申請中 (with a confirmation)", async ({ page, api, expectQuietConsole }) => {
    void api;
    await signIn(page, "G01", "/reservations");
    const row = page.locator('li.res[data-id="7"]');
    page.once("dialog", (d) => { expect(d.message()).toContain("#7"); void d.dismiss(); });
    await row.getByTestId("cancel").click();
    await expect(row.getByTestId("status")).toHaveText("申請中");
    page.once("dialog", (d) => void d.accept());
    await row.getByTestId("cancel").click();
    await expect(row.getByTestId("status")).toHaveText("取消");
    await expect(page.getByTestId("cancel-message")).toHaveText("申込 #7 を取り消しました");
    await expect(row.getByTestId("cancel")).toBeHidden();
    expectQuietConsole();
  });

  test("a 409 when staff decided first (the live update did not arrive)", async ({ page, api, expectQuietConsole }) => {
    // this page gets no live updates, so it still shows 申請中
    await page.route(/\/api\/events/, (route) => route.abort());
    await signIn(page, "G01", "/reservations");
    const row = page.locator('li.res[data-id="7"]');
    await expect(row.getByTestId("status")).toHaveText("申請中");
    expect(await api.decide(7, "approved")).toBe(200);
    page.once("dialog", (d) => void d.accept());
    await row.getByTestId("cancel").click();
    await expect(page.getByTestId("cancel-message")).toHaveText("職員がすでに決定したため取り消せませんでした");
    await expect(row.getByTestId("status")).toHaveText("承認"); // reloaded
    expectQuietConsole(/status of 409|ERR_FAILED|api\/events|EventSource|wcs-sse|io-error-unobserved/);
  });
});
