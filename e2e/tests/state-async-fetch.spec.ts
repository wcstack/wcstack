import { test, expect, type Page, type Route } from "@playwright/test";
import { collectErrors } from "./helpers";

// state 単体: async メソッドから fetch() して、`isLoading` / `posts` / `message` の 3 つの
// キーで「読み込み中 → 一覧 / 空 / エラー」を if / else の入れ子で出し分けるデモ。
// `$connectedCallback` で初回を読み、Refresh Posts で読み直す。
//
// デモは外部 API（jsonplaceholder.typicode.com）を読むが、テストはインターネットに
// 依存しない: page.route() でその URL を横取りし、応答をテストごとに決める。
// クロスオリジンの fetch なので、応答には Access-Control-Allow-Origin を付ける。
//
// この spec が固定するもの:
//  - 応答を保留している間は Loading... だけが出て、届くと先頭 5 件が描かれる
//    （title と、100 文字で切った body + "..."）
//  - HTTP エラー・ネットワークエラー・配列でない応答・空配列のそれぞれで出る文言
//  - Refresh Posts でふたたび Loading... を経て、新しい応答に置き換わる（エラーからの回復を含む）

const API = "https://jsonplaceholder.typicode.com/posts";
const CORS = { "access-control-allow-origin": "*" };

type Post = { userId: number; id: number; title: string; body: string };

function makePosts(count: number, tag: string): Post[] {
  return Array.from({ length: count }, (_, i) => ({
    userId: 1,
    id: i + 1,
    title: `${tag} title ${i + 1}`,
    // 偶数番は 100 文字を超える本文（切られる）、奇数番は短い本文（そのまま）
    body: i % 2 === 0
      ? `${tag} long body ${i + 1} `.padEnd(140, "x")
      : `${tag} short body ${i + 1}`,
  }));
}

// 1 件の <li> の表示: <strong>title</strong><br/> body の先頭 100 文字 + "..."
function expectedItem(p: Post): string {
  return `${p.title} ${p.body.slice(0, 100)}...`;
}

async function readItems(page: Page): Promise<string[]> {
  return page.$$eval(".example-container li", (lis) =>
    lis.map((li) => li.textContent!.replace(/\s+/g, " ").trim()));
}

/** 応答を手で放すまで保留するハンドラ。release(fulfill) で応答を返す。 */
function holdRoute(page: Page) {
  const pending: Array<(fn: (route: Route) => Promise<void>) => Promise<void>> = [];
  let arrived = 0;
  const ready = page.route(API, async (route) => {
    arrived++;
    await new Promise<void>((resolve) => {
      pending.push(async (fn) => { await fn(route); resolve(); });
    });
  });
  return {
    ready,
    arrived: () => arrived,
    async release(fn: (route: Route) => Promise<void>) {
      await expect.poll(() => pending.length).toBeGreaterThan(0);
      await pending.shift()!(fn);
    },
  };
}

const json = (body: unknown, status = 200) => (route: Route) =>
  route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

// 注入した HTTP エラー / 遮断に対して出る想定内のコンソール出力:
//  - Chromium 自身の "Failed to load resource"（4xx/5xx・遮断した要求）
//  - デモの catch 節の console.error('Error fetching posts:', e)
//    （エラー経路を通ったことの証拠でもあるので、件数はテストで別に確かめる）
function appErrors(errors: string[]): string[] {
  return errors.filter((e) => !/Failed to load resource/.test(e) && !/Error fetching posts:/.test(e));
}

const loading = (page: Page) => page.getByText("Loading...", { exact: true });
const refresh = (page: Page) => page.getByRole("button", { name: "Refresh Posts" });

