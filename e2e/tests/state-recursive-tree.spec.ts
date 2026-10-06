import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// state 単体: 再帰パス（`$recursion` + `**`）で深さがデータで決まる木を集計するデモ。
// 描画は自分自身を入れ子にする <tree-node>（shadow root の中の bind-component で行に
// `state: .` でマウント）が受け持ち、どの段もパスは 1 段（label / value / total /
// children）しか書かない。
//
// この spec が固定するもの:
//  - 種の木が深さどおりに shadow root の入れ子で描かれ、各行の Σ（`nodes.**.total`）と
//    高さ（`nodes.**.depth`）、Total / Nodes / Height / Selected（`$getAll(…, [])`）が正しい
//  - 深い段の値の編集が、祖先すべての Σ と全体の集計に届き、兄弟の部分木は変わらない
//  - + child で、ページがまだ描いたことのない深さまで木を伸ばせて、その段の getter も
//    初めて読まれたときに組み上がる。− で末尾の子を部分木ごと外せる
//  - Select all / Clear selection（`$setAll("nodes.**.selected", [], …)`）がすべての深さに届く
//  - Reset tree で木全体が種に戻る
//
// 期待値はページのコードの写しではなく、テスト側の木のモデルから独立に計算する。
//
// 4.0.0-rc.6 の不具合の回帰: 子を持つ節点を外す（− で子を外す、Reset tree）と、描画結果は
// 正しいのに、外した行の中の入れ子の <tree-node> について `binding "text: total" failed to
// apply. Error: … The host row of <tree-node> was removed.` が console.error に出ていた
// （消えた行のコンポーネントの中のコンポーネントが、ホストの getter を読みに行っていた。
// packages/state の fixes.test.ts に最小の形）。コンソールが静かであることを求める。

type TreeNode = { label: string; value: number; selected: boolean; children: TreeNode[] };

// ページの種の木（入力データ）。集計値はここから下の関数で導く。
function seed(): TreeNode[] {
  const n = (label: string, value: number, children: TreeNode[] = []): TreeNode =>
    ({ label, value, selected: false, children });
  return [
    n("src", 4, [
      n("src.state", 12, [n("src.state.proxy", 30), n("src.state.list", 18)]),
      n("src.router", 9),
    ]),
    n("docs", 6, [n("docs.adr", 7)]),
  ];
}

const total = (n: TreeNode): number => n.value + n.children.reduce((a, c) => a + total(c), 0);
const height = (n: TreeNode): number => 1 + Math.max(0, ...n.children.map(height));

function preorder(nodes: TreeNode[], depth = 1): Array<{ node: TreeNode; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...preorder(node.children, depth + 1)]);
}

function find(nodes: TreeNode[], label: string): TreeNode {
  const hit = preorder(nodes).find(({ node }) => node.label === label);
  if (!hit) throw new Error(`no node ${label} in the model`);
  return hit.node;
}

type RowView = {
  label: string; depth: number; total: string; height: string;
  value: string; selected: boolean; canDrop: boolean;
};

function expectedRows(model: TreeNode[]): RowView[] {
  return preorder(model).map(({ node, depth }) => ({
    label: node.label,
    depth,
    total: `Σ ${total(node)}`,
    height: `h${height(node)}`,
    value: String(node.value),
    selected: node.selected,
    canDrop: node.children.length > 0,
  }));
}

function expectedStats(model: TreeNode[]): Record<string, string> {
  const all = preorder(model);
  return {
    Total: String(model.reduce((a, n) => a + total(n), 0)),
    Nodes: String(all.length),
    Height: String(Math.max(0, ...model.map(height))),
    Selected: String(all.filter(({ node }) => node.selected).length),
  };
}

// <tree-node> を shadow root の入れ子どおりに先行順で辿り、各行の表示を読む。
// depth は「いくつの <tree-node> の shadow root の中にいるか」+1 で、DOM の入れ子が
// データの深さと一致していることもここで確かめる。
async function readTree(page: Page): Promise<RowView[]> {
  return page.evaluate(() => {
    const rows: Array<Record<string, unknown>> = [];
    const walk = (root: ParentNode, depth: number) => {
      for (const el of Array.from(root.querySelectorAll("tree-node"))) {
        const sr = (el as HTMLElement).shadowRoot!;
        const q = (sel: string) => sr.querySelector(sel) as HTMLElement;
        rows.push({
          label: q(".label").textContent!.trim(),
          depth,
          total: q(".total").textContent!.replace(/\s+/g, " ").trim(),
          height: q(".depth").textContent!.trim(),
          value: (q('input[type="number"]') as HTMLInputElement).value,
          selected: (q('input[type="checkbox"]') as HTMLInputElement).checked,
          canDrop: !(q('button[aria-label="Remove the last child"]') as HTMLButtonElement).disabled,
        });
        walk(sr, depth + 1);
      }
    };
    walk(document, 1);
    return rows;
  }) as Promise<RowView[]>;
}

