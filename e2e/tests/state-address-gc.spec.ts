import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// アドレスの intern が <wcs-state> を GC から隠さないこと
//（docs/state-address-unification-design.md §5-3 の I2、impl-plan §4-3・§9）。
//
// 現行実装に対する基準試験であり、アドレス型の統合（案 A）の受け入れ条件でもある。統合は
// `IStateAddress` に `stateElement` を持たせる。そのアドレスを不滅のキー（`PathInfo` は強参照の Map に
// 載っている）や、ツリーより長生きするキー（同じ配列を持つ別ツリーが生かす `ListIndex`）から辿れる
// 表に入れると、要素を DOM から外しても永久に回収されなくなる。例外は出ない — ページが漏れるだけ。
//
// GC の強制は CDP の `HeapProfiler.collectGarbage`（e2e/bench/memory-profile.mjs と同じ手段）。
// WeakRef は作った・deref したジョブの終わりまで対象を生かすので、GC は必ず別タスクから掛ける。

const FIXTURE = "/e2e/fixtures/state-address-gc.html";

// `WCS_STATE_BUNDLE=<絶対パス>` を与えると、ページが読む state のバンドルをそのファイルに差し替える。
// tracked な `packages/state/dist` を書き換えずに、別ブランチのビルドや変異を入れたビルドでこの spec を
// 流すための口（intern の置き場所の比較、番人が本当に落ちることの確認 — impl-plan §5・§12 の罠 1）。
const BUNDLE_OVERRIDE = process.env.WCS_STATE_BUNDLE;

async function open(page: Page): Promise<void> {
  if (BUNDLE_OVERRIDE) {
    await page.route("**/packages/state/dist/auto.min.js", (route) =>
      route.fulfill({ path: BUNDLE_OVERRIDE, contentType: "text/javascript; charset=utf-8" }));
  }
  await page.goto(FIXTURE);
  await expect(page.locator("html[data-ready=true]")).toBeAttached();
}

/** drain とフレームを流し切ってから GC を強制する（prevValues の台帳は drain 終端まで強参照 — impl-plan F8）。 */
async function settleAndCollect(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(() => resolve(), 50))),
  );
  const client = await page.context().newCDPSession(page);
  await client.send("HeapProfiler.collectGarbage");
  await client.send("HeapProfiler.collectGarbage");
  await client.detach();
}

const survivors = (page: Page, name: string) =>
  page.evaluate((tree) => (window as any).__gc.survivors(tree), name) as Promise<{ host: boolean; state: boolean }>;
const rows = (page: Page, name: string) =>
  page.evaluate((tree) => (window as any).__gc.rows(tree), name) as Promise<string[]>;

test.describe("e2e/fixtures/state-address-gc — アドレスの intern と GC", () => {
  test("対照: 強参照を握ったままのツリーは回収されないこと（GC を本当に観測している）", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    await page.evaluate(async () => {
      const gc = (window as any).__gc;
      await gc.mountOwn("pinned");
      gc.pin("pinned");
      gc.unmount("pinned");
    });
    await settleAndCollect(page);
    expect(await survivors(page, "pinned")).toEqual({ host: true, state: true });
    expect(errors).toEqual([]);
  });

  test("null 行の読み（素のパスと getter）だけをしたツリーが、外したあと回収されること", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    await page.evaluate(async () => {
      const gc = (window as any).__gc;
      await gc.mountOwn("solo");
    });
    // title（素のパス）と count（null 行の getter）は描画で読まれている
    await expect.poll(() => page.evaluate(() => (window as any).__gc.count("solo"))).toBe("2");
    await page.evaluate(() => (window as any).__gc.unmount("solo"));
    await settleAndCollect(page);
    expect(await survivors(page, "solo")).toEqual({ host: false, state: false });
    expect(errors).toEqual([]);
  });

  test("行付きの読みと書き込み（drain）を通したツリーが、外したあと回収されること", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    await page.evaluate(async () => {
      const gc = (window as any).__gc;
      await gc.mountOwn("rows");
      gc.write("rows", 1, "written");
    });
    await expect.poll(() => rows(page, "rows")).toEqual(["ROWS-0", "WRITTEN"]);
    await page.evaluate(() => (window as any).__gc.unmount("rows"));
    await settleAndCollect(page);
    expect(await survivors(page, "rows")).toEqual({ host: false, state: false });
    expect(errors).toEqual([]);
  });

  test("行（ListIndex）を共有する 2 ツリーの片方だけを外すと、外した側だけが回収されること", async ({ page }) => {
    const errors = collectErrors(page);
    await open(page);
    await page.evaluate(async () => {
      const gc = (window as any).__gc;
      await gc.mountSharing("gone", "kept");
      // 両方のツリーで、共有している行のアドレスを台帳に通す
      gc.write("gone", 0, "via-gone");
      gc.write("kept", 1, "via-kept");
    });
    await expect.poll(() => rows(page, "gone")).toEqual(["VIA-GONE", "SHARED-1"]);
    await expect.poll(() => rows(page, "kept")).toEqual(["SHARED-0", "VIA-KEPT"]);

    await page.evaluate(() => (window as any).__gc.unmount("gone"));
    await settleAndCollect(page);

    // 残ったツリーが配列と ListIndex を生かし続けていても、外した側の要素は回収される
    expect(await survivors(page, "gone")).toEqual({ host: false, state: false });
    expect(await survivors(page, "kept")).toEqual({ host: true, state: true });

    // 残った側は同じ行で描画・更新を続ける
    await page.evaluate(() => (window as any).__gc.write("kept", 0, "still-alive"));
    await expect.poll(() => rows(page, "kept")).toEqual(["STILL-ALIVE", "VIA-KEPT"]);
    expect(errors).toEqual([]);
  });
});
