import { test, expect, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

// state: spread バインディング (`...: path`)。wc-bindable を宣言したモック要素 <fake-fetch> の
// properties + inputs 全部を 1 行で配線する。ページ直下の単独 spread、for: の行ごとの
// `...: storesFetches.*`、spread の後ろの明示バインディングが勝つ後勝ち上書きの 3 形を示す。
// 状態の値が要素のプロパティへ届くこと (inputs) に加えて、要素が自分の値を変えてイベントを
// dispatch すると状態へ書き戻され (properties)、同じパスを spread する別の要素へ届くことを
// 実ブラウザで固定する。デモの要素は value / loading / error / status を properties と inputs の
// 両方に宣言しているので、初期同期の authority は state (デモ冒頭のコメントどおり)。
const PAGE = "/packages/state/examples/spread/";

// デモの状態の初期値
const USERS_FETCH = {
  url: "/api/users", method: "GET", value: { items: [{ id: 1, name: "Alice" }] },
  loading: false, error: null, status: 200,
};
const STORES_FETCHES = [
  { url: "/api/store/a", method: "GET", value: "store A data", loading: false, error: null, status: 200 },
  { url: "/api/store/b", method: "GET", value: "store B data", loading: true, error: null, status: null },
  { url: "/api/store/c", method: "POST", value: null, loading: false, error: "timeout", status: 504 },
];
const MEMBERS = ["url", "method", "value", "loading", "error", "status"] as const;

// <fake-fetch> の render() が出す文字列 (デモの要素の表示形式)
type Fetch = { url: string; method: string; value: unknown; loading: boolean; status: number | null };
const display = (f: Fetch) =>
  `[${f.method} ${f.url}] value=${JSON.stringify(f.value)} loading=${f.loading} status=${f.status}`;

const single = (page: Page) => page.locator("fake-fetch").nth(0);
const rowEls = (page: Page) => page.locator("li fake-fetch");
const overridden = (page: Page) => page.locator("fake-fetch").nth(4);

// 要素の wc-bindable メンバーの現在値を読む
async function props(page: Page, nth: number) {
  return page.locator("fake-fetch").nth(nth).evaluate((el: any, names) =>
    Object.fromEntries(names.map((n: string) => [n, el[n]])), [...MEMBERS]);
}

// 状態の値を公開 API (createState の readonly) で読む
async function readState(page: Page, path: string) {
  return page.evaluate((p) => {
    let v: unknown;
    (document.querySelector("wcs-state") as any).createState("readonly", (s: any) => {
      v = JSON.parse(JSON.stringify(s[p] ?? null));
    });
    return v;
  }, path);
}

// 実際の I/O ノードと同じく、要素が自分のプロパティを変えてから変更イベントを dispatch する
async function emit(page: Page, nth: number, name: string, value: unknown) {
  await page.locator("fake-fetch").nth(nth).evaluate((el: any, [n, v]) => {
    el[n as string] = v;
    el.dispatchEvent(new CustomEvent(`fake-fetch:${n}-changed`, { detail: v }));
  }, [name, value] as const);
}

test.describe("packages/state/examples/spread", () => {
  test("単独の spread で properties + inputs の 6 メンバーすべてに状態の値が入る", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    await expect(page.locator("fake-fetch")).toHaveCount(5);
    await expect(single(page)).toHaveText(display(USERS_FETCH));
    expect(await props(page, 0)).toEqual(USERS_FETCH);
    // ページ直下の要素は data-wcs をそのまま持つ (行の要素からは外れる — 次のテスト)
    await expect(single(page)).toHaveAttribute("data-wcs", "...: usersFetch");

    expect(errors).toEqual([]);
  });

  test("for: の中の `...: storesFetches.*` が行ごとに自分の要素を配線する", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    await expect(rowEls(page)).toHaveText(STORES_FETCHES.map(display));
    for (let i = 0; i < STORES_FETCHES.length; i++) {
      // error は表示されないので、プロパティで確かめる (3 行目だけ "timeout")
      expect(await props(page, 1 + i)).toEqual(STORES_FETCHES[i]);
    }
    // 4.0 は行のために複製した要素から data-wcs を外す (migration-v4 §3.4)
    for (const el of await rowEls(page).all()) await expect(el).not.toHaveAttribute("data-wcs");

    expect(errors).toEqual([]);
  });

  test("spread の後ろの明示バインディング (status: overriddenStatus) が後勝ちする", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);

    await expect(overridden(page)).toHaveText(display({ ...USERS_FETCH, status: 418 }));
    expect(await props(page, 4)).toEqual({ ...USERS_FETCH, status: 418 });

    expect(errors).toEqual([]);
  });

  test("要素が出した値は状態へ書き戻され、同じパスを spread する別の要素に届く (上書きしたメンバーは除く)", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);
    await expect(single(page)).toHaveText(display(USERS_FETCH));
    await expect(overridden(page)).toHaveText(display({ ...USERS_FETCH, status: 418 }));

    // 単独 spread の要素が新しい value を出す → usersFetch.value → 上書き側の要素にも届く
    const next = { items: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] };
    await emit(page, 0, "value", next);
    await expect.poll(() => readState(page, "usersFetch.value")).toEqual(next);
    await expect(overridden(page)).toHaveText(display({ ...USERS_FETCH, value: next, status: 418 }));

    // status を出す → usersFetch.status は変わるが、上書き側の status は overriddenStatus のまま
    await emit(page, 0, "status", 201);
    await expect.poll(() => readState(page, "usersFetch.status")).toBe(201);
    await expect(single(page)).toHaveText(display({ ...USERS_FETCH, value: next, status: 201 }));
    await expect(overridden(page)).toHaveText(display({ ...USERS_FETCH, value: next, status: 418 }));
    await expect.poll(() => readState(page, "overriddenStatus")).toBe(418);

    // 上書き側の要素が status を出すと、書き戻し先は明示バインディングのパス (overriddenStatus)
    await emit(page, 4, "status", 451);
    await expect.poll(() => readState(page, "overriddenStatus")).toBe(451);
    await expect.poll(() => readState(page, "usersFetch.status")).toBe(201);
    await expect(single(page)).toHaveText(display({ ...USERS_FETCH, value: next, status: 201 }));

    expect(errors).toEqual([]);
  });

  test("行の要素が出した値はその行のパスにだけ書き戻される", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto(PAGE);
    await expect(rowEls(page)).toHaveText(STORES_FETCHES.map(display));

    // 2 行目の読み込みが終わる: loading=false, status=200, value を更新
    await emit(page, 2, "loading", false);
    await emit(page, 2, "status", 200);
    await emit(page, 2, "value", "store B ready");
    await expect.poll(() => readState(page, "storesFetches.1")).toEqual({
      ...STORES_FETCHES[1], loading: false, status: 200, value: "store B ready",
    });
    // ほかの行は変わらない
    await expect.poll(() => readState(page, "storesFetches.0")).toEqual(STORES_FETCHES[0]);
    await expect.poll(() => readState(page, "storesFetches.2")).toEqual(STORES_FETCHES[2]);
    await expect(rowEls(page)).toHaveText([
      display(STORES_FETCHES[0]),
      display({ ...STORES_FETCHES[1], loading: false, status: 200, value: "store B ready" }),
      display(STORES_FETCHES[2]),
    ]);

    // 3 行目の error が消える
    await emit(page, 3, "error", null);
    await expect.poll(() => readState(page, "storesFetches.2.error")).toBe(null);

    expect(errors).toEqual([]);
  });
});