async function readStats(page: Page): Promise<Record<string, string>> {
  return page.$$eval(".stat", (stats) =>
    Object.fromEntries(stats.map((s) => [
      s.querySelector(".k")!.textContent!.trim(),
      s.querySelector(".v")!.textContent!.trim(),
    ])));
}

async function expectTree(page: Page, model: TreeNode[]): Promise<void> {
  await expect.poll(() => readTree(page)).toEqual(expectedRows(model));
  await expect.poll(() => readStats(page)).toEqual(expectedStats(model));
}

// ラベルで 1 行（その節点自身の .node）を選ぶ。.node は自分の .label だけを含み、
// 子の行は兄弟の .children の中にあるので、ラベルの完全一致で一意に決まる。
function row(page: Page, label: string) {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator(".node").filter({ has: page.locator(".label", { hasText: exact }) });
}

async function setValue(page: Page, model: TreeNode[], label: string, value: number) {
  await row(page, label).locator('input[type="number"]').fill(String(value));
  find(model, label).value = value;
}

async function addChild(page: Page, model: TreeNode[], label: string): Promise<string> {
  await row(page, label).getByRole("button", { name: "+ child" }).click();
  const node = find(model, label);
  const child = { label: `${label}.${node.children.length + 1}`, value: 5, selected: false, children: [] };
  node.children.push(child);
  return child.label;
}

async function dropChild(page: Page, model: TreeNode[], label: string) {
  await row(page, label).getByRole("button", { name: "Remove the last child" }).click();
  find(model, label).children.pop();
}

function setAllSelected(model: TreeNode[], selected: boolean) {
  for (const { node } of preorder(model)) node.selected = selected;
}

