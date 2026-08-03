import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// state: ワイルドカード getter だけで組み立てたカレンダー表。行(週)/列(曜日)の
// 二重ワイルドカードと $1 / $2 のインデックス依存、月移動での再計算を実ブラウザで検証する。
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ページと同じ規則で期待値を独立に組み立てる(実装の写しではなく Date から導出)。
function expectedGrid(year: number, month: number): string[][] {
  const offset = new Date(year, month - 1, 1).getDay();
  const lastDate = new Date(year, month, 0).getDate();
  const weekCount = Math.ceil((offset + lastDate) / 7);
  return Array.from({ length: weekCount }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = w * 7 + d - offset + 1;
      return date >= 1 && date <= lastDate ? String(date) : "";
    }),
  );
}

async function readGrid(page: import("@playwright/test").Page): Promise<string[][]> {
  return page.$$eval("tbody tr", (rows) =>
    rows.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent!.trim())),
  );
}

// 表示中の月をラベルから読み、そこから期待グリッドを作る(today 依存を避ける)。
async function currentYearMonth(page: import("@playwright/test").Page): Promise<[number, number]> {
  const label = (await page.locator(".month-label").textContent())!.trim();
  const [name, year] = label.split(" ");
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return [Number(year), months.indexOf(name) + 1];
}

test.describe("packages/state/examples/calendar", () => {
  test("初期表示は今月のグリッドで、曜日ヘッダと日付配置が正しい", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/calendar/");

    await expect(page.locator("thead th")).toHaveText(DAY_NAMES);

    const [year, month] = await currentYearMonth(page);
    const now = new Date();
    expect([year, month]).toEqual([now.getFullYear(), now.getMonth() + 1]);
    expect(await readGrid(page)).toEqual(expectedGrid(year, month));

    // today は当月に必ず1セルだけ
    await expect(page.locator("td.today")).toHaveCount(1);
    await expect(page.locator("td.today")).toHaveText(String(now.getDate()));

    expect(errors).toEqual([]);
  });

  test("class / attr バインドがセル単位で正しく付く", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/calendar/");

    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow.locator("td")).toHaveCount(7);
    // attr.title: .dayOfWeek — 列インデックス($2)だけで決まる
    expect(await firstRow.locator("td").evaluateAll(
      (tds) => tds.map((td) => td.getAttribute("title")))).toEqual(DAY_NAMES);
    // class.weekend も同じく列だけで決まる(日曜と土曜)
    expect(await firstRow.locator("td").evaluateAll(
      (tds) => tds.map((td) => td.classList.contains("weekend"))))
      .toEqual([true, false, false, false, false, false, true]);

    // class.blank は先頭の空白セルにだけ付き、日付セルには付かない
    const [year, month] = await currentYearMonth(page);
    const offset = new Date(year, month - 1, 1).getDay();
    expect(await firstRow.locator("td").evaluateAll(
      (tds) => tds.map((td) => td.classList.contains("blank"))))
      .toEqual(Array.from({ length: 7 }, (_, d) => d < offset));

    expect(errors).toEqual([]);
  });

  test("Prev / Next で月を動かすとグリッド全体が追随する(週数変化・年跨ぎを含む)", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/calendar/");
    await expect(page.locator("thead th")).toHaveCount(7);

    const [startYear, startMonth] = await currentYearMonth(page);

    // 24 か月ぶん戻す — 週数 4/5/6 の月、うるう年の 2 月、年跨ぎを必ず通る
    for (let i = 1; i <= 24; i++) {
      await page.locator("button", { hasText: "Prev" }).click();
      const at = new Date(startYear, startMonth - 1 - i, 1);
      const [y, m] = [at.getFullYear(), at.getMonth() + 1];
      const grid = expectedGrid(y, m);
      await expect(page.locator("tbody tr")).toHaveCount(grid.length);
      expect(await currentYearMonth(page)).toEqual([y, m]);
      expect(await readGrid(page), `${y}-${m}`).toEqual(grid);
      // 当月以外に today が残らない
      await expect(page.locator("td.today")).toHaveCount(0);
    }

    // 同じ回数だけ進めて元の月に戻る
    for (let i = 23; i >= 0; i--) {
      await page.locator("button", { hasText: "Next" }).click();
      const at = new Date(startYear, startMonth - 1 - i, 1);
      expect(await currentYearMonth(page)).toEqual([at.getFullYear(), at.getMonth() + 1]);
    }
    expect(await readGrid(page)).toEqual(expectedGrid(startYear, startMonth));
    await expect(page.locator("td.today")).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test("Today ボタンで今月に戻る", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/calendar/");

    for (let i = 0; i < 5; i++) await page.locator("button", { hasText: "Next" }).click();
    await expect(page.locator("td.today")).toHaveCount(0);

    await page.locator("button", { hasText: "Today" }).click();
    const now = new Date();
    expect(await currentYearMonth(page)).toEqual([now.getFullYear(), now.getMonth() + 1]);
    await expect(page.locator("td.today")).toHaveText(String(now.getDate()));
    expect(await readGrid(page)).toEqual(expectedGrid(now.getFullYear(), now.getMonth() + 1));

    expect(errors).toEqual([]);
  });
});
