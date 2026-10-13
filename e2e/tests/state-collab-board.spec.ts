import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/state-collab-board — state + sse + fetch + storage + network の共有ボード。
// 主題は継ぎ目: スナップショット（GET /api/cards）とイベントストリーム（SSE）と
// 自分の楽観的な変更を一枚の盤面に重ね、二人の利用者・拒まれた変更・切れた接続・
// オフラインのどれを通っても、盤面がサーバーと一致する（欠けも重複もない）こと。
// この spec はその意図を実ブラウザで固定する: 二つのブラウザコンテキストが二人の
// 利用者、context.setOffline がオフライン、デモの試験用エンドポイント
// （fail-next / drop-streams）が拒否と再接続を起こす。
//
// SSE とカードの API はデモ自身の server.js が持つので、router-spa と同じく
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）でワーカーごとに別ポートで
// 立てる。カードはメモリにあるので、各テストの前に /api/test/reset で初期の 6 枚に戻す。
const PORT = 4800 + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

type Card = { id: number; title: string; column: "todo" | "doing" | "done"; order: number; version: number; updatedBy: string };
type Board = { todo: string[]; doing: string[]; done: string[] };

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/state-collab-board/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error("demo server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Demo server running")) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    server.on("error", (err) => { clearTimeout(timer); rejectReady(err); });
    server.on("exit", (code) => { clearTimeout(timer); rejectReady(new Error(`demo server exited with ${code}`)); });
  });
});

// 子プロセスが終わるまで待つ: 同じワーカーで次に立てるサーバーが同じポートを使う。
test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill();
  await exited;
});

test.beforeEach(async () => {
  expect((await api("POST", "/api/test/reset")).status).toBe(200);
});

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function serverCards(): Promise<Card[]> {
  return (await api("GET", "/api/cards")).json.cards;
}

/** サーバーの盤面: 列ごとに order 順の「タイトル — 変更者」 */
async function serverBoard(): Promise<Board> {
  const board: Board = { todo: [], doing: [], done: [] };
  for (const c of (await serverCards()).toSorted((a, b) => a.order - b.order)) board[c.column].push(`${c.title} — ${c.updatedBy}`);
  return board;
}

/** ページが描いている盤面（同じ形） */
async function boardOf(page: Page): Promise<Board> {
  return page.evaluate(() => {
    const board: Record<string, string[]> = {};
    for (const col of document.querySelectorAll<HTMLElement>("section.column")) {
      board[col.dataset.col!] = [...col.querySelectorAll("article.card")].map(
        (card) => `${card.querySelector(".title")?.textContent} — ${card.querySelector(".by span")?.textContent}`,
      );
    }
    return board as Board;
  });
}

const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
const conn = (page: Page) => page.locator("#conn");
const notice = (page: Page) => page.locator("#notice");
const banner = (page: Page) => page.locator("#offline-banner");
const column = (page: Page, key: string) => page.locator(`section.column[data-col="${key}"]`);
/** 盤面全体でそのタイトルのカード（重複の検出にも使う） */
const cardsTitled = (page: Page, title: string) =>
  page.locator("article.card").filter({ has: page.locator(".title", { hasText: exact(title) }) });
const cardIn = (page: Page, key: string, title: string) =>
  column(page, key).locator("article.card").filter({ has: page.locator(".title", { hasText: exact(title) }) });

type User = { context: BrowserContext; page: Page; errors: string[] };

/** 新しいブラウザ（コンテキスト）でボードを開き、名前を入れ、Live になるまで待つ */
async function openBoard(browser: Browser, name: string): Promise<User> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = collectErrors(page);
  await page.goto(`${BASE}/`);
  await page.locator("#name-input").fill(name);
  await page.locator(".name-dialog button[type=submit]").click();
  await expect(page.locator(".me b")).toHaveText(name);
  await expect(conn(page)).toHaveText("Live");
  return { context, page, errors };
}

/** ページの再接続を止めたまま、サーバー側でストリームを切る（再接続の間をテストが握る） */
async function holdReconnect(page: Page): Promise<void> {
  await page.route("**/api/events", (route) => route.abort());
  expect((await api("POST", "/api/test/drop-streams")).status).toBe(200);
  await expect(conn(page)).toHaveText("Reconnecting…");
}

// デモが意図して起こす失敗を Chromium がネットワークのログとしてコンソールに出すもの
// （ページのコードのエラーではない）だけを、テストごとに名指しで除く
const without = (errors: string[], ...network: RegExp[]) =>
  errors.filter((e) => !network.some((re) => re.test(e)));