test.describe("packages/state/examples/recursive-tree", () => {
  test("種の木が深さどおりに入れ子で描かれ、各行の Σ・高さと全体の集計が正しい", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/recursive-tree/");

    const model = seed();
    await expectTree(page, model);
    // 念のため具体値でも 1 度だけ確かめる（モデルの計算そのものの取り違えを防ぐ）
    expect(expectedStats(model)).toEqual({ Total: "86", Nodes: "7", Height: "3", Selected: "0" });
    await expect(row(page, "src").locator(".total")).toHaveText("Σ 73");
    await expect(row(page, "docs").locator(".total")).toHaveText("Σ 13");
    // 葉の行の − は押せない
    await expect(row(page, "src.state.proxy").getByRole("button", { name: "Remove the last child" })).toBeDisabled();

    expect(errors).toEqual([]);
  });

  test("深い段の値を編集すると祖先すべての Σ と Total が追随し、兄弟の部分木は変わらない", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/recursive-tree/");
    const model = seed();
    await expectTree(page, model);

    // 深さ 3 の葉
    await setValue(page, model, "src.state.proxy", 41);
    await expectTree(page, model);
    await expect(row(page, "src").locator(".total")).toHaveText("Σ 84");
    await expect(row(page, "docs").locator(".total")).toHaveText("Σ 13");

    // 深さ 2 の内部節点（自分の値と子の合計の両方が Σ に入る）
    await setValue(page, model, "src.state", 0);
    await expectTree(page, model);

    // 深さ 1 の根
    await setValue(page, model, "docs", 100);
    await expectTree(page, model);

    expect(errors).toEqual([]);
  });

  test("+ child で描いたことのない深さまで木を伸ばし、その段の Σ と高さが上の段すべてに届く", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/recursive-tree/");
    const model = seed();
    await expectTree(page, model);

    // 深さ 3 の葉に子を足す → 深さ 4（ページが一度も描いていない深さ）
    const d4 = await addChild(page, model, "src.state.list");
    expect(d4).toBe("src.state.list.1");
    await expectTree(page, model);
    await expect(row(page, d4).locator(".total")).toHaveText("Σ 5");

    // さらにその下へ 2 段伸ばす → 深さ 6
    const d5 = await addChild(page, model, d4);
    const d6 = await addChild(page, model, d5);
    expect(d6).toBe("src.state.list.1.1.1");
    await expectTree(page, model);
    expect(expectedStats(model).Height).toBe("6");

    // 新しく作った最深の段の値を編集しても、根まで届く
    await setValue(page, model, d6, 50);
    await expectTree(page, model);

    // 同じ段に兄弟を足す（ラベルの番号は子の数から決まる）
    const sibling = await addChild(page, model, d5);
    expect(sibling).toBe("src.state.list.1.1.2");
    await expectTree(page, model);

    // 根の段にも子を足せる
    await addChild(page, model, "docs");
    await expectTree(page, model);

    expect(errors).toEqual([]);
  });

  test("− は末尾の子を部分木ごと外し、子がなくなると押せなくなる", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/recursive-tree/");
    const model = seed();
    await expectTree(page, model);

    // 深く伸ばしてから、最深の段から順に戻す
    const d4 = await addChild(page, model, "src.state.proxy");
    const d5 = await addChild(page, model, d4);
    await expectTree(page, model);
    await dropChild(page, model, d4);
    await expectTree(page, model);
    await expect(row(page, d5)).toHaveCount(0);
    await expect(row(page, d4).getByRole("button", { name: "Remove the last child" })).toBeDisabled();
    await dropChild(page, model, "src.state.proxy");
    await expectTree(page, model);
    await expect(row(page, d4)).toHaveCount(0);

    // 深さ 1 の − は末尾の子（src.router）を外す
    await dropChild(page, model, "src");
    await expectTree(page, model);
    await expect(row(page, "src.router")).toHaveCount(0);

    // もう一度押すと、子を持つ src.state を部分木ごと外す（3 節点減る）
    await dropChild(page, model, "src");
    await expectTree(page, model);
    expect(expectedStats(model)).toMatchObject({ Nodes: "3", Total: "17" });
    for (const gone of ["src.state", "src.state.proxy", "src.state.list"]) {
      await expect(row(page, gone)).toHaveCount(0);
    }
    await expect(row(page, "src").getByRole("button", { name: "Remove the last child" })).toBeDisabled();

    // 外した後でも + child は普通に効く
    await addChild(page, model, "src");
    await expectTree(page, model);

    expect(errors).toEqual([]);
  });

  test("Select all / Clear selection はすべての深さに 1 回で届き、個別のチェックとも整合する", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/recursive-tree/");
    const model = seed();
    await expectTree(page, model);

    // 個別のチェック（深さ 3 と深さ 1）
    await row(page, "src.state.list").getByRole("checkbox").check();
    find(model, "src.state.list").selected = true;
    await row(page, "docs").getByRole("checkbox").check();
    find(model, "docs").selected = true;
    await expectTree(page, model);

    // 後から足した深い節点にもブロードキャストが届く
    const d4 = await addChild(page, model, "src.state.list");
    await page.getByRole("button", { name: "Select all" }).click();
    setAllSelected(model, true);
    await expectTree(page, model);
    await expect(row(page, d4).getByRole("checkbox")).toBeChecked();

    // 選択済みの木に足した子は未選択で入る
    await addChild(page, model, d4);
    await expectTree(page, model);

    // 1 つ外す
    await row(page, "src.router").getByRole("checkbox").uncheck();
    find(model, "src.router").selected = false;
    await expectTree(page, model);

    await page.getByRole("button", { name: "Clear selection" }).click();
    setAllSelected(model, false);
    await expectTree(page, model);

    expect(errors).toEqual([]);
  });

  test("Reset tree は編集・追加・削除・選択をすべて捨てて種の木に戻す", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/packages/state/examples/recursive-tree/");
    const model = seed();
    await expectTree(page, model);

    await setValue(page, model, "src.state.proxy", 1);
    const d4 = await addChild(page, model, "src.state.proxy");
    await addChild(page, model, d4);
    await dropChild(page, model, "docs");
    await page.getByRole("button", { name: "Select all" }).click();
    setAllSelected(model, true);
    await expectTree(page, model);

    await page.getByRole("button", { name: "Reset tree" }).click();
    await expectTree(page, seed());

    // 戻った木の上でも、深い段の編集はふたたび根まで届く
    const fresh = seed();
    await setValue(page, fresh, "src.state.list", 20);
    await expectTree(page, fresh);

    expect(errors).toEqual([]);
  });
});
