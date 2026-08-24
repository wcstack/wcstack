import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// @wcstack/view-transition の実ブラウザ契約（docs/view-transition-design.md）。
//
// このパッケージの機構は丸ごと document.startViewTransition の上に乗っており、
// happy-dom はそれを実装しない。パッケージ内の単体テストは全て手書きのフェイクを
// 相手にしているので、「本物の View Transition と噛み合うか」を見るのはここだけ。
//
// fixture は startViewTransition を読み込み前にラップして呼び出し回数を数える。
// 「遷移が始まらないこと」という否定側の主張は、この計数でしか固定できない。
declare global {
  interface Window {
    __vt: { started: number; supported: boolean };
  }
}

const started = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.__vt.started);

test.describe("e2e/fixtures/view-transition-list", () => {
  test("リスト更新は本物の View Transition の中で適用され、行は一意に命名される", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/view-transition-list.html");
    await expect(page.locator("#list li")).toHaveCount(3);

    expect(await page.evaluate(() => window.__vt.supported)).toBe(true);

    // naming="auto": 行ごとに一意な view-transition-name。重複するとブラウザは
    // 遷移そのものを abort するので、ここが崩れると何もアニメーションしない。
    const names = await page
      .locator("#list li")
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.getPropertyValue("view-transition-name")));
    expect(names).toHaveLength(3);
    expect(names.every((n) => /^wcs-row-\d+$/.test(n))).toBe(true);
    expect(new Set(names).size).toBe(3);
    const classes = await page
      .locator("#list li")
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.getPropertyValue("view-transition-class")));
    expect(new Set(classes)).toEqual(new Set(["wcs-row"]));

    // 追加: 遷移が 1 つ開始され、DOM 変更はちょうど 1 回適用される
    const before = await started(page);
    await page.locator("#add").click();
    await expect(page.locator("#list li")).toHaveCount(4);
    expect(await started(page)).toBe(before + 1);
    await expect(page.locator("#list li").last()).toHaveText("added-4");

    // 削除: 退場もフレームワークの同期削除のまま遷移に乗る
    await page.locator("#remove").click();
    await expect(page.locator("#list li")).toHaveCount(3);
    await expect(page.locator("#list li").first()).toHaveText("two");

    // 並べ替え: 名前は content に付いて回るので、行の再利用と一致する
    await page.locator("#reverse").click();
    await expect(page.locator("#list li").first()).toHaveText("added-4");
    const reordered = await page
      .locator("#list li")
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.getPropertyValue("view-transition-name")));
    expect(new Set(reordered).size).toBe(reordered.length);

    expect(errors).toEqual([]);
  });

  test("配線の無いパスへの書き込みは遷移を開始しない", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/view-transition-list.html");
    await expect(page.locator("#list li")).toHaveCount(3);

    // headlessTicks はどの binding からも参照されていない。書き込みは enqueue され
    // drain も走るが、適用すべき binding が 0 本なので arbiter へは渡らない。
    // 渡してしまうと mode="latest" の既定でページ全体をスナップショットした上、
    // 実行中の遷移まで巻き添えでスキップする（docs §7.2）。
    const before = await started(page);
    await page.locator("#headless").click();
    await page.locator("#headless").click();
    await page.waitForTimeout(300);
    expect(await started(page)).toBe(before);

    // 直後に本物の更新をしても、遷移はきちんと 1 回始まる
    await page.locator("#add").click();
    await expect(page.locator("#list li")).toHaveCount(4);
    expect(await started(page)).toBe(before + 1);

    expect(errors).toEqual([]);
  });
});

test.describe("e2e/fixtures/view-transition-route", () => {
  test("ルート差し替えは 1 つの遷移として走り、DOM はちょうど 1 回変わる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/view-transition-route.html");
    await expect(page.locator("#view")).toHaveText("home");

    const before = await started(page);
    await page.getByText("about", { exact: true }).click();
    await expect(page.locator("#view")).toHaveText("about");
    // hide + show は 1 変更として渡されるので、遷移は 1 つだけ
    expect(await started(page)).toBe(before + 1);
    // 旧ルートが残っていない = 変更が二重適用も部分適用もされていない
    await expect(page.locator("#view")).toHaveCount(1);

    await page.getByText("home", { exact: true }).click();
    await expect(page.locator("#view")).toHaveText("home");
    expect(await started(page)).toBe(before + 2);

    expect(errors).toEqual([]);
  });
});
