import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// examples/city-library — 東京の市立図書館の利用者向けサイト（日本語・英語・アラビア語、継ぎ目アプリ、docs/seam-apps.md の
// city-library）。キーボードとスクリーンリーダーの利用者のために、公開文書だけから初めての作者が書き、4.10.0 で要らなく
// なった回避策を外したもの: <wcs-view-transition> の下でも $watch がバインディングの後に走る（ログインの $watch から
// next へ、422 の $watch からフォーカス）、素のフラグメントへのリンクがページに留まる（スキップリンク）、クエリ付きの
// <wcs-link> がそのクエリでだけ現在のページ、date / time のフィルターの時間帯、`query.next` の誤った警告の撤去、
// lint の --root。
//
// この spec は作者の確認（friction-log と scripts/flow-*.mjs）を意図として固定する: キーボードだけの検索 → 結果 →
// 資料 → 予約（422 で最初の誤りの欄へ）、取り消しの <dialog> とフォーカスの戻り先、深い URL のスキップリンク、ページ
// 送りの aria-current、トランジションの下のログインの next、予約の準備完了の通知（ページのライブリージョンに 1 回）、
// ロサンゼルスとロンドンから見た東京の開館時間、/ja/ /en/ /ar/ と言語の切り替え、reduced motion、すべてのページの
// 再読み込みと戻る・進む。読み上げは MutationObserver でリージョンの文の変化を記録し、フォーカスは focusin の時点の
// 属性で見る。コンソールは wcstack の警告もエラーも無いこと。わざと起こした HTTP の失敗にブラウザ自身が出す
// "Failed to load resource" の行は、family-ledger と同じく別に数える。
//
// デモのサーバーを WCS_LOCAL=1（esm.run → packages/*/dist）でワーカーごとに 7100 + 10 × index のポートで立てる
// （4600–4900 / 5000 / 5100 / 5200 / 5300–5540 / 5700– / 6100– は他の spec。fetch が拒むポート 6000 / 6566 /
// 6665–6669 を避ける）。
const PORT = 7100 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const APP = `http://localhost:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const CARD = "1002";   // Emily Carter, English
const PIN = "1234";

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/city-library/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const timer = setTimeout(() => fail(new Error("city-library server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("city-library on http")) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`city-library server exited with ${code}`)); });
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
});

// --- helpers -------------------------------------------------------------------

async function hook(path: string): Promise<any> {
  const res = await fetch(APP + path, { method: "POST" });
  expect(res.status, path).toBe(200);
  return res.json();
}
/** テストの外からの API 呼び出し（同じカードで、サーバーに予約を作る） */
async function placeHold(itemId: number, card = CARD): Promise<{ id: number; title: string }> {
  const login = await (await fetch(`${APP}/api/login?lang=en`, { method: "POST", body: JSON.stringify({ card, pin: PIN }) })).json();
  const res = await fetch(`${APP}/api/holds?lang=en`, {
    method: "POST",
    headers: { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, branch: "central", notify: "email", phone: "" }),
  });
  expect(res.status).toBe(201);
  return res.json();
}
const streamsOpen = (card: string) =>
  expect.poll(async () => (await (await fetch(`${APP}/__streams`, { method: "POST" })).json()).open.includes(card), { timeout: 15_000 }).toBe(true);

/**
 * コンソールの記録。`problems` は wcstack とページのエラー・警告（空であること）、`resources` はわざと起こした
 * HTTP の失敗（401・409・422）にブラウザ自身が出す "Failed to load resource" の行（ページからは消せない）。
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

/** 文の中の双方向の分離（U+2068 … U+2069、i18n/format.js の isolate）を外した文字列 */
const plain = (s: string | null) => (s ?? "").replace(/[⁨⁩]/g, "");

const h1 = (page: Page) => page.locator("main h1");
/** その path（言語の basename の下）に着き、ルートの見出しが出た */
async function at(page: Page, path: string, heading: string | RegExp): Promise<void> {
  await expect(page).toHaveURL(APP + path);
  await expect(h1(page)).toHaveText(heading);
}
/** Tab だけでその要素までフォーカスを進める（キーボードだけの利用者の道） */
async function tabTo(page: Page, target: Locator, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab ${max} 回で届かなかった: ${target}`);
}
const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  return el ? (el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}:${(el.textContent ?? "").trim().slice(0, 40)}`) : "";
});

async function login(page: Page, card = CARD): Promise<void> {
  await page.locator("#login-card").fill(card);
  await page.locator("#login-pin").fill(PIN);
  await page.locator(".login-form button[type=submit]").click();
}
/** ログインのページの next= を通って、その path に着く（ガードが送るのと同じ道） */
async function loginTo(page: Page, path: string, heading: string | RegExp): Promise<void> {
  await page.goto(`${APP}/en/login?next=${encodeURIComponent(path)}`);
  await expect(h1(page)).toHaveText("Log in");
  await login(page);
  await at(page, "/en" + path, heading);
  await expect(page.locator(".greeting")).toHaveText("Hello, Emily Carter");
}

/** document.startViewTransition の呼ばれた回数を数える（<wcs-view-transition> がトランジションを走らせたか） */
async function countTransitions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __vt: number };
    w.__vt = 0;
    const original = document.startViewTransition?.bind(document);
    if (original) {
      document.startViewTransition = ((arg: any) => { w.__vt++; return original(arg); }) as typeof document.startViewTransition;
    }
  });
}
const transitions = (page: Page) => page.evaluate(() => (window as unknown as { __vt: number }).__vt);

/**
 * ライブリージョンの文の変化を記録する（スクリーンリーダーが聞く変化）。リージョンはページにずっとある要素で、
 * その textContent が変わるたびに、空でなければ記録する。
 */
async function recordRegion(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const region = document.querySelector(sel)!;
    const w = window as unknown as { __said: Record<string, string[]> };
    (w.__said ??= {})[sel] = [];
    let last = region.textContent ?? "";
    new MutationObserver(() => {
      const now = (region.textContent ?? "").trim();
      if (now !== last.trim() && now !== "") w.__said[sel].push(now.replace(/[⁨⁩]/g, ""));
      last = now;
    }).observe(region, { childList: true, subtree: true, characterData: true });
  }, selector);
}
const said = (page: Page, selector: string) =>
  page.evaluate((sel) => (window as unknown as { __said: Record<string, string[]> }).__said[sel], selector);

/** 予約のフォームの focusin を、その時点の aria-invalid / aria-describedby と一緒に記録する */
async function recordFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __focus: string[] };
    w.__focus = [];
    document.addEventListener("focusin", (e) => {
      const el = e.target as HTMLElement;
      w.__focus.push(`${el.id ? "#" + el.id : el.tagName.toLowerCase()} invalid=${el.getAttribute("aria-invalid")} describedby=${el.getAttribute("aria-describedby")}`);
    });
  });
}
const focusLog = (page: Page) => page.evaluate(() => (window as unknown as { __focus: string[] }).__focus.splice(0));

/** API でログインしたセッションを、ページより先に localStorage に置く（ログインの画面を通らない） */
async function presetSession(page: Page, card = CARD): Promise<void> {
  const session = await (await fetch(`${APP}/api/login?lang=en`, { method: "POST", body: JSON.stringify({ card, pin: PIN }) })).json();
  await page.addInitScript((s) => localStorage.setItem("city-library.session", JSON.stringify(s)), session);
}

// --- tests -------------------------------------------------------------------

test("キーボードだけで検索 → 結果 → 資料 → ログイン → 予約: 件数は 1 回だけ聞こえ、422 では最初の誤りの欄が aria-invalid を持ってからフォーカスを受ける", async ({ page }) => {
  const log = watchConsole(page);
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await countTransitions(page);
  await page.goto(`${APP}/en/`);
  await expect(h1(page)).toHaveText("Welcome to the City Library");
  await recordRegion(page, "#search-announcer");

  await tabTo(page, page.locator("#home-q"));
  await page.keyboard.type("tokyo");
  await page.keyboard.press("Enter");
  await at(page, "/en/search?q=tokyo", "Catalogue");
  await expect(h1(page)).toBeFocused();   // focus="heading"
  await expect(page.locator("li.result .result-title")).toHaveText(["100 Cats of Tokyo", "A History of Tokyo", "Documentary: Tokyo 2023"]);
  await expect.poll(() => said(page, "#search-announcer")).toEqual(["“tokyo”: 3 items, Title, page 1 of 1"]);

  await tabTo(page, page.locator("li.result a").first());
  await page.keyboard.press("Enter");
  await at(page, "/en/items/30", "100 Cats of Tokyo");
  await expect(h1(page)).toBeFocused();
  await tabTo(page, page.getByRole("link", { name: "Log in to place a hold" }));
  await page.keyboard.press("Enter");
  await at(page, `/en/login?next=${encodeURIComponent("/items/30/hold")}`, "Log in");
  await tabTo(page, page.locator("#login-card"));
  await page.keyboard.type(CARD);
  await page.keyboard.press("Tab");
  await page.keyboard.type(PIN);
  await page.keyboard.press("Enter");
  await at(page, "/en/items/30/hold", "Place a hold");
  await expect(page.locator(".hold-item")).toHaveText("100 Cats of Tokyo");

  // 空のまま送る → 422: フォーカスは最初の誤りの欄へ、その時点で aria-invalid と説明が付いている
  await recordFocus(page);
  await tabTo(page, page.locator(".hold-form button[type=submit]"));
  await focusLog(page);
  await page.keyboard.press("Enter");
  await expect(page.locator("#hold-branch")).toBeFocused();
  expect(await focusLog(page)).toEqual(["#hold-branch invalid=true describedby=hold-branch-error"]);
  await expect(page.locator("#hold-branch-error")).toHaveText("Choose a pickup branch.");
  await expect(page.locator(".error-summary p")).toHaveText("There are 2 problems with the form.");

  await page.locator("#hold-branch").selectOption("central");
  await tabTo(page, page.locator("#hold-notify-email"));
  await page.keyboard.press("Space");
  await expect(page.locator("#hold-notify-email")).toBeChecked();
  await recordRegion(page, "p.flash");
  await tabTo(page, page.locator(".hold-form button[type=submit]"));
  await page.keyboard.press("Enter");
  await at(page, "/en/account", "My account");
  await expect(page.locator("li.hold h3")).toHaveText(["100 Cats of Tokyo"]);
  await expect.poll(() => said(page, "p.flash")).toEqual(["Your hold on “100 Cats of Tokyo” is placed."]);
  expect(await transitions(page)).toBeGreaterThan(0);   // <wcs-view-transition> がトランジションを走らせた
  expect(dialogs).toEqual([]);
  expect(log.problems).toEqual([]);
  expect(onlyProvoked(log, status(422))).toEqual([]);
});

test("@browsers 422 の要約は欄ごとのリンクを持ち、ページの中で欄へ移る。フォーカスは aria-invalid の付いた最初の欄へ", async ({ page }) => {
  const log = watchConsole(page);
  await presetSession(page);
  await page.goto(`${APP}/en/items/4/hold`);
  await expect(h1(page)).toHaveText("Place a hold");
  await expect(page.locator(".hold-item")).toHaveText("The Pragmatic Programmer");
  await page.locator("#hold-phone").fill("12");
  await recordFocus(page);
  await page.locator(".hold-form button[type=submit]").click();
  await expect(page.locator("#hold-branch")).toBeFocused();
  // button のクリックの後、最初の focusin が欄で、その時点で印が付いている
  expect((await focusLog(page)).filter((f) => !f.startsWith("button"))[0]).toBe("#hold-branch invalid=true describedby=hold-branch-error");
  await expect(page.locator(".error-summary p")).toHaveText("There are 3 problems with the form.");
  const links = page.locator(".error-summary a");
  await expect(links).toHaveText(["Choose a pickup branch.", "Choose how to be told.", "Enter the phone number as 10 or 11 digits (for example 09012345678)."]);
  await expect(page.locator("#hold-phone")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#hold-phone")).toHaveAttribute("aria-describedby", "hold-phone-hint hold-phone-error");

  // 要約のリンクはその欄へ: ルートは変わらず（入力は残り、離脱の確認も出ない）、URL にハッシュが付く
  await links.nth(2).click();
  await expect(page).toHaveURL(`${APP}/en/items/4/hold#hold-phone`);
  await expect(page.locator("#hold-phone")).toBeFocused();
  await expect(page.locator("#hold-phone")).toHaveValue("12");
  await links.nth(1).click();
  await expect(page).toHaveURL(`${APP}/en/items/4/hold#hold-notify-email`);
  await expect(page.locator("#hold-notify-email")).toBeFocused();
  await expect(h1(page)).toHaveText("Place a hold");
  expect(log.problems).toEqual([]);
  expect(onlyProvoked(log, status(422))).toEqual([]);
});

