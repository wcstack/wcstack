import { test, expect, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// examples/homeroom — 3年B組 連絡帳（クラスの連絡帳。継ぎ目アプリ、docs/seam-apps.md の homeroom）。4.2.0 で書き、
// 同じ作者が 4.10.1 に上げたアプリを、両方の版のまま取り込んだもの: v4.2.0/ は 4.2.0 で書いたときのまま（回避策つき、
// 4.2.0 のパッケージ）、public/ は今の版（この木の packages/*/dist）。一つのサーバーが同じオリジンでどちらかを出し、
// テストのフックで切り替える — 開いたタブの下での配備と巻き戻し。
//
// 今の版から外した回避策（4.3〜4.11 が要らなくした）は、それぞれ自分のテストを持つ: <wcs-upload-header> のトークン
// （UploadCore を自分で動かしていた、4.9）、ヘッダーの if: の中の <wcs-link match="prefix">（4.10）、手動の取り直し
// （4.3）、スキップリンクの onclick#prevent（4.10）、console.error を包むエラー報告（4.7）、ページの階層に置いた
// <wcs-ws>（接続中のソケットを開いてから閉じる、4.11）、ページ送りの素の <a>（to="/notices?"、4.11）。
// 残した回避策（区分のバッジの子の <span>）は、部品が遅れて届くテストが固定する。
//
// コンソールは wcstack の警告もエラーも無いこと。わざと起こした HTTP の失敗にブラウザ自身が出す
// "Failed to load resource" の行は、family-ledger と同じく別に数える。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist、@4.2.0 → npm の別名で入れた 4.2.0）でワーカーごとに
// 7300 + 10 × index のポートで立てる（4600–4900 / 5000 / 5100 / 5200 / 5300–5540 / 5700– / 6100– / 7100– は他の
// spec。fetch が拒むポート 6000 / 6566 / 6665–6669 を避ける）。
const PORT = 7300 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const APP = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const ACCOUNTS = { teacher: ["sato", "sensei1"], tanaka: ["tanaka", "oya1"], suzuki: ["suzuki", "oya2"] } as const;
type Account = keyof typeof ACCOUNTS;
const NOTICE = "/notices/25";   // the newest seeded notice: one answered question, one open
const LEAVE = "保存していない変更があります。このページを離れますか？";

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/homeroom/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("homeroom server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("homeroom (3年B組 連絡帳) on http")) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`homeroom server exited with ${code}`)); });
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
  await hook("/api/_test/reset");
});

// --- helpers -------------------------------------------------------------------

async function hook(path: string, data?: unknown): Promise<void> {
  const res = await fetch(APP + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data ?? {}),
  });
  expect(res.status, path).toBe(204);
}
/** 配る版を替える（サーバーもセッションもそのまま — 配備と巻き戻し） */
const serve = (dir: "public" | "v4.2.0") => hook("/api/_test/public-dir", { dir });
type ServerLog = {
  served: string; openSockets: number;
  uploads: { at: number; path: string; auth: "header" | "query" | "none"; status: number }[];
  sockets: { noticeId: number; event: "open" | "close" | "gave-up" }[];
};
const serverLog = async (): Promise<ServerLog> => (await fetch(`${APP}/api/_test/log`)).json();
const clientErrors = async (): Promise<{ message: string; url: string }[]> => (await fetch(`${APP}/api/_test/client-errors`)).json();

