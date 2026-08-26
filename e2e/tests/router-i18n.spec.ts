import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// examples/router-i18n だけは serve.mjs（リポジトリルートを配る共有サーバー）に
// 載せられない。ロケール交渉のスニペットは **アプリがオリジンのルートに置かれて
// いる** 前提で書かれており（`/ja/orders` の先頭セグメントがロケール）、
// `/examples/router-i18n/` の下では先頭セグメントが "examples" になってしまう。
// サブパス配備に対応させるにはスニペットに mount 定数を持たせることになるが、
// それはコピペ雛形を検証の都合で複雑にする取引なので採らない。代わりにデモ自身の
// サーバーをルートで立てて、配布されるとおりの形を検証する。
//
// WCS_LOCAL=1 は esm.run の一行を packages/*/dist に差し替える（serve.mjs と同じ
// 手口）。CI の e2e ジョブは実行前に stale な dist を再ビルドするので、この suite は
// 公開済みバンドルではなく作業ツリーを検証する。
// ポートはワーカーごとにずらす。fullyParallel なので、固定ポートだと 2 人目の
// ワーカーの beforeAll が EADDRINUSE で落ちる（TEST_PARALLEL_INDEX は
// workers 数で頭打ちになるので、ポートが無限にずれない）。
const PORT = Number(process.env.I18N_PORT || 4199) + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const BASE = `http://127.0.0.1:${PORT}`;
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["examples/router-i18n/server.js"], {
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

test.afterAll(() => {
  server?.kill();
});

/** ロケールが確定するまで（＝リダイレクトが落ち着くまで）待つ */
async function settled(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("lang", /^(en|ja)$/);
}

test.describe("examples/router-i18n — ロケール交渉", () => {
  // 決定順: URL > 明示選択(storage) > navigator.languages > fallback。
  // URL を最優先にするのは、共有されたリンクで言語が変わらないようにするため。

  test("navigator の言語で着地先が決まる", async ({ browser }) => {
    for (const [locale, expected, heading] of [
      ["ja-JP", "/ja/", "注文履歴"],
      ["en-US", "/en/", "Order history"],
      // 対応していない言語は fallback('en') に落ちる
      ["fr-FR", "/en/", "Order history"],
    ] as const) {
      const context = await browser.newContext({ locale });
      const page = await context.newPage();
      const errors = collectErrors(page);
      await page.goto(`${BASE}/`);
      await settled(page);
      expect(page.url()).toBe(`${BASE}${expected}`);
      await expect(page.locator("h1")).toHaveText(heading);
      expect(errors).toEqual([]);
      await context.close();
    }
  });

  test("URL のロケールが navigator より優先する", async ({ browser }) => {
    const context = await browser.newContext({ locale: "ja-JP" });
    const page = await context.newPage();
    await page.goto(`${BASE}/en/`);
    await settled(page);
    // リダイレクトされず、英語のまま
    expect(page.url()).toBe(`${BASE}/en/`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1")).toHaveText("Order history");
    await context.close();
  });

  test("明示選択（storage）が navigator より優先し、URL には負ける", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    await context.addInitScript(() => {
      localStorage.setItem("wcs-i18n-lang", "ja");
    });
    const page = await context.newPage();

    // ロケールを含まない URL: 明示選択が navigator(en) に勝つ
    await page.goto(`${BASE}/`);
    await settled(page);
    expect(page.url()).toBe(`${BASE}/ja/`);

    // ロケールを含む URL: 明示選択より URL が勝つ
    await page.goto(`${BASE}/en/about`);
    await settled(page);
    expect(page.url()).toBe(`${BASE}/en/about`);
    await context.close();
  });

  test("言語リンクのクリックが明示選択として記録される", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(`${BASE}/en/`);
    await settled(page);

    await page.locator('.lang-switch a[data-lang="ja"]').click();
    await settled(page);
    expect(page.url()).toBe(`${BASE}/ja/`);
    expect(await page.evaluate(() => localStorage.getItem("wcs-i18n-lang"))).toBe("ja");

    // 記録された選択は、ロケールを含まない URL への次の訪問で効く
    await page.goto(`${BASE}/`);
    await settled(page);
    expect(page.url()).toBe(`${BASE}/ja/`);
    await context.close();
  });
});