test("取り消しの <dialog>: 閉じればフォーカスは行のボタンへ、取り消せば一覧の見出しへ。結果はページのリージョンで 1 回聞こえる", async ({ page }) => {
  const log = watchConsole(page);
  await placeHold(3);
  await loginTo(page, "/account", "My account");
  const row = page.locator("li.hold", { hasText: "Norwegian Wood" });
  await expect(row).toBeVisible();
  const cancel = row.getByRole("button", { name: /Cancel the hold on/ });
  const dialog = page.locator("#cancel-dialog");

  await tabTo(page, cancel);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#cancel-dialog-body")).toHaveText(/“.?Norwegian Wood.?” will be cancelled/);
  await expect(dialog.getByRole("button", { name: "Keep it" })).toBeFocused();   // autofocus: 壊さない方の操作
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(cancel).toBeFocused();

  await recordRegion(page, "p.flash");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel the hold" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
  await expect(page.locator("main section[aria-labelledby=holds-h] > p")).toHaveText("You have no holds.");
  // 行と一緒にボタンが消えた: フォーカスは <body> ではなく一覧の見出し
  await expect(page.locator("#holds-h")).toBeFocused();
  await expect.poll(() => said(page, "p.flash")).toEqual(["Your hold on “Norwegian Wood” is cancelled."]);
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("@browsers 深い URL のスキップリンクはページに留まり、<main> にフォーカスを移す", async ({ page }) => {
  const log = watchConsole(page);
  await page.goto(`${APP}/en/search?q=tokyo&type=book`);
  await expect(h1(page)).toHaveText("Catalogue");
  await expect(page.locator("li.result")).toHaveCount(1);
  await page.evaluate(() => { (window as unknown as { __doc: string }).__doc = "same-document"; });
  const skip = page.locator("a.skip-link");
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await expect(skip).toHaveText("Skip to main content");
  await expect(skip).toHaveAttribute("href", "#main");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${APP}/en/search?q=tokyo&type=book#main`);
  await expect(page.locator("main#main")).toBeFocused();
  await expect(h1(page)).toHaveText("Catalogue");
  await expect(page.locator("li.result")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __doc: string }).__doc)).toBe("same-document");
  await page.keyboard.press("Tab");   // 次は本文の最初の欄
  await expect(page.locator("#search-q")).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(`${APP}/en/search?q=tokyo&type=book`);
  await expect(page.locator("li.result")).toHaveCount(1);

  // 右から左のページの資料でも同じ
  await page.goto(`${APP}/ar/items/16`);
  await expect(h1(page)).toHaveText("موسم الهجرة إلى الشمال");
  await page.keyboard.press("Tab");
  await expect(skip).toHaveText("انتقل إلى المحتوى الرئيسي");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${APP}/ar/items/16#main`);
  await expect(page.locator("main#main")).toBeFocused();
  await expect(h1(page)).toHaveText("موسم الهجرة إلى الشمال");
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("@browsers ページ送りの aria-current は表示しているページのリンクにだけある", async ({ page }) => {
  const log = watchConsole(page);
  await page.goto(`${APP}/en/search`);
  const pager = page.locator("nav.pager");
  const marked = pager.locator("a[aria-current]");
  const shown = async (n: number, of = 4) => {
    await expect(page.locator(".result-status")).toHaveText(new RegExp(`page ${n} of ${of}$`));
    await expect(marked).toHaveCount(1);
    await expect(marked).toHaveText(String(n));
    await expect(marked).toHaveAttribute("aria-current", "page");
  };
  await shown(1);
  await expect(pager.locator("li a")).toHaveText(["1", "2", "3", "4"]);
  // ナビゲーションの「Catalogue」（クエリの無い to）はパスだけで比べる: どのページでも現在のページ
  const nav = page.locator(".main-nav a", { hasText: "Catalogue" });
  await expect(nav).toHaveAttribute("aria-current", "page");

  await pager.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(`${APP}/en/search?page=2`);
  await shown(2);
  await expect(pager.getByRole("link", { name: "Previous page" })).toHaveAttribute("href", "/en/search?page=1");
  await expect(nav).toHaveAttribute("aria-current", "page");
  await pager.locator("li a", { hasText: /^4$/ }).click();
  await expect(page).toHaveURL(`${APP}/en/search?page=4`);
  await shown(4);
  await expect(pager.getByRole("link", { name: "Next page" })).toHaveCount(0);
  await pager.getByRole("link", { name: "Previous page" }).click();
  await expect(page).toHaveURL(`${APP}/en/search?page=3`);
  await shown(3);
  await page.goBack();
  await shown(4);
  await page.goBack();
  await shown(2);
  await page.goBack();
  await expect(page).toHaveURL(`${APP}/en/search`);
  await shown(1);
  await page.goForward();
  await shown(2);
  // 絞り込みと一緒でも
  await page.goto(`${APP}/en/search?type=book&sort=-year&page=2`);
  await shown(2, 2);
  await expect(pager.locator("li a").first()).toHaveAttribute("href", "/en/search?type=book&sort=-year&page=1");
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("@browsers <wcs-view-transition> の下でも、ログインは next へ着き、戻るはその前のページへ。ログアウトの後の戻るでは会員のページが出ない", async ({ page }) => {
  const log = watchConsole(page);
  await countTransitions(page);
  await page.goto(`${APP}/en/items/3`);
  await expect(h1(page)).toHaveText("Norwegian Wood");
  await page.getByRole("link", { name: "Log in to place a hold" }).click();
  await at(page, `/en/login?next=${encodeURIComponent("/items/3/hold")}`, "Log in");
  await expect(page.locator("main .lead")).toHaveText("You need to log in to see that page.");
  await login(page);
  // $watch（token）からの next への移動は、<wcs-storage> がセッションを保存した後: ガードはそれを読んで通す
  await at(page, "/en/items/3/hold", "Place a hold");
  await expect(page.locator(".greeting")).toHaveText("Hello, Emily Carter");
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem("city-library.session")))!)).toMatchObject({ card: CARD });
  expect(await transitions(page)).toBeGreaterThan(0);

  await page.goBack();   // ログインのページは置き換えられている
  await at(page, "/en/items/3", "Norwegian Wood");
  await expect(page.getByRole("link", { name: "Place a hold on this item" })).toBeVisible();
  await page.goForward();
  await at(page, "/en/items/3/hold", "Place a hold");

  await page.locator(".session button", { hasText: "Log out" }).click();
  await at(page, "/en/", "Welcome to the City Library");
  await expect(page.locator(".session a", { hasText: "Log in" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`${APP}/en/login?next=${encodeURIComponent("/items/3/hold")}`);
  await expect(h1(page)).toHaveText("Log in");
  await expect(page.locator(".hold-form")).toHaveCount(0);
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("ヘッダーのログインは next 無しのログインへ: 案内は出ず、PIN の誤りはその場で、正しければマイページへ", async ({ page }) => {
  const log = watchConsole(page);
  await page.goto(`${APP}/en/`);
  await expect(h1(page)).toHaveText("Welcome to the City Library");
  await page.locator(".session a", { hasText: "Log in" }).click();
  await at(page, "/en/login", "Log in");
  await expect(page.locator("main .lead")).toHaveCount(0);   // if: query.next — URL に next が無い
  await page.locator("#login-card").fill(CARD);
  await page.locator("#login-pin").fill("9999");
  await page.locator(".login-form button[type=submit]").click();
  await expect(page.locator(".login-form [role=alert]")).toHaveText("The card number or PIN is wrong.");
  await expect(page).toHaveURL(`${APP}/en/login`);
  // `query` は router の searchParams: next の無い URL でも、診断は "query.next" を誤りと言わない
  expect(log.problems).toEqual([]);
  await page.locator("#login-pin").fill(PIN);
  await page.locator(".login-form button[type=submit]").click();
  await at(page, "/en/account", "My account");
  await expect(page.locator("main section[aria-labelledby=holds-h] > p")).toHaveText("You have no holds.");
  // 検索のページからのログインは、そのページを next に持つ
  await page.locator(".session button", { hasText: "Log out" }).click();
  await at(page, "/en/", "Welcome to the City Library");
  await page.goto(`${APP}/en/search?q=tokyo`);
  await expect(page.locator(".session a", { hasText: "Log in" })).toHaveAttribute("href", `/en/login?next=${encodeURIComponent("/search?q=tokyo")}`);
  expect(log.problems).toEqual([]);   // [wcs/binding-path-missing] "query.next" も無い
  expect(onlyProvoked(log, status(401))).toEqual([]);
});

test("予約の準備完了の知らせは、サイトのどこにいてもページのライブリージョンに 1 回だけ書かれる", async ({ page }) => {
  const log = watchConsole(page);
  await loginTo(page, "/search?q=tokyo", "Catalogue");
  const hold = await placeHold(3);
  await streamsOpen(CARD);
  await recordRegion(page, ".notices");
  const notices = page.locator(".notices .notice");
  await hook(`/__ready?hold=${hold.id}`);
  await expect(notices).toHaveCount(1);
  await expect(notices).toHaveText([/^Your hold “.?Norwegian Wood.?” is ready at Central Library\.$/]);
  // 同じ知らせをもう一度（新しい id で、同じ id で）: 書き足さない
  await hook(`/__resend?hold=${hold.id}`);
  await hook(`/__resend?hold=${hold.id}&sameId=1`);
  // その後の別の知らせ（期限切れ）が届いたら、前の 2 つも処理済み
  await hook(`/__expire?hold=${hold.id}`);
  await expect(notices).toHaveCount(2);
  await expect(notices.nth(1)).toHaveText(/^Your hold “.?Norwegian Wood.?” has expired\.$/);
  const heard = await said(page, ".notices");
  expect(heard).toHaveLength(2);
  expect(heard[1].match(/is ready/g)).toHaveLength(1);
  // リージョンはルートの外: 移動しても残る
  await page.locator(".main-nav a", { hasText: "Opening hours" }).click();
  await at(page, "/en/hours", "Opening hours");
  await expect(notices).toHaveCount(2);
  await expect(page.locator(".notices")).toHaveAttribute("role", "log");
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

for (const zone of [
  { id: "America/Los_Angeles", reader: "Wed, 5:00 PM PDT – Thu, 4:00 AM PDT" },
  { id: "Europe/London", reader: "Thu, 12:00 AM GMT – Thu, 11:00 AM GMT" },
]) {
  test(`@browsers ${zone.id} から見ても開館時間は東京の時刻で、読み手の時刻は別の列に出る`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: zone.id, locale: "en-US" });
    const page = await context.newPage();
    const log = watchConsole(page);
    await page.goto(`${APP}/en/hours?from=2026-10-29`);
    await expect(h1(page)).toHaveText("Opening hours");
    await expect(page.locator("main")).toContainText("All times are the library's local time in Tokyo (Japan Standard Time).");
    await expect(page.locator("main")).toContainText(`Your own time (${zone.id}) is shown too.`);
    const central = page.locator(".hours-branch").first();
    await expect(central.locator("h2")).toHaveText("Central Library");
    await expect(central.locator("thead th").nth(3)).toHaveText(`Your time (${zone.id})`);
    const thursday = central.locator("tbody tr").first();
    await expect(thursday.locator("th")).toHaveText("Thursday, October 29, 2026");
    await expect(thursday.locator("td")).toHaveText(["9:00 AM", "8:00 PM", zone.reader]);
    // 休館日: 川辺分館の月曜
    const monday = page.locator(".hours-branch").nth(1).locator("tbody tr").nth(4);
    await expect(monday.locator("th")).toHaveText("Monday, November 2, 2026");
    await expect(monday.locator("td")).toHaveText(["Closed", "—", "—"]);
    // 日本語のページも東京の日付と時刻
    await page.goto(`${APP}/ja/hours?from=2026-10-29`);
    await expect(h1(page)).toHaveText("開館時間");
    const row = page.locator(".hours-branch").first().locator("tbody tr").first();
    await expect(row.locator("th")).toHaveText("2026年10月29日木曜日");
    await expect(row.locator("td").nth(0)).toHaveText("9:00");
    await expect(row.locator("td").nth(1)).toHaveText("20:00");
    expect(log.problems).toEqual([]);
    expect(log.resources).toEqual([]);
    await context.close();
  });
}

test("返却期限と手数料の日付は、ロサンゼルスから見ても東京の日付", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "America/Los_Angeles", locale: "en-US" });
  const page = await context.newPage();
  const log = watchConsole(page);
  await page.goto(`${APP}/en/items/4`);
  await expect(h1(page)).toHaveText("The Pragmatic Programmer");
  const copies = page.locator("table.copies tbody tr");
  await expect(copies.nth(0).locator("th, td")).toHaveText(["Riverside Branch", "On loan", "Oct 24, 2026"]);   // 23:59 東京
  await expect(copies.nth(1).locator("th, td")).toHaveText(["Hilltop Branch", "Available", "—"]);
  await loginTo(page, "/account/fees", "Fees");
  // 2026-09-28 の東京の 0 時は、ロサンゼルスでは 27 日
  await expect(page.locator("table.fees tbody tr").first().locator("th, td")).toHaveText(["Sep 28, 2026", "Late return (Clean Code)", "¥1,200"]);
  await expect(page.locator("main")).toContainText("1 fee, ¥1,200 in total");
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
  await context.close();
});

