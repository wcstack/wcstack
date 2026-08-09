import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// 親 state だけを書いたときに bind-component の子ビューが更新されるか。
// docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.1 / gate G1。
//
// 既存の state-bind-component-write.spec.ts は「公開プロパティ経由の write」と
// 「初期配送」を固定しているが、どちらも子側のコードが動く経路なので、
// 親だけが書いたときの配送は一度も通っていなかった。判別子は Shadow 内のビュー
// （#host-view は親自身のバインディングなのでどちらにせよ更新される）。
test.describe("e2e/fixtures/bind-component-parent-write", () => {
  test("親 state 起点の書き込みが子コンポーネントのビューに届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-parent-write.html");

    // 初期配送
    await expect(page.locator("#host-view")).toHaveText("Alice");
    await expect(page.locator("#leaf-view")).toHaveText("Alice");
    await expect(page.locator("#obj-view")).toHaveText("Alice");

    // 親のメソッドがマップ先のパスそのもの（user.name）を書く
    await page.locator("#rename").click();
    await expect(page.locator("#host-view")).toHaveText("Bob");
    // 葉のマッピング: state.name -> user.name
    await expect(page.locator("#leaf-view")).toHaveText("Bob");
    // オブジェクトのマッピング下のサブパス: state.user -> user、子は user.name を読む
    await expect(page.locator("#obj-view")).toHaveText("Bob");

    expect(errors).toEqual([]);
  });

  test("マップ先オブジェクトの丸ごと差し替えも子コンポーネントに届くこと", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/bind-component-parent-write.html");

    await expect(page.locator("#obj-view")).toHaveText("Alice");

    // this.user = { name: "Carol" } — マップ先そのものへの代入
    await page.locator("#replace").click();
    await expect(page.locator("#host-view")).toHaveText("Carol");
    await expect(page.locator("#leaf-view")).toHaveText("Carol");
    await expect(page.locator("#obj-view")).toHaveText("Carol");

    expect(errors).toEqual([]);
  });
});
