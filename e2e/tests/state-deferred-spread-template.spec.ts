import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// for / if のテンプレートの中の spread を、後から define される要素に付けたとき（#330）。
// happy-dom は define 時に既存ノードを差し替えるので、unit テスト
// （packages/state/__tests__/integration.spreadDeferredTemplate.test.ts）は registry を
// 差し込んで模している。本物の define・upgrade を通すのはここだけ。
test.describe("e2e/fixtures/deferred-spread-template", () => {
  test("define 前に行・枝が描かれ、define 後にその行の値で展開される", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/deferred-spread-template.html");

    // define 前（state の描画完了時点）でも行と枝は描かれている（修正前は for / if ごと 0 件）
    await page.waitForFunction(() => (window as any).__beforeDefine !== undefined);
    expect(await page.evaluate(() => (window as any).__beforeDefine)).toEqual({
      defined: false, dot: 2, star: 2, branch: 1, gone: 2,
    });

    await expect(page.locator("#dot x-greet")).toHaveText(["hello a", "hello b"]);
    await expect(page.locator("#star x-greet")).toHaveText(["hello a", "hello b"]);
    await expect(page.locator("#branch x-greet")).toHaveText("hello z");
    // define 前に消した行（x）は展開されない。残った行（y）だけが展開される
    await expect(page.locator("#gone x-greet")).toHaveText(["hello y"]);
    expect(await page.evaluate(() => {
      const el = (window as any).__removedEl;
      return { connected: el.isConnected, text: el.textContent, name: el.name ?? null };
    })).toEqual({ connected: false, text: "", name: null });

    // 出力専用メンバーの初期同期も行ごとに成り立つ（要素の値が state に入る）
    const statuses = await page.evaluate(() => {
      let result: unknown;
      (document.querySelector("wcs-state") as any).createState("readonly", (state: any) => {
        result = [state["people.0.status"], state["people.1.status"], state["one.status"]];
      });
      return result;
    });
    expect(statuses).toEqual(["ready", "ready", "ready"]);

    // 展開した束縛は state の書き込みに追従する
    await page.evaluate(() => {
      (document.querySelector("wcs-state") as any).createState("writable", (state: any) => {
        state["people.1.name"] = "bb";
      });
    });
    await expect(page.locator("#dot x-greet")).toHaveText(["hello a", "hello bb"]);

    expect(errors).toEqual([]);
  });
});