test("@browsers / は読み手の言語へ。/ja/ /en/ /ar/ は lang と dir を持ち、言語の切り替えは素のリンクで、選んだ言語を覚える", async ({ browser }) => {
  const context = await browser.newContext({ locale: "ja-JP" });
  const page = await context.newPage();
  const log = watchConsole(page);
  await page.goto(`${APP}/`);
  await at(page, "/ja/", "市立図書館へようこそ");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

  await page.goto(`${APP}/ar/search?q=tokyo`);
  await at(page, "/ar/search?q=tokyo", "الفهرس");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("li.result")).toHaveCount(3);
  // 言語の切り替え: 別の basename への素の <a>（<wcs-link> はこのページの basename を前に付ける）
  await expect(page.locator(".lang-nav wcs-link")).toHaveCount(0);
  await expect(page.locator(".lang-nav a")).toHaveText(["日本語", "English", "العربية"]);
  await expect(page.locator('.lang-nav a[hreflang="ar"]')).toHaveAttribute("aria-current", "true");
  const english = page.locator('.lang-nav a[hreflang="en"]');
  await expect(english).toHaveAttribute("href", "/en/search?q=tokyo");
  await expect(english).toHaveAttribute("lang", "en");
  await page.evaluate(() => { (window as unknown as { __doc: string }).__doc = "ar"; });
  await english.click();
  await at(page, "/en/search?q=tokyo", "Catalogue");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  expect(await page.evaluate(() => (window as unknown as { __doc?: string }).__doc)).toBeUndefined();   // 新しい文書
  await expect(page.locator("li.result")).toHaveCount(3);
  // 選んだ言語は、ブラウザの言語（ja）より先に効く
  await page.goto(`${APP}/`);
  await at(page, "/en/", "Welcome to the City Library");
  await page.goto(`${APP}/fr/hours`);   // 言語の形をした知らない区切りは、覚えた言語へ直す
  await at(page, "/en/hours", "Opening hours");
  await page.goto(`${APP}/settings`);   // 言語の無い URL には足す
  await at(page, "/en/settings", "Display settings");
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
  await context.close();
});

