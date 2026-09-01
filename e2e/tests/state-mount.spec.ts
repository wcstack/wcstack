import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// v2 のマウント構文の目標ページ（docs/state-mount-design.md §3、docs/state-mount-impl-plan.md P0-5）。
//
// 4 ページとも v1.32 では成立しない形を書いてある。fixme で止めてあり、実装 Phase の着地で
// 順に外す（受け入れ ID は設計書 §7 / 計画 §7 のマトリクス）:
//   - mount-root / mount-row  … Phase 1（`state: path` を既存機構の上で成立させる）— 済み（fixme を外した）
//   - mount-light             … Phase 2（スコープを DOM 位置で解決、name 不要）
//   - mount-volume            … Phase 3（`mount=` ボリューム、name / @ の撤去）
//
// fixme の理由文字列に Phase を書いておく: 外し忘れは「red なのに skip」ではなく
// 「skip 一覧に Phase N と書いてある」で見つける。
const PHASE2 = "state-mount Phase 2（スコープの DOM 解決）で有効化 — docs/state-mount-impl-plan.md §3";
const PHASE3 = "state-mount Phase 3（mount= ボリューム）で有効化 — docs/state-mount-impl-plan.md §4";

const rowIds = async (locator: import("@playwright/test").Locator) =>
  locator.evaluateAll((els) => els.map((el) => el.getAttribute("data-row-id")));

test.describe("e2e/fixtures/mount-root — 丸ごとマウント state: path", () => {
  test("M1/M16: 中の name と getter がツリーの user.* を読む", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/mount-root.html");
    await expect(page.locator("#card >>> .name")).toHaveText("Alice");
    await expect(page.locator("#card >>> .display")).toHaveText("Alice <alice@example.com>");
    await expect(page.locator("#card >>> .theme")).toHaveText("light");
    expect(errors).toEqual([]);
  });

  test("M2/M13: 中の入力がツリーに届き、親スコープのバインドが更新される", async ({ page }) => {
    await page.goto("/e2e/fixtures/mount-root.html");
    await page.locator("#card >>> .edit").fill("Eve");
    await page.locator("#card >>> .edit").dispatchEvent("input");
    await expect(page.locator("#host-name")).toHaveText("Eve");
    await expect(page.locator("#card >>> .display")).toHaveText("Eve <alice@example.com>");
  });

  test("M3: 親の user 丸ごと差し替えと部分書き込みが中に届く", async ({ page }) => {
    await page.goto("/e2e/fixtures/mount-root.html");
    await page.click("#rename");
    await expect(page.locator("#card >>> .name")).toHaveText("Carol");
    await page.click("#replace");
    await expect(page.locator("#card >>> .display")).toHaveText("Dana <dana@example.com>");
  });

  test("M5: 部分マウント state.theme: theme が併用できる", async ({ page }) => {
    await page.goto("/e2e/fixtures/mount-root.html");
    await page.click("#toggle-theme");
    await expect(page.locator("#card >>> .theme")).toHaveText("dark");
  });
});

test.describe("e2e/fixtures/mount-row — 行そのものをマウント state: .", () => {
  const row = (n: number) => `#rows user-row:nth-of-type(${n}) >>> .name`;
  const tags = (n: number) => `#rows user-row:nth-of-type(${n}) >>> .tags li`;

  test("M4/M7/M10: 各行が自分の行を読み、中の for が users.*.tags.* を回す", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/mount-row.html");
    await expect(page.locator(row(1))).toHaveText("Anna");
    await expect(page.locator(row(2))).toHaveText("Ben");
    await expect(page.locator(tags(1))).toHaveText(["x"]);
    await expect(page.locator(tags(2))).toHaveText(["y", "z"]);
    expect(errors).toEqual([]);
  });

  test("M4: 行フィールドの書き込みがその行だけを更新する（id 不変）", async ({ page }) => {
    await page.goto("/e2e/fixtures/mount-row.html");
    const before = await rowIds(page.locator("#rows user-row >>> .name"));
    await page.click("#rename-row");
    await expect(page.locator(row(2))).toHaveText("Bennett");
    await expect(page.locator(row(1))).toHaveText("Anna");
    expect(await rowIds(page.locator("#rows user-row >>> .name"))).toEqual(before);
  });

  test("M7: 親が行の配列を差し替えると中の for が追随する", async ({ page }) => {
    await page.goto("/e2e/fixtures/mount-row.html");
    await page.click("#add-tag");
    await expect(page.locator(tags(1))).toHaveText(["x", "w"]);
  });

  test("M17: swap と丸ごと差し替えで行コンポーネントが付け替わる", async ({ page }) => {
    await page.goto("/e2e/fixtures/mount-row.html");
    await page.click("#swap");
    await expect(page.locator(row(1))).toHaveText("Ben");
    await expect(page.locator(row(2))).toHaveText("Anna");
    await page.click("#replace-rows");
    await expect(page.locator("#rows user-row")).toHaveCount(1);
    await expect(page.locator(row(1))).toHaveText("Cleo");
  });
});

test.describe("e2e/fixtures/mount-light — Light DOM に name が要らない", () => {
  test("L1/L3: name 無しの Light DOM コンポーネントがマウント先を読む", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/mount-light.html");
    await expect(page.locator("#single light-view .inner")).toHaveText("Alice");
    await expect(page.locator("#host-name")).toHaveText("Alice");
    await page.click("#rename");
    await expect(page.locator("#single light-view .inner")).toHaveText("Carol");
    await expect(page.locator("#host-name")).toHaveText("Carol");
    expect(errors).toEqual([]);
  });

  test("L2: 同じ Light DOM コンポーネントを for の行に置ける", async ({ page }) => {
    await page.goto("/e2e/fixtures/mount-light.html");
    await expect(page.locator("#list light-item .inner")).toHaveText(["Anna", "Ben"]);
    expect(await rowIds(page.locator("#list light-item .inner"))).toEqual(["a", "b"]);
    await page.click("#rename-row");
    await expect(page.locator("#list light-item .inner")).toHaveText(["Anna", "Bennett"]);
  });
});

test.describe("e2e/fixtures/mount-volume — mount= で接ぎ木するボリューム", () => {
  test("V1/V2/V5: ルートより先に置いたボリュームが i18n.* として読める", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/e2e/fixtures/mount-volume.html");
    await expect(page.locator("#title")).toHaveText("Hello");
    await expect(page.locator("#lang")).toHaveText("en");
    expect(errors).toEqual([]);
  });

  test("V2/V3: ボリュームの getter とルートの getter が i18n.lang に依存する", async ({ page }) => {
    await page.goto("/e2e/fixtures/mount-volume.html");
    await expect(page.locator("#label")).toHaveText("1 items");
    await page.click("#inc");
    await expect(page.locator("#label")).toHaveText("2 items");
    await page.click("#to-ja");
    await expect(page.locator("#title")).toHaveText("こんにちは");
    await expect(page.locator("#label")).toHaveText("2 件");
  });

  test("V7: ボリュームの $connectedCallback が chroot で走る", async ({ page }) => {
    await page.goto("/e2e/fixtures/mount-volume.html");
    const connected = await page.evaluate(async () => {
      const root = document.querySelector("wcs-state:not([mount])") as any;
      await root.connectedCallbackPromise;
      let value: unknown;
      await root.createStateAsync("readonly", async (s: any) => { value = s["i18n.connected"]; });
      return value;
    });
    expect(connected).toBe(true);
  });
});
