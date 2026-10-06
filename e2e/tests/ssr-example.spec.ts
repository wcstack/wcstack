import { test, expect, type Page, type Request } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/ssr — @wcstack/server の renderToString() でページを描き、ブラウザの
// @wcstack/state がその DOM をハイドレートするデモ。テンプレートは
// `$connectedCallback` で /api/users を取得する一覧（for:）、`{{ counter }}` の
// カウンタ、`if: show` / `else:` の枝を持ち、`<wcs-state enable-ssr>` で
// スナップショット（<wcs-ssr>）を出させる。
//
// デモは自前のサーバー（server.js）がページを都度描くので serve.mjs には載せず、
// router-i18n.spec.ts と同じくワーカーごとに立てる。WCS_LOCAL=1 で
// renderToString は packages/server/dist（@wcstack/state は packages/server/node_modules
// のシンボリックリンク経由で packages/state）から、クライアントは
// /packages/state/dist/auto.min.js から読むので、サーバーとクライアントの両方が
// 作業ツリーの 4.0 エンジンになる（npm の @wcstack/server や esm.run は通らない）。
//
// この spec が固定するもの（docs/migration-v4.ja.md §3.6・packages/server/README.md）:
//  - 内容は JS より前に HTML に載っている（一覧・カウンタ・if の枝）
//  - <wcs-ssr version> が 4.0.x で、クライアントはそれを自分の出力として読む
//    （"does not match … snapshot is discarded" の警告が出ない）
//  - ハイドレーションはサーバーのノードをその場で引き取り、描き直さない。
//    `$connectedCallback` はサーバーで走ったのでクライアントでは走らない
//  - 引き取った後のボタン（+1 / Add / Remove / Toggle）が状態を変え、DOM が追従する
const PORT = Number(process.env.SSR_EXAMPLE_PORT || 4500) + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

// examples/ssr/server.js のモックデータ（/api/users）
const USERS = [
  { name: "Alice Johnson", role: "admin" },
  { name: "Bob Smith", role: "editor" },
  { name: "Charlie Davis", role: "viewer" },
  { name: "Diana Miller", role: "editor" },
  { name: "Ethan Wilson", role: "viewer" },
];

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/ssr/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, WCS_LOCAL: "1", PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error("demo server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("SSR Demo:")) {
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

/** console.warn を集める（バージョン不一致の警告は warn で出る） */
function collectWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning") warnings.push(msg.text());
  });
  return warnings;
}

/** ブラウザからの /api/users 要求を集める（ハイドレート時は 0 件のはず） */
function collectApiCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (req: Request) => {
    if (new URL(req.url()).pathname === "/api/users") calls.push(req.url());
  });
  return calls;
}

/** <wcs-state> の定義とバインディング構築（＝ハイドレーション）の完了を待つ */
async function hydrated(page: Page): Promise<void> {
  // 採用が始まると <wcs-ssr> は取り除かれる
  await expect(page.locator("wcs-ssr")).toHaveCount(0);
  await page.evaluate(async () => {
    const ctor = (await customElements.whenDefined("wcs-state")) as unknown as {
      getBindingsReady(root: Node): Promise<void>;
    };
    await ctor.getBindingsReady(document);
  });
}

const userItems = (page: Page) => page.locator("ul.user-list li.user-item");

