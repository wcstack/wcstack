import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// bind-component の境界を 2 枚重ねた形。
// docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.11 / §1.12。
//
// 中間の panel は配列を素通しするだけで自分の行バインディングを持たない。中継が居ないため、
// 1 段目だけの相乗り登録では正本スコープ起点の行フィールド書き込みが誰にも届かない（§1.11）。
//
// 判別子は最下層（card）の Shadow 内のリスト。shadow を constructor で組む形（*-eager）と
// connectedCallback で組む形（*-lazy）の両方を見る（§1.9 の理由）。
//
// 2 形を別ページに分けているのは、§1.12 の失敗が初期描画で throw してドキュメント全体を
// ウェッジするため。同居させると §1.11 側も道連れになり、独立した信号にならない。

const rowIds = async (locator: import("@playwright/test").Locator) =>
  locator.evaluateAll((els) => els.map((el) => el.getAttribute("data-row-id")));

test.describe("e2e/fixtures/bind-component-depth2 (§1.11 平坦な 2 段)", () => {
  const eager = "#flat panel-eager >>> card-eager >>> .leaf-view li";
  const lazy = "#flat panel-lazy >>> card-lazy >>> .leaf-view li";

  test("初期描画が 2 枚の境界を越えて届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-depth2.html");

    await expect(page.locator(eager)).toHaveText(["Alice", "Bob"]);
    await expect(page.locator(lazy)).toHaveText(["Alice", "Bob"]);

    expect(errors).toEqual([]);
  });

  test("最上位の行フィールド書き込みが 2 枚越しの最下層に届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-depth2.html");
    await expect(page.locator(eager)).toHaveText(["Alice", "Bob"]);

    await page.locator("#rename").click();

    await expect(page.locator(eager)).toHaveText(["Alice", "Bobby"]);
    await expect(page.locator(lazy)).toHaveText(["Alice", "Bobby"]);
    // 行は作り直されていない ＝ 全再描画に落ちていない
    expect(await rowIds(page.locator(eager))).toEqual(["a", "b"]);

    expect(errors).toEqual([]);
  });

  test("最上位のリスト置換が 2 枚越しの最下層に届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-depth2.html");
    await expect(page.locator(eager)).toHaveText(["Alice", "Bob"]);

    await page.locator("#replace").click();

    await expect(page.locator(eager)).toHaveText(["Xavier", "Yolanda"]);
    await expect(page.locator(lazy)).toHaveText(["Xavier", "Yolanda"]);

    expect(errors).toEqual([]);
  });

  test("行オブジェクトを保った並べ替えで行の同一性が保たれること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-depth2.html");
    await expect(page.locator(eager)).toHaveText(["Alice", "Bob"]);

    await page.locator("#swap").click();

    await expect(page.locator(eager)).toHaveText(["Bob", "Alice"]);
    expect(await rowIds(page.locator(eager))).toEqual(["b", "a"]);

    expect(errors).toEqual([]);
  });
});

test.describe("e2e/fixtures/bind-component-depth2-nested (§1.12 親ループの中の 2 段)", () => {
  const eager = (group: number) =>
    `#nested section:nth-of-type(${group}) panel-eager >>> card-eager >>> .leaf-view li`;
  const lazy = (group: number) =>
    `#nested section:nth-of-type(${group}) panel-lazy >>> card-lazy >>> .leaf-view li`;
  const hostView = (group: number) =>
    `#nested section:nth-of-type(${group}) .host-view li`;

  test("初期描画が Δ>0 でも 2 枚の境界を越えて届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-depth2-nested.html");

    await expect(page.locator(hostView(1))).toHaveText(["Carol", "Dave"]);
    await expect(page.locator(eager(1))).toHaveText(["Carol", "Dave"]);
    await expect(page.locator(lazy(1))).toHaveText(["Carol", "Dave"]);
    await expect(page.locator(eager(2))).toHaveText(["Erin"]);
    await expect(page.locator(lazy(2))).toHaveText(["Erin"]);

    expect(errors).toEqual([]);
  });

  test("行フィールド書き込みが該当グループの該当行にだけ届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-depth2-nested.html");
    await expect(page.locator(eager(1))).toHaveText(["Carol", "Dave"]);

    await page.locator("#rename-nested").click();

    await expect(page.locator(eager(1))).toHaveText(["Carol", "Davey"]);
    await expect(page.locator(lazy(1))).toHaveText(["Carol", "Davey"]);
    // 別グループは無傷
    await expect(page.locator(eager(2))).toHaveText(["Erin"]);
    // 行は作り直されていない
    expect(await rowIds(page.locator(eager(1)))).toEqual(["c", "d"]);

    expect(errors).toEqual([]);
  });

  test("行配列の差し替えが該当グループにだけ届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-depth2-nested.html");
    await expect(page.locator(eager(1))).toHaveText(["Carol", "Dave"]);

    await page.locator("#replace-nested").click();

    await expect(page.locator(eager(1))).toHaveText(["Peggy", "Quinn"]);
    await expect(page.locator(lazy(1))).toHaveText(["Peggy", "Quinn"]);
    await expect(page.locator(eager(2))).toHaveText(["Erin"]);

    expect(errors).toEqual([]);
  });

  test("グループを並べ替えても行と子の対応が保たれること", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-depth2-nested.html");
    await expect(page.locator(eager(1))).toHaveText(["Carol", "Dave"]);

    await page.locator("#swap-groups").click();

    await expect(page.locator(eager(1))).toHaveText(["Erin"]);
    await expect(page.locator(eager(2))).toHaveText(["Carol", "Dave"]);
    await expect(page.locator(lazy(1))).toHaveText(["Erin"]);
    await expect(page.locator(lazy(2))).toHaveText(["Carol", "Dave"]);

    expect(errors).toEqual([]);
  });

  test("並べ替えのあとも行フィールド書き込みが正しい子に届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-depth2-nested.html");
    await page.locator("#swap-groups").click();
    await expect(page.locator(eager(1))).toHaveText(["Erin"]);

    // groups.0 は入れ替わって G2（Erin 1 行）。renameNestedRow は groups.0.children.1 を
    // 狙うので、行が足りず既存の範囲外挙動になる — ここでは G1 側が無傷なことだけを見る
    await expect(page.locator(eager(2))).toHaveText(["Carol", "Dave"]);
    expect(await rowIds(page.locator(eager(2)))).toEqual(["c", "d"]);

    expect(errors).toEqual([]);
  });
});
