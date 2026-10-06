import { test, expect, type Page, type Route } from "@playwright/test";
import { collectErrors } from "./helpers";

// examples/signals-live-search の実ブラウザテスト。
//
// デモは @wcstack/signals（state ではない）の 2 部構成:
//   1. <signal-counter> — SignalsElement を基底にした custom element。count signal と
//      computed（×2）を h() で描く。
//   2. ライブ検索 — mountNode("wcs-fetch") で作った本物の <wcs-fetch> の `url` を
//      query signal から effect で書き、wc-bindable アダプタが value / loading を
//      signal に畳み戻す。結果は For（キー付き）で <li> を描く。
//
// /api/people はデモ自身の server.js（port 3000 固定）が返すもので、serve.mjs には
// 無い。ここでは page.route() で横取りし、server.js と同じ形（名前の部分一致・
// 大文字小文字無視、空クエリで全件）を返す。応答を保留できるので、loading 表示と
// 「打ち直したら古い要求は捨てられる」（FetchCore の supersede）を決定的に見られる。
//
// @wcstack/signals/dom は serve.mjs が /packages/signals/dist/dom.esm.js に書き換える
// （import map 内の URL）。

const PEOPLE = [
  { id: 1, name: "Ada Lovelace", role: "admin" },
  { id: 2, name: "Linus Torvalds", role: "editor" },
  { id: 3, name: "Grace Hopper", role: "admin" },
  { id: 4, name: "Alan Turing", role: "viewer" },
  { id: 5, name: "Margaret Hamilton", role: "editor" },
  { id: 6, name: "Dennis Ritchie", role: "editor" },
  { id: 7, name: "Barbara Liskov", role: "admin" },
  { id: 8, name: "Tim Berners-Lee", role: "viewer" },
  { id: 9, name: "Katherine Johnson", role: "viewer" },
  { id: 10, name: "Donald Knuth", role: "editor" },
];

// server.js と同じ絞り込み。
const search = (q: string) => {
  const needle = q.trim().toLowerCase();
  return needle ? PEOPLE.filter((p) => p.name.toLowerCase().includes(needle)) : PEOPLE;
};

type Hook = (route: Route, q: string | null) => Promise<void> | void;

// /api/people を横取りする。hook が無ければ即座に server.js 相当の JSON を返す。
// 受けた要求の q（無ければ null）を順に記録する。
async function mockPeople(page: Page, hook?: Hook) {
  const seen: (string | null)[] = [];
  await page.route(
    (url) => url.pathname === "/api/people",
    async (route) => {
      const q = new URL(route.request().url()).searchParams.get("q");
      seen.push(q);
      if (hook) return hook(route, q);
      await route.fulfill({ json: search(q ?? "") });
    },
  );
  return seen;
}

const fulfillPeople = (route: Route, q: string | null) =>
  route.fulfill({ json: search(q ?? "") });

