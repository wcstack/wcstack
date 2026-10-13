import { test, expect, type Page, type Request } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/router-auth — router + state + fetch + storage の会員エリア（シーム・アプリ）。
// 公開ページ・ログインフォーム・ガードで守った会員ページ（プロフィール / 注文一覧 / 注文詳細）と、
// トークンが要る JSON API。セッション（トークン + 利用者）は <wcs-storage> で localStorage に置き、
// 再読み込みでも残り、すべてのタブで共有され、使っている最中に失効しうる。
// この spec はデモのライフイベント — ログアウト中のディープリンク → ログイン → そのページ、
// ログイン中の再読み込み、使用中の失効、ログアウト後の戻る、別タブでのログアウト、注文の無い会員、
// サイト外を指す next — を、URL・内容が描かれる場所・再読み込みで残るもの・2 つ目のタブ・
// 履歴の振る舞い（ガードのリダイレクトの後で戻るに閉じ込められない）・文書の読み込み回数・
// コンソールの静けさで固定する。
//
// router-spa と同じく serve.mjs には載らない（<base href="/"> でアプリのルートを固定し、
// API と SPA fallback はデモ自身の server.js が持つ）。WCS_LOCAL=1（esm.run → packages/*/dist）で
// ワーカーごとに別ポートで立てる。サーバーのトークンはそのプロセスのメモリにあるので、
// /api/test/expire-all はこのワーカーのサーバーにしか効かない。
const PORT = 4600 + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const SESSION_KEY = "coffee-corner.session";
const EXPIRED = "Your session has expired — please log in again.";

type Summary = { id: number; date: string; total: number; status: string };
type Order = Summary & { items: { name: string; qty: number; price: number }[] };
type Profile = { name: string; email: string };

let server: ChildProcess;
// 期待値はページのコードではなく API の応答から組み立てる
let alice: { profile: Profile; orders: Summary[]; details: Map<number, Order> };
let bob: { profile: Profile; orders: Summary[] };

async function apiLogin(username: string, password: string): Promise<{ token: string; user: Profile }> {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(200);
  return res.json();
}
const apiGet = async <T>(path: string, token: string): Promise<T> =>
  (await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })).json() as Promise<T>;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/router-auth/server.js"], {
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

  const a = await apiLogin("alice", "alice123");
  const orders = await apiGet<Summary[]>("/api/orders", a.token);
  expect(orders.length).toBe(3);
  const details = new Map<number, Order>();
  for (const o of orders) details.set(o.id, await apiGet<Order>(`/api/orders/${o.id}`, a.token));
  alice = { profile: a.user, orders, details };
  const b = await apiLogin("bob", "bob123");
  bob = { profile: b.user, orders: await apiGet<Summary[]>("/api/orders", b.token) };
  expect(bob.orders).toEqual([]);
});

// 子プロセスが終わるまで待つ: 同じワーカーで次に立てるサーバーが同じポートを使う。
test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill();
  await exited;
});

// --- helpers -------------------------------------------------------------------

/** console.error / pageerror に加えて console.warning も集める（正しいアプリは警告も出さない） */
function collectConsole(page: Page): string[] {
  const messages = collectErrors(page);
  page.on("console", (msg) => {
    if (msg.type() === "warning") messages.push(`console.warning: ${msg.text()}`);
  });
  return messages;
}
/** デモが意図して起こす HTTP エラー応答を Chromium がネットワークのログとして出すもの（ページのコードのエラーではない）だけを除く */
const withoutStatusLog = (messages: string[], ...statuses: number[]) =>
  messages.filter((m) => !statuses.some((s) => m.includes(`Failed to load resource: the server responded with a status of ${s}`)));

const yen = (n: number) => "¥" + n.toLocaleString("en");
const outlet = (page: Page) => page.locator("wcs-outlet");
const heading = (page: Page) => outlet(page).locator("h1");
const header = (page: Page) => page.locator("header.site-header");
const orderRows = (page: Page) => outlet(page).locator("table.orders tbody tr");
const storedSession = (page: Page) => page.evaluate((key) => localStorage.getItem(key), SESSION_KEY);

