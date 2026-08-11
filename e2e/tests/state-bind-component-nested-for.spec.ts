import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// 親スコープの `for` の中にコンポーネントがあり、子スコープでも `for` を回す入れ子形。
// docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.10。
//
// 判別子は Shadow 内のリスト（.host-view は親自身のバインディングなので断線していても動く）。
// shadow を constructor で組む形（group-eager）と connectedCallback で組む形（group-lazy）の
// 両方を見る — 後者は再接続で新しい state 要素になるため、前者だけが露出する欠落がある（§1.9）。
test.describe("e2e/fixtures/bind-component-nested-for", () => {
  const eager = (group: number) =>
    `#outer section:nth-of-type(${group}) group-eager >>> .child-view li`;
  const lazy = (group: number) =>
    `#outer section:nth-of-type(${group}) group-lazy >>> .child-view li`;
  const hostView = (group: number) =>
    `#outer section:nth-of-type(${group}) .host-view li`;

  const rowIds = async (locator: import("@playwright/test").Locator) =>
    locator.evaluateAll((els) => els.map((el) => el.getAttribute("data-row-id")));

  test("各コンポーネントが自分の行の配列を描画すること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-nested-for.html");

    await expect(page.locator(hostView(1))).toHaveText(["Alice", "Bob"]);
    await expect(page.locator(eager(1))).toHaveText(["Alice", "Bob"]);
    await expect(page.locator(lazy(1))).toHaveText(["Alice", "Bob"]);
    await expect(page.locator(eager(2))).toHaveText(["Carol"]);
    await expect(page.locator(lazy(2))).toHaveText(["Carol"]);

    expect(errors).toEqual([]);
  });

  test("親の入れ子行フィールド書き込みが該当コンポーネントの該当行にだけ届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-nested-for.html");
    await expect(page.locator(eager(1))).toHaveText(["Alice", "Bob"]);

    await page.locator("#rename").click();

    await expect(page.locator(eager(1))).toHaveText(["Alice", "Bobby"]);
    await expect(page.locator(lazy(1))).toHaveText(["Alice", "Bobby"]);
    // 別グループは無傷
    await expect(page.locator(eager(2))).toHaveText(["Carol"]);
    // 行は作り直されていない ＝ 全再描画に落ちていない
    expect(await rowIds(page.locator(eager(1)))).toEqual(["a", "b"]);

    expect(errors).toEqual([]);
  });

  test("行の配列そのものを差し替えても子が追随すること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-nested-for.html");
    await expect(page.locator(eager(1))).toHaveText(["Alice", "Bob"]);

    await page.locator("#replace-rows").click();

    await expect(page.locator(eager(1))).toHaveText(["Xavier", "Yolanda", "Zach"]);
    await expect(page.locator(lazy(1))).toHaveText(["Xavier", "Yolanda", "Zach"]);
    await expect(page.locator(eager(2))).toHaveText(["Carol"]);

    expect(errors).toEqual([]);
  });

  test("行を減らしても例外を出さず、他のコンポーネントを巻き添えにしないこと", async ({ page }) => {
    // 親起点の行通知は、その行を外す子の `for` より先に適用される。消えた行の読みが
    // 生の TypeError になると updater の drain も行ループも捕まえないので、
    // 同じバッチの無関係な更新まで道連れになる（§1.7 / §1.9 と同じ構図）。
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-nested-for.html");
    await expect(page.locator(eager(1))).toHaveText(["Alice", "Bob"]);

    await page.locator("#replace-rows").click();
    await expect(page.locator(eager(1))).toHaveText(["Xavier", "Yolanda", "Zach"]);

    await page.locator("#shrink-rows").click();

    await expect(page.locator(eager(1))).toHaveText(["Alice"]);
    await expect(page.locator(lazy(1))).toHaveText(["Alice"]);
    await expect(page.locator(eager(2))).toHaveText(["Carol"]);

    expect(errors).toEqual([]);
  });

  test("親のリストを並べ替えても行と子の対応が保たれること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-nested-for.html");
    await expect(page.locator(eager(1))).toHaveText(["Alice", "Bob"]);

    await page.locator("#swap-groups").click();

    await expect(page.locator("#outer h3")).toHaveText(["G2", "G1"]);
    await expect(page.locator(eager(1))).toHaveText(["Carol"]);
    await expect(page.locator(eager(2))).toHaveText(["Alice", "Bob"]);
    await expect(page.locator(lazy(2))).toHaveText(["Alice", "Bob"]);
    expect(await rowIds(page.locator(eager(2)))).toEqual(["a", "b"]);

    expect(errors).toEqual([]);
  });

  test("並べ替えのあとも入れ子の行書き込みが正しい子に届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-nested-for.html");
    await expect(page.locator(eager(1))).toHaveText(["Alice", "Bob"]);

    await page.locator("#swap-groups").click();
    await expect(page.locator("#outer h3")).toHaveText(["G2", "G1"]);

    // 並べ替え後、G1 は groups.1。そこの 2 行目へ書けば DOM 上 2 番目の子に届く
    await page.locator("#rename-2nd").click();
    await expect(page.locator(eager(2))).toHaveText(["Alice", "Bobby"]);
    await expect(page.locator(lazy(2))).toHaveText(["Alice", "Bobby"]);
    // 1 番目（G2）は無傷
    await expect(page.locator(eager(1))).toHaveText(["Carol"]);

    // 並べ替えを往復してから書けば、同じ行が DOM 上 1 番目に届く
    await page.locator("#swap-groups").click();
    await expect(page.locator("#outer h3")).toHaveText(["G1", "G2"]);
    await page.locator("#rename").click();
    await expect(page.locator(eager(1))).toHaveText(["Alice", "Bobby"]);
    await expect(page.locator(lazy(1))).toHaveText(["Alice", "Bobby"]);
    expect(await rowIds(page.locator(eager(1)))).toEqual(["a", "b"]);

    expect(errors).toEqual([]);
  });

  test("親のリスト差し替えで各コンポーネントが自分の行を描き直すこと", async ({ page }) => {
    // 行 content はプールで再利用されるため、作り直された行は DOM に戻る前に apply が走る。
    // constructor 形は <wcs-state> が使い回されるので、ここが両形を並べる理由（§1.9）。
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-nested-for.html");
    await expect(page.locator(eager(1))).toHaveText(["Alice", "Bob"]);

    await page.locator("#replace-groups").click();

    await expect(page.locator("#outer h3")).toHaveText(["H1", "H2"]);
    await expect(page.locator(eager(1))).toHaveText(["Peggy"]);
    await expect(page.locator(lazy(1))).toHaveText(["Peggy"]);
    await expect(page.locator(eager(2))).toHaveText(["Quinn", "Rita"]);
    await expect(page.locator(lazy(2))).toHaveText(["Quinn", "Rita"]);

    expect(errors).toEqual([]);
  });
});