const HTTP_409 = /Failed to load resource: the server responded with a status of 409/;
const HTTP_500 = /Failed to load resource: the server responded with a status of 500/;
const ABORTED = /Failed to load resource: net::ERR_FAILED/;
const OFFLINE = /Failed to load resource: net::ERR_INTERNET_DISCONNECTED/;

test.describe("examples/state-collab-board", () => {
  test("A の追加・移動・名前の変更・削除は A に即座に出て、B には 1 秒以内に一度ずつ届く", async ({ browser }) => {
    const a = await openBoard(browser, "Alice");
    const b = await openBoard(browser, "Bob");
    await expect.poll(() => boardOf(b.page)).toEqual(await serverBoard());

    // 追加。A の POST はテストが二段で握る: (1) 送る前 — A には保存待ちのカードが
    // すでに出ている（サーバーも B もまだ知らない）。(2) 送った後、応答を返す前 —
    // 自分の追加の SSE イベントが応答より先に届いても、A のカードは一枚のまま
    let sendPost!: () => void;
    let answerPost!: () => void;
    const sendHeld = new Promise<void>((r) => { sendPost = r; });
    const answerHeld = new Promise<void>((r) => { answerPost = r; });
    await a.page.route("**/api/cards", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await sendHeld;
      const response = await route.fetch();
      await answerHeld;
      await route.fulfill({ response });
    });
    await column(a.page, "todo").locator(".add input").fill("Plan the retro");
    await column(a.page, "todo").locator(".add button").click();
    await expect(cardIn(a.page, "todo", "Plan the retro")).toHaveCount(1, { timeout: 300 });
    await expect(cardIn(a.page, "todo", "Plan the retro")).toHaveClass(/\bpending\b/);
    expect((await serverCards()).some((c) => c.title === "Plan the retro")).toBe(false);
    await expect(cardsTitled(b.page, "Plan the retro")).toHaveCount(0);

    sendPost();
    await expect(cardIn(b.page, "todo", "Plan the retro")).toHaveCount(1, { timeout: 1000 });
    await expect(cardIn(b.page, "todo", "Plan the retro").locator(".by")).toHaveText("changed by Alice");
    // イベントは A にも届いた（保存待ちの印が外れる）— それでも一枚
    await expect(cardsTitled(a.page, "Plan the retro").last()).not.toHaveClass(/\bpending\b/);
    await expect(cardsTitled(a.page, "Plan the retro")).toHaveCount(1);
    const answered = a.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/cards" && r.request().method() === "POST");
    answerPost();
    expect((await answered).status()).toBe(201);
    await a.page.unroute("**/api/cards");
    await expect(cardsTitled(a.page, "Plan the retro")).toHaveCount(1);
    await expect(cardsTitled(b.page, "Plan the retro")).toHaveCount(1);

    // 右へ移動
    await cardIn(a.page, "todo", "Plan the retro").getByRole("button", { name: "Move right" }).click();
    await expect(cardIn(a.page, "doing", "Plan the retro")).toHaveCount(1, { timeout: 300 });
    await expect(cardIn(b.page, "doing", "Plan the retro")).toHaveCount(1, { timeout: 1000 });

    // その場で名前を変える（Enter で保存）
    await cardIn(a.page, "doing", "Plan the retro").getByRole("button", { name: "Edit" }).click();
    await expect(a.page.locator("input.edit")).toBeFocused();
    await a.page.locator("input.edit").fill("Plan the team retro");
    await a.page.locator("input.edit").press("Enter");
    await expect(cardIn(a.page, "doing", "Plan the team retro")).toHaveCount(1, { timeout: 300 });
    await expect(cardIn(b.page, "doing", "Plan the team retro")).toHaveCount(1, { timeout: 1000 });

    // 削除
    await cardIn(a.page, "doing", "Plan the team retro").getByRole("button", { name: "Delete" }).click();
    await expect(cardsTitled(a.page, "Plan the team retro")).toHaveCount(0, { timeout: 300 });
    await expect(cardsTitled(b.page, "Plan the team retro")).toHaveCount(0, { timeout: 1000 });

    // 両方の盤面がサーバーと一致する: 自分の変更の SSE イベントが二重に適用されていない
    const expected = await serverBoard();
    expect(expected.doing).toEqual(["Review the board design — Chie", "Migrate the build to esbuild — Ana"]);
    await expect.poll(() => boardOf(a.page)).toEqual(expected);
    await expect.poll(() => boardOf(b.page)).toEqual(expected);
    await expect(notice(a.page)).toBeHidden();

    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    await a.context.close();
    await b.context.close();
  });

  test("サーバーが変更を拒むと（fail-next → 500）、カードはいったん動いてから元に戻り、理由が出る", async ({ browser }) => {
    const a = await openBoard(browser, "Alice");
    const b = await openBoard(browser, "Bob");
    expect((await api("POST", "/api/test/fail-next")).status).toBe(200);
    // 応答を 400ms 遅らせ、楽観的に動いた姿を観測できるようにする
    await a.page.route("**/api/cards/*", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const response = await route.fetch();
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({ response });
    });

    const t = "Fix the login redirect";
    await cardIn(a.page, "todo", t).getByRole("button", { name: "Move right" }).click();
    // まず動く（保存待ちの印つき）
    await expect(cardIn(a.page, "doing", t)).toHaveClass(/\bpending\b/, { timeout: 300 });
    // 500 で元の列へ戻り、理由が出る
    await expect(cardIn(a.page, "todo", t)).toHaveCount(1);
    await expect(cardsTitled(a.page, t)).toHaveCount(1);
    await expect(cardIn(a.page, "todo", t)).not.toHaveClass(/\bpending\b/);
    await expect(notice(a.page)).toBeVisible();
    await expect(notice(a.page).locator("span")).toHaveText(`Could not move “${t}”: Server error. Your change was undone.`);

    // サーバーも B も、動いたことを一度も知らない
    expect((await serverCards()).find((c) => c.title === t)?.column).toBe("todo");
    await expect.poll(() => boardOf(b.page)).toEqual(await serverBoard());
    await expect.poll(() => boardOf(a.page)).toEqual(await serverBoard());
    await expect(notice(b.page)).toBeHidden();

    expect(without(a.errors, HTTP_500)).toEqual([]);
    expect(b.errors).toEqual([]);
    await a.context.close();
    await b.context.close();
  });

  test("409: A の移動の後に B が古い盤面から同じカードを動かすと、B には A の版が出て、A が先だったと告げる", async ({ browser }) => {
    const a = await openBoard(browser, "Alice");
    const b = await openBoard(browser, "Bob");
    // B の回線が詰まる: ストリームが切れ、再接続も通らない — B は古い盤面のまま操作できる
    await holdReconnect(b.page);
    await expect(conn(a.page)).toHaveText("Live");

    const t = "Review the board design";
    await cardIn(a.page, "doing", t).getByRole("button", { name: "Move right" }).click();
    await expect.poll(async () => (await serverCards()).find((c) => c.title === t)?.column).toBe("done");

    await expect(cardIn(b.page, "doing", t)).toHaveCount(1);          // B はまだ古い版を見ている
    await cardIn(b.page, "doing", t).getByRole("button", { name: "Move left" }).click();
    await expect(notice(b.page).locator("span")).toHaveText(
      `Alice changed “${t}” before you did — the card now shows their version.`,
    );
    await expect(cardIn(b.page, "done", t)).toHaveCount(1);
    await expect(cardsTitled(b.page, t)).toHaveCount(1);
    await expect(cardIn(b.page, "done", t).locator(".by")).toHaveText("changed by Alice");
    // サーバーは A の版のまま（B の古い版での変更は通らない）
    const card = (await serverCards()).find((c) => c.title === t)!;
    expect([card.column, card.updatedBy, card.version]).toEqual(["done", "Alice", 2]);

    // B の回線が戻ると、盤面はサーバーと一致する
    await b.page.unroute("**/api/events");
    await expect(conn(b.page)).toHaveText("Live");
    await expect.poll(() => boardOf(b.page)).toEqual(await serverBoard());
    await expect.poll(() => boardOf(a.page)).toEqual(await serverBoard());
    await expect(notice(a.page)).toBeHidden();

    expect(a.errors).toEqual([]);
    expect(without(b.errors, HTTP_409, ABORTED)).toEqual([]);
    await a.context.close();
    await b.context.close();
  });

  test("409: A が名前を編集している間に B が同じカードを先に保存すると、A の保存は通らず B の名前が残る", async ({ browser }) => {
    const a = await openBoard(browser, "Alice");
    const b = await openBoard(browser, "Bob");
    const t = "Set up the staging server";
    await cardIn(a.page, "done", t).getByRole("button", { name: "Edit" }).click();
    await a.page.locator("input.edit").fill("Set up staging (Alice)");

    await cardIn(b.page, "done", t).getByRole("button", { name: "Edit" }).click();
    await b.page.locator("input.edit").fill("Set up staging (Bob)");
    await b.page.locator("input.edit").press("Enter");
    await expect.poll(async () => (await serverCards()).find((c) => c.id === 5)?.title).toBe("Set up staging (Bob)");

    // A の保存は編集を始めた時の版で送られる — 先に保存された B の名前を上書きしない
    await expect(a.page.locator("input.edit")).toHaveValue("Set up staging (Alice)");
    await a.page.locator("input.edit").press("Enter");
    await expect(notice(a.page).locator("span")).toHaveText(
      "Bob changed “Set up staging (Bob)” before you did — the card now shows their version.",
    );
    await expect(cardIn(a.page, "done", "Set up staging (Bob)")).toHaveCount(1);
    await expect(cardsTitled(a.page, "Set up staging (Alice)")).toHaveCount(0);
    expect((await serverCards()).find((c) => c.id === 5)?.title).toBe("Set up staging (Bob)");
    await expect.poll(() => boardOf(a.page)).toEqual(await serverBoard());
    await expect.poll(() => boardOf(b.page)).toEqual(await serverBoard());

    expect(without(a.errors, HTTP_409)).toEqual([]);
    expect(b.errors).toEqual([]);
    await a.context.close();
    await b.context.close();
  });

  test("ストリームが切れて（drop-streams）戻ると、その間の変更が欠けも重複もなく揃う — 未受信・リプレイ・resync", async ({ browser }) => {
    const a = await openBoard(browser, "Alice");
    let snapshots = 0;
    a.page.on("request", (req) => {
      if (req.method() === "GET" && new URL(req.url()).pathname === "/api/cards") snapshots++;
    });
    const cards = await serverCards();
    const byTitle = (t: string) => cards.find((c) => c.title === t)!;

    // 1) まだ一つもイベントを受け取っていない: ブラウザは Last-Event-ID を送れない
    //    → ページが盤面を取り直す
    await holdReconnect(a.page);
    await api("POST", "/api/cards", { title: "Gap card 1", column: "todo", by: "Carol" });
    await api("POST", "/api/cards", { title: "Gap card 2", column: "doing", by: "Carol" });
    const r = byTitle("Draft the onboarding guide");
    await api("PATCH", `/api/cards/${r.id}`, { title: "Draft the onboarding guide v2", version: r.version, by: "Carol" });
    await api("DELETE", `/api/cards/${byTitle("Set up the staging server").id}?by=Carol`);
    const before1 = snapshots;
    await a.page.unroute("**/api/events");
    await expect(conn(a.page)).toHaveText("Live");
    await expect.poll(() => boardOf(a.page)).toEqual(await serverBoard());
    for (const t of ["Gap card 1", "Gap card 2", "Draft the onboarding guide v2"]) await expect(cardsTitled(a.page, t)).toHaveCount(1);
    await expect(cardsTitled(a.page, "Set up the staging server")).toHaveCount(0);
    expect(snapshots - before1).toBe(1);

    // 2) id つきのイベントを受け取った後: 再接続が Last-Event-ID を送り、サーバーがリプレイする
    await api("POST", "/api/cards", { title: "Seen live", column: "done", by: "Carol" });
    await expect(cardsTitled(a.page, "Seen live")).toHaveCount(1);
    await holdReconnect(a.page);
    const m = (await serverCards()).find((c) => c.title === "Write the release notes")!;
    await api("PATCH", `/api/cards/${m.id}`, { column: "done", version: m.version, by: "Carol" });
    await api("POST", "/api/cards", { title: "Gap card 3", column: "todo", by: "Carol" });
    const before2 = snapshots;
    await a.page.unroute("**/api/events");
    await expect(conn(a.page)).toHaveText("Live");
    await expect.poll(() => boardOf(a.page)).toEqual(await serverBoard());
    await expect(cardIn(a.page, "done", "Write the release notes")).toHaveCount(1);
    await expect(cardsTitled(a.page, "Gap card 3")).toHaveCount(1);
    expect(snapshots - before2).toBe(0);

    // 3) 100 件より多く遅れた: サーバーは resync を一つ送り、ページが盤面を取り直す
    await holdReconnect(a.page);
    for (let i = 0; i < 105; i++) await api("POST", "/api/cards", { title: `Bulk ${i}`, column: "todo", by: "Carol" });
    const before3 = snapshots;
    await a.page.unroute("**/api/events");
    await expect(conn(a.page)).toHaveText("Live");
    await expect.poll(() => boardOf(a.page)).toEqual(await serverBoard());
    for (const i of [0, 52, 104]) await expect(cardsTitled(a.page, `Bulk ${i}`)).toHaveCount(1);
    expect(snapshots - before3).toBe(1);

    expect(without(a.errors, ABORTED)).toEqual([]);
    await a.context.close();
  });

  test("オフライン: バナーが出て盤面を変える操作が無効になり、オンラインに戻ると B の変更に追いつく", async ({ browser }) => {
    const a = await openBoard(browser, "Alice");
    const b = await openBoard(browser, "Bob");
    await expect(a.page.locator(".column button:enabled, .column input:enabled").first()).toBeVisible();

    await a.context.setOffline(true);
    await expect(banner(a.page)).toBeVisible();
    await expect(conn(a.page)).toHaveText("Offline");
    expect(await a.page.locator(".column button, .column input").count()).toBeGreaterThan(0);
    await expect(a.page.locator(".column button:enabled, .column input:enabled")).toHaveCount(0);
    // Chromium のオフライン模擬は開いたままの localhost のストリームを切らない。本物の
    // 断線と同じにするため、サーバー側で切る（再接続はオフラインなので通らない）
    await api("POST", "/api/test/drop-streams");
    await expect.poll(() => a.page.evaluate(() => (document.querySelector("wcs-sse") as unknown as { connected: boolean }).connected)).toBe(false);

    // その間に B が変える
    await column(b.page, "done").locator(".add input").fill("Order new laptops");
    await column(b.page, "done").locator(".add button").click();
    await cardIn(b.page, "todo", "Write the release notes").getByRole("button", { name: "Move right" }).click();
    await expect.poll(async () => (await serverCards()).map((c) => `${c.title}:${c.column}`))
      .toEqual(expect.arrayContaining(["Order new laptops:done", "Write the release notes:doing"]));
    await expect(cardsTitled(a.page, "Order new laptops")).toHaveCount(0);   // A はまだ知らない

    await a.context.setOffline(false);
    await expect(banner(a.page)).toBeHidden();
    await expect(conn(a.page)).toHaveText("Live");
    await expect.poll(() => boardOf(a.page)).toEqual(await serverBoard());
    await expect(cardIn(a.page, "done", "Order new laptops")).toHaveCount(1);
    await expect(cardIn(a.page, "doing", "Write the release notes")).toHaveCount(1);
    await expect(column(a.page, "todo").locator(".add input")).toBeEnabled();

    expect(without(a.errors, OFFLINE)).toEqual([]);
    expect(b.errors).toEqual([]);
    await a.context.close();
    await b.context.close();
  });

  test("名前は一度だけ聞かれ、再読み込みしてもサーバーの盤面と名前がそのまま戻る", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.goto(`${BASE}/`);
    // 名前が無い間は盤面を変えられない
    await expect(page.locator("#name-input")).toBeVisible();
    await expect(column(page, "todo").locator(".add input")).toBeDisabled();
    await page.locator("#name-input").fill("Alice");
    await page.locator(".name-dialog button[type=submit]").click();
    await expect(page.locator("#name-input")).toHaveCount(0);
    await expect(column(page, "todo").locator(".add input")).toBeEnabled();

    await cardIn(page, "todo", "Fix the login redirect").getByRole("button", { name: "Move right" }).click();
    await expect.poll(async () => (await serverCards()).find((c) => c.title === "Fix the login redirect")?.updatedBy).toBe("Alice");
    await api("POST", "/api/cards", { title: "Added by someone else", column: "done", by: "Carol" });
    await expect(cardsTitled(page, "Added by someone else")).toHaveCount(1);

    await page.reload();
    await expect(conn(page)).toHaveText("Live");
    await expect(page.locator("#name-input")).toHaveCount(0);
    await expect(page.locator(".me b")).toHaveText("Alice");
    await expect.poll(() => boardOf(page)).toEqual(await serverBoard());
    await expect(cardIn(page, "doing", "Fix the login redirect").locator(".by")).toHaveText("changed by Alice");
    expect(page.url()).toBe(`${BASE}/`);

    expect(errors).toEqual([]);
    await context.close();
  });
});