test.describe("packages/state/examples/async-fetch", () => {
  test("読み込み中は Loading... だけを出し、届いたら先頭 5 件を title と切った body で描く", async ({ page }) => {
    const errors = collectErrors(page);
    const api = holdRoute(page);
    await api.ready;
    await page.goto("/packages/state/examples/async-fetch/");

    // $connectedCallback の fetch が保留中: Loading... だけ
    await expect(loading(page)).toBeVisible();
    await expect(page.locator(".example-container li")).toHaveCount(0);
    await expect(page.getByText("No posts found.")).toHaveCount(0);

    const posts = makePosts(8, "first");
    await api.release(json(posts));
    await expect(loading(page)).toHaveCount(0);
    await expect.poll(() => readItems(page)).toEqual(posts.slice(0, 5).map(expectedItem));
    await expect(page.locator(".example-container li strong")).toHaveText(posts.slice(0, 5).map((p) => p.title));
    await expect(page.getByText("No posts found.")).toHaveCount(0);
    expect(api.arrived()).toBe(1);

    expect(errors).toEqual([]);
  });

  test("Refresh Posts でふたたび Loading... を経て、新しい応答に置き換わる", async ({ page }) => {
    const errors = collectErrors(page);
    const api = holdRoute(page);
    await api.ready;
    await page.goto("/packages/state/examples/async-fetch/");

    const first = makePosts(5, "first");
    await api.release(json(first));
    await expect.poll(() => readItems(page)).toEqual(first.map(expectedItem));

    await refresh(page).click();
    await expect(loading(page)).toBeVisible();
    await expect(page.locator(".example-container li")).toHaveCount(0);

    // 5 件に満たない応答はその件数だけ描く
    const second = makePosts(3, "second");
    await api.release(json(second));
    await expect(loading(page)).toHaveCount(0);
    await expect.poll(() => readItems(page)).toEqual(second.map(expectedItem));

    // 空配列: 一覧の枝が else に切り替わり、既定の文言を出す
    await refresh(page).click();
    await api.release(json([]));
    await expect(page.getByText("No posts found.", { exact: true })).toBeVisible();
    await expect(page.locator(".example-container li")).toHaveCount(0);
    await expect(loading(page)).toHaveCount(0);
    expect(api.arrived()).toBe(3);

    expect(errors).toEqual([]);
  });

  test("HTTP エラーではステータス付きの文言を出し、Refresh で回復する", async ({ page }) => {
    const errors = collectErrors(page);
    const api = holdRoute(page);
    await api.ready;
    await page.goto("/packages/state/examples/async-fetch/");

    await api.release(json({ error: "boom" }, 500));
    await expect(page.getByText("Failed to fetch posts. 500", { exact: true })).toBeVisible();
    await expect(loading(page)).toHaveCount(0);
    await expect(page.locator(".example-container li")).toHaveCount(0);

    await refresh(page).click();
    await expect(loading(page)).toBeVisible();
    const posts = makePosts(6, "retry");
    await api.release(json(posts));
    await expect.poll(() => readItems(page)).toEqual(posts.slice(0, 5).map(expectedItem));
    await expect(page.getByText("Failed to fetch posts. 500")).toHaveCount(0);

    // エラー経路をちょうど 1 回通った（デモの catch 節の console.error）
    expect(errors.filter((e) => /Error fetching posts:/.test(e))).toHaveLength(1);
    expect(appErrors(errors)).toEqual([]);
  });

  test("ネットワークエラーでは fetch の例外の文言を出す", async ({ page }) => {
    const errors = collectErrors(page);
    const api = holdRoute(page);
    await api.ready;
    await page.goto("/packages/state/examples/async-fetch/");

    await api.release((route) => route.abort("connectionrefused"));
    // Chromium の fetch() は遮断を TypeError("Failed to fetch") で reject する
    await expect(page.getByText("Failed to fetch", { exact: true })).toBeVisible();
    await expect(loading(page)).toHaveCount(0);
    await expect(page.locator(".example-container li")).toHaveCount(0);

    expect(errors.filter((e) => /Error fetching posts:/.test(e))).toHaveLength(1);
    expect(appErrors(errors)).toEqual([]);
  });

  test("配列でない応答は一覧を空にして、応答の message（無ければ既定の文言）を出す", async ({ page }) => {
    const errors = collectErrors(page);
    const api = holdRoute(page);
    await api.ready;
    await page.goto("/packages/state/examples/async-fetch/");

    const posts = makePosts(5, "ok");
    await api.release(json(posts));
    await expect.poll(() => readItems(page)).toEqual(posts.map(expectedItem));

    // 200 だが配列でない: 一覧は空にされ、message を出す
    await refresh(page).click();
    await api.release(json({ message: "Rate limit exceeded" }));
    await expect(page.getByText("Rate limit exceeded", { exact: true })).toBeVisible();
    await expect(page.locator(".example-container li")).toHaveCount(0);

    // message の無いオブジェクト
    await refresh(page).click();
    await api.release(json({}));
    await expect(page.getByText("Failed to fetch posts.", { exact: true })).toBeVisible();
    await expect(page.locator(".example-container li")).toHaveCount(0);

    // この経路は例外ではないので console.error は出ない
    expect(errors).toEqual([]);
  });
});
