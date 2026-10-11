import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// state 単体: `$watch` によるヘッドレスな購読のデモ（カート）。
//  - 行の watch `"items.*.qty"(cur, prev, index)` が数量の変化ごとにログを 1 行書く
//  - どこにもバインドしていない getter `freeShipping` を watch して（watch で eager になる）、
//    送料無料の閾値（20,000）をまたいだときだけバナーを書き換える
//  - `$listKeys: { items: "id" }` があるので、配列を丸ごと差し替える Restock でも、実際に
//    変わった行だけが（スカラの prev 付きで）発火し、行の DOM は作り直されない
//
// この spec が固定するもの: 行・小計の表示、行 watch のログの文言（prev → cur）・並び
// （新しい順）・上限 8 件、変化の無い操作ではログが増えないこと、閾値をまたぐ方向ごとの
// バナーと class.below、Restock の差分発火と行の DOM の同一性。
//
// 期待値はページのコードの写しではなく、テスト側のカートのモデルから計算する。

type Item = { name: string; price: number; qty: number };

// ページの初期データ（入力）。
const initialItems = (): Item[] => [
  { name: "Mechanical keyboard", price: 12000, qty: 1 },
  { name: "USB-C cable", price: 1200, qty: 2 },
  { name: "Desk mat", price: 3800, qty: 1 },
];
const THRESHOLD = 20000;
const UNLOCKED = "🎉 Free shipping unlocked";
const LOST = "Free shipping lost — back under the threshold";

// <html lang="en"> なので locale フィルタは en の桁区切り
const fmt = (n: number) => n.toLocaleString("en");
const subtotal = (items: Item[]) => items.reduce((a, i) => a + i.price * i.qty, 0);

async function readRows(page: Page) {
  return page.$$eval("tbody tr", (trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent!.replace(/\s+/g, " ").trim())));
}

function expectedRows(items: Item[]) {
  // 数量のセルは「− qty +」のボタン込みのテキストになる
  return items.map((i) => [i.name, fmt(i.price), `− ${i.qty} +`, fmt(i.price * i.qty)]);
}

async function expectCart(page: Page, items: Item[]) {
  await expect.poll(() => readRows(page)).toEqual(expectedRows(items));
  // 小計のラベルはページの toLocaleString()（ブラウザの既定ロケール）で、Playwright の既定は en-US
  await expect(page.locator("p", { hasText: "Subtotal:" })).toContainText(`Subtotal: ¥${fmt(subtotal(items))}`);
}

const logLines = (page: Page) => page.locator(".log li");
const banner = (page: Page) => page.locator("p.banner");

function rowButton(page: Page, index: number, label: "+" | "−") {
  return page.locator("tbody tr").nth(index).getByRole("button", { name: label, exact: true });
}

/** 数量を 1 つ動かし、モデルとログの期待値を更新する（0 未満にはならない）。 */
async function step(page: Page, items: Item[], log: string[], index: number, delta: 1 | -1) {
  await rowButton(page, index, delta > 0 ? "+" : "−").click();
  const item = items[index];
  const next = item.qty + delta;
  if (next < 0) return; // − at 0 は何も書かない
  log.unshift(`${item.name}: ${item.qty} → ${next}`);
  item.qty = next;
}