async function expectAt(page: Page, pathAndQuery: string): Promise<void> {
  await expect.poll(() => { const u = new URL(page.url()); return u.pathname + u.search; }).toBe(pathAndQuery);
}

async function fillLogin(page: Page, username: string, password: string): Promise<void> {
  await expect(heading(page)).toHaveText("Log in");
  await outlet(page).locator("input[name=username]").fill(username);
  await outlet(page).locator("input[name=password]").fill(password);
  await outlet(page).getByRole("button", { name: "Log in" }).click();
}

async function expectLoggedOutHeader(page: Page): Promise<void> {
  await expect(header(page).getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(header(page).locator(".greeting")).toHaveCount(0);
  await expect(header(page).getByRole("button", { name: "Log out" })).toHaveCount(0);
}

async function expectLoggedInHeader(page: Page, name: string): Promise<void> {
  await expect(header(page).locator(".greeting")).toHaveText(`Hello, ${name}`);
  await expect(header(page).getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(header(page).getByRole("link", { name: "Log in" })).toHaveCount(0);
}

/** 注文一覧が API の注文を、この順で、詳細へのリンク付きで描いていること */
async function expectOrderList(page: Page, orders: Summary[]): Promise<void> {
  await expect(heading(page)).toHaveText("My orders");
  await expect(page).toHaveTitle("My orders — Coffee Corner");
  await expect(orderRows(page)).toHaveCount(orders.length);
  await expect(orderRows(page).locator("td:nth-child(1)")).toHaveText(orders.map((o) => `#${o.id}`));
  await expect(orderRows(page).locator("td:nth-child(2)")).toHaveText(orders.map((o) => o.date));
  await expect(orderRows(page).locator("td:nth-child(3)")).toHaveText(orders.map((o) => yen(o.total)));
  await expect(orderRows(page).locator("td:nth-child(4)")).toHaveText(orders.map((o) => o.status));
  for (const o of orders) {
    await expect(orderRows(page).locator(`a[href="/account/orders/${o.id}"]`)).toHaveCount(1);
  }
}

/** 注文詳細がその注文だけを描いていること */
async function expectOrder(page: Page, order: Order): Promise<void> {
  await expect(heading(page)).toHaveText(`Order #${order.id}`);
  await expect(page).toHaveTitle(`Order #${order.id} — Coffee Corner`);
  await expect(outlet(page)).toContainText(`Placed on ${order.date} — ${order.status}`);
  const items = outlet(page).locator("table.items tbody tr");
  await expect(items).toHaveCount(order.items.length);
  await expect(items.locator("td:nth-child(1)")).toHaveText(order.items.map((i) => i.name));
  await expect(items.locator("td:nth-child(2)")).toHaveText(order.items.map((i) => String(i.qty)));
  await expect(items.locator("td:nth-child(3)")).toHaveText(order.items.map((i) => yen(i.price)));
  await expect(outlet(page)).toContainText(`Total: ${yen(order.total)}`);
}

/** 会員の内容（プロフィール・注文）がどこにも描かれていないこと */
async function expectNoMemberContent(page: Page): Promise<void> {
  await expect(outlet(page).locator("dl.profile, table.orders, table.items")).toHaveCount(0);
  const text = await page.locator("body").innerText();
  for (const o of alice.details.values()) {
    for (const i of o.items) expect(text).not.toContain(i.name);
  }
  expect(text).not.toContain(alice.profile.email);
}

/** /api/ への要求を、送った Authorization ヘッダーと一緒に記録する */
function recordApi(page: Page): { path: string; auth: string | undefined }[] {
  const seen: { path: string; auth: string | undefined }[] = [];
  page.on("request", (req: Request) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/")) seen.push({ path: url.pathname, auth: req.headers()["authorization"] });
  });
  return seen;
}

/** ページ（タブ）が受け取った文書の要求を数える */
function countDocuments(page: Page): string[] {
  const docs: string[] = [];
  page.on("request", (req) => { if (req.resourceType() === "document") docs.push(new URL(req.url()).pathname); });
  return docs;
}

// --- tests -----------------------------------------------------------------------

test.describe("examples/router-auth", () => {
  test("ディープリンク: ログアウト中に /account/orders/2 を開くと文書 1 回のまま /login?next= に着き、ログインすると注文 2 が描かれる", async ({ page }) => {
    const messages = collectConsole(page);
    const docs = countDocuments(page);
    const api = recordApi(page);
    await page.goto(`${BASE}/account/orders/2`);

    await expectAt(page, "/login?next=%2Faccount%2Forders%2F2");
    await expect(heading(page)).toHaveText("Log in");
    await expect(page).toHaveTitle("Log in — Coffee Corner");
    await expectLoggedOutHeader(page);
    await expectNoMemberContent(page);
    // 着地でのリダイレクトはクライアント側: 文書の読み込みは最初の 1 回だけ
    expect(docs).toEqual(["/account/orders/2"]);
    // ガードは内容を置く前に止める: ログアウト中は会員 API に 1 つも要求が出ない
    expect(api).toEqual([]);

    await fillLogin(page, "alice", "alice123");
    await expectAt(page, "/account/orders/2");
    await expectOrder(page, alice.details.get(2)!);
    await expectLoggedInHeader(page, alice.profile.name);
    // ログイン後の会員 API はすべてトークン付き
    const token = JSON.parse((await storedSession(page))!).token;
    expect(api.filter((r) => r.path !== "/api/login")).toEqual([{ path: "/api/orders/2", auth: `Bearer ${token}` }]);
    expect(docs).toEqual(["/account/orders/2"]);

    expect(messages).toEqual([]);
  });

  test("ガードのリダイレクトは履歴を置き換える: 戻るとガードの前のページへ戻り、/login に閉じ込められない", async ({ page }) => {
    const messages = collectConsole(page);
    await page.goto(`${BASE}/`);
    await expect(heading(page)).toHaveText("Welcome to Coffee Corner");
    const historyLength = await page.evaluate(() => history.length);

    // アプリの中のリンクから守られたページへ
    await outlet(page).getByRole("link", { name: "See my orders" }).click();
    await expectAt(page, "/login?next=%2Faccount%2Forders");
    await expect(heading(page)).toHaveText("Log in");
    // 守られた URL は履歴に残らない: 増えたのはリダイレクト先の 1 件だけ
    expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);

    await page.goBack();
    await expectAt(page, "/");
    await expect(heading(page)).toHaveText("Welcome to Coffee Corner");

    // 着地（URL の直接入力）でも同じ
    await page.goto(`${BASE}/account`);
    await expectAt(page, "/login?next=%2Faccount");
    await page.goBack();
    await expectAt(page, "/");
    await expect(heading(page)).toHaveText("Welcome to Coffee Corner");

    expect(messages).toEqual([]);
  });

  test("再読み込み: ログイン中に /account/orders で再読み込みしても同じページのままログインも保たれ、最初の要求からトークンが付く", async ({ page }) => {
    const messages = collectConsole(page);
    await page.goto(`${BASE}/login?next=%2Faccount%2Forders`);
    await fillLogin(page, "alice", "alice123");
    await expectAt(page, "/account/orders");
    await expectOrderList(page, alice.orders);
    const session = await storedSession(page);
    expect(JSON.parse(session!).user).toEqual(alice.profile);

    const api = recordApi(page);
    await page.reload();
    await expectAt(page, "/account/orders");
    await expectOrderList(page, alice.orders);
    await expectLoggedInHeader(page, alice.profile.name);
    // 保存されたセッションはそのまま（読み込み時に種の値で上書きされない）
    expect(await storedSession(page)).toBe(session);
    // 再読み込み直後の /api/orders も、state がヘッダーを結ぶ前に飛び出したりせずトークン付き
    expect(api).toEqual([{ path: "/api/orders", auth: `Bearer ${JSON.parse(session!).token}` }]);

    // 2 回目の訪問: 一覧 → 詳細 → 一覧で、一覧はもう一度取り直して描く
    await orderRows(page).locator('a[href="/account/orders/3"]').click();
    await expectAt(page, "/account/orders/3");
    await expectOrder(page, alice.details.get(3)!);
    await outlet(page).getByRole("link", { name: "Back to my orders" }).click();
    await expectAt(page, "/account/orders");
    await expectOrderList(page, alice.orders);
    expect(api.map((r) => r.path)).toEqual(["/api/orders", "/api/orders/3", "/api/orders"]);

    expect(messages).toEqual([]);
  });

  test("失効: expire-all の後に別の会員ページへ進むと、メッセージ付きで /login?next=<そのページ> に移り、ログインし直すとそこへ戻る", async ({ page }) => {
    const messages = collectConsole(page);
    await page.goto(`${BASE}/login?next=%2Faccount%2Forders`);
    await fillLogin(page, "alice", "alice123");
    await expectOrderList(page, alice.orders);

    const res = await fetch(`${BASE}/api/test/expire-all`, { method: "POST" });
    expect(res.status).toBe(200);
    await orderRows(page).locator('a[href="/account/orders/1"]').click();

    await expectAt(page, "/login?next=%2Faccount%2Forders%2F1");
    await expect(outlet(page).locator(".notice")).toHaveText(EXPIRED);
    await expectLoggedOutHeader(page);
    await expectNoMemberContent(page);
    // セッションは消えている（このタブだけでなく保存先からも）
    expect(await storedSession(page)).toBeNull();

    await fillLogin(page, "alice", "alice123");
    await expectAt(page, "/account/orders/1");
    await expectOrder(page, alice.details.get(1)!);
    await expectLoggedInHeader(page, alice.profile.name);
    // メッセージはログインし直すと消える
    await expect(page.locator(".notice")).toHaveCount(0);

    // 失効したトークンへの 401 応答のネットワークログだけを除く
    expect(withoutStatusLog(messages, 401)).toEqual([]);
  });

  test("ログアウト: サーバーにも伝えてトークンを無効にし / へ移る。戻っても会員の内容は出ず、戻るはさらに前へ進める", async ({ page }) => {
    const messages = collectConsole(page);
    await page.goto(`${BASE}/`);
    await header(page).getByRole("link", { name: "Log in" }).click();
    await fillLogin(page, "alice", "alice123");
    await expectAt(page, "/account");
    await expect(outlet(page).locator("dl.profile dd")).toHaveText([alice.profile.name, alice.profile.email]);
    await outlet(page).getByRole("link", { name: "My orders" }).click();
    await expectOrderList(page, alice.orders);
    await orderRows(page).locator('a[href="/account/orders/3"]').click();
    await expectOrder(page, alice.details.get(3)!);
    const token = JSON.parse((await storedSession(page))!).token;

    const api = recordApi(page);
    await header(page).getByRole("button", { name: "Log out" }).click();
    await expectAt(page, "/");
    await expect(heading(page)).toHaveText("Welcome to Coffee Corner");
    await expectLoggedOutHeader(page);
    expect(await storedSession(page)).toBeNull();
    // サーバーに伝わった: ログアウト要求にトークンが付いていて、そのトークンはもう効かない
    expect(api).toEqual([{ path: "/api/logout", auth: `Bearer ${token}` }]);
    expect((await fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);

    await page.goBack();
    await expectAt(page, "/login?next=%2Faccount%2Forders%2F3");
    await expect(heading(page)).toHaveText("Log in");
    await expectNoMemberContent(page);
    // 戻るは一つ前の会員ページの番へ進む（同じ /login に閉じ込められない）
    await page.goBack();
    await expectAt(page, "/login?next=%2Faccount%2Forders");
    await expectNoMemberContent(page);
    // 戻った先で会員 API を叩いていない
    expect(api.map((r) => r.path)).toEqual(["/api/logout"]);

    expect(messages).toEqual([]);
  });

  test("2 つのタブ: ログインは開いていたログインフォームのタブも進め、片方でのログアウトでもう片方は会員ページを離れる", async ({ context }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    const messagesA = collectConsole(a);
    const messagesB = collectConsole(b);

    // B はログインフォームを開いて待っている
    await b.goto(`${BASE}/login?next=%2Faccount%2Forders%2F3`);
    await expect(heading(b)).toHaveText("Log in");

    await a.goto(`${BASE}/login`);
    await fillLogin(a, "alice", "alice123");
    await expectAt(a, "/account");
    await expectLoggedInHeader(a, alice.profile.name);

    // A のログインが B に届く: B は自分の next へ進み、注文 3 を描く
    await expectAt(b, "/account/orders/3");
    await expectOrder(b, alice.details.get(3)!);
    await expectLoggedInHeader(b, alice.profile.name);

    await header(a).getByRole("button", { name: "Log out" }).click();
    await expectAt(a, "/");

    // B も会員ページを離れ、ログアウトした見出しになり、注文はどこにも残らない
    await expectAt(b, "/");
    await expect(heading(b)).toHaveText("Welcome to Coffee Corner");
    await expectLoggedOutHeader(b);
    await expectNoMemberContent(b);
    // B から会員ページへ進もうとしてもガードが止める（ガードは共有の保存先を読む）
    await outlet(b).getByRole("link", { name: "See my orders" }).click();
    await expectAt(b, "/login?next=%2Faccount%2Forders");
    await expectNoMemberContent(b);

    expect(messagesA).toEqual([]);
    expect(messagesB).toEqual([]);
  });

  test("注文の無い会員: bob でログインすると、注文一覧は空であることを文で伝え、表を描かない", async ({ page }) => {
    const messages = collectConsole(page);
    await page.goto(`${BASE}/login?next=%2Faccount`);
    await fillLogin(page, "bob", "bob123");
    await expectAt(page, "/account");
    await expectLoggedInHeader(page, bob.profile.name);
    await expect(outlet(page).locator("dl.profile dd")).toHaveText([bob.profile.name, bob.profile.email]);

    await outlet(page).getByRole("link", { name: "My orders" }).click();
    await expectAt(page, "/account/orders");
    await expect(heading(page)).toHaveText("My orders");
    await expect(outlet(page).locator(".empty")).toHaveText("You have no orders yet.");
    await expect(outlet(page).locator("table.orders")).toHaveCount(0);

    // alice の注文は bob には見つからない（ルートは一致するが API が 404）
    await page.goto(`${BASE}/account/orders/1`);
    await expect(outlet(page).locator(".empty")).toHaveText("Order not found.");
    await expect(outlet(page).locator("table.items")).toHaveCount(0);

    expect(withoutStatusLog(messages, 404)).toEqual([]);
  });

  test("next: サイト外・スキーム付きの next には従わず /account へ、アプリ内のパスにはクエリごと従う", async ({ page }) => {
    const messages = collectConsole(page);
    const offSite: string[] = [];
    page.on("request", (req) => { if (new URL(req.url()).hostname.includes("evil")) offSite.push(req.url()); });

    for (const next of ["https://evil.example/", "//evil.example/", "/\\evil.example/", "javascript:alert(1)"]) {
      await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
      await fillLogin(page, "alice", "alice123");
      await expectAt(page, "/account");
      expect(new URL(page.url()).origin).toBe(BASE);
      await expect(heading(page)).toHaveText("My account");
      await header(page).getByRole("button", { name: "Log out" }).click();
      await expectAt(page, "/");
    }
    expect(offSite).toEqual([]);

    // ガードは toPath に無いクエリを next に戻すので、ディープリンクのクエリもログイン後に残る
    await page.goto(`${BASE}/account/orders?sort=date`);
    await expectAt(page, "/login?next=%2Faccount%2Forders%3Fsort%3Ddate");
    await fillLogin(page, "alice", "alice123");
    await expectAt(page, "/account/orders?sort=date");
    await expectOrderList(page, alice.orders);

    expect(messages).toEqual([]);
  });

  test("ログインフォーム: 誤った資格情報ではサーバーのメッセージを出して留まり、ログイン済みで /login を開くと /account へ置き換えられる", async ({ page }) => {
    const messages = collectConsole(page);
    const docs = countDocuments(page);
    await page.goto(`${BASE}/login`);
    await fillLogin(page, "alice", "wrong");
    await expect(outlet(page).getByRole("alert")).toHaveText("Wrong username or password");
    await expectAt(page, "/login");
    await expectLoggedOutHeader(page);
    expect(await storedSession(page)).toBeNull();

    await outlet(page).locator("input[name=password]").fill("alice123");
    await outlet(page).getByRole("button", { name: "Log in" }).click();
    await expectAt(page, "/account");
    await expect(heading(page)).toHaveText("My account");

    await page.goto(`${BASE}/login`);
    await expectAt(page, "/account");
    await expect(heading(page)).toHaveText("My account");
    await expect(outlet(page).locator("form")).toHaveCount(0);
    expect(docs).toEqual(["/login", "/login"]);

    // 誤ったパスワードへの 401 応答のネットワークログだけを除く
    expect(withoutStatusLog(messages, 401)).toEqual([]);
  });

  test("not found: 未知のパスと型制約（:id(int)）に合わないパスは fallback、存在しない注文は詳細ページの中で伝える", async ({ page }) => {
    const messages = collectConsole(page);
    for (const path of ["/nope", "/account/orders/abc"]) {
      await page.goto(`${BASE}${path}`);
      await expect(heading(page)).toHaveText("Page not found");
      await expect(page).toHaveTitle("Not found — Coffee Corner");
      await expectAt(page, path);
    }

    await page.goto(`${BASE}/login?next=%2Faccount%2Forders%2F99`);
    await fillLogin(page, "alice", "alice123");
    await expectAt(page, "/account/orders/99");
    await expect(heading(page)).toHaveText("Order #99");
    await expect(outlet(page).locator(".empty")).toHaveText("Order not found.");
    await expect(outlet(page).locator("table.items")).toHaveCount(0);

    // 存在する注文へ移れば普通に描く（404 の表示は残らない）
    await outlet(page).getByRole("link", { name: "Back to my orders" }).click();
    await orderRows(page).locator('a[href="/account/orders/2"]').click();
    await expectOrder(page, alice.details.get(2)!);
    await expect(outlet(page).locator(".empty")).toHaveCount(0);

    expect(withoutStatusLog(messages, 404)).toEqual([]);
  });

  test("ルートへ戻る 2 回目: 注文 → 一覧 → 別の注文で、前の注文の url で要求し直さない（新しい見出しの下に前の注文を出さない）", async ({ page }) => {
    const messages = collectConsole(page);
    const api = recordApi(page);
    const [first, second] = alice.orders.map((o) => o.id);
    await page.goto(`${BASE}/login?next=%2Faccount%2Forders%2F${first}`);
    await fillLogin(page, "alice", "alice123");
    await expectOrder(page, alice.details.get(first)!);
    await outlet(page).getByRole("link", { name: "Back to my orders" }).click();
    await expectOrderList(page, alice.orders);
    // 同じ注文詳細のルート（同じ <wcs-fetch> の節点）へ、別の id で戻る
    api.length = 0;
    await orderRows(page).locator(`a[href="/account/orders/${second}"]`).click();
    await expectOrder(page, alice.details.get(second)!);
    expect(api.map((r) => r.path)).toEqual([`/api/orders/${second}`]);

    expect(messages).toEqual([]);
  });
});
