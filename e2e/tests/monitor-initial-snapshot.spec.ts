import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// monitor 系 I/O ノードの初回スナップショットが、手動 pull なしで data-wcs
// バインドに届くことの回帰テスト。
//
// これらのノードは接続中に最初の値を同期発火するため、告知イベントは
// <wcs-state> がリスナーを張るより前に飛ぶ。かつては README 各例が
// 「$connectedCallback + whenDefined + プロパティ pull」でこれを補っていたが、
// 現在は directional initial sync(v1.21.0 で既定 ON)が構造的に解決している:
// これらのメンバは output-only(properties のみで inputs に無い)なので既定の
// binding authority が `element` になり、バインド確立時にプロパティを
// 直接読む(packages/state の BindingSession.readProducerSnapshot)。
//
// fixture は手動 pull を一切持たないので、この宣言的 pull が退行すると
// バインドパスはシード値のまま残り、以下の assert が落ちる。
// = network / screen-orientation README が手動 pull を載せない根拠。
test.describe("e2e/fixtures/monitor-initial-snapshot", () => {
  test("手動 pull 無しで初回スナップショットがバインドに届く", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/monitor-initial-snapshot.html");

    // screen-orientation: Chromium は常に対応。type は "portrait-*"/"landscape-*"、
    // portrait は厳密 boolean。どちらもシード(null)から動いていることを見る。
    await expect(page.locator("#orient-type")).toHaveText(/^(portrait|landscape)-/);
    await expect(page.locator("#orient-portrait")).toHaveText(/^(true|false)$/);

    // network: Chromium は NetworkInformation 対応なので supported=true が
    // 初回スナップショットとして届く(seed は false)。supported は接続時に
    // 一度確定したきり change が二度と飛ばないため、pull が効かなければ
    // 永久に false のまま = この assert が退行を捕まえる。
    await expect(page.locator("#net-supported")).toHaveText("true");
    await expect(page.locator("#net-effective")).not.toBeEmpty();

    expect(errors).toEqual([]);
  });
});