test.describe("examples/ssr — サーバー描画", () => {
  test("生 HTML に一覧・カウンタ・if の枝と 4.0 のスナップショットが載る", async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.ok()).toBeTruthy();
    const html = await res.text();

    // スナップショットは 4.0 のエンジンが書いたもの（クライアントは major.minor で照合する）
    const version = html.match(/<wcs-ssr\b[^>]*\sversion="([^"]+)"/)?.[1];
    expect(version).toMatch(/^4\.0\./);
    // スナップショットの状態は $connectedCallback が取得した後のもの
    const snapshot = JSON.parse(html.match(/<wcs-ssr\b[\s\S]*?<script type="application\/json">([\s\S]*?)<\/script>/)![1]);
    expect(snapshot).toEqual({ users: USERS, show: true, counter: 0 });

    // 一覧の行・if の枝が展開済み（テンプレートの外に、値の入った要素として載る）
    for (const { name, role } of USERS) {
      expect(html).toMatch(new RegExp(`<span class="user-name">${name}</span>\\s*<span class="role-badge">${role}</span>`));
    }
    expect(html).toContain('<div class="info-box">This block is visible because show = true</div>');

    // WCS_LOCAL: クライアントは作業ツリーのバンドル
    expect(html).toContain('<script type="module" src="/packages/state/dist/auto.min.js"></script>');
    expect(html).not.toContain("esm.run");
  });

  test("JavaScript 無しでも描画済みの内容が見える", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${BASE}/`);

    await expect(page.locator("h2").nth(0)).toHaveText("Counter: 0");
    await expect(page.locator("h2").nth(1)).toHaveText("User List (5 users)");
    await expect(userItems(page)).toHaveCount(USERS.length);
    for (const [i, { name, role }] of USERS.entries()) {
      await expect(userItems(page).nth(i).locator(".user-name")).toHaveText(name);
      await expect(userItems(page).nth(i).locator(".role-badge")).toHaveText(role);
    }
    // show = true の枝だけが出ている
    await expect(page.locator(".info-box")).toHaveCount(1);
    await expect(page.locator(".info-box")).toHaveText("This block is visible because show = true");
    // マスタッシュが生のまま見えていない（FOUC が無い）
    expect(await page.locator("body").innerText()).not.toContain("{{");
    await context.close();
  });
});

test.describe("examples/ssr — ハイドレーション", () => {
  test("サーバーのノードをその場で引き取り、描き直さない", async ({ page }) => {
    const errors = collectErrors(page);
    const warnings = collectWarnings(page);
    const apiCalls = collectApiCalls(page);

    // state のバンドルを止めておき、ハイドレーション前の DOM に目印を付ける
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await page.route("**/packages/state/dist/auto.min.js", async (route) => {
      await gate;
      await route.continue();
    });

    await page.goto(`${BASE}/`, { waitUntil: "commit" });
    await expect(userItems(page)).toHaveCount(USERS.length);
    await expect(page.locator(".info-box")).toHaveCount(1);
    expect(await page.evaluate(() => customElements.get("wcs-state"))).toBeUndefined();
    await expect(page.locator("wcs-ssr")).toHaveCount(1);

    await page.evaluate(() => {
      type Marked = Node & { __ssrMark?: string };
      document.querySelectorAll("li.user-item").forEach((li, i) => { (li as Marked).__ssrMark = `row-${i}`; });
      (document.querySelector(".info-box") as Marked).__ssrMark = "branch";
      document.querySelectorAll("h2").forEach((h, i) => { (h as Marked).__ssrMark = `h2-${i}`; });
    });

    release();
    await hydrated(page);

    // 行・枝・見出しはどれもハイドレーション前と同じノード（二重描画も置き換えもない）
    const marks = await page.evaluate(() => {
      type Marked = Node & { __ssrMark?: string };
      return {
        rows: Array.from(document.querySelectorAll("li.user-item"), (li) => (li as Marked).__ssrMark ?? null),
        branches: Array.from(document.querySelectorAll(".info-box"), (b) => (b as Marked).__ssrMark ?? null),
        headings: Array.from(document.querySelectorAll("h2"), (h) => (h as Marked).__ssrMark ?? null),
      };
    });
    expect(marks.rows).toEqual(USERS.map((_, i) => `row-${i}`));
    expect(marks.branches).toEqual(["branch"]);
    expect(marks.headings.slice(0, 3)).toEqual(["h2-0", "h2-1", "h2-2"]);
    await expect(page.locator("h2").nth(0)).toHaveText("Counter: 0");
    await expect(page.locator("h2").nth(1)).toHaveText("User List (5 users)");

    // 状態はスナップショットから: $connectedCallback（/api/users の取得）はクライアントで走らない
    expect(apiCalls).toEqual([]);
    // 4.0 のサーバー出力を 4.0 のクライアントが読む: 不一致の警告が無い
    expect(warnings.filter((w) => w.includes("does not match"))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("ハイドレーション後に +1 / Add / Remove / Toggle が状態と DOM を変える", async ({ page }) => {
    const errors = collectErrors(page);
    const warnings = collectWarnings(page);
    await page.goto(`${BASE}/`);
    await hydrated(page);

    // 引き取った行に目印（行は配列の要素と同一性で対応付くので、追加・削除で残る行は動かない）
    await page.evaluate(() => {
      document.querySelectorAll("li.user-item").forEach((li, i) => {
        (li as Node & { __ssrMark?: string }).__ssrMark = `row-${i}`;
      });
    });
    const rowMarks = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("li.user-item"), (li) => (li as Node & { __ssrMark?: string }).__ssrMark ?? null),
      );

    // {{ counter }}（ページ直下のテキストバインディング）
    const counter = page.locator("h2").nth(0);
    await page.getByRole("button", { name: "+1" }).click();
    await expect(counter).toHaveText("Counter: 1");
    await page.getByRole("button", { name: "+1" }).click();
    await expect(counter).toHaveText("Counter: 2");

    // for: users — 追加は末尾に 1 行、"New User <length+1>"
    const listHeading = page.locator("h2").nth(1);
    await page.getByRole("button", { name: "Add User" }).click();
    await expect(userItems(page)).toHaveCount(6);
    await expect(listHeading).toHaveText("User List (6 users)");
    await expect(userItems(page).nth(5).locator(".user-name")).toHaveText("New User 6");
    await expect(userItems(page).nth(5).locator(".role-badge")).toHaveText("viewer");
    expect(await rowMarks()).toEqual(["row-0", "row-1", "row-2", "row-3", "row-4", null]);

    // 末尾から 2 行削除: 追加した行と Ethan Wilson が消え、残りは引き取った行のまま
    await page.getByRole("button", { name: "Remove Last" }).click();
    await page.getByRole("button", { name: "Remove Last" }).click();
    await expect(userItems(page)).toHaveCount(4);
    await expect(listHeading).toHaveText("User List (4 users)");
    await expect(userItems(page).locator(".user-name")).toHaveText(USERS.slice(0, 4).map((u) => u.name));
    expect(await rowMarks()).toEqual(["row-0", "row-1", "row-2", "row-3"]);

    // if: show / else: — サーバーが描いた枝から else へ、そして戻る
    await page.getByRole("button", { name: "Toggle" }).click();
    await expect(page.locator(".info-box")).toHaveCount(1);
    await expect(page.locator(".info-box")).toHaveText("Hidden (show = false)");
    await expect(page.locator(".info-box")).toHaveClass(/hidden/);
    await page.getByRole("button", { name: "Toggle" }).click();
    await expect(page.locator(".info-box")).toHaveCount(1);
    await expect(page.locator(".info-box")).toHaveText("This block is visible because show = true");

    expect(warnings.filter((w) => w.includes("does not match"))).toEqual([]);
    expect(errors).toEqual([]);
  });
});
