import { test, expect, type Page, type Route, type WebSocketRoute } from "@playwright/test";
import { collectErrors } from "./helpers";

// examples/state-custom-states — I/O ノードが自分の真偽の出力（loading / error /
// connected）を CustomStateSet に写し、ページの CSS が `:state()` だけでスピナー・
// エラーバナー・接続ドットを描き分けるデモ。<wcs-state> のスクリプトはそれらを
// 一度も読まない（束ねるのは <wcs-fetch> の url / value と <wcs-ws> の url と
// 2 つのコマンドだけ）。
//
// デモ自身のサーバー（server.js）は /api/widgets のモックと ws://…/ws を持つが、
// ここでは serve.mjs で配り、/api/widgets を page.route()（server.js と同じ形・
// 応答のタイミングはテストが握る）、/ws を page.routeWebSocket() で差し替える。
//
// この spec が固定するもの:
//  - <wcs-fetch> の :state(loading) でスピナーが出てリストが薄くなり、
//    :state(error) で節のバナー・カードの色・上部の共有バナー（:has()）が出る
//  - <wcs-ws> の :state(loading) / :state(connected) / :state(error) でドットと
//    カードが変わる。Disconnect / Reconnect は command-token（$command.* →
//    command.close: / command.connect:）で <wcs-ws> の close() / connect() に届く
//  - debug-states で data-wcs-state-* が状態を写す。"Show the CSS" は効いている CSS そのもの

const PAGE = "/examples/state-custom-states/";

// examples/state-custom-states/server.js のモックデータ
const WIDGETS = [
  { id: 1, name: "Torque Wrench", stock: 42 },
  { id: 2, name: "Ball Bearing 6203", stock: 318 },
  { id: 3, name: "Hex Bolt M8x40", stock: 1200 },
  { id: 4, name: "Gasket Set", stock: 76 },
  { id: 5, name: "Hydraulic Hose 2m", stock: 19 },
];

// CSS 変数の計算値（index.html の :root）
const OK = "rgb(22, 163, 74)"; // --ok #16a34a
const PENDING = "rgb(217, 119, 6)"; // --pending #d97706
const IDLE_DOT = "rgb(156, 163, 175)"; // .status-dot の既定 #9ca3af
const DANGER_BG = "rgb(252, 228, 236)"; // --danger-bg #fce4ec
const DANGER_BORDER = "rgb(248, 187, 208)"; // --danger-border #f8bbd0
const WS_CARD_BG = "rgb(250, 250, 250)"; // .ws-card の既定 #fafafa

// 失敗モードの 500 応答（デモ自身のサーバーも 500 を返す）に Chromium が出す
// リソース読み込み失敗のログ。デモが意図して起こす失敗なので、これだけ除く。
const isFail500Log = (e: string) =>
  e.startsWith("console.error: Failed to load resource: the server responded with a status of 500");

type PendingRequest = { mode: string; attempt: number; route: Route };

/** /api/widgets をモックし、応答はテストが respond() で返す（server.js と同じ形） */
async function mockWidgets(page: Page) {
  const pending: PendingRequest[] = [];
  const seen: string[] = [];
  await page.route(/\/api\/widgets\?/, (route) => {
    const url = new URL(route.request().url());
    seen.push(url.search);
    pending.push({ mode: url.searchParams.get("mode") ?? "", attempt: Number(url.searchParams.get("attempt")), route });
  });
  return {
    seen,
    /** 次の要求が届くのを待ち、その mode / attempt を返す（まだ応答しない） */
    async next(): Promise<PendingRequest> {
      await expect.poll(() => pending.length).toBeGreaterThan(0);
      return pending[0];
    },
    /** 先頭の保留中の要求に応答する */
    async respond(): Promise<void> {
      const req = pending.shift()!;
      if (req.mode === "fail") {
        await req.route.fulfill({
          status: 500,
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({ error: "Warehouse service unavailable (simulated failure)." }),
        });
      } else {
        await req.route.fulfill({ status: 200, contentType: "application/json; charset=utf-8", body: JSON.stringify(WIDGETS) });
      }
    },
  };
}

/**
 * ws://…/ws をモックする。既定は接続を受け付けるだけ。
 *  - hold: release() までに張られたソケットの open を止めておく（ハンドラが返るまで
 *    ページ側のソケットは CONNECTING のまま。返ると open が飛ぶ）
 *  - refuse が true の間は本物のサーバーへ繋ぐ。serve.mjs は WebSocket を受けないので
 *    ハンドシェイクが失敗し、ページ側に error と close が届く
 */