test("入力途中の予約から別の言語へ移ると、ページの言語で確認する。断れば元のページと元の言語のまま", async ({ browser }) => {
  const context = await browser.newContext({ locale: "ar" });
  const page = await context.newPage();
  const log = watchConsole(page);
  await presetSession(page);
  await page.goto(`${APP}/en/items/16/hold`);
  await expect(h1(page)).toHaveText("Place a hold");
  await page.locator("#hold-phone").fill("09012345678");
  const dialogs: string[] = [];
  page.once("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); });
  await page.locator('.lang-nav a[hreflang="ja"]').click();
  await expect.poll(() => dialogs).toEqual(["What you entered for this hold will be lost. Leave this page?"]);
  await expect(page).toHaveURL(`${APP}/en/items/16/hold`);
  await expect(page.locator("#hold-phone")).toHaveValue("09012345678");
  // 覚えた言語は変わっていない: 言語の無い URL はブラウザの言語（ar）へ
  const other = await context.newPage();
  await other.goto(`${APP}/`);
  await expect(other).toHaveURL(`${APP}/ar/`);
  await other.close();
  // 受け入れれば移り、その言語を覚える
  page.once("dialog", (d) => { dialogs.push(d.message()); void d.accept(); });
  await page.locator('.lang-nav a[hreflang="ja"]').click();
  await at(page, "/ja/items/16/hold", "予約する");
  const third = await context.newPage();
  await third.goto(`${APP}/`);
  await expect(third).toHaveURL(`${APP}/ja/`);
  expect(dialogs).toHaveLength(2);
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
  await context.close();
});

test("reduced motion と「アニメーションなし」ではトランジションを走らせず、移動もログインもそのまま動く", async ({ browser }) => {
  for (const mode of ["no-preference", "reduce", "off"] as const) {
    const context = await browser.newContext({ reducedMotion: mode === "reduce" ? "reduce" : "no-preference" });
    const page = await context.newPage();
    const log = watchConsole(page);
    await countTransitions(page);
    if (mode === "off") {
      // この端末の設定: 「アニメーションなし」（<wcs-storage> に残り、再読み込みの後も効く）
      await page.goto(`${APP}/en/settings`);
      await page.getByLabel("No animations").check();
      await page.reload();
      await expect(page.getByLabel("No animations")).toBeChecked();
    }
    await page.goto(`${APP}/en/`);
    await expect(h1(page)).toHaveText("Welcome to the City Library");
    const before = await transitions(page);
    await page.locator(".main-nav a", { hasText: "Catalogue" }).click();
    await at(page, "/en/search", "Catalogue");
    await page.locator("li.result a").first().click();
    await expect(page).toHaveURL(/\/en\/items\/\d+$/);
    await page.getByRole("link", { name: "Log in to place a hold" }).click();
    await expect(page).toHaveURL(/\/en\/login\?next=/);
    await login(page);
    await expect(page).toHaveURL(/\/en\/items\/\d+\/hold$/);
    await expect(h1(page)).toHaveText("Place a hold");
    await page.locator(".main-nav a", { hasText: "Display settings" }).click();
    await at(page, "/en/settings", "Display settings");
    await expect(page.locator("main")).toContainText(`Your system setting: ${mode === "reduce" ? "reduce motion" : "no preference"}`);
    const ran = (await transitions(page)) - before;
    if (mode === "no-preference") expect(ran, mode).toBeGreaterThan(0);
    else expect(ran, mode).toBe(0);
    expect(log.problems).toEqual([]);
    expect(log.resources).toEqual([]);
    await context.close();
  }
});

test("どのページも、再読み込みで同じページ・同じ内容に戻る", async ({ page }) => {
  const log = watchConsole(page);
  await placeHold(3);
  await loginTo(page, "/account", "My account");
  const pages: [string, string, () => Promise<void>][] = [
    ["/en/", "Welcome to the City Library", async () => {
      await expect(page.locator("ul.today li")).toHaveCount(3);
      await expect(page.locator("ul.today li strong")).toHaveText(["Central Library", "Riverside Branch", "Hilltop Branch"]);
    }],
    ["/en/hours?from=2026-10-29", "Opening hours", async () => {
      await expect(page.locator(".hours-branch").first().locator("tbody th").first()).toHaveText("Thursday, October 29, 2026");
    }],
    ["/en/search?q=tokyo&type=book", "Catalogue", async () => {
      await expect(page.locator("li.result .result-title")).toHaveText(["A History of Tokyo"]);
      await expect(page.locator("#search-q")).toHaveValue("tokyo");
      await expect(page.locator("#search-type")).toHaveValue("book");
    }],
    ["/en/items/3", "Norwegian Wood", async () => {
      await expect(page.locator(".item-desc")).toHaveText(/Haruki Murakami/);
    }],
    ["/en/items/4/hold", "Place a hold", async () => {
      await expect(page.locator(".hold-item")).toHaveText("The Pragmatic Programmer");
    }],
    ["/en/account", "My account", async () => {
      await expect(page.locator("li.hold h3")).toHaveText(["Norwegian Wood"]);
    }],
    ["/en/account/fees", "Fees", async () => {
      await expect(page.locator("table.fees tbody tr")).toHaveCount(1);
    }],
    ["/en/settings", "Display settings", async () => {
      await expect(page.getByLabel("Follow my system setting")).toBeChecked();
    }],
    ["/en/no-such-page", "Page not found", async () => {}],
    ["/en/items/999", "Item not found", async () => {}],
  ];
  for (const [path, heading, check] of pages) {
    await page.goto(APP + path);
    await at(page, path, heading);
    await check();
    await page.reload();
    await at(page, path, heading);
    await check();
    await expect(page.locator(".greeting")).toHaveText("Hello, Emily Carter");
  }
  expect(log.problems).toEqual([]);
  expect(onlyProvoked(log, status(404))).toEqual([]);   // /api/items/999
});

test("リンクでたどったすべてのページを、戻る・進むで同じページと内容に戻る", async ({ page }) => {
  const log = watchConsole(page);
  await placeHold(3);
  await loginTo(page, "/", "Welcome to the City Library");
  type Stop = { path: string; heading: string; check?: () => Promise<void> };
  const stops: Stop[] = [{ path: "/en/", heading: "Welcome to the City Library" }];
  const go = async (click: () => Promise<void>, stop: Stop) => {
    await click();
    await at(page, stop.path, stop.heading);
    await stop.check?.();
    stops.push(stop);
  };
  const nav = (name: string) => page.locator(".main-nav a", { hasText: name });
  await go(() => nav("Opening hours").click(), { path: "/en/hours", heading: "Opening hours",
    check: () => expect(page.locator(".hours-branch")).toHaveCount(3) });
  await go(() => nav("Catalogue").click(), { path: "/en/search", heading: "Catalogue",
    check: () => expect(page.locator(".result-status")).toHaveText(/32 items/) });
  await go(async () => { await page.locator("#search-q").fill("tokyo"); await page.locator("#search-q").press("Enter"); },
    { path: "/en/search?q=tokyo", heading: "Catalogue", check: async () => {
      await expect(page.locator("li.result")).toHaveCount(3);
      await expect(page.locator("#search-q")).toHaveValue("tokyo");
    } });
  await go(() => page.locator("li.result a", { hasText: "A History of Tokyo" }).click(), { path: "/en/items/11", heading: "A History of Tokyo" });
  await go(() => page.getByRole("link", { name: "Place a hold on this item" }).click(), { path: "/en/items/11/hold", heading: "Place a hold",
    check: () => expect(page.locator(".hold-item")).toHaveText("A History of Tokyo") });
  await go(() => nav("My account").click(), { path: "/en/account", heading: "My account",
    check: () => expect(page.locator("li.hold h3")).toHaveText(["Norwegian Wood"]) });
  await go(() => page.locator(".account-nav a", { hasText: "Fees" }).click(), { path: "/en/account/fees", heading: "Fees",
    check: () => expect(page.locator("table.fees tbody tr")).toHaveCount(1) });
  await go(() => nav("Display settings").click(), { path: "/en/settings", heading: "Display settings" });

  for (let i = stops.length - 2; i >= 0; i--) {
    await page.goBack();
    await at(page, stops[i].path, stops[i].heading);
    await stops[i].check?.();
  }
  for (let i = 1; i < stops.length; i++) {
    await page.goForward();
    await at(page, stops[i].path, stops[i].heading);
    await stops[i].check?.();
  }
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("絞り込みの件数は応答ごとに 1 回、正しい数で聞こえ、結果のページで打つ文字は URL へ置き換えで書かれ、深いリンクの q は消えない", async ({ page }) => {
  const log = watchConsole(page);
  await page.goto(`${APP}/en/search?q=tokyo`);
  await expect(page.locator(".result-status")).toHaveText(/“.?tokyo.?”: 3 items/);
  await recordRegion(page, "#search-announcer");
  await page.locator("#search-type").selectOption("book");
  await expect(page).toHaveURL(`${APP}/en/search?q=tokyo&type=book`);
  await expect(page.locator("li.result")).toHaveCount(1);
  await expect.poll(() => said(page, "#search-announcer")).toEqual(["“tokyo”, Book: 1 item, Title, page 1 of 1"]);

  // 結果のページの欄で打つ: debounce の後に置き換え（履歴は増えない）、打った文字はそのまま
  const length = await page.evaluate(() => history.length);
  await page.locator("#search-q").fill("");
  await page.locator("#search-q").pressSequentially("history", { delay: 30 });
  await expect(page).toHaveURL(`${APP}/en/search?q=history&type=book`);
  await expect(page.locator("li.result .result-title")).toHaveText(["A History of Tokyo"]);
  await expect(page.locator("#search-q")).toHaveValue("history");
  expect(await page.evaluate(() => history.length)).toBe(length);
  await expect.poll(() => said(page, "#search-announcer")).toEqual(["“tokyo”, Book: 1 item, Title, page 1 of 1", "“history”, Book: 1 item, Title, page 1 of 1"]);

  // 深いリンク: debounce の最初の値（""）が URL の q を消さない
  await page.goto(`${APP}/en/search?q=${encodeURIComponent("猫")}`);
  await expect(page.locator("li.result .result-title")).toHaveText(["I Am a Cat"]);
  await page.waitForTimeout(1000);   // debounce（400 ms）が落ち着くより後
  await expect(page).toHaveURL(`${APP}/en/search?q=${encodeURIComponent("猫")}`);
  await expect(page.locator("#search-q")).toHaveValue("猫");
  expect(log.problems).toEqual([]);
  expect(log.resources).toEqual([]);
});

test("会員のページの深いリンクはログインの後そこへ着き、セッションが切れたらログインへ戻して next に残す", async ({ page }) => {
  const log = watchConsole(page);
  await page.goto(`${APP}/en/account/fees`);
  await expect(page).toHaveURL(`${APP}/en/login?next=${encodeURIComponent("/account/fees")}`);
  await expect(page.locator("table.fees")).toHaveCount(0);
  await login(page);
  await at(page, "/en/account/fees", "Fees");
  await expect(page.locator("table.fees tbody tr")).toHaveCount(1);
  // サーバーがセッションを忘れた（再起動）: 次の会員の要求が 401 → ログインへ、戻り先は今のページ
  await hook("/__reset");
  await page.locator(".account-nav a", { hasText: "Holds" }).click();
  await expect(page).toHaveURL(`${APP}/en/login?next=${encodeURIComponent("/account")}`);
  await expect(h1(page)).toHaveText("Log in");
  await expect(page.locator(".session a", { hasText: "Log in" })).toBeVisible();
  await login(page);
  await at(page, "/en/account", "My account");
  expect(log.problems).toEqual([]);
  expect(onlyProvoked(log, status(401))).toEqual([]);
});