test.describe("examples/router-i18n — URL の修復", () => {
  // 修復は head の同期スクリプトが DOM 解析前に行う。router の guard では
  // redirect 先を動的に決められないため書けない（docs/i18n-design.md §9-1-2）。

  test("ロケールが無い URL には前置し、残りのパスを保つ", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(`${BASE}/about`);
    await settled(page);
    expect(page.url()).toBe(`${BASE}/en/about`);
    await expect(page.locator("h2")).toHaveText("About this demo");
    await context.close();
  });

  test("ロケールらしいが未対応のセグメントは置換する（前置ではない）", async ({ browser }) => {
    const context = await browser.newContext({ locale: "ja-JP" });
    const page = await context.newPage();
    await page.goto(`${BASE}/xx/about`);
    await settled(page);
    // "xx" は前置されず置き換わる。/ja/xx/about になってはいけない
    expect(page.url()).toBe(`${BASE}/ja/about`);
    await context.close();
  });

  test("修復済みの URL を再訪してもリダイレクトしない", async ({ browser }) => {
    const context = await browser.newContext({ locale: "ja-JP" });
    const page = await context.newPage();
    const redirects: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) redirects.push(frame.url());
    });
    await page.goto(`${BASE}/ja/about`);
    await settled(page);
    expect(page.url()).toBe(`${BASE}/ja/about`);
    // ナビゲーションは 1 回きり（ループしていない）
    expect(redirects).toEqual([`${BASE}/ja/about`]);
    await context.close();
  });
});

test.describe("examples/router-i18n — 言語切替はハードナビゲーション", () => {
  // これが D9（ロケールは router の basename に置く）の存在理由。basename の内側の
  // リンクは router に intercept され、辞書モジュールが再評価されないまま
  // 「言語が変わらないのに何も壊れて見えない」状態になる。

  test("言語リンクはページを再読み込みし、アプリ内リンクはしない", async ({ browser }) => {
    const context = await browser.newContext({ locale: "ja-JP" });
    const page = await context.newPage();
    const errors = collectErrors(page);
    await page.goto(`${BASE}/ja/`);
    await settled(page);

    // 同一ドキュメントかどうかを見分けるための目印
    await page.evaluate(() => { (window as unknown as Record<string, string>).__marker = "same-document"; });
    await page.locator('.lang-switch a[data-lang="en"]').click();
    await settled(page);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__marker)).toBeUndefined();
    await expect(page.locator("h1")).toHaveText("Order history");

    // アプリ内リンクは soft navigation のまま（router が intercept する）
    await page.evaluate(() => { (window as unknown as Record<string, string>).__marker = "same-document"; });
    await page.locator('.top-nav a[href="/en/about"]').click();
    await expect(page.locator("h2")).toBeAttached();
    expect(page.url()).toBe(`${BASE}/en/about`);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__marker)).toBe("same-document");

    expect(errors).toEqual([]);
    await context.close();
  });
});

// 既知の欠陥（i18n 固有ではない・router × state の統合）。直ったらこのテストが
// 「失敗するはずが成功した」で落ちるので、取りこぼさずに気づける。
//
// `data-wcs` のバインドは、**state がバインドを構築した時点で document に居た
// ノードにしか存在しない**。非活性なルートの内容はそのとき切り離されているので
// 一度も走査されず、あとからナビゲーションで挿入されてもバインドされない
// （MutationObserver は「既に関心のある session を持つノード」しか配送しない）。
//
// したがって症状は「初回だけ」ではなく **恒久的**: 何度行き来しても空のまま。
// ハードロードでそのルートが active だった場合にだけ効く。`@i18n` 越境に限らず
// 自 state のバインド（`path`）でも同じなので、クロス state 起因ではない。
test.describe("examples/router-i18n — 既知の欠陥", () => {
  // 直せないあいだ、せめて黙って壊れないこと。router が「後から差し込む内容に
  // バインドがある」と気づいた時点で、原因（バインド構築の時点）と回避策を
  // 名指しで警告する。これが入るまでは、空の見出しから原因へ辿る手がかりが
  // 一切なかった。
  test("バインドが効かないことを router が警告すること", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });
    await page.goto(`${BASE}/en/`);
    await settled(page);
    await page.locator('.top-nav a[href="/en/about"]').click();
    await expect(page.locator("h2")).toBeAttached();

    const unbound = warnings.filter((w) => w.includes("will never be applied"));
    expect(unbound.length).toBeGreaterThan(0);
    expect(unbound[0]).toContain("inside a route");
    expect(unbound[0]).toContain("render empty");
    await context.close();
  });
});

test.describe("examples/router-i18n — 未修正の欠陥（tripwire）", () => {
  test.fail();

  test("非活性ルートの内容がナビゲーション後にバインドされる", async ({ browser }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(`${BASE}/en/`);
    await settled(page);

    // 往復しても回復しないことまで含めて固定する（「初回だけ」ではない）
    for (let i = 0; i < 2; i++) {
      await page.locator('.top-nav a[href="/en/about"]').click();
      await expect(page.locator("h2")).toBeAttached();
      await page.locator('.top-nav a[href="/en/"]').click();
      await expect(page.locator(".orders")).toBeAttached();
    }
    await page.locator('.top-nav a[href="/en/about"]').click();
    await expect(page.locator("h2")).toHaveText("About this demo");
    await context.close();
  });
});