async function mockSocket(page: Page, { hold = false, refuse = false } = {}) {
  const sockets: WebSocketRoute[] = [];
  const closedByPage = new Set<WebSocketRoute>();
  let release: () => void = () => {};
  const gate = hold ? new Promise<void>((r) => { release = r; }) : Promise.resolve();
  const ctl = {
    sockets,
    closedByPage,
    refuse,
    release: () => release(),
    latest: () => sockets[sockets.length - 1],
  };
  await page.routeWebSocket(/\/ws$/, async (ws) => {
    sockets.push(ws);
    // onClose を付けると既定の転送が止まるので、ページ側の close イベントは自分で返す
    ws.onClose((code, reason) => {
      closedByPage.add(ws);
      void ws.close({ code, reason });
    });
    if (ctl.refuse) {
      ws.connectToServer();
      return;
    }
    await gate;
  });
  return ctl;
}

const matchesState = (page: Page, selector: string, state: string) =>
  page.locator(selector).evaluate((el, s) => el.matches(`:state(${s})`), state);

test.describe("examples/state-custom-states — <wcs-fetch> の :state()", () => {
  test("loading でスピナーと薄いリスト、error で節・カード・上部の共有バナー（:has()）が出る", async ({ page }) => {
    const errors = collectErrors(page);
    const api = await mockWidgets(page);
    await mockSocket(page);
    await page.goto(PAGE);

    const fetchEl = "#widgets-fetch";
    const card = page.locator("section.demo-card").nth(0);
    const spinner = page.locator(".spinner");
    const list = page.locator(".widget-list");
    const items = page.locator(".widget-list li.widget-item");
    const banner = page.locator(".error-banner");
    const globalBanner = page.locator(".global-error-banner");

    // 初回: ページを開くと 1 回だけ取得する（mode=fast, attempt=0）
    const first = await api.next();
    expect([first.mode, first.attempt]).toEqual(["fast", 0]);
    await expect.poll(() => matchesState(page, fetchEl, "loading")).toBe(true);
    await expect(spinner).toHaveCSS("display", "flex");
    await expect(list).toHaveCSS("opacity", "0.35");
    await expect(page.locator(".empty-hint")).toBeVisible();
    await expect(banner).toBeHidden();
    await expect(globalBanner).toBeHidden();

    await api.respond();
    await expect.poll(() => matchesState(page, fetchEl, "loading")).toBe(false);
    await expect(spinner).toHaveCSS("display", "none");
    await expect(list).toHaveCSS("opacity", "1");
    await expect(items.locator("span:first-child")).toHaveText(WIDGETS.map((w) => w.name));
    await expect(items.locator(".stock")).toHaveText(WIDGETS.map((w) => String(w.stock)));
    await expect(page.locator(".empty-hint")).toHaveCount(0);

    // 再取得中は前のリストを残したまま薄くする
    await page.getByRole("button", { name: /Load \(slow/ }).click();
    const slow = await api.next();
    expect([slow.mode, slow.attempt]).toEqual(["slow", 1]);
    await expect(spinner).toHaveCSS("display", "flex");
    await expect(list).toHaveCSS("opacity", "0.35");
    await expect(items).toHaveCount(WIDGETS.length);
    await api.respond();
    await expect(spinner).toHaveCSS("display", "none");
    await expect(list).toHaveCSS("opacity", "1");

    // 失敗: :state(error) — 節のバナー、カードの色、上部の共有バナー（:has() でしか届かない）
    await page.getByRole("button", { name: "Load (fails)" }).click();
    const fail = await api.next();
    expect([fail.mode, fail.attempt]).toEqual(["fail", 2]);
    await expect(spinner).toHaveCSS("display", "flex");
    await api.respond();
    await expect.poll(() => matchesState(page, fetchEl, "error")).toBe(true);
    expect(await matchesState(page, fetchEl, "loading")).toBe(false);
    await expect(spinner).toHaveCSS("display", "none");
    await expect(banner).toBeVisible();
    await expect(card).toHaveCSS("background-color", DANGER_BG);
    await expect(card).toHaveCSS("border-top-color", DANGER_BORDER);
    await expect(globalBanner).toBeVisible();
    // HTTP エラーで <wcs-fetch> の value は null に戻り、リストは空の案内になる
    await expect(items).toHaveCount(0);
    await expect(page.locator(".empty-hint")).toBeVisible();

    // 取り直すと error は要求の開始で消え、成功でリストが戻る
    await page.getByRole("button", { name: "Load (fast)" }).click();
    const retry = await api.next();
    expect([retry.mode, retry.attempt]).toEqual(["fast", 3]);
    await expect.poll(() => matchesState(page, fetchEl, "error")).toBe(false);
    await expect(banner).toBeHidden();
    await expect(globalBanner).toBeHidden();
    await api.respond();
    await expect(items).toHaveCount(WIDGETS.length);
    await expect(card).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    // url が変わったときだけ取得する（4 回: 初回 + 3 クリック）
    expect(api.seen).toEqual([
      "?mode=fast&attempt=0",
      "?mode=slow&attempt=1",
      "?mode=fail&attempt=2",
      "?mode=fast&attempt=3",
    ]);
    expect(errors.filter((e) => !isFail500Log(e))).toEqual([]);
  });
});

test.describe("examples/state-custom-states — <wcs-ws> の :state()", () => {
  test("接続中は amber、open で green。Disconnect / Reconnect が close() / connect() に届く", async ({ page }) => {
    const errors = collectErrors(page);
    const api = await mockWidgets(page);
    const socket = await mockSocket(page, { hold: true });
    await page.goto(PAGE);
    await api.next();
    await api.respond();

    const wsEl = "#ws-conn";
    const dot = page.locator(".ws-card .status-dot");

    // ハンドシェイク中: :state(loading)
    await expect.poll(() => socket.sockets.length).toBe(1);
    await expect.poll(() => matchesState(page, wsEl, "loading")).toBe(true);
    expect(await matchesState(page, wsEl, "connected")).toBe(false);
    await expect(dot).toHaveCSS("background-color", PENDING);

    // open: :state(connected)
    socket.release();
    await expect.poll(() => matchesState(page, wsEl, "connected")).toBe(true);
    expect(await matchesState(page, wsEl, "loading")).toBe(false);
    await expect(dot).toHaveCSS("background-color", OK);
    expect(socket.sockets.length).toBe(1);
    const live = socket.latest();
    expect(socket.closedByPage.has(live)).toBe(false);

    // Disconnect → $command.disconnectWs → <wcs-ws>.close(): ページ側から今のソケットを閉じる
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect.poll(() => socket.closedByPage.has(live)).toBe(true);
    await expect.poll(() => matchesState(page, wsEl, "connected")).toBe(false);
    expect(await matchesState(page, wsEl, "loading")).toBe(false);
    await expect(dot).toHaveCSS("background-color", IDLE_DOT);

    // Reconnect → $command.reconnectWs → <wcs-ws>.connect(): 新しいソケットを 1 本開く
    await page.getByRole("button", { name: "Reconnect" }).click();
    await expect.poll(() => socket.sockets.length).toBe(2);
    await expect.poll(() => matchesState(page, wsEl, "connected")).toBe(true);
    await expect(dot).toHaveCSS("background-color", OK);

    // サーバー側から閉じても connected が外れる（auto-reconnect は付けていない）
    await socket.latest().close();
    await expect.poll(() => matchesState(page, wsEl, "connected")).toBe(false);
    await expect(dot).toHaveCSS("background-color", IDLE_DOT);
    expect(socket.sockets.length).toBe(2);

    // ws の状態は fetch の節にもエラーの共有バナーにも漏れない
    await expect(page.locator(".global-error-banner")).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("接続に失敗すると :state(error) でカードが赤くなり、上部の共有バナーが出る。Reconnect で戻る", async ({ page }) => {
    const errors = collectErrors(page);
    const api = await mockWidgets(page);
    // 最初は本物のサーバーへ通す: serve.mjs は WebSocket を受けないので、ハンドシェイクが失敗する
    const socket = await mockSocket(page, { refuse: true });
    await page.goto(PAGE);
    await api.next();
    await api.respond();

    const wsEl = "#ws-conn";
    const wsCard = page.locator(".ws-card");
    await expect.poll(() => matchesState(page, wsEl, "error")).toBe(true);
    await expect.poll(() => matchesState(page, wsEl, "loading")).toBe(false);
    expect(await matchesState(page, wsEl, "connected")).toBe(false);
    await expect(wsCard).toHaveCSS("background-color", DANGER_BG);
    await expect(wsCard).toHaveCSS("border-top-color", DANGER_BORDER);
    await expect(page.locator(".global-error-banner")).toBeVisible();
    // fetch の節は成功しているので、その節のバナーは出ない
    await expect(page.locator(".error-banner")).toBeHidden();

    // 受け付けるようにして Reconnect: 接続の開始で error が外れ、open で green
    expect(socket.sockets.length).toBe(1);
    socket.refuse = false;
    await page.getByRole("button", { name: "Reconnect" }).click();
    await expect.poll(() => socket.sockets.length).toBe(2);
    await expect.poll(() => matchesState(page, wsEl, "connected")).toBe(true);
    expect(await matchesState(page, wsEl, "error")).toBe(false);
    await expect(page.locator(".ws-card .status-dot")).toHaveCSS("background-color", OK);
    await expect(wsCard).toHaveCSS("background-color", WS_CARD_BG);
    await expect(page.locator(".global-error-banner")).toBeHidden();

    // 意図して起こした接続失敗について Chromium が出すログだけを除く
    expect(errors.filter((e) => !/WebSocket connection to 'ws:\/\/[^']+\/ws' failed/.test(e))).toEqual([]);
  });

  // 二重接続の回帰（@wcstack/websocket で修正）: 以前の <wcs-ws> は url 属性が同じ値で
  // 書かれても connect() し直し、state の `url:` は url の setter 自身の setAttribute と
  // inputs[].attribute ミラー（packages/state/README.md「Inputs and Attribute Mirror」）の
  // setAttribute とで 2 回書くので、ソケットを 2 本張って 1 本目を CONNECTING のまま閉じていた。
  test("ページを開いたときに張るソケットは 1 本で、閉じられない", async ({ page }) => {
    const errors = collectErrors(page);
    const api = await mockWidgets(page);
    const socket = await mockSocket(page);
    await page.goto(PAGE);
    await api.next();
    await api.respond();
    await expect.poll(() => matchesState(page, "#ws-conn", "connected")).toBe(true);
    expect(socket.sockets.length).toBe(1);
    expect(socket.closedByPage.size).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe("examples/state-custom-states — 観察の補助", () => {
  test("debug-states で data-wcs-state-* が状態を写し、Show the CSS は効いている CSS そのもの", async ({ page }) => {
    const errors = collectErrors(page);
    const api = await mockWidgets(page);
    const socket = await mockSocket(page);
    await page.goto(PAGE);
    await api.next();
    await api.respond();
    await expect.poll(() => matchesState(page, "#ws-conn", "connected")).toBe(true);

    const fetchEl = page.locator("#widgets-fetch");
    const wsEl = page.locator("#ws-conn");
    await page.locator("#debug-toggle").check();
    await expect(fetchEl).toHaveAttribute("debug-states", "");
    await expect(wsEl).toHaveAttribute("debug-states", "");

    // 以後の状態の変化が属性に写る（:state() はスタイルに、属性は観察だけに）
    await page.getByRole("button", { name: "Load (fast)" }).click();
    await api.next();
    await expect(fetchEl).toHaveAttribute("data-wcs-state-loading", "");
    await api.respond();
    await expect(fetchEl).not.toHaveAttribute("data-wcs-state-loading");

    // （有効にした時点で接続済みなので、属性はまだ無い — 写すのは以後の変化だけ）
    await expect(wsEl).not.toHaveAttribute("data-wcs-state-connected");
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect.poll(() => matchesState(page, "#ws-conn", "connected")).toBe(false);
    await expect(wsEl).not.toHaveAttribute("data-wcs-state-connected");
    await page.getByRole("button", { name: "Reconnect" }).click();
    await expect.poll(() => socket.sockets.length).toBe(2);
    await expect(wsEl).toHaveAttribute("data-wcs-state-connected", "");

    // 外すと、以後の変化は属性に写らない
    await page.locator("#debug-toggle").uncheck();
    await expect(fetchEl).not.toHaveAttribute("debug-states");
    await page.getByRole("button", { name: "Disconnect" }).click();
    await expect.poll(() => matchesState(page, "#ws-conn", "connected")).toBe(false);
    await expect(wsEl).toHaveAttribute("data-wcs-state-connected", "");

    // "Show the CSS" は <style id="state-css"> の本文の写し
    await page.locator("details.css-reveal summary").click();
    const shown = await page.locator("#css-source").textContent();
    const applied = await page.locator("#state-css").evaluate((s) => s.textContent!.trim());
    expect(shown).toBe(applied);
    expect(shown).toContain("#widgets-fetch:state(loading) ~ .spinner");
    expect(errors).toEqual([]);
  });
});
