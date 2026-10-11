import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// state: for: によるリスト描画と、ワイルドカードの算出プロパティ (users.*.ageCategory) を
// 行ごとに評価して表示する。デモに操作 UI は無いので、描画の全行を固定したうえで、
// 公開 API (IStateElement.createState) から書き込み、行 getter が行単位で計算し直されて
// 行の追加・削除にも追従することを実ブラウザで検証する。
const PAGE = "/packages/state/examples/simple-list/";

// デモのデータ。分類はデモの説明どおり: 25 未満 Young / 35 未満 Adult / それ以上 Senior
const USERS: [string, number][] = [
  ["Alice", 30], ["Bob", 25], ["Charlie", 35], ["David", 28], ["Eve", 22],
  ["Frank", 40], ["Grace", 27], ["Heidi", 33], ["Ivan", 29], ["Judy", 31],
];
function category(age: number): string {
  if (age < 25) return "Young";
  if (age < 35) return "Adult";
  return "Senior";
}
const line = ([name, age]: [string, number]) => `${name} (${age} years old, ${category(age)})`;

const rows = (page: Page) => page.locator(".example-container > p:not(.example-title)");

test.describe("packages/state/examples/simple-list", () => {
  test("10 人ぶんの行が並び、年齢区分が境界値 (25 / 35) を含めて正しい", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    await expect(rows(page)).toHaveText(USERS.map(line));
    // 境界: 25 歳は Adult、35 歳は Senior
    await expect(rows(page).nth(1)).toHaveText("Bob (25 years old, Adult)");
    await expect(rows(page).nth(2)).toHaveText("Charlie (35 years old, Senior)");
    await expect(page.locator("body")).not.toContainText("{{");

    expect(errors).toEqual([]);
  });

  test("年齢を書き換えるとその行の区分だけが計算し直され、行の追加・削除にも追従する", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);
    await expect(rows(page)).toHaveCount(USERS.length);

    // Eve 22 → 25 (Young → Adult)、Alice 30 → 35 (Adult → Senior)。ほかの行はそのまま
    await page.evaluate(() => {
      (document.querySelector("wcs-state") as any).createState("writable", (state: any) => {
        state["users.4.age"] = 25;
        state["users.0.age"] = 35;
      });
    });
    const expected = USERS.map(([n, a]) => [n, a] as [string, number]);
    expected[4][1] = 25;
    expected[0][1] = 35;
    await expect(rows(page)).toHaveText(expected.map(line));

    // 新しい配列の代入で末尾に追加 (18 歳 → Young)
    await page.evaluate(() => {
      (document.querySelector("wcs-state") as any).createState("writable", (state: any) => {
        state.users = [...state.users, { name: "Zoe", age: 18 }];
      });
    });
    expected.push(["Zoe", 18]);
    await expect(rows(page)).toHaveText(expected.map(line));

    // 先頭を削除: 残った行は区分ごと 1 つずつ詰まる
    await page.evaluate(() => {
      (document.querySelector("wcs-state") as any).createState("writable", (state: any) => {
        state.users = state.users.slice(1);
      });
    });
    expected.shift();
    await expect(rows(page)).toHaveText(expected.map(line));

    expect(errors).toEqual([]);
  });
});