/** テストの外からの API 呼び出し（もう一人の利用者、サーバーの中身の確認） */
async function apiToken(who: Account): Promise<string> {
  const [id, password] = ACCOUNTS[who];
  const res = await fetch(`${APP}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, password }) });
  return (await res.json()).token;
}
async function api(path: string, token: string): Promise<{ status: number; json: any }> {
  const res = await fetch(APP + path, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/**
 * コンソールの記録。`problems` は wcstack とページのエラー・警告（空であること）、`resources` はわざと起こした
 * HTTP の失敗にブラウザ自身が出す "Failed to load resource" の行（ページからは消せない — 作者の F14）。
 */
type ConsoleLog = { problems: string[]; resources: string[] };
function watchConsole(page: Page): ConsoleLog {
  const log: ConsoleLog = { problems: [], resources: [] };
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    if (/^Failed to load resource: /.test(m.text())) log.resources.push(m.text());
    else log.problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => log.problems.push(`pageerror: ${e.message}`));
  return log;
}
const status = (...codes: number[]) => new RegExp(`the server responded with a status of (${codes.join("|")})`);
/** 起こした失敗だけ: `resources` の行がどれも許した形のどれかに当たる */
const onlyProvoked = (log: ConsoleLog, ...allow: RegExp[]) => log.resources.filter((r) => !allow.some((re) => re.test(r)));
function clean(log: ConsoleLog, ...allow: RegExp[]): void {
  expect(log.problems, "console errors / warnings").toEqual([]);
  expect(onlyProvoked(log, ...allow), "HTTP failures nobody provoked").toEqual([]);
}

/** ログインのページで（ガードが送った next= のままで）ログインし、ログインのページを離れるまで待つ */
async function login(page: Page, who: Account, from: string | null = "/login"): Promise<void> {
  if (from) await page.goto(APP + from);
  const [id, password] = ACCOUNTS[who];
  await page.locator("#login-id").fill(id);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
async function newPage(browser: Browser): Promise<{ page: Page; log: ConsoleLog }> {
  const page = await (await browser.newContext()).newPage();
  return { page, log: watchConsole(page) };
}
const tabs = (page: Page) => page.getByRole("navigation", { name: "区分で絞り込む" });
const pager = (page: Page) => page.getByRole("navigation", { name: "ページ" });
const items = (page: Page) => page.locator(".notice-item");
const pdf = (name: string, size = 120_000) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n" + "x".repeat(size)) });

async function openNewForm(page: Page): Promise<void> {
  await login(page, "teacher");
  await page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name: "お知らせを書く" }).click();
  await expect(page).toHaveURL(APP + "/notices/new");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("新しいお知らせ");
}

/** /api/ への要求とソケット: 「方法 パス 認証の有無」— 版の違いで変わってはいけないもの */
function recordRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) seen.push(`${r.method()} ${u.pathname}${u.search} ${r.headers()["authorization"] ? "auth" : "-"}`);
  });
  page.on("websocket", (ws) => seen.push(`WS ${new URL(ws.url()).pathname} ${new URL(ws.url()).searchParams.has("token") ? "token" : "-"}`));
  return seen;
}

// --- the current app: main flows ----------------------------------------------

test("ログアウト中のディープリンクは、ログインのあとクエリごとその表示に戻る", async ({ page }) => {
  const log = watchConsole(page);
  await page.goto(APP + "/notices/3?from=mail");
  await expect(page).toHaveURL(APP + "/login?next=%2Fnotices%2F3%3Ffrom%3Dmail");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("3年B組 連絡帳");
  await login(page, "tanaka", null);
  await expect(page).toHaveURL(APP + "/notices/3?from=mail");
  await expect(page.locator(".notice-body")).toBeVisible();
  await expect(page.locator(".who-name")).toHaveText("田中 花子");
  // the avatar is our own component, loaded by the autoloader placed first (4.7 — on 4.2.0 it stopped every component)
  await expect(page.locator("hr-avatar:defined")).toHaveCount(1);
  clean(log);
});

test("一覧: 区分のタブとページは URL にあり、再読み込みと戻る・進むで残り、見ているタブとページだけが現在", async ({ page }) => {
  const log = watchConsole(page);
  await login(page, "tanaka");
  await expect(page).toHaveURL(APP + "/notices");
  await expect(items(page)).toHaveCount(10);
  const currentTab = () => tabs(page).locator('a[aria-current="page"]');
  const currentPage = () => pager(page).locator('a[aria-current="page"]');
  await expect(currentTab()).toHaveText(["すべて"]);
  // page 1 of every notice is <wcs-link to="/notices?">: current only where the URL has no query (4.11)
  await expect(currentPage()).toHaveText(["1"]);
  const firstOfPage1 = await page.locator(".notice-item-title").first().innerText();

  await pager(page).getByRole("link", { name: "2ページ" }).click();
  await expect(page).toHaveURL(APP + "/notices?page=2");
  await expect(page.locator(".notice-item-title").first()).not.toHaveText(firstOfPage1);
  await expect(currentPage()).toHaveText(["2"]);          // not "1", not "前へ"
  await expect(currentTab()).toHaveText(["すべて"]);       // the tab is the category, on every page of it
  await page.reload();
  await expect(items(page)).toHaveCount(10);
  await expect(currentPage()).toHaveText(["2"]);

  await tabs(page).getByRole("link", { name: "宿題" }).click();
  await expect(page).toHaveURL(APP + "/notices?cat=homework");
  await expect(currentTab()).toHaveText(["宿題"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("お知らせ（宿題）");
  await expect(page).toHaveTitle("お知らせ（宿題） 1ページ — 3年B組 連絡帳");
  await expect(page.locator(".notice-item hr-cat-badge")).toHaveText(Array(7).fill("宿題"));
  await expect(pager(page)).toHaveCount(0);                // 7 notices: one page

  await page.goBack();
  await expect(page).toHaveURL(APP + "/notices?page=2");
  await expect(currentPage()).toHaveText(["2"]);
  await expect(currentTab()).toHaveText(["すべて"]);
  await page.goForward();
  await expect(page).toHaveURL(APP + "/notices?cat=homework");
  await expect(items(page)).toHaveCount(7);
  clean(log);
});

test("開いたお知らせは既読になり、一覧に戻ると未読の印が消えている（同じ url をもう一度取りに行く）", async ({ page }) => {
  const log = watchConsole(page);
  await login(page, "tanaka");
  const first = items(page).first();
  await expect(first.locator(".unread")).toHaveText("未読");
  await expect(first.locator(".notice-item-meta")).toContainText(/掲載 \d+月\d+日\([日月火水木金土]\)/);
  await first.locator("a").click();
  await expect(page).toHaveURL(APP + NOTICE);   // the newest notice
  await expect(page.locator(".notice-body")).toBeVisible();
  // the list url went empty on the notice and comes back: <wcs-fetch> loads it again (4.3; on 4.2.0 it showed the old list)
  await page.getByRole("link", { name: "← お知らせ一覧へ" }).click();
  await expect(page).toHaveURL(APP + "/notices");
  await expect(items(page)).toHaveCount(10);
  await expect(items(page).first().locator(".unread")).toHaveCount(0);
  clean(log);
});

test("保護者の質問と先生の回答が、それぞれもう一方のブラウザに再読み込みなしで届く", async ({ browser }) => {
  const parent = await newPage(browser);
  const teacher = await newPage(browser);
  await login(parent.page, "tanaka", `/login?next=${encodeURIComponent(NOTICE)}`);
  await login(teacher.page, "teacher", `/login?next=${encodeURIComponent(NOTICE)}`);
  for (const { page } of [parent, teacher]) {
    await expect(page.locator(".question")).toHaveCount(2);
    await expect(page.locator(".ws-status")).toBeHidden();   // connected
  }
  await parent.page.getByLabel("先生に質問する").fill("上履きは必要ですか？");
  await parent.page.getByRole("button", { name: "質問を送る" }).click();
  const asked = teacher.page.locator(".question").filter({ hasText: "上履きは必要ですか？" });
  await expect(asked).toBeVisible();
  await expect(asked.locator(".q-from")).toHaveText("田中 花子");
  await expect(parent.page.getByLabel("先生に質問する")).toHaveValue("");

  await asked.getByRole("button", { name: "回答する" }).click();
  await teacher.page.getByRole("textbox", { name: "回答", exact: true }).fill("はい、持ってきてください。");
  await teacher.page.getByRole("button", { name: "回答を送る" }).click();
  const mine = parent.page.locator(".question").filter({ hasText: "上履きは必要ですか？" });
  await expect(mine.locator(".a-text")).toHaveText("はい、持ってきてください。");
  await expect(parent.page.locator(".question")).toHaveCount(3);
  await expect(teacher.page.locator(".question")).toHaveCount(3);
  clean(parent.log);
  clean(teacher.log);
  await parent.page.context().close();
  await teacher.page.context().close();
});

test("ソケットが切れても自分で戻り、切れている間の回答を失わず、質問を重ねない", async ({ page }) => {
  const log = watchConsole(page);
  await login(page, "suzuki", `/login?next=${encodeURIComponent(NOTICE)}`);
  await expect(page.locator(".question")).toHaveCount(2);
  await expect(page.locator(".ws-status")).toBeHidden();
  const token = await apiToken("teacher");
  const open = (await api(`/api${NOTICE}/questions`, token)).json.find((q: any) => !q.answer);

  // this browser's reconnect is held for 2 s: the teacher answers while it is not listening
  await hook("/api/_test/ws-delay", { ms: 2000, user: "suzuki" });
  await hook("/api/_test/ws/drop");
  await expect(page.locator(".ws-status")).toContainText("接続が切れました");
  const ws = new WebSocket(`${APP.replace(/^http/, "ws")}/ws${NOTICE}?token=${token}`);
  await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
  ws.send(JSON.stringify({ type: "answer", questionId: open.id, text: "雨天の場合は延期します。" }));
  await expect.poll(async () => (await api(`/api${NOTICE}/questions`, token)).json.find((q: any) => q.id === open.id).answer?.text)
    .toBe("雨天の場合は延期します。");
  ws.close();
  await expect(page.locator(".question").filter({ hasText: open.text }).locator(".a-text")).toHaveCount(0);   // not yet

  // back by itself: the questions are loaded again and merged by id
  await expect(page.locator(".ws-status")).toBeHidden({ timeout: 10_000 });
  await expect(page.locator(".question").filter({ hasText: open.text }).locator(".a-text")).toHaveText("雨天の場合は延期します。");
  await expect(page.locator(".question")).toHaveCount(2);
  await hook("/api/_test/ws-delay", { ms: 0 });

  await page.getByLabel("先生に質問する").fill("持ち物はいつまでに？");
  await page.getByRole("button", { name: "質問を送る" }).click();
  await expect(page.locator(".question")).toHaveCount(3);
  await page.waitForTimeout(300);
  await expect(page.locator(".question").filter({ hasText: "持ち物はいつまでに？" })).toHaveCount(1);
  clean(log);
});

test("お知らせを離れるとソケットは閉じる — まだ接続中に離れても、ブラウザは警告しない", async ({ page }) => {
  const log = watchConsole(page);
  await login(page, "tanaka");
  await expect(items(page)).toHaveCount(10);
  // every handshake is held 1.5 s: the reader leaves the notice while its socket is still connecting
  await hook("/api/_test/ws-delay", { ms: 1500 });
  await page.goto(APP + NOTICE);
  await expect(page.locator(".notice-body")).toBeVisible();
  await expect(page.locator(".ws-status")).toHaveText("接続しています…");
  await page.getByRole("link", { name: "← お知らせ一覧へ" }).click();
  await expect(items(page)).toHaveCount(10);
  // <wcs-ws> left with the route: the socket was let go and closed once it opened (4.11) — not aborted while
  // connecting, which Chromium reports as "WebSocket is closed before the connection is established."
  // (up to 4.10 the browser aborted the handshake: the server saw the connection go before it could answer)
  await expect.poll(async () => (await serverLog()).sockets.at(-1)?.event, { timeout: 10_000 }).toMatch(/^(close|gave-up)$/);
  expect((await serverLog()).sockets.map((s) => s.event)).toEqual(["open", "close"]);
  expect((await serverLog()).openSockets).toBe(0);
  await page.waitForTimeout(300);
  clean(log);
});

test("先生が添付付きのお知らせを保存すると、添付は Authorization ヘッダー付きで上がり、編集して 2 回保存できる", async ({ page }) => {
  const log = watchConsole(page);
  await openNewForm(page);
  await page.getByLabel("タイトル（60文字まで）").fill("社会科見学の持ち物");
  await page.getByLabel("区分").selectOption("event");
  await page.getByLabel("本文").fill("お弁当と水筒を持たせてください。");
  await page.getByLabel("日付").fill("2026-12-01");
  await page.getByLabel("時刻").fill("09:30");
  await page.getByLabel("添付ファイルを選ぶ").setInputFiles(pdf("持ち物リスト.pdf"));
  await expect(page.locator(".file-row")).toContainText("保存時に送信します");
  await page.getByRole("button", { name: "保存する" }).click();

  await expect(page).toHaveURL(APP + "/notices/26");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("社会科見学の持ち物");
  await expect(page.locator(".deadline-box")).toHaveText("締め切り 12月1日(火) 09:30まで");
  await expect(page.locator(".attachments").getByRole("link", { name: "持ち物リスト.pdf" })).toBeVisible();
  // <wcs-upload> with <wcs-upload-header name="Authorization"> (4.9; on 4.2.0 the app drove UploadCore itself)
  expect((await serverLog()).uploads.map(({ at: _at, ...u }) => u)).toEqual([{ path: "/api/notices/26/attachments", auth: "header", status: 201 }]);
  const download = await page.request.get(APP + await page.locator(".attachments a").getAttribute("href"));
  expect(download.status()).toBe(200);

  for (const title of ["社会科見学の持ち物（更新）", "社会科見学の持ち物（再更新）"]) {
    await page.getByRole("link", { name: "編集する" }).click();
    await expect(page).toHaveURL(APP + "/notices/26/edit");
    await expect(page.locator(".file-row")).toContainText("添付済み");
    await page.locator("#edit-title").fill(title);
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page).toHaveURL(APP + "/notices/26");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  }
  await expect(page.locator(".attachments li")).toHaveCount(1);
  expect((await serverLog()).uploads).toHaveLength(1);
  clean(log);
});

test("サーバーの 422 はそれぞれの欄の隣に出て、その欄は aria-invalid になる", async ({ page }) => {
  const log = watchConsole(page);
  await openNewForm(page);
  await page.getByLabel("タイトル（60文字まで）").fill("あ".repeat(61));
  await page.getByLabel("日付").fill("2020-01-01");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.locator("#new-title-error")).toHaveText("タイトルは60文字以内で入力してください。");
  await expect(page.locator("#new-body-error")).toHaveText("本文を入力してください。");
  await expect(page.locator("#new-deadline-error")).toHaveText("締め切りに過去の日時は指定できません。");
  await expect(page.locator("#new-title")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#new-body")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#new-cat")).not.toHaveAttribute("aria-invalid");
  await expect(page.locator(".form-error")).toHaveText("入力内容を確認してください。");
  await expect(page).toHaveURL(APP + "/notices/new");
  clean(log, status(422));
});

test("未保存のフォームを離れるときは先に聞き、断れば留まり、認めれば離れる（リンクと戻る）", async ({ page }) => {
  const log = watchConsole(page);
  await openNewForm(page);
  await page.getByLabel("タイトル（60文字まで）").fill("書きかけ");
  const asked: string[] = [];
  page.on("dialog", (d) => { asked.push(d.message()); void d.dismiss(); });
  await page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name: "欠席連絡" }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe(LEAVE);
  await expect(page).toHaveURL(APP + "/notices/new");
  await expect(page.locator("#new-title")).toHaveValue("書きかけ");

  // (page.goBack() would wait for a navigation the router cancels — the author's F18)
  await page.evaluate(() => history.back());
  await expect.poll(() => asked.length).toBe(2);
  await expect(page).toHaveURL(APP + "/notices/new");
  await expect(page.locator("#new-title")).toHaveValue("書きかけ");

  page.removeAllListeners("dialog");
  page.on("dialog", (d) => void d.accept());
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(APP + "/notices");
  // the list is on screen before Forward: a Forward within the frame the Back's view transition takes leaves the
  // list on screen under /notices/new (the router diffs against the routes before the Back — docs/seam-apps.md)
  await expect(items(page)).toHaveCount(10);
  await page.goForward();
  await expect(page).toHaveURL(APP + "/notices/new");
  await expect(page.locator("#new-title")).toHaveValue("");   // a fresh form
  clean(log);
});

test("トークンが切れてもフォームの上でログインし直せ、書きかけは残り、保存はそのまま通る", async ({ page }) => {
  const log = watchConsole(page);
  await openNewForm(page);
  await page.getByLabel("タイトル（60文字まで）").fill("期限切れのあとで保存");
  await page.getByLabel("本文").fill("ログインし直しても下書きは残ります。");
  await hook("/api/_test/expire");
  await page.getByRole("button", { name: "保存する" }).click();
  const dialog = page.getByRole("dialog", { name: "もう一度ログインしてください" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("#reauth-password")).toBeFocused();
  await expect(page.locator("#new-title")).toHaveValue("期限切れのあとで保存");
  await dialog.getByLabel("パスワード").fill("sensei1");
  await dialog.getByRole("button", { name: "ログイン" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(APP + "/notices/26");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("期限切れのあとで保存");
  clean(log, status(401));
});

test("欠席連絡: 422 は日付と理由の隣に出て、直すと送れて一覧に載る", async ({ page }) => {
  const log = watchConsole(page);
  await login(page, "tanaka");
  await page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name: "欠席連絡" }).click();
  await expect(page).toHaveURL(APP + "/absences");
  await expect(page.getByText("欠席連絡はまだありません。")).toBeVisible();
  await page.getByRole("link", { name: "欠席を連絡する" }).click();
  await expect(page).toHaveURL(APP + "/absences/new");
  await expect(page.getByText("児童: 田中 一郎")).toBeVisible();
  const today = await page.locator("#absence-date").inputValue();
  await page.getByLabel("日付").fill("2026-01-05");
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page.locator("#absence-date-error")).toHaveText("30日より前の日付は届け出できません。");
  await expect(page.locator("#absence-reason-error")).toHaveText("理由を選んでください。");
  await expect(page.locator("#absence-date")).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("日付").fill(today);
  await page.getByLabel("理由").selectOption("illness");
  await page.getByLabel("メモ（任意）").fill("熱があるため");
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page).toHaveURL(APP + "/absences");
  const rows = page.locator(".absence-table tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(["田中 一郎"]);
  await expect(rows.first()).toContainText("病気");
  await expect(rows.first()).toContainText("熱があるため");
  clean(log, status(422));
});

test("設定の文字の大きさと添付の表示は、再読み込みしても残り、お知らせに効く", async ({ page }) => {
  const log = watchConsole(page);
  await login(page, "tanaka");
  await page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name: "設定" }).click();
  await expect(page).toHaveURL(APP + "/settings");
  await page.getByLabel("大きい").check();
  await page.getByLabel("お知らせの添付ファイル一覧を表示する").uncheck();
  await expect(page.locator(".app")).toHaveClass(/text-large/);
  await page.reload();
  await expect(page.getByLabel("大きい")).toBeChecked();
  await expect(page.getByLabel("お知らせの添付ファイル一覧を表示する")).not.toBeChecked();
  await expect(page.locator(".app")).toHaveClass(/text-large/);
  await page.goto(APP + "/notices");
  await items(page).filter({ has: page.locator(".attach-count") }).first().locator("a").click();
  await expect(page.getByText("添付ファイルは設定で非表示になっています。")).toBeVisible();
  await expect(page.locator(".attachments")).toHaveCount(0);
  clean(log);
});

test("スキップリンクはページに留まり、本文へフォーカスを移す（戻るで元の URL）", async ({ page }) => {
  const log = watchConsole(page);
  await login(page, "teacher");
  await page.goto(APP + "/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("設定");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());   // Tab from the top
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "本文へスキップ" })).toBeFocused();
  await page.keyboard.press("Enter");
  // a bare fragment stays on the page under the router since 4.10 (on 4.2.0 "#main" under <base href="/"> went to "/")
  await expect(page).toHaveURL(APP + "/settings#main");
  await expect(page.locator("#main")).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("設定");
  await page.goBack();
  await expect(page).toHaveURL(APP + "/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("設定");
  clean(log);
});

test("state が報告したエラーはバナーを出し、/api/client-errors に 1 回だけ届く", async ({ page }) => {
  const log = watchConsole(page);
  // a list whose first notice says "many" attachments: its `if: .attachments|gt(0)` binding fails to apply
  await page.route(/\/api\/notices\?/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.items[0].attachments = "many";
    await route.fulfill({ response: res, json: body });
  });
  await login(page, "tanaka");
  await expect(items(page)).toHaveCount(10);
  // the engine's errors reach the page's "error" listener through reportError() (4.7; on 4.2.0 the app wrapped console.error)
  await expect(page.locator("#error-banner")).toBeVisible();
  await expect(page.locator("#error-banner")).toHaveText("問題が発生しました。再読み込みしてください");
  await expect.poll(async () => (await clientErrors()).length).toBe(1);
  await page.waitForTimeout(500);
  const reports = await clientErrors();
  expect(reports).toHaveLength(1);
  expect(reports[0].message).toContain("listItems.*.attachments");
  expect(reports[0].url).toBe(APP + "/notices");
  // the page's only problem is that error, reported once
  expect(log.problems).toHaveLength(1);
  expect(log.problems[0]).toMatch(/^pageerror: .*listItems\.\*\.attachments/);
  expect(onlyProvoked(log)).toEqual([]);
});

test("ログアウトはサーバーにトークンを忘れさせ、戻るで会員のページは出ない", async ({ page }) => {
  const log = watchConsole(page);
  await login(page, "tanaka");
  await expect(page).toHaveURL(APP + "/notices");
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("homeroom.session") ?? "null").token);
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(APP + "/login");
  expect(await page.evaluate(() => localStorage.getItem("homeroom.session"))).toBeNull();
  // the logout went with its token (the trigger is written before the session is cleared): the server forgot it
  expect((await api("/api/notices", token)).status).toBe(401);
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator(".notice-list")).toHaveCount(0);
  clean(log);
});

test("ほかのタブでのログアウトは、もう一方のタブを next 付きでログインへ送り、ログインし直すとそこへ戻る", async ({ page, context }) => {
  const log = watchConsole(page);
  await login(page, "suzuki");
  const other = await context.newPage();
  const otherLog = watchConsole(other);
  await other.goto(APP + "/notices/5");
  await expect(other.locator(".notice-body")).toBeVisible();
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(APP + "/login");
  await expect(other).toHaveURL(APP + "/login?next=%2Fnotices%2F5");
  await expect(other.locator(".notice-box")).toContainText("別のタブでログアウトしました");
  // said by the page-level status region, which is always in the page (so it is announced)
  await expect(other.getByRole("status").filter({ hasText: "別のタブでログアウトしました" })).toHaveCount(1);
  await login(other, "suzuki", null);
  await expect(other).toHaveURL(APP + "/notices/5");
  clean(log);
  clean(otherLog);
});

test("自分の部品が遅れて届いても、ページは動き、区分の文字は先に読める", async ({ page }) => {
  test.slow();
  const log = watchConsole(page);
  await login(page, "tanaka");
  await expect(items(page)).toHaveCount(10);
  await hook("/api/_test/component-delay", { ms: 6000 });
  await page.reload();
  await expect(page.locator("hr-avatar:not(:defined)")).toHaveCount(1);
  await expect(items(page)).toHaveCount(10);
  await expect(page.locator("hr-cat-badge:not(:defined)").first()).toBeVisible();
  // kept workaround: the label is a child <span>; a textContent: binding on the badge itself would wait for the
  // definition (4.11's diagnostics would say so 5 s after the page was ready, [wcs/element-undefined])
  await expect(page.locator(".notice-item hr-cat-badge").first()).toHaveText(/行事|宿題|保健|連絡/);
  await expect(page.locator("hr-avatar:defined")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator("hr-cat-badge:not(:defined)")).toHaveCount(0);
  expect(await page.locator("hr-avatar").evaluate((el) => el.shadowRoot?.querySelector("span")?.textContent)).toBe("田");
  clean(log);
});

// --- the upgrade: v4.2.0/ and public/ on one server -------------------------------------------------

/** 一覧 → 区分 → 2 ページ目 → お知らせ → 一覧へ戻る、を開いた版で */
async function smokeFlow(page: Page): Promise<void> {
  await login(page, "tanaka");
  await expect(items(page)).toHaveCount(10);
  await tabs(page).getByRole("link", { name: "行事" }).click();
  await expect(page).toHaveURL(APP + "/notices?cat=event");
  await expect(items(page)).toHaveCount(7);
  await tabs(page).getByRole("link", { name: "すべて" }).click();
  await expect(page).toHaveURL(APP + "/notices");
  await pager(page).getByRole("link", { name: "2ページ" }).click();
  await expect(page).toHaveURL(APP + "/notices?page=2");
  await items(page).first().locator("a").click();
  await expect(page.locator(".notice-body")).toBeVisible();
  await expect(page.locator(".ws-status")).toBeHidden();   // connected
  await page.getByRole("link", { name: "← お知らせ一覧へ" }).click();
  await expect(page).toHaveURL(APP + "/notices?page=2");
  await expect(items(page)).toHaveCount(10);
}

test("同じ操作が 4.2.0 の版と今の版で同じ要求を送る（回避策を外しても、取り直しも認証も変わらない）", async ({ browser }) => {
  const runs: Record<string, string[]> = {};
  for (const copy of ["v4.2.0", "public"] as const) {
    await hook("/api/_test/reset");
    await serve(copy);
    const { page, log } = await newPage(browser);
    const seen = recordRequests(page);
    const scripts: string[] = [];
    page.on("request", (r) => { if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname); });
    await smokeFlow(page);
    // each copy runs its own packages: the 4.2.0 files, or this tree's
    expect(scripts.filter((s) => /\/state[@/]/.test(s)), copy).toEqual(
      [copy === "public" ? "/packages/state/dist/auto.min.js" : "/vendor/@wcstack/state@4.2.0/dist/auto.min.js"]);
    clean(log);
    runs[copy] = seen.sort();
    await page.context().close();
  }
  expect(runs.public).toEqual(runs["v4.2.0"]);
  expect(runs.public).toContain("GET /api/notices?cat=&page=1 auth");
  expect(runs.public.filter((r) => r === "GET /api/notices?cat=&page=2 auth")).toHaveLength(2);   // there, and back again
});


test("4.2.0 の版を開いたままサーバーが今の版に替わっても、そのタブは 4.2.0 のまま動き、再読み込みで今の版になる", async ({ page }) => {
  const log = watchConsole(page);
  const loaded: string[] = [];
  page.on("request", (r) => { const p = new URL(r.url()).pathname; if (/^\/(packages|vendor)\//.test(p)) loaded.push(p); });
  await serve("v4.2.0");
  await login(page, "tanaka");
  await expect(items(page)).toHaveCount(10);
  expect(loaded.length).toBeGreaterThan(0);
  expect(loaded.every((p) => p.startsWith("/vendor/@wcstack/") && p.includes("@4.2.0/")), loaded.join("\n")).toBe(true);

  await serve("public");   // the deploy, under the open tab
  loaded.length = 0;
  // the open tab keeps the 4.2.0 engine in memory and talks to the same API: a category, a notice, a question
  await tabs(page).getByRole("link", { name: "宿題" }).click();
  await expect(items(page)).toHaveCount(7);
  await tabs(page).getByRole("link", { name: "すべて" }).click();
  await expect(items(page)).toHaveCount(10);
  await items(page).first().locator("a").click();
  await expect(page).toHaveURL(APP + NOTICE);
  await expect(page.locator(".question")).toHaveCount(2);
  await expect(page.locator(".ws-status")).toBeHidden();
  await page.getByLabel("先生に質問する").fill("開いたままのタブから");
  await page.getByRole("button", { name: "質問を送る" }).click();
  await expect(page.locator(".question")).toHaveCount(3);
  const teacher = await apiToken("teacher");
  expect((await api(`/api${NOTICE}/questions`, teacher)).json.map((q: any) => q.text)).toContain("開いたままのタブから");
  expect(loaded, "nothing of the new version reached the open tab").toEqual([]);

  // a reload is the new version, still logged in
  await page.reload();
  await expect(page.locator(".notice-body")).toBeVisible();
  await expect(page.locator(".who-name")).toHaveText("田中 花子");
  await expect(page.locator(".question")).toHaveCount(3);
  expect(loaded).toContain("/packages/state/dist/auto.min.js");
  expect(loaded.filter((p) => p.startsWith("/vendor/"))).toEqual([]);
  clean(log);
});

test("保存した設定とセッションは、4.2.0 から今の版へも、今の版から 4.2.0 へも読める", async ({ page }) => {
  const log = watchConsole(page);
  const stored = () => page.evaluate(() => [localStorage.getItem("homeroom.session"), localStorage.getItem("homeroom.settings")]);
  const settings = () => page.getByRole("navigation", { name: "メインメニュー" }).getByRole("link", { name: "設定" });
  await serve("v4.2.0");
  await login(page, "suzuki");
  await settings().click();
  await expect(page).toHaveURL(APP + "/settings");
  await page.getByLabel("大きい").check();
  await page.getByLabel("お知らせの添付ファイル一覧を表示する").uncheck();
  await expect(page.locator(".app")).toHaveClass(/text-large/);
  const by420 = await stored();
  expect(JSON.parse(by420[1] ?? "null")).toEqual({ textSize: "large", showAttachments: false });

  await serve("public");   // the upgrade
  await page.reload();
  await expect(page.locator(".who-name")).toHaveText("鈴木 美咲");
  await expect(page.getByLabel("大きい")).toBeChecked();
  await expect(page.getByLabel("お知らせの添付ファイル一覧を表示する")).not.toBeChecked();
  await expect(page.locator(".app")).toHaveClass(/text-large/);
  expect(await stored()).toEqual(by420);   // read as it was, the same strings
  await page.getByLabel("標準").check();
  await page.getByLabel("お知らせの添付ファイル一覧を表示する").check();
  await expect(page.locator(".app")).not.toHaveClass(/text-large/);

  await serve("v4.2.0");   // the rollback
  await page.reload();
  await expect(page.locator('script[src*="/state@4.2.0/"]')).toHaveCount(1);
  await expect(page.locator(".who-name")).toHaveText("鈴木 美咲");
  await expect(page.getByLabel("標準")).toBeChecked();
  await expect(page.getByLabel("お知らせの添付ファイル一覧を表示する")).toBeChecked();
  await expect(page.locator(".app")).not.toHaveClass(/text-large/);
  clean(log);
});
