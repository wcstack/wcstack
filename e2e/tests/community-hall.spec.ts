import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// examples/community-hall — みどり市民会館のサイト（継ぎ目アプリ、docs/seam-apps.md の community-hall）。wcstack がページを
// 持たない: 自前の CMS（{{ }} のテンプレート）が描き htmx 2 が入れ替えるサイトに、wcstack のアイランド（マイリスト・SSE の
// 空席・予約のフォーム・URL に載る絞り込み）を足し、提携先の旅館（別の origin・Turbo 8・自前の wcstack 4.17.0 の問い合わせ
// フォーム）に予約のウィジェットを置く。公開文書だけから初めての作者が 4.19.0 で書き、4.20.0 で要らなくなった回避策を外した
// もの: ページごとに新しい状態にするための inline の factory と import map（<wcs-state src> は要素ごとにモジュールを評価
// する）、lint のためだけに生成した stateSchema（JSDoc の Record<string, T> が下のパスを開く）、glob を並べるスクリプト。
// 残したもの（4.20 の案内どおりの書き方）: htmx が入れた断片を binder に渡し、捨てるときに release する（hall.js）、htmx の
// 履歴のキャッシュを切る（hx-history="false"）、scoped registry のウィジェット。htmx の popstate を止める回避策は htmx の側。
//
// この spec は作者の確認（tests/e2e の 7 件）を意図として固定し、4.20.0 の決定を 2 つ足す: 次のイベントの予約フォームが空で
// 始まる（4.19 では 1 つ目のイベントの枚数が出た）、検索で捨てたカードに席の変化が書き込まれない（4.19 では捨てたカードが
// 残り続けた）。
//
// デモのサーバーを WCS_LOCAL=1（会館とウィジェットの esm.run → packages/*/dist、旅館の 4.17.0 → 例の node_modules の
// npm の別名）でワーカーごとに会館 7700 + 10 × index・旅館 +5 のポートで立てる（4199–4900 / 5000–5540 / 5700– / 6100– /
// 7100– / 7300– / 7500– は他の spec）。htmx・Turbo・4.17.0 は例の node_modules から（e2e.yml が npm ci する）。
const HALL_PORT = 7700 + 10 * Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const INN_PORT = HALL_PORT + 5;
const HALL = `http://localhost:${HALL_PORT}`;
const INN = `http://localhost:${INN_PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const EXAMPLE = resolve(REPO_ROOT, "examples/community-hall");
const STATE_VERSION = JSON.parse(readFileSync(resolve(REPO_ROOT, "packages/state/package.json"), "utf8")).version as string;

let server: ChildProcess;

base.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/community-hall/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", HALL_PORT: String(HALL_PORT), INN_PORT: String(INN_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ready, fail) => {
    const up = new Set<string>();
    const timer = setTimeout(() => fail(new Error("community-hall server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      for (const m of chunk.toString().matchAll(/community-hall (hall|inn) on http/g)) up.add(m[1]);
      if (up.size === 2) { clearTimeout(timer); ready(); }
    });
    server.on("error", (err) => { clearTimeout(timer); fail(err); });
    server.on("exit", (code) => { clearTimeout(timer); fail(new Error(`community-hall server exited with ${code}`)); });
  });
});

// 子プロセスが終わるまで待つ: 同じワーカーで次に立てるサーバーが同じポートを使う。
base.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill();
  await exited;
});

base.beforeEach(async ({ request }) => {
  const res = await request.post(`${HALL}/api/_test/reset`);
  expect(res.ok()).toBe(true);
});

// --- fixtures and helpers --------------------------------------------------------------

type Guard = { allowStatuses: Set<number>; consoleClean(): void };

/**
 * どのページの捕まらない例外でもテストは落ちる。consoleClean() はコンソールにエラーも警告も無いことを確かめる — ただし
 * テスト自身が起こした HTTP の状態についてブラウザが出す "Failed to load resource" は除く。
 */
const test = base.extend<{ guard: Guard }>({
  guard: [async ({ context }, use) => {
    const messages: { type: string; text: string }[] = [];
    const pageErrors: string[] = [];
    const watch = (page: Page) => {
      page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") messages.push({ type: m.type(), text: m.text() }); });
      page.on("pageerror", (e) => pageErrors.push(`${page.url()}: ${e.message}`));
    };
    context.pages().forEach(watch);
    context.on("page", watch);
    const guard: Guard = {
      allowStatuses: new Set(),
      consoleClean() {
        const bad = messages.filter((m) => {
          const s = m.text.match(/Failed to load resource: the server responded with a status of (\d{3})/);
          return !(s && guard.allowStatuses.has(Number(s[1])));
        });
        expect(bad, "console errors / warnings").toEqual([]);
      },
    };
    await use(guard);
    expect(pageErrors, "uncaught page errors").toEqual([]);
  }, { auto: true }],
});

/** ページのルートの <wcs-state> がページを束ね、$connectedCallback を終えるまで待つ */
async function ready(page: Page) {
  await page.waitForFunction(() => customElements.get("wcs-state") && (document.querySelector("wcs-state") as any)?.connectedCallbackPromise);
  await page.evaluate(() => (document.querySelector("wcs-state") as any).connectedCallbackPromise);
}

const widget = (page: Page, i = 0) => page.locator("midori-booking").nth(i);

async function title(request: APIRequestContext, id: number) {
  return (await (await request.get(`${HALL}/api/events/${id}`)).json()).title as string;
}

// --- the hall's site (htmx 2) ------------------------------------------------------------

test.describe("会館のサイト（htmx 2 の上のアイランド）", () => {
  test("もっと見るで入ったカードの星がヘッダーの数・別のタブ・マイリストに出る", async ({ page, context, guard }) => {
    const other = await context.newPage();
    await other.goto(`${HALL}/my`);
    await ready(other);
    await expect(other.locator(".my-item")).toHaveCount(0);

    await page.goto(`${HALL}/events`);
    await ready(page);
    await expect(page.locator(".card")).toHaveCount(10);
    await page.getByRole("button", { name: "もっと見る" }).click();
    await expect(page.locator(".card")).toHaveCount(20);
    await expect(page).toHaveURL(/page=2/);
    const card = page.locator(".card").nth(14);
    const name = await card.locator(".card-title").innerText();
    await card.locator(".star").click();
    await expect(card.locator(".star")).toHaveText("★");
    await expect(card.locator(".star")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#mylist-count")).toHaveText("1");

    // マイリストを開いた別のタブはすぐに追いつく
    await expect(other.locator("#mylist-count")).toHaveText("1");
    await expect(other.locator(".my-item h2")).toHaveText([name]);

    // このタブのマイリストへ、ブーストしたリンクで
    await page.locator("header").getByRole("link", { name: /マイリスト/ }).click();
    await expect(page).toHaveURL(/\/my$/);
    await expect(page.locator(".my-item h2")).toHaveText([name]);
    await page.locator(".my-item").getByRole("button", { name: "マイリストから外す" }).click();
    await expect(page.locator(".my-item")).toHaveCount(0);
    await expect(other.locator(".my-item")).toHaveCount(0);
    await expect(other.locator("#mylist-count")).toHaveText("");
    guard.consoleClean();
  });

  test("検索で入ったカードの空席は、サーバーの変化に追いつく", async ({ page, request, guard }) => {
    await page.goto(`${HALL}/events`);
    await ready(page);
    await page.locator("#q").fill("陶芸");
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page).toHaveURL(/q=%E9%99%B6%E8%8A%B8/);
    const card = page.locator(".card").first();
    const id = Number(await card.getAttribute("data-event-id"));

    await request.post(`${HALL}/api/_test/seats`, { data: { id, remaining: 3 } });
    await expect(card.locator(".seats b")).toHaveText("3");
    await request.post(`${HALL}/api/_test/seats`, { data: { id, remaining: 0 } });
    await expect(card.locator(".seats")).toHaveClass(/soldout/);
    await expect(card.locator(".seats")).toContainText("満席");
    await expect(card.getByText(/残り/)).toBeHidden();
    guard.consoleClean();
  });

  test("3 枚の予約で、名前を入れた後に 1 枚を外し、422 を直して受け付けられる", async ({ page, guard }) => {
    guard.allowStatuses.add(422);
    await page.goto(`${HALL}/events`);
    await ready(page);
    await page.locator('.card[data-event-id="1"] .card-title a').click();
    await expect(page).toHaveURL(/\/events\/1$/);
    const form = page.locator("#booking-form");
    await expect(form).toBeVisible();
    const seatsBefore = Number(await page.locator("#event-seats").innerText());

    await page.locator("#t-adult").selectOption("3");
    const names = page.locator(".attendee-name");
    await expect(names).toHaveCount(3);
    await names.nth(0).fill("山田 太郎");
    await names.nth(1).fill("山田 花子");
    await names.nth(2).fill("山田 次郎");
    await page.locator(".attendee").nth(1).getByRole("button", { name: "この券を外す" }).click();
    await expect(names).toHaveCount(2);
    await expect(names.nth(0)).toHaveValue("山田 太郎");
    await expect(names.nth(1)).toHaveValue("山田 次郎");
    await expect(page.locator("#t-adult")).toHaveValue("2");
    await expect(page.locator("#booking-total")).toHaveText("4,000円");

    await page.getByLabel("お名前", { exact: true }).fill("山田 太郎");
    await page.getByLabel("電話番号").fill("12-34");
    await page.getByLabel("メールアドレス").fill("taro@example.jp");
    await page.getByRole("button", { name: "予約する" }).click();
    await expect(page.locator("#b-phone-error")).toHaveText(/電話番号の形式/);
    await expect(page.getByLabel("電話番号")).toHaveAttribute("aria-invalid", "true");
    await expect(names.nth(1)).toHaveValue("山田 次郎");      // 入れたものは失われない

    await page.getByLabel("電話番号").fill("0277-12-3456");
    await page.getByRole("button", { name: "予約する" }).click();
    const done = page.locator(".booking-done");
    await expect(done).toBeVisible();
    await expect(done.locator(".booking-id")).toHaveText(/^MH-\d+$/);
    await expect(done).toContainText("4,000");
    await expect(page.locator("#event-seats")).toHaveText(String(seatsBefore - 2));   // ストリームが新しい数を運んだ
    guard.consoleClean();
  });

  test("絞り込んだ一覧は再読み込みでき、戻る／進むで絞り込みと結果が一緒に戻る（履歴はサーバーから）", async ({ page, guard }) => {
    await page.goto(`${HALL}/events`);
    await ready(page);
    await page.locator("#filters summary").click();
    await page.getByLabel("音楽").check();
    await expect(page).toHaveURL(/cat=%E9%9F%B3%E6%A5%BD/);
    await page.getByLabel("空席ありのみ").check();
    await expect(page).toHaveURL(/available=1/);
    await page.getByLabel("並び順").selectOption("title");
    await expect(page).toHaveURL(/sort=title/);
    const filteredTitles = await page.locator(".card-title").allInnerTexts();
    expect(filteredTitles.length).toBeGreaterThan(0);
    await expect(page.locator(".card .tag")).toHaveText(filteredTitles.map(() => "音楽"));

    await page.reload();
    await ready(page);
    await expect(page.locator(".card-title")).toHaveText(filteredTitles);
    await expect(page.getByLabel("音楽")).toBeChecked();
    await expect(page.getByLabel("空席ありのみ")).toBeChecked();
    await expect(page.getByLabel("並び順")).toHaveValue("title");
    await expect(page.locator(".filter-summary").getByText("タイトル順")).toBeVisible();

    await page.goBack();                                    // "sort=title" の前
    await expect(page).not.toHaveURL(/sort=title/);
    await expect(page.getByLabel("並び順")).toHaveValue("date");
    await expect(page.getByLabel("空席ありのみ")).toBeChecked();
    await expect(page.locator(".filter-summary").getByText("タイトル順")).toBeHidden();
    await page.goBack();                                    // "available=1" の前
    await expect(page).not.toHaveURL(/available=1/);
    await expect(page.getByLabel("空席ありのみ")).not.toBeChecked();
    await expect(page.getByLabel("音楽")).toBeChecked();
    await page.goForward();
    await page.goForward();
    await expect(page).toHaveURL(/sort=title/);
    await expect(page.locator(".card-title")).toHaveText(filteredTitles);
    await expect(page.getByLabel("並び順")).toHaveValue("title");
    guard.consoleClean();
  });

  test("予約の節の文面はテンプレートで直せば、JavaScript に触れずに出る", async ({ page, guard }) => {
    const file = resolve(EXAMPLE, "templates", "booking.html");
    const original = readFileSync(file, "utf8");
    const before = "チケットの枚数を選び、参加される方全員のお名前をご記入ください。";
    const after = "【CMS編集テスト】枚数と参加者のお名前を入力してください。";
    expect(original).toContain(before);
    try {
      writeFileSync(file, original.replace(before, after));
      await page.goto(`${HALL}/events/2`);
      await ready(page);
      await expect(page.locator(".booking-intro")).toContainText(after);
      await expect(page.getByText(before)).toHaveCount(0);
    } finally {
      writeFileSync(file, original);
    }
    guard.consoleClean();
  });

  test("4.20: 次のイベントの予約フォームは空で始まる — ページごとの <wcs-state src> がモジュールを評価し直す", async ({ page, guard }) => {
    page.on("dialog", (d) => d.accept());               // 書きかけのフォームを離れる確認
    await page.goto(`${HALL}/events/1`);
    await ready(page);
    await page.locator("#t-adult").selectOption("2");
    await expect(page.locator(".attendee-name")).toHaveCount(2);
    await page.locator(".attendee-name").nth(0).fill("山田 太郎");

    await page.locator("header").getByRole("link", { name: "イベント", exact: true }).click();
    await expect(page).toHaveURL(/\/events$/);
    await page.locator('.card[data-event-id="2"] .card-title a').click();
    await expect(page).toHaveURL(/\/events\/2$/);
    await expect(page.locator("#booking-form")).toBeVisible();
    // 4.19 は同じオブジェクトを共有し、1 つ目のイベントの 2 枚・名前の欄が出た
    await expect(page.locator("#t-adult")).toHaveValue("0");
    await expect(page.locator(".attendee-name")).toHaveCount(0);
    guard.consoleClean();
  });

  test("4.20: 検索で捨てたカードは手放される — 席の変化は、文書から外れたカードのどれにも書き込まれない", async ({ page, request, guard }) => {
    await page.goto(`${HALL}/events`);
    await ready(page);
    const id = Number(await page.locator(".card").first().getAttribute("data-event-id"));
    // 検索するたびに htmx は #results の中身を捨て、hall.js が新しいカードを渡して古いものを release する
    for (let i = 0; i < 4; i++) {
      await page.locator("#q").fill("陶芸");
      await expect(page.locator(".card")).toHaveCount(1);
      await page.locator("#q").fill("");
      await expect(page.locator(".card")).toHaveCount(10);
    }
    await page.evaluate(() => {
      const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
      const w = window as any;
      w.__detachedWrites = 0;
      Object.defineProperty(Node.prototype, "textContent", {
        configurable: true,
        get: desc.get,
        set(this: Node, v: string) { if (!this.isConnected) w.__detachedWrites++; desc.set!.call(this, v); },
      });
    });
    await request.post(`${HALL}/api/_test/seats`, { data: { id, remaining: 7 } });
    await expect(page.locator(`.card[data-event-id="${id}"] .seats b`)).toHaveText("7");
    expect(await page.evaluate(() => (window as any).__detachedWrites)).toBe(0);
    guard.consoleClean();
  });
});

// --- the partner inn's site (another origin, Turbo 8, its own wcstack 4.17.0) -------------

test.describe("旅館のサイトの予約ウィジェット（別の origin・Turbo・自前の wcstack 4.17.0）", () => {
  test("ウィジェットで予約し、旅館のページを行き来して戻る。旅館の問い合わせフォームは動き続ける", async ({ page, request, guard }) => {
    await page.goto(`${INN}/`);
    // ウィジェットを使う前の、旅館自身のフォーム
    await page.locator("#contact-name").fill("佐藤");
    await page.locator("#contact-message").fill("駐車場はありますか");
    await page.locator("#contact-send").click();
    await expect(page.locator("#contact-done")).toContainText("佐藤 様");

    const w = widget(page);
    await expect(w.locator(".w-title")).toHaveText(await title(request, 1));
    await expect(w.locator(".w-remaining")).not.toBeEmpty();
    const before = Number(await w.locator(".w-remaining").innerText());
    // 旅館のスタイルシートはウィジェットに届かない（すべてのボタンを大文字・赤にし、[hidden] を見せる）
    await expect(w.locator(".w-submit")).toHaveCSS("text-transform", "none");
    await expect(w.locator(".w-submit")).toHaveCSS("background-color", "rgb(157, 179, 166)");   // 無効: まだ券が無い

    await w.locator(".w-adult").selectOption("2");
    await w.locator(".w-attendee-name").nth(0).fill("佐藤 一郎");
    await w.locator(".w-attendee-name").nth(1).fill("佐藤 花子");
    await w.locator(".w-name").fill("佐藤 一郎");
    await w.locator(".w-phone").fill("0277-11-2222");
    await w.locator(".w-email").fill("ichiro@example.jp");
    await w.locator(".w-submit").click();
    await expect(w.locator(".w-done")).toBeVisible();
    await expect(w.locator(".w-booking-id")).toHaveText(/^MH-\d+$/);
    await expect(w.locator(".w-remaining")).toHaveText(String(before - 2));

    // Turbo Drive: 宿泊プランへ、周辺のイベント（ウィジェット 2 つ）へ、戻る（Turbo のキャッシュの写し）、もう一度戻る
    await page.getByRole("link", { name: "ご宿泊プラン" }).first().click();
    await expect(page).toHaveURL(`${INN}/stay`);
    await page.getByRole("link", { name: "周辺のイベント" }).first().click();
    await expect(page).toHaveURL(`${INN}/events`);
    await expect(widget(page, 0).locator(".w-title")).toHaveText(await title(request, 2));
    await expect(widget(page, 1).locator(".w-title")).toHaveText(await title(request, 9));
    await expect(widget(page, 1).locator(".w-remaining")).not.toBeEmpty();
    await page.goBack();
    await expect(page).toHaveURL(`${INN}/stay`);
    await page.goBack();
    await expect(page).toHaveURL(`${INN}/`);
    await expect(widget(page).locator(".w-remaining")).toHaveText(String(before - 2));
    await expect(widget(page).locator(".w-submit")).toBeVisible();

    // その後の旅館のフォーム
    await page.locator("#contact-name").fill("鈴木");
    await page.locator("#contact-message").fill("夕食の時間について");
    await page.locator("#contact-send").click();
    await expect(page.locator("#contact-done")).toContainText("鈴木 様");

    // ウィジェットの wcstack はこのリポジトリの版、旅館のものは自前の 4.17.0 のまま
    const versions = await page.evaluate(() => {
      const s = Symbol.for("wcstack.package");
      return {
        inn: (customElements.get("wcs-state") as any)?.[s],
        widget: (document.querySelector("midori-booking")!.shadowRoot!.querySelector("wcs-state")!.constructor as any)[s],
      };
    });
    expect(versions).toEqual({ inn: "@wcstack/state@4.17.0", widget: `@wcstack/state@${STATE_VERSION}` });
    guard.consoleClean();
  });

  test("1 ページの 2 つのウィジェットは互いに独立し、席の変化に追いつく", async ({ page, request, guard }) => {
    await page.goto(`${INN}/events`);
    await expect(widget(page, 1).locator(".w-remaining")).toHaveText("1");
    await widget(page, 0).locator(".w-adult").selectOption("1");
    await expect(widget(page, 0).locator(".w-attendee-name")).toHaveCount(1);
    await expect(widget(page, 1).locator(".w-attendee-name")).toHaveCount(0);
    await request.post(`${HALL}/api/_test/seats`, { data: { id: 9, remaining: 0 } });
    await expect(widget(page, 1).locator(".w-seats").getByText("満席")).toBeVisible();
    await expect(widget(page, 1).locator(".w-submit")).toBeDisabled();
    await expect(widget(page, 0).locator(".w-seats").getByText("満席")).toBeHidden();
    guard.consoleClean();
  });
});
