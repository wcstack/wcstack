import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// examples/family-ledger — 二人で使う家計簿（継ぎ目アプリ、docs/seam-apps.md の family-ledger）。AI の作成スキルだけを
// 入口にした初めての作者が書き、4.9.0 で要らなくなった回避策を外したもの: <wcs-upload-header> でトークンを付ける
// アップロード、<wcs-sse auto-reconnect>、応答のイベント（eventToken.value + $on）で知る削除の完了。
//
// この spec は作者の確認（checks.md と e2e/check-*.mjs）を意図として固定する: 再読み込み・ログアウト中のディープリンク・
// ログアウト後の戻る・2 回目・2 つのブラウザ・409・編集中のトークン切れ・422・領収書・遅い／失敗するサーバー・オフライン・
// サーバーの再起動・離脱の確認・CSV と設定。サーバーが見たもの（/__log: ストリームの要求とその答え、アップロードの
// トークンの来かた）と画面の両方で見る。コンソールは wcstack の警告もエラーも無いこと。わざと起こした HTTP の失敗に
// ブラウザ自身が出す "Failed to load resource" の行は、作者と同じく別に数える。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）でワーカーごとに 5900 + 10 × index のポートで立てる
// （4600–4900 / 5000 / 5100 / 5200 / 5300–5540 / 5700– は他の spec）。
const PORT = 5900 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const APP = `http://localhost:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const MOM = "mom@example.com";
const DAD = "dad@example.com";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const LEAVE = "保存していない変更があります。破棄して移動しますか？";

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/family-ledger/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("family-ledger server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Demo server running")) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`family-ledger server exited with ${code}`)); });
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
  await hook("/__reset");
  await hook("/__token-ttl?ms=1800000");
});

// --- helpers -------------------------------------------------------------------

async function hook(path: string): Promise<any> {
  const res = await fetch(APP + path, { method: "POST" });
  expect(res.status, path).toBe(200);
  return res.json();
}
type ServerLog = {
  now: number; openStreams: number;
  streams: { at: number; status: number; lastEventId: string | null }[];
  uploads: { at: number; entryId: number; auth: "header" | "query" | "none"; status: number }[];
};
const serverLog = async (): Promise<ServerLog> => (await fetch(`${APP}/__log`)).json();

/** テストの外からの API 呼び出し（もう一人の利用者、サーバーの中身の確認） */
async function apiToken(email = DAD): Promise<string> {
  const res = await fetch(`${APP}/api/login`, { method: "POST", body: JSON.stringify({ email, password: "pass" }) });
  return (await res.json()).token;
}
async function api(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; json: any }> {
  const token = init.token ?? await apiToken();
  const res = await fetch(APP + path, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const entriesOf = async (month: string): Promise<any[]> => (await api(`/api/entries?month=${month}`)).json.entries;

/**
 * コンソールの記録。`problems` は wcstack とページのエラー・警告（空であること）、`resources` はわざと起こした
 * HTTP の失敗にブラウザ自身が出す "Failed to load resource" の行（ページからは消せない — 作者の friction #10）。
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
/** 起こした失敗だけ: `resources` の行がどれも許した形のどれかに当たる */
const onlyProvoked = (log: ConsoleLog, ...allow: RegExp[]) => log.resources.filter((r) => !allow.some((re) => re.test(r)));
const status = (...codes: number[]) => new RegExp(`the server responded with a status of (${codes.join("|")})`);

async function login(page: Page, email = MOM): Promise<void> {
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill("pass");
  await page.locator("button[type=submit]", { hasText: "ログイン" }).click();
}
/** ログインして、その path に着く（ログインのページの next= を通る — ガードが通すのと同じ道） */
async function loginTo(page: Page, path: string, email = MOM): Promise<void> {
  await page.goto(`${APP}/login?next=${encodeURIComponent(path)}`);
  await login(page, email);
  await expect(page).toHaveURL(APP + path);
  await expect(page.locator("header .who")).toHaveText(`${email === MOM ? "母" : "父"} さん`);
}
const rows = (page: Page) => page.locator("li.entry");
const row = (page: Page, memo: string) => page.locator("li.entry", { has: page.locator(".memo", { hasText: memo }) });
const fieldError = (page: Page, name: string) => page.locator("label", { has: page.locator(`[name=${name}]`) }).locator(".field-error");
/** 月のページが、その月のデータを出し終えた */
async function monthShown(page: Page, title: string): Promise<void> {
  await expect(page.locator(".month-nav h1")).toHaveText(title);
  await expect(page.locator(".total strong")).toBeVisible();
}
/** フォームを埋める（月のページの「＋ 追加」から開いたフォームか編集のフォーム） */
async function fillEntry(page: Page, e: { date?: string; amount?: string; categoryId?: string; memo?: string }): Promise<void> {
  if (e.date !== undefined) await page.locator("input[name=date]").fill(e.date);
  if (e.amount !== undefined) await page.locator("input[name=amount]").fill(e.amount);
  if (e.categoryId !== undefined) await page.locator("select[name=categoryId]").selectOption(e.categoryId);
  if (e.memo !== undefined) await page.locator("input[name=memo]").fill(e.memo);
}
const saveButton = (page: Page) => page.locator("form button[type=submit]", { hasText: "保存" });
/** ストリームを開いているページの数がサーバーから見て n になるまで待つ */
const streamsOpen = (n: number) => expect.poll(async () => (await serverLog()).openStreams, { timeout: 15_000 }).toBe(n);

// --- tests -------------------------------------------------------------------

test("再読み込みしても、どのページも同じページ・同じデータ・同じ絞り込みのまま", async ({ page }) => {
  const log = watchConsole(page);
  await loginTo(page, "/months/2026-09?category=food&sort=-amount");
  const monthView = async () => {
    await monthShown(page, "2026年9月");
    await expect(page.locator("li.entry .amount")).toHaveText(["¥7,650", "¥2,480"]);   // 食費だけ、金額の大きい順
    await expect(page.locator("select[name=category]")).toHaveValue("food");
    await expect(page.locator("select[name=sort]")).toHaveValue("-amount");
  };
  await monthView();
  await page.reload();
  await expect(page).toHaveURL(`${APP}/months/2026-09?category=food&sort=-amount`);
  await monthView();
  await expect(page.locator("header .who")).toHaveText("母 さん");

  await page.goto(`${APP}/entries/8/edit`);
  for (let i = 0; i < 2; i++) {
    await expect(page).toHaveTitle("記録を編集 - 家計簿");
    await expect(page.locator("input[name=memo]")).toHaveValue("ティッシュ");
    await expect(page.locator("input[name=amount]")).toHaveValue("1280");
    await expect(page.locator("select[name=categoryId]")).toHaveValue("daily");
    if (i === 0) await page.reload();
  }

  await page.goto(`${APP}/budgets/2026-10`);
  const food = page.locator(".budget-row", { hasText: "食費" }).locator("input");
  await expect(food).toHaveValue("30000");
  await page.reload();
  await expect(page).toHaveURL(`${APP}/budgets/2026-10`);
  await expect(food).toHaveValue("30000");

  // 設定はこの端末に残る: 再読み込みのあとも、新しい記録の初期カテゴリと月の一覧のメモの列に効く
  await page.goto(`${APP}/settings`);
  await page.locator("select[name=defaultCategory]").selectOption("transport");
  await page.locator("input[name=showMemo]").uncheck();
  await page.reload();
  await expect(page.locator("select[name=defaultCategory]")).toHaveValue("transport");
  await expect(page.locator("input[name=showMemo]")).not.toBeChecked();
  await page.goto(`${APP}/entries/new?month=2026-09`);
  await expect(page.locator("select[name=categoryId]")).toHaveValue("transport");
  await expect(page.locator("input[name=date]")).toHaveValue("2026-09-01");
  await page.goto(`${APP}/months/2026-10`);
  await monthShown(page, "2026年10月");
  await expect(rows(page).first().locator(".memo")).toBeHidden();
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("ログアウト中のディープリンクは、ログインのあとちょうどその表示に着く", async ({ page }) => {
  const log = watchConsole(page);
  const deep = "/months/2026-09?category=food&sort=-amount";
  await page.goto(APP + deep);
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(deep);
  await expect(rows(page)).toHaveCount(0);
  await login(page);
  await expect(page).toHaveURL(APP + deep);
  await monthShown(page, "2026年9月");
  await expect(page.locator("li.entry .memo")).toHaveText(["外食", "スーパー"]);
  await expect(page.locator("select[name=category]")).toHaveValue("food");
  await expect(page.locator("select[name=sort]")).toHaveValue("-amount");
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("月の間とフォームの戻る・進むはそのページとデータに戻り、ログアウトの後の戻るでは会員のページが出ない", async ({ page }) => {
  const log = watchConsole(page);
  await loginTo(page, "/months/2026-10");
  await monthShown(page, "2026年10月");
  await page.locator(".month-nav a", { hasText: "前の月" }).click();
  await expect(page).toHaveURL(`${APP}/months/2026-09`);
  await expect(row(page, "スーパー")).toBeVisible();
  await page.locator(".month-nav a", { hasText: "前の月" }).click();
  await expect(page).toHaveURL(`${APP}/months/2026-08`);
  await expect(page.locator("p.empty")).toHaveText("この月の記録はまだありません。");
  await page.goBack();
  await expect(page).toHaveURL(`${APP}/months/2026-09`);
  await expect(row(page, "スーパー")).toBeVisible();
  await expect(row(page, "焼肉")).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(`${APP}/months/2026-10`);
  await expect(row(page, "焼肉")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(`${APP}/months/2026-09`);
  await expect(row(page, "スーパー")).toBeVisible();

  await row(page, "外食").locator("a", { hasText: "編集" }).click();
  await expect(page).toHaveURL(`${APP}/entries/5/edit`);
  await expect(page.locator("input[name=memo]")).toHaveValue("外食");
  await page.goBack();
  await expect(page).toHaveURL(`${APP}/months/2026-09`);
  await expect(row(page, "外食")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(`${APP}/entries/5/edit`);
  await expect(page.locator("input[name=memo]")).toHaveValue("外食");

  await page.locator("header button", { hasText: "ログアウト" }).click();
  await expect(page).toHaveURL(`${APP}/login`);
  const noMemberPage = async () => {
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("main h1")).toHaveText("ログイン");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('section[aria-label="記録フォーム"]')).toHaveCount(0);
    await expect(page.locator("header .who")).toHaveCount(0);
  };
  await page.goBack();
  await noMemberPage();
  await page.goBack();
  await noMemberPage();
  await page.goForward();
  await noMemberPage();
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("追加も編集も削除も、2 回目が 1 回目と同じに動く", async ({ page }) => {
  const log = watchConsole(page);
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.accept(); });
  await loginTo(page, "/months/2026-10");
  await monthShown(page, "2026年10月");

  const add = async (e: { date: string; amount: string; categoryId: string; memo: string }) => {
    await page.locator(".controls a", { hasText: "＋ 追加" }).click();
    await expect(page).toHaveURL(`${APP}/entries/new?month=2026-10`);
    await expect(page.locator('section[aria-label="記録フォーム"] h1')).toHaveText("記録を追加");
    await fillEntry(page, e);
    await saveButton(page).click();
    await expect(page).toHaveURL(`${APP}/months/${e.date.slice(0, 7)}`);
  };
  await add({ date: "2026-10-27", amount: "1111", categoryId: "daily", memo: "追加その1" });
  await expect(row(page, "追加その1").locator(".amount")).toHaveText("¥1,111");
  await add({ date: "2026-10-28", amount: "2222", categoryId: "food", memo: "追加その2" });
  await expect(row(page, "追加その2").locator(".amount")).toHaveText("¥2,222");
  await expect(row(page, "追加その1")).toBeVisible();
  const added = (await entriesOf("2026-10")).filter((e) => e.memo.startsWith("追加その"));
  expect(added.map((e) => e.memo).sort()).toEqual(["追加その1", "追加その2"]);   // 2 件、1 件ずつ

  const first = added.find((e) => e.memo === "追加その1")!;
  for (const [memo, amount] of [["編集1回目", "1234"], ["編集2回目", "4321"]]) {
    await page.locator("li.entry", { has: page.locator(".memo", { hasText: /^(追加その1|編集1回目)$/ }) }).locator("a", { hasText: "編集" }).click();
    await expect(page).toHaveURL(`${APP}/entries/${first.id}/edit`);
    // 2 回目のフォームは前の応答ではなく、保存した内容で埋まる
    await expect(page.locator("input[name=memo]")).toHaveValue(memo === "編集1回目" ? "追加その1" : "編集1回目");
    await expect(page.locator("input[name=amount]")).toHaveValue(memo === "編集1回目" ? "1111" : "1234");
    await fillEntry(page, { memo, amount });
    await saveButton(page).click();
    await expect(page).toHaveURL(`${APP}/months/2026-10`);
    await expect(row(page, memo)).toBeVisible();
  }
  const edited = (await api(`/api/entries/${first.id}`)).json;
  expect([edited.memo, edited.amount, edited.version]).toEqual(["編集2回目", 4321, 3]);   // 409 は無く、2 回とも保存された

  // 削除の 2 回目も月へ戻る: DELETE は 2 回とも 204 で、同じ値の `status` は何も知らせない — 応答のイベントで知る
  for (const memo of ["編集2回目", "追加その2"]) {
    await row(page, memo).locator("a", { hasText: "編集" }).click();
    await expect(page.locator("input[name=memo]")).toHaveValue(memo);
    await page.locator("form button", { hasText: "削除" }).click();
    await expect(page).toHaveURL(`${APP}/months/2026-10`);
    await expect(row(page, memo)).toHaveCount(0);
  }
  expect(dialogs).toEqual(["この記録を削除しますか？", "この記録を削除しますか？"]);
  expect((await entriesOf("2026-10")).map((e) => e.memo)).not.toContain("追加その2");
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("二つのブラウザ: 一方の追加と予算の変更が、もう一方の開いている月に再読み込みなしで届く", async ({ browser }) => {
  const mom = await browser.newContext();
  const dad = await browser.newContext();
  try {
    const momPage = await mom.newPage();
    const dadPage = await dad.newPage();
    const momLog = watchConsole(momPage);
    const dadLog = watchConsole(dadPage);
    await loginTo(momPage, "/months/2026-10", MOM);
    await loginTo(dadPage, "/months/2026-10", DAD);
    await monthShown(dadPage, "2026年10月");
    await expect(dadPage.locator(".total strong")).toHaveText("¥26,385");
    await streamsOpen(2);

    await momPage.locator(".controls a", { hasText: "＋ 追加" }).click();
    await fillEntry(momPage, { date: "2026-10-29", amount: "4321", categoryId: "daily", memo: "ライブ追加" });
    await saveButton(momPage).click();
    await expect(momPage).toHaveURL(`${APP}/months/2026-10`);
    await expect(row(dadPage, "ライブ追加")).toBeVisible();
    await expect(row(dadPage, "ライブ追加").locator(".by")).toHaveText("母");
    await expect(dadPage.locator(".total strong")).toHaveText("¥30,706");

    await momPage.locator(".controls a", { hasText: "予算" }).click();
    await expect(momPage).toHaveURL(`${APP}/budgets/2026-10`);
    const food = momPage.locator(".budget-row", { hasText: "食費" }).locator("input");
    await expect(food).toHaveValue("30000");
    await food.fill("15000");
    await momPage.locator("form button[type=submit]", { hasText: "保存" }).click();
    await expect(momPage.locator("main p.status", { hasText: "保存しました" })).toBeVisible();
    const dadFood = dadPage.locator(".budget-bars li", { hasText: "食費" });
    await expect(dadFood.locator(".nums")).toHaveText("¥17,445 / ¥15,000");
    await expect(dadFood.locator(".fill")).toHaveClass(/over/);
    await expect(dadFood.locator(".rest")).toHaveText("¥2,445 超過");
    expect((await api("/api/budgets?month=2026-10")).json.budgets.food).toBe(15000);

    // サーバーの検証のエラーは、その欄の隣に
    await food.fill("abc");
    await momPage.locator("form button[type=submit]", { hasText: "保存" }).click();
    await expect(momPage.locator(".budget-row", { hasText: "食費" }).locator(".field-error")).toHaveText("0以上の整数で入力してください");

    expect(momLog.problems).toEqual([]);
    expect(dadLog.problems).toEqual([]);
    expect(onlyProvoked(momLog, status(422))).toEqual([]);
    expect(dadLog.resources).toEqual([]);
  } finally {
    await mom.close();
    await dad.close();
  }
});

test("同じ記録を二人で編集すると、後の保存は 409 になり、相手の内容を読み込むことも自分の内容で上書きすることもできる", async ({ browser }) => {
  const mom = await browser.newContext();
  const dad = await browser.newContext();
  try {
    const momPage = await mom.newPage();
    const dadPage = await dad.newPage();
    const momLog = watchConsole(momPage);
    const dadLog = watchConsole(dadPage);
    await loginTo(momPage, "/entries/8/edit", MOM);
    await loginTo(dadPage, "/entries/8/edit", DAD);
    const conflict = dadPage.locator(".conflict");
    for (const p of [momPage, dadPage]) await expect(p.locator("input[name=memo]")).toHaveValue("ティッシュ");

    await fillEntry(momPage, { memo: "母が編集" });
    await saveButton(momPage).click();
    await expect(momPage).toHaveURL(`${APP}/months/2026-10`);
    await fillEntry(dadPage, { memo: "父が編集" });
    await saveButton(dadPage).click();
    await expect(conflict).toContainText("あなたが編集している間に、この記録が更新されました。");
    await expect(conflict).toContainText("サーバーにある最新の内容：2026-10-05 / ¥1,280 / 母が編集");
    await expect(dadPage).toHaveURL(`${APP}/entries/8/edit`);
    await dadPage.locator("button", { hasText: "相手の内容を読み込む" }).click();
    await expect(dadPage.locator("input[name=memo]")).toHaveValue("母が編集");
    await expect(conflict).toHaveCount(0);
    await fillEntry(dadPage, { memo: "父が編集2" });
    await saveButton(dadPage).click();
    await expect(dadPage).toHaveURL(`${APP}/months/2026-10`);
    expect((await api("/api/entries/8")).json.memo).toBe("父が編集2");

    // もう一度: 今度は自分の内容で上書きする
    await momPage.goto(`${APP}/entries/8/edit`);
    await dadPage.goto(`${APP}/entries/8/edit`);
    for (const p of [momPage, dadPage]) await expect(p.locator("input[name=memo]")).toHaveValue("父が編集2");
    await fillEntry(momPage, { memo: "母の勝ち" });
    await saveButton(momPage).click();
    await expect(momPage).toHaveURL(`${APP}/months/2026-10`);
    await fillEntry(dadPage, { memo: "父の上書き" });
    await saveButton(dadPage).click();
    await expect(conflict).toContainText("母の勝ち");
    await dadPage.locator("button", { hasText: "自分の内容で上書き" }).click();
    await expect(dadPage).toHaveURL(`${APP}/months/2026-10`);
    await expect(row(dadPage, "父の上書き")).toBeVisible();
    const saved = (await api("/api/entries/8")).json;
    expect([saved.memo, saved.version]).toEqual(["父の上書き", 5]);

    expect(momLog.problems).toEqual([]);
    expect(dadLog.problems).toEqual([]);
    expect(momLog.resources).toEqual([]);
    expect(onlyProvoked(dadLog, status(409))).toEqual([]);
    expect(dadLog.resources).toHaveLength(2);
  } finally {
    await mom.close();
    await dad.close();
  }
});

test("編集の途中でトークンが切れても、ログインし直すと入力は残っていて保存でき、ライブの更新も新しいトークンで戻る", async ({ page }) => {
  const log = watchConsole(page);
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.accept(); });
  await loginTo(page, "/entries/8/edit");
  await expect(page.locator("input[name=memo]")).toHaveValue("ティッシュ");
  await streamsOpen(1);
  await fillEntry(page, { memo: "期限切れ前に入力", amount: "4242" });
  await hook("/__expire");
  await saveButton(page).click();
  await expect(page).toHaveURL(`${APP}/login?next=${encodeURIComponent("/entries/8/edit")}`);
  expect(dialogs).toEqual([]);                          // ログインへ送られるときに「破棄しますか」とは聞かない
  await login(page);
  await expect(page).toHaveURL(`${APP}/entries/8/edit`);
  await expect(page.locator("input[name=memo]")).toHaveValue("期限切れ前に入力");
  await expect(page.locator("input[name=amount]")).toHaveValue("4242");
  await saveButton(page).click();
  await expect(page).toHaveURL(`${APP}/months/2026-10`);
  await expect(row(page, "期限切れ前に入力").locator(".amount")).toHaveText("¥4,242");

  // ストリームは新しいトークンで開き直されている: もう一人の追加が届く
  await streamsOpen(1);
  expect((await serverLog()).streams.at(-1)!.status).toBe(200);
  await api("/api/entries", { method: "POST", body: { date: "2026-10-30", amount: 500, categoryId: "other", memo: "再ログインの後", clientId: "after-relogin" } });
  await expect(row(page, "再ログインの後")).toBeVisible();
  expect(log.problems).toEqual([]);
  expect(onlyProvoked(log, status(401))).toEqual([]);
});

test("サーバーの 422 は、それぞれの欄の隣に出て、ほかの欄には出ない", async ({ page }) => {
  const log = watchConsole(page);
  await loginTo(page, "/entries/new?month=2026-10");
  const invalid = () => page.locator("form .invalid").evaluateAll((els) => els.map((e) => e.getAttribute("name")));
  for (const [amount, message] of [["-5", "金額は1円以上で入力してください"], ["abc", "金額は整数で入力してください"], ["", "金額を入力してください"]]) {
    await fillEntry(page, { date: "2026-10-27", amount, categoryId: "food" });
    await saveButton(page).click();
    await expect(fieldError(page, "amount")).toHaveText(message);
    await expect(fieldError(page, "date")).toHaveText("");
    await expect(fieldError(page, "categoryId")).toHaveText("");
    expect(await invalid()).toEqual(["amount"]);
  }
  for (const date of ["2026-10-32", "2026-02-30", "10/27"]) {
    await fillEntry(page, { date, amount: "100" });
    await saveButton(page).click();
    await expect(fieldError(page, "date")).toHaveText("日付が正しくありません（実在する日付を YYYY-MM-DD で）");
    await expect(fieldError(page, "amount")).toHaveText("");
    expect(await invalid()).toEqual(["date"]);
  }
  await fillEntry(page, { date: "", amount: "", categoryId: "", memo: "x".repeat(101) });
  await saveButton(page).click();
  await expect(fieldError(page, "date")).toHaveText("日付を入力してください");
  await expect(fieldError(page, "amount")).toHaveText("金額を入力してください");
  await expect(fieldError(page, "categoryId")).toHaveText("カテゴリを選んでください");
  await expect(fieldError(page, "memo")).toHaveText("メモは100文字以内で入力してください");
  expect(await invalid()).toEqual(["date", "amount", "categoryId", "memo"]);

  await fillEntry(page, { date: "2026-10-27", amount: "321", categoryId: "food", memo: "検証OK" });
  await saveButton(page).click();
  await expect(page).toHaveURL(`${APP}/months/2026-10`);
  await expect(row(page, "検証OK").locator(".amount")).toHaveText("¥321");
  expect(log.problems).toEqual([]);
  expect(onlyProvoked(log, status(422))).toEqual([]);
  expect(log.resources).toHaveLength(7);
});

test("領収書はトークン付きで上がり、画像でないもの・大きすぎるもの・サーバーが断ったものは理由を添えて伝える", async ({ page }) => {
  const log = watchConsole(page);
  await loginTo(page, "/entries/new?month=2026-10");
  const receipt = page.locator("input[name=receipt]");
  await receipt.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 10, 1) });
  await expect(fieldError(page, "receipt")).toHaveText("領収書のサイズが 5MB を超えています。小さい画像を選んでください。");
  expect(await receipt.evaluate((e: HTMLInputElement) => e.files!.length)).toBe(0);
  await receipt.setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(fieldError(page, "receipt")).toHaveText("領収書は JPEG / PNG / WebP の画像だけ選べます。");
  expect(await receipt.evaluate((e: HTMLInputElement) => e.files!.length)).toBe(0);

  await fillEntry(page, { date: "2026-10-27", amount: "880", categoryId: "daily", memo: "領収書つき" });
  await receipt.setInputFiles({ name: "ok.png", mimeType: "image/png", buffer: PNG });
  await expect(fieldError(page, "receipt")).toHaveText("");
  await saveButton(page).click();
  await expect(page).toHaveURL(`${APP}/months/2026-10`);
  const thumb = row(page, "領収書つき").locator("img.thumb");
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(1);
  const saved = (await entriesOf("2026-10")).find((e) => e.memo === "領収書つき")!;
  expect(saved.receiptUrl).toMatch(/^\/receipts\//);
  // サーバーが見たアップロードは 1 回だけ — Authorization ヘッダーで来て、受け付けた（大きすぎる・画像でないものは送られていない）
  expect((await serverLog()).uploads).toEqual([expect.objectContaining({ entryId: saved.id, auth: "header", status: 200 })]);

  // ページは通したがサーバーが断った（ここではサーバーの上限を 10 バイトに下げる）: 記録は保存され、その編集のページで知らせる
  await hook("/__receipt-max?bytes=10");
  await page.locator(".controls a", { hasText: "＋ 追加" }).click();
  await fillEntry(page, { date: "2026-10-28", amount: "990", categoryId: "food", memo: "断られた領収書" });
  await receipt.setInputFiles({ name: "ok.png", mimeType: "image/png", buffer: PNG });
  await saveButton(page).click();
  await expect(page).toHaveURL(/\/entries\/\d+\/edit$/);
  const id = Number(/\/entries\/(\d+)\/edit/.exec(page.url())![1]);
  expect((await api(`/api/entries/${id}`)).json).toEqual(expect.objectContaining({ memo: "断られた領収書", receiptUrl: null }));
  await expect(fieldError(page, "receipt")).toHaveText("領収書のサイズが 5MB を超えています。");
  await expect(page.locator("form p.error")).toHaveText("記録は保存しました。領収書だけ保存できませんでした。");
  expect((await serverLog()).uploads.at(-1)).toEqual(expect.objectContaining({ entryId: id, auth: "header", status: 413 }));
  // もう一度選べば、その記録に付く
  await hook(`/__receipt-max?bytes=${5 * 1024 * 1024}`);
  await receipt.setInputFiles({ name: "ok.png", mimeType: "image/png", buffer: PNG });
  await saveButton(page).click();
  await expect(page).toHaveURL(`${APP}/months/2026-10`);
  await expect(row(page, "断られた領収書").locator("img.thumb")).toBeVisible();
  expect((await serverLog()).uploads.at(-1)).toEqual(expect.objectContaining({ entryId: id, auth: "header", status: 200 }));
  expect(log.problems).toEqual([]);
  expect(onlyProvoked(log, status(413))).toEqual([]);
});

test("遅いサーバーと失敗するサーバー: 読み込み中が出て、再試行は効き、速い月の切り替えは最後に選んだ月で終わる", async ({ page }) => {
  const log = watchConsole(page);
  await loginTo(page, "/months/2026-10");
  await monthShown(page, "2026年10月");

  await page.goto(`${APP}/months/2026-10?delay=3000`);
  await expect(page.locator("p.status", { hasText: "読み込み中…" })).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  await expect(row(page, "焼肉")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("p.status", { hasText: "読み込み中…" })).toHaveCount(0);

  await page.goto(`${APP}/months/2026-10?fail=1`);
  const box = page.locator(".error-box");
  await expect(box).toContainText("この月のデータを読み込めませんでした（500: failed on purpose）。");
  await box.locator("button", { hasText: "再試行" }).click();
  await expect(row(page, "焼肉")).toBeVisible();
  await expect(box).toHaveCount(0);
  await expect(page).toHaveURL(`${APP}/months/2026-10`);       // 再試行は ?fail を外す（作者の設計: friction #6）

  await page.goto(`${APP}/months/2026-10?delay=2500`);
  await expect(row(page, "焼肉")).toBeVisible({ timeout: 10_000 });
  const nav = (label: string) => page.locator(".month-nav a", { hasText: label }).click();
  await nav("前の月");
  await nav("前の月");
  await nav("次の月");
  await expect(page).toHaveURL(`${APP}/months/2026-09?delay=2500`);
  await expect(row(page, "スーパー")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(3000);                              // 8 月と 10 月の応答が遅れて来ても上書きしない
  await expect(page.locator(".month-nav h1")).toHaveText("2026年9月");
  await expect(page.locator("li.entry .memo")).toHaveText(["スーパー", "洗剤", "定期券", "映画", "外食", "郵便・雑費"]);
  expect(log.problems).toEqual([]);
  expect(onlyProvoked(log, status(500))).toEqual([]);
});

test("オフラインではバナーが出て保存できず、つながると月が追いつく", async ({ page, context }) => {
  const log = watchConsole(page);
  await loginTo(page, "/months/2026-10");
  await monthShown(page, "2026年10月");
  await context.setOffline(true);
  await expect(page.locator(".banner.offline")).toHaveText("オフラインです。保存はオンラインに戻ってからできます。");
  await page.locator(".controls a", { hasText: "＋ 追加" }).click();
  await expect(page).toHaveURL(`${APP}/entries/new?month=2026-10`);
  await expect(saveButton(page)).toBeDisabled();
  await context.setOffline(false);
  await expect(page.locator(".banner.offline")).toHaveCount(0);
  await expect(saveButton(page)).toBeEnabled();
  await page.locator("form a", { hasText: "キャンセル" }).click();
  await expect(page).toHaveURL(`${APP}/months/2026-10`);
  await expect(row(page, "焼肉")).toBeVisible();

  await context.setOffline(true);
  await expect(page.locator(".banner.offline")).toBeVisible();
  await api("/api/entries", { method: "POST", body: { date: "2026-10-30", amount: 777, categoryId: "other", memo: "オフライン中", clientId: "offline-1" } });
  await page.waitForTimeout(1500);
  await expect(row(page, "オフライン中")).toHaveCount(0);
  await context.setOffline(false);
  await expect(row(page, "オフライン中")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".banner.offline")).toHaveCount(0);
  expect(log.problems).toEqual([]);
  expect(onlyProvoked(log, /net::ERR_INTERNET_DISCONNECTED/, /net::ERR_NETWORK_CHANGED/)).toEqual([]);
});

test("サーバーが再起動しても、ライブの更新はひとりでに戻り（auto-reconnect）、その間の変更にも追いつく", async ({ page }) => {
  const log = watchConsole(page);
  await loginTo(page, "/months/2026-10");
  await monthShown(page, "2026年10月");
  await streamsOpen(1);
  const before = (await serverLog()).streams.length;

  await hook("/__restart?ms=5000");             // ストリームを閉じ、5 秒のあいだ何にでも 502 で答える
  await expect(page.locator(".banner.live")).toHaveText("リアルタイム更新が切れました。再接続しています…");
  // 戻った直後（ストリームがつながる前）にもう一人が記録を足す
  await expect.poll(async () => (await fetch(`${APP}/api/categories`)).status, { timeout: 15_000 }).toBe(401);
  await api("/api/entries", { method: "POST", body: { date: "2026-10-30", amount: 999, categoryId: "other", memo: "再起動の直後", clientId: "restart-1" } });
  await streamsOpen(1);
  await expect(page.locator(".banner.live")).toHaveCount(0);
  await expect(row(page, "再起動の直後")).toBeVisible();          // つながり直したときの追いつき

  // ブラウザ自身のつなぎ直しは 502 で諦め（EventSource は二度と試さない）、その後の 200 は <wcs-sse> が開き直したもの
  const after = (await serverLog()).streams.slice(before).map((s) => s.status);
  expect(after).toContain(502);
  expect(after.at(-1)).toBe(200);
  expect(after.indexOf(502)).toBeLessThan(after.lastIndexOf(200));

  // 開き直したストリームで、そのあとの変更がライブで届く
  await api("/api/entries", { method: "POST", body: { date: "2026-10-30", amount: 998, categoryId: "other", memo: "再起動の後のライブ", clientId: "restart-2" } });
  await expect(row(page, "再起動の後のライブ")).toBeVisible();
  // サーバーが切ったストリーム（502 ではない）はブラウザがつなぎ直し、Last-Event-ID で続きを受ける
  await hook("/__drop");
  await expect(page.locator(".banner.live")).toBeVisible();
  await api("/api/entries", { method: "POST", body: { date: "2026-10-30", amount: 997, categoryId: "other", memo: "切断の後", clientId: "drop-1" } });
  await expect(row(page, "切断の後")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".banner.live")).toHaveCount(0);
  expect(log.problems).toEqual([]);
  expect(onlyProvoked(log, status(502), /net::ERR_INCOMPLETE_CHUNKED_ENCODING/)).toEqual([]);
});

test("変更したフォームを離れるときは、リンクでも戻るでもタブを閉じるときでも尋ね、変更が無ければ尋ねない", async ({ page }) => {
  const log = watchConsole(page);
  const dialogs: string[] = [];
  let answer: "accept" | "dismiss" = "dismiss";
  page.on("dialog", (d) => { dialogs.push(`${d.type()}: ${d.message()}`); void (answer === "accept" ? d.accept() : d.dismiss()); });
  await loginTo(page, "/months/2026-10");
  await monthShown(page, "2026年10月");
  await page.locator(".controls a", { hasText: "＋ 追加" }).click();
  await expect(page).toHaveURL(`${APP}/entries/new?month=2026-10`);
  await fillEntry(page, { memo: "未保存" });

  await page.locator("form a", { hasText: "キャンセル" }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toBe(`confirm: ${LEAVE}`);
  await expect(page).toHaveURL(`${APP}/entries/new?month=2026-10`);
  await expect(page.locator("input[name=memo]")).toHaveValue("未保存");

  await page.evaluate(() => history.back());     // page.goBack() は断られた移動を待ち続ける（作者の friction #11）
  await expect.poll(() => dialogs.length).toBe(2);
  expect(dialogs[1]).toBe(`confirm: ${LEAVE}`);
  await expect(page).toHaveURL(`${APP}/entries/new?month=2026-10`);
  await expect(page.locator("input[name=memo]")).toHaveValue("未保存");

  answer = "accept";
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(`${APP}/months/2026-10`);
  expect(dialogs).toHaveLength(3);

  await page.locator(".controls a", { hasText: "＋ 追加" }).click();
  await expect(page.locator("input[name=memo]")).toHaveValue("");    // 捨てたフォームは空で開き直す
  await page.locator("form a", { hasText: "キャンセル" }).click();
  await expect(page).toHaveURL(`${APP}/months/2026-10`);
  expect(dialogs).toHaveLength(3);                                    // 変更の無いフォームは尋ねない

  await page.locator(".controls a", { hasText: "＋ 追加" }).click();
  await fillEntry(page, { memo: "閉じる前" });
  answer = "dismiss";
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs.length).toBe(4);
  expect(dialogs[3]).toMatch(/^beforeunload: /);
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("CSV は見ている記録だけを絞り込みと並び順のままコピーし、設定は別のブラウザには移らない", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const other = await browser.newContext();
  try {
    const page = await context.newPage();
    const log = watchConsole(page);
    await loginTo(page, "/months/2026-09?category=food&sort=-amount");
    await monthShown(page, "2026年9月");
    await page.locator("button", { hasText: "CSVをコピー" }).click();
    await expect(page.locator("main p.status", { hasText: "コピー" })).toHaveText("2件をCSVとしてコピーしました");
    const csv = await page.evaluate(() => navigator.clipboard.readText());
    expect(csv.split("\r\n")).toEqual(["日付,カテゴリ,メモ,金額,入力者", "2026-09-21,食費,外食,7650,父", "2026-09-03,食費,スーパー,2480,母"]);

    await page.goto(`${APP}/settings`);
    await page.locator("select[name=defaultCategory]").selectOption("fun");
    await page.locator("input[name=showMemo]").uncheck();
    const otherPage = await other.newPage();
    const otherLog = watchConsole(otherPage);
    await loginTo(otherPage, "/settings");
    await expect(otherPage.locator("select[name=defaultCategory]")).toHaveValue("");
    await expect(otherPage.locator("input[name=showMemo]")).toBeChecked();
    expect(log.problems).toEqual([]);
    expect(otherLog.problems).toEqual([]);
  } finally {
    await context.close();
    await other.close();
  }
});