test.describe("packages/state/examples/watch", () => {
  test("初期表示: 行・小計が描かれ、バナーは出ず、ログは空の案内を出す", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/watch/");

    const items = initialItems();
    await expectCart(page, items);
    expect(subtotal(items)).toBeLessThan(THRESHOLD);
    // freeShipping は接続時に評価される（eager）が、それだけでは watch は発火しない
    await expect(banner(page)).toHaveCount(0);
    await expect(logLines(page)).toHaveCount(0);
    await expect(page.locator(".log .empty")).toHaveText("change a quantity — the row watch writes here");

    expect(errors).toEqual([]);
  });

  test("数量を動かすたびに行の watch が (prev → cur) を新しい順にログへ書き、変化しない操作では書かない", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/watch/");
    const items = initialItems();
    const log: string[] = [];
    await expectCart(page, items);

    await step(page, items, log, 1, +1); // USB-C cable 2 → 3
    await expectCart(page, items);
    await expect(logLines(page)).toHaveText(log);
    await expect(page.locator(".log .empty")).toHaveCount(0);

    await step(page, items, log, 2, -1); // Desk mat 1 → 0
    await expect(logLines(page)).toHaveText(log);
    await expectCart(page, items);

    // 0 の行の − は何も書かない（行の watch も発火しない）
    await rowButton(page, 2, "−").click();
    await rowButton(page, 2, "−").click();
    await expectCart(page, items);
    await expect(logLines(page)).toHaveText(log);

    // 別の行（添字 0）も同じ watch の別の添字として発火する
    await step(page, items, log, 0, +1); // keyboard 1 → 2
    await step(page, items, log, 0, -1); // keyboard 2 → 1
    await expect(logLines(page)).toHaveText(log);
    await expectCart(page, items);

    expect(errors).toEqual([]);
  });

  test("ログは最新 8 件だけを新しい順に保つ", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/watch/");
    const items = initialItems();
    const log: string[] = [];
    await expectCart(page, items);

    for (let i = 0; i < 11; i++) {
      await step(page, items, log, 2, +1); // Desk mat 1 → 12
      await expect(logLines(page).first()).toHaveText(log[0]);
    }
    await expect(logLines(page)).toHaveText(log.slice(0, 8));
    await expect(logLines(page).first()).toHaveText("Desk mat: 11 → 12");
    await expect(logLines(page).last()).toHaveText("Desk mat: 4 → 5");
    await expectCart(page, items);

    expect(errors).toEqual([]);
  });

  test("どこにもバインドしていない freeShipping の watch が、閾値をまたぐ方向ごとにバナーを書き換える", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/watch/");
    const items = initialItems();
    const log: string[] = [];
    await expectCart(page, items);

    // 18,200 → 19,400: 閾値の下のまま。freeShipping は false のままなのでバナーは出ない
    await step(page, items, log, 1, +1);
    await expectCart(page, items);
    expect(subtotal(items)).toBeLessThan(THRESHOLD);
    await expect(banner(page)).toHaveCount(0);

    // 19,400 → 20,600: 閾値をまたいで上へ
    await step(page, items, log, 1, +1);
    await expectCart(page, items);
    expect(subtotal(items)).toBeGreaterThanOrEqual(THRESHOLD);
    await expect(banner(page)).toHaveText(UNLOCKED);
    await expect(banner(page)).not.toHaveClass(/\bbelow\b/);
    await expect(logLines(page)).toHaveText(log);

    // 上にいるまま動かしても文言は変わらない（cur === prev で早期 return）
    await step(page, items, log, 0, +1); // 32,600
    await expect(logLines(page)).toHaveText(log);
    await expect(banner(page)).toHaveText(UNLOCKED);

    // 下へ戻る: 32,600 → 20,600 → 19,400
    await step(page, items, log, 0, -1);
    await expect(banner(page)).toHaveText(UNLOCKED);
    await step(page, items, log, 1, -1);
    await expectCart(page, items);
    expect(subtotal(items)).toBeLessThan(THRESHOLD);
    await expect(banner(page)).toHaveText(LOST);
    await expect(banner(page)).toHaveClass(/\bbelow\b/);

    // ふたたび上へ
    await step(page, items, log, 2, +1); // 23,200
    await expect(banner(page)).toHaveText(UNLOCKED);
    await expect(banner(page)).not.toHaveClass(/\bbelow\b/);
    await expect(logLines(page)).toHaveText(log.slice(0, 8));

    expect(errors).toEqual([]);
  });

  test("Restock は配列を丸ごと差し替えるが、$listKeys により変わった行だけが発火し、行の DOM は残る", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/watch/");
    const items = initialItems();
    const log: string[] = [];
    await expectCart(page, items);

    // 行の要素に印を付けて、差し替えの後も同じ要素かを確かめる
    await page.$$eval("tbody tr", (trs) => trs.forEach((tr, i) => { (tr as any).__mark = i; }));
    const marks = () => page.$$eval("tbody tr", (trs) => trs.map((tr) => (tr as any).__mark));

    // 他の行を先に動かしておく（Restock はそれを保つ）
    await step(page, items, log, 1, +1); // cable 2 → 3
    await expect(logLines(page)).toHaveText(log);

    const restock = page.getByRole("button", { name: "Restock keyboard" });
    await restock.click();
    // keyboard だけが 1 → 2。prev はスカラで取れる
    log.unshift(`${items[0].name}: ${items[0].qty} → 2`);
    items[0].qty = 2;
    await expect(logLines(page)).toHaveText(log);
    await expectCart(page, items);
    await expect(banner(page)).toHaveText(UNLOCKED); // 24,000 + 3,600 + 3,800 = 31,400
    expect(await marks()).toEqual([0, 1, 2]);

    // もう一度押しても何も変わらない — キー照合でフィールドの書き込みが 1 つも起きない。
    // 続けて別の行を動かし、ログに増えたのがその 1 行だけであることで「Restock は何も
    // 発火しなかった」を確かめる（Restock のバッチは次のクリックより前に drain される）。
    await restock.click();
    await step(page, items, log, 2, +1); // desk 1 → 2
    await expect(logLines(page)).toHaveText(log);
    await expectCart(page, items);
    expect(await marks()).toEqual([0, 1, 2]);

    // keyboard を 2 から動かしてから押すと、その差分（5 → 2）だけが発火する
    for (let i = 0; i < 3; i++) await step(page, items, log, 0, +1); // 2 → 5
    await expect(logLines(page)).toHaveText(log);
    await restock.click();
    log.unshift(`${items[0].name}: 5 → 2`);
    items[0].qty = 2;
    await expect(logLines(page)).toHaveText(log);
    await expectCart(page, items);
    expect(await marks()).toEqual([0, 1, 2]);

    expect(errors).toEqual([]);
  });
});