test.describe("examples/signals-live-search", () => {
  test("SignalsElement のカウンタが signal と computed で描き直される", async ({ page }) => {
    const errors = collectErrors(page);
    await mockPeople(page);
    await page.goto("/examples/signals-live-search/");

    const counter = page.locator("signal-counter");
    const count = counter.locator("output.count");
    const doubled = counter.locator(".muted");
    await expect(count).toHaveText("0");
    await expect(doubled).toHaveText("×2 = 0");

    await counter.getByRole("button", { name: "increment" }).click();
    await counter.getByRole("button", { name: "increment" }).click();
    await counter.getByRole("button", { name: "increment" }).click();
    await expect(count).toHaveText("3");
    await expect(doubled).toHaveText("×2 = 6");

    await counter.getByRole("button", { name: "decrement" }).click();
    await expect(count).toHaveText("2");
    await expect(doubled).toHaveText("×2 = 4");

    expect(errors).toEqual([]);
  });

  test("初期表示で全件を描き、入力で絞り込み、0 件で空表示、クリアで全件に戻る", async ({ page }) => {
    const errors = collectErrors(page);
    const seen = await mockPeople(page);
    await page.goto("/examples/signals-live-search/");

    const status = page.locator("#search-app .status");
    const empty = page.locator("#search-app .empty");
    const rows = page.locator("#search-app li.person");
    const input = page.locator("#search-app input.search");

    // 初期: クエリなしの URL で 1 回フェッチし、全 10 件を描く。
    await expect(status).toHaveText("10 result(s)");
    await expect(rows).toHaveCount(10);
    await expect(rows.locator(".name")).toHaveText(PEOPLE.map((p) => p.name));
    await expect(rows.first().locator(".role")).toHaveText("admin");
    await expect(empty).toHaveText("");
    expect(seen[0]).toBeNull();

    // For はキー（id）で行を持ち続ける: 絞り込みで残る行は同じ <li> のまま。
    await rows.filter({ hasText: "Linus Torvalds" }).evaluate((li) => {
      (li as HTMLElement).dataset.mark = "kept";
    });

    // 入力 → query signal → effect が url を書き換え → 再フェッチ → 絞り込み。
    await input.fill("li");
    const expectedLi = search("li").map((p) => p.name);
    expect(expectedLi).toEqual(["Linus Torvalds", "Barbara Liskov"]);
    await expect(rows.locator(".name")).toHaveText(expectedLi);
    await expect(status).toHaveText(`${expectedLi.length} result(s)`);
    expect(seen.at(-1)).toBe("li");
    await expect(rows.filter({ hasText: "Linus Torvalds" })).toHaveAttribute("data-mark", "kept");

    // URL エンコードされたクエリ（空白・記号）も server 側の q に届く。
    await input.fill("Tim B");
    await expect(rows.locator(".name")).toHaveText(["Tim Berners-Lee"]);
    expect(seen.at(-1)).toBe("Tim B");

    // 0 件: 行は消え、"No matches." が出る。
    await input.fill("zzz");
    await expect(status).toHaveText("0 result(s)");
    await expect(rows).toHaveCount(0);
    await expect(empty).toHaveText("No matches.");

    // クリア: クエリなしの URL に戻り、全件。
    await input.fill("");
    await expect(rows).toHaveCount(10);
    await expect(status).toHaveText("10 result(s)");
    await expect(empty).toHaveText("");
    expect(seen.at(-1)).toBeNull();

    expect(errors).toEqual([]);
  });

  test("応答を待つ間は Loading… を出し、空表示は出さない", async ({ page }) => {
    const errors = collectErrors(page);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await mockPeople(page, async (route, q) => {
      if (q === "grace") await gate;
      await fulfillPeople(route, q);
    });
    await page.goto("/examples/signals-live-search/");

    const status = page.locator("#search-app .status");
    const empty = page.locator("#search-app .empty");
    await expect(status).toHaveText("10 result(s)");

    await page.locator("#search-app input.search").fill("grace");
    await expect(status).toHaveText("Loading…");
    // value は前の結果のまま（loading 中に空表示が点滅しない）。
    await expect(empty).toHaveText("");
    await expect(page.locator("#search-app li.person")).toHaveCount(10);

    release();
    await expect(status).toHaveText("1 result(s)");
    await expect(page.locator("#search-app li.person .name")).toHaveText(["Grace Hopper"]);

    expect(errors).toEqual([]);
  });

  test("打ち直すと古い要求は中断され、遅れて届いても結果を上書きしない", async ({ page }) => {
    const errors = collectErrors(page);
    let releaseStale!: () => void;
    const staleGate = new Promise<void>((r) => (releaseStale = r));
    let staleSettled!: () => void;
    const staleDone = new Promise<void>((r) => (staleSettled = r));
    await mockPeople(page, async (route, q) => {
      if (q === "a") {
        await staleGate;
        // ページ側が中断した要求への fulfill は失敗しうる（既に破棄されている）。
        await route.fulfill({ json: search("a") }).catch(() => {});
        staleSettled();
        return;
      }
      await fulfillPeople(route, q);
    });
    const aborted: string[] = [];
    page.on("requestfailed", (req) => {
      if (new URL(req.url()).pathname === "/api/people") {
        aborted.push(`${new URL(req.url()).searchParams.get("q")}: ${req.failure()?.errorText}`);
      }
    });
    await page.goto("/examples/signals-live-search/");

    const rows = page.locator("#search-app li.person");
    await expect(rows).toHaveCount(10);

    const input = page.locator("#search-app input.search");
    await input.fill("a");                       // 保留される（古い要求）
    await expect(page.locator("#search-app .status")).toHaveText("Loading…");
    await input.fill("ada");                     // 新しい要求が先に返る
    await expect(rows.locator(".name")).toHaveText(["Ada Lovelace"]);
    await expect(page.locator("#search-app .status")).toHaveText("1 result(s)");

    // FetchCore は supersede で古い fetch を AbortController で中断している。
    await expect.poll(() => aborted).toEqual(["a: net::ERR_ABORTED"]);

    // 古い要求を今さら返しても、表示は新しいクエリの結果のまま。
    // 中断済みなので応答はページに届かない。fulfill の決着後、2 フレーム回して
    // 仮に届いていた場合の描画も済ませてから確かめる。
    releaseStale();
    await staleDone;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(rows.locator(".name")).toHaveText(["Ada Lovelace"]);
    await expect(page.locator("#search-app .status")).toHaveText("1 result(s)");

    expect(errors).toEqual([]);
  });

  test("HTTP エラーでは value が null に戻り 0 件表示になり、次の検索で回復する", async ({ page }) => {
    // このページはエラー専用の表示を持たない（status / empty の 2 行だけ）。
    // FetchCore は HTTP エラーで value を null に戻すので、people は [] になり
    // "0 result(s)" / "No matches." と出る。ここではそれ以上の描画が壊れないことと、
    // 次のクエリで回復することを固定する。
    const errors = collectErrors(page);
    await mockPeople(page, async (route, q) => {
      if (q === "boom") {
        await route.fulfill({ status: 500, json: { error: "boom" } });
        return;
      }
      await fulfillPeople(route, q);
    });
    await page.goto("/examples/signals-live-search/");

    const rows = page.locator("#search-app li.person");
    const status = page.locator("#search-app .status");
    await expect(rows).toHaveCount(10);

    await page.locator("#search-app input.search").fill("boom");
    await expect(status).toHaveText("0 result(s)");
    await expect(rows).toHaveCount(0);
    await expect(page.locator("#search-app .empty")).toHaveText("No matches.");

    await page.locator("#search-app input.search").fill("knuth");
    await expect(rows.locator(".name")).toHaveText(["Donald Knuth"]);
    await expect(status).toHaveText("1 result(s)");

    // 500 応答はブラウザ自身が "Failed to load resource" を console.error に出す。
    // ページのコードの失敗ではないのでこの 1 件だけ除く。
    expect(
      errors.filter((e) => !/Failed to load resource: the server responded with a status of 500/.test(e)),
    ).toEqual([]);
  });
});
