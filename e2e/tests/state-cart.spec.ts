import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// state: ショッピングカート。<select> の中の for: で商品の <option> を描き、入力フィルタ
// (value|number) で選択 id を数値として状態へ書き戻す。Add は既にある商品なら数量を +1、
// 無ければ新しい配列の代入で行を足す。行の数量は valueAsNumber の双方向バインディング、
// 行の小計・合計・税・総計は多段のワイルドカード getter ($getAll で集計)、Delete は
// confirm() の後にループインデックス ($1) で toSpliced する。if / else で見出しを切り替える。
// 選択・追加・数量入力・削除 (キャンセル含む)・空カートからの復帰を実ブラウザで固定する。
const PAGE = "/packages/state/examples/cart/";

// デモの商品データ
const PRODUCTS: Record<number, { name: string; price: number }> = {
  1: { name: "Laptop", price: 999.99 },
  2: { name: "Smartphone", price: 499.99 },
  3: { name: "Headphones", price: 199.99 },
  4: { name: "Smartwatch", price: 149.99 },
  5: { name: "Tablet", price: 299.99 },
  6: { name: "Camera", price: 599.99 },
  7: { name: "Printer", price: 89.99 },
  8: { name: "Monitor", price: 249.99 },
  9: { name: "Keyboard", price: 49.99 },
  10: { name: "Mouse", price: 29.99 },
};
const TAX_RATE = 0.1;

type Item = { id: number; qty: number };
type Row = [no: string, name: string, unit: string, qty: string, price: string];

// 期待する表示を商品データとカート内容から組み立てる (小計 = 単価 × 数量、税 = 合計の 10%、2 桁表示)
function expectedRows(items: Item[]): Row[] {
  return items.map(({ id, qty }, i) => [
    String(i + 1),
    PRODUCTS[id].name,
    PRODUCTS[id].price.toFixed(2),
    String(qty),
    (PRODUCTS[id].price * qty).toFixed(2),
  ]);
}
function expectedTotals(items: Item[]): [string, string, string] {
  const total = items.reduce((sum, { id, qty }) => sum + PRODUCTS[id].price * qty, 0);
  const tax = total * TAX_RATE;
  return [total.toFixed(2), tax.toFixed(2), (total + tax).toFixed(2)];
}

const itemRows = (page: Page) => page.locator("tbody tr:has(input[name='item'])");

async function readRows(page: Page): Promise<Row[]> {
  return itemRows(page).evaluateAll((trs) =>
    trs.map((tr) => {
      const td = tr.querySelectorAll("td");
      return [
        td[0].textContent!.trim(),
        td[1].textContent!.trim(),
        td[2].textContent!.trim(),
        td[3].querySelector("input")!.value,
        td[4].textContent!.trim(),
      ] as Row;
    }),
  );
}

async function readTotals(page: Page): Promise<string[]> {
  return page.locator("tbody tr:not(:has(input)) td.right:not(:has(strong))").allTextContents()
    .then((texts) => texts.map((t) => t.trim()));
}

async function expectCart(page: Page, items: Item[]) {
  await expect.poll(() => readRows(page)).toEqual(expectedRows(items));
  await expect.poll(() => readTotals(page)).toEqual(expectedTotals(items));
  await expect(page.locator("section h2")).toHaveText(
    items.length > 0 ? "Your Shopping Cart" : "Your cart is empty.",
  );
}

const INITIAL: Item[] = [{ id: 1, qty: 1 }, { id: 5, qty: 2 }];

test.describe("packages/state/examples/cart", () => {
  test("初期表示: 商品の選択肢、カートの 2 行、合計・税・総計", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    // <select> の中の for: が 10 件の <option> を描き、value に id が入る
    const options = page.locator("select option");
    await expect(options).toHaveText(
      Object.values(PRODUCTS).map((p) => `${p.name} - $${p.price.toFixed(2)}`),
    );
    expect(await options.evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)))
      .toEqual(Object.keys(PRODUCTS));
    // 初期選択は状態の selectedProductId (1)
    await expect(page.locator("select")).toHaveValue("1");

    await expectCart(page, INITIAL);
    // 行の中からトップレベルのパスを読む attr.min
    expect(await itemRows(page).locator("input").evaluateAll((is) => is.map((i) => i.getAttribute("min"))))
      .toEqual(["1", "1"]);
    // taxRate|percent
    await expect(page.locator("tbody strong", { hasText: "Tax" })).toHaveText("Tax (10%) ($):");
    await expect(page.locator("body")).not.toContainText("{{");

    expect(errors).toEqual([]);
  });

  test("Add to Cart: 無い商品は行を足し、ある商品は数量を +1 する", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);
    await expectCart(page, INITIAL);

    const select = page.locator("select");
    const add = page.locator("button", { hasText: "Add to Cart" });

    // Headphones (id 3) はカートに無い → 3 行目に追加
    await select.selectOption("3");
    await add.click();
    const items: Item[] = [{ id: 1, qty: 1 }, { id: 5, qty: 2 }, { id: 3, qty: 1 }];
    await expectCart(page, items);

    // もう一度 → 行は増えず数量が 2 (value|number で id が数値として状態に入っている証拠)
    await add.click();
    items[2].qty = 2;
    await expectCart(page, items);

    // Laptop (id 1) に戻して追加 → 1 行目の数量が 2
    await select.selectOption("1");
    await expect(select).toHaveValue("1");
    await add.click();
    items[0].qty = 2;
    await expectCart(page, items);

    expect(errors).toEqual([]);
  });

  test("数量の入力が小計と合計に反映され、その値が状態に書き戻されている", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);
    await expectCart(page, INITIAL);

    const qty = itemRows(page).locator("input");
    await qty.nth(0).fill("3");
    const items: Item[] = [{ id: 1, qty: 3 }, { id: 5, qty: 2 }];
    await expectCart(page, items);

    await qty.nth(1).fill("1");
    items[1].qty = 1;
    await expectCart(page, items);

    // 入力した数量は状態に入っている: Tablet を Add すると 1 → 2 (DOM だけの変更なら 3 になる)
    await page.locator("select").selectOption("5");
    await page.locator("button", { hasText: "Add to Cart" }).click();
    items[1].qty = 2;
    await expectCart(page, items);

    expect(errors).toEqual([]);
  });

  test("Delete: confirm をキャンセルすると残り、承認するとその行が消えて番号が詰まり、空になると見出しが替わる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);
    await expectCart(page, INITIAL);

    const dialogs: string[] = [];
    const answerNext = (accept: boolean) =>
      page.once("dialog", async (d) => {
        dialogs.push(`${d.type()}: ${d.message()}`);
        await (accept ? d.accept() : d.dismiss());
      });
    const deleteButton = (n: number) => itemRows(page).nth(n).locator("button", { hasText: "Delete" });

    // キャンセル → 何も変わらない
    answerNext(false);
    await deleteButton(0).click();
    await expect.poll(() => dialogs.length).toBe(1);
    await expectCart(page, INITIAL);

    // 1 行目 (Laptop) を承認して削除 → Tablet が No.1 に繰り上がる
    answerNext(true);
    await deleteButton(0).click();
    let items: Item[] = [{ id: 5, qty: 2 }];
    await expectCart(page, items);

    // 削除後も商品 id → 行の対応が正しい: Tablet を Add すると繰り上がった行の数量が増える
    await page.locator("select").selectOption("5");
    await page.locator("button", { hasText: "Add to Cart" }).click();
    items = [{ id: 5, qty: 3 }];
    await expectCart(page, items);

    // 最後の行を削除 → 空カートの見出し、合計はすべて 0.00
    answerNext(true);
    await deleteButton(0).click();
    items = [];
    await expectCart(page, items);
    await expect(itemRows(page)).toHaveCount(0);

    // 空から追加すると見出しが戻る
    await page.locator("select").selectOption("10");
    await page.locator("button", { hasText: "Add to Cart" }).click();
    items = [{ id: 10, qty: 1 }];
    await expectCart(page, items);

    expect(dialogs).toEqual(
      Array(3).fill("confirm: Are you sure you want to delete this item from the cart?"),
    );
    expect(errors).toEqual([]);
  });
});
