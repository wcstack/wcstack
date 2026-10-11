import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { get } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { collectErrors } from "./helpers";

// state 単体: `$stream` で fetch のレスポンス本文（チャンク転送のテキスト）を 1 つの
// リアクティブなプロパティ `story` に畳むデモ。
//  - `args` が読む `prompt` / `seed` が変わると、走っている run を AbortSignal で中断し、
//    `story` を `initial`（""）に戻して新しい run を始める（switchMap）
//  - Regenerate は `seed` を進めるだけ（done / error からの再試行も同じ操作）
//  - プロンプトに "error" を含めるとサーバーが途中で接続を切り、`$streamStatus.story` が
//    error になり `$streamError.story` が埋まるが、それまでに畳んだ文は残る
//
// この spec はデモ自身の server.js をワーカーごとのポートで立て、そこからページを開く。
// page.route() の fulfill は本文を一度に返すだけなので、このデモが見せるもの —— チャンクが
// 届くたびに畳まれて文が伸びること、本文の途中での中断、途中で切れた接続で畳んだ文が残る
// こと —— を再現できない。本物の逐次ストリーム（約 60ms ごとに 1 語）が要る。
// ページは esm.run から state を読むので、その 1 本だけは page.route() でローカルの
// packages/state/dist/auto.min.js（serve.mjs が `/auto` を解決する先と同じ）に差し替える。
// HTTP エラーの経路（デモのサーバーは返さない）は、そのテストだけ page.route() で注入する。
//
// 期待する本文はページのコードからではなく、同じサーバーへテスト側から直接要求して得る。

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const STATE_AUTO = resolve(REPO_ROOT, "packages/state/dist/auto.min.js");
// fullyParallel なので、ワーカーごとにポートをずらす（router-i18n.spec.ts と同じ手口）
const PORT = Number(process.env.STREAMS_PORT || 4400) + Number(process.env.TEST_PARALLEL_INDEX ?? 0);
const BASE = `http://127.0.0.1:${PORT}`;
const DEFAULT_PROMPT = "a tiny robot";

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(process.execPath, ["packages/state/examples/streams/server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error("demo server did not start in 30s")), 30_000);
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("demo running")) {
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

const storyUrl = (prompt: string, seed: number) =>
  `${BASE}/api/story?prompt=${encodeURIComponent(prompt)}&seed=${seed}`;

/**
 * サーバーが (prompt, seed) に対して送る本文を、ページを通さずに読む。接続が途中で
 * 切られた場合（"error" を含むプロンプト）は、切られるまでに届いた分を返す。
 */
function serverStory(prompt: string, seed: number): Promise<{ text: string; complete: boolean }> {
  return new Promise((resolveText, rejectText) => {
    get(storyUrl(prompt, seed), (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { text += chunk; });
      res.on("end", () => resolveText({ text, complete: res.complete }));
      res.on("aborted", () => resolveText({ text, complete: false }));
      res.on("error", () => resolveText({ text, complete: false }));
    }).on("error", rejectText);
  });
}

/** ページを開く。esm.run の state をローカルの dist に差し替え、本文と chip の変化を記録する。 */
async function openDemo(page: Page): Promise<void> {
  await page.route("https://esm.run/**", (route) =>
    route.fulfill({
      path: STATE_AUTO,
      contentType: "text/javascript; charset=utf-8",
      // クロスオリジンのモジュールスクリプトなので CORS ヘッダが要る
      headers: { "access-control-allow-origin": "*" },
    }));
  // デモのサーバーは favicon を持たない（404 をコンソールに出させない）
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  // story の textContent と chip の文言を、変わるたびに記録する（逐次に伸びたことの証拠）
  await page.addInitScript(() => {
    const w = window as any;
    w.__samples = [];
    w.__statuses = [];
    document.addEventListener("DOMContentLoaded", () => {
      const span = document.querySelector(".story > span:first-child")!;
      const chip = document.querySelector(".chip")!;
      new MutationObserver(() => {
        const t = span.textContent ?? "";
        if (w.__samples[w.__samples.length - 1] !== t) w.__samples.push(t);
        const s = chip.textContent ?? "";
        if (w.__statuses[w.__statuses.length - 1] !== s) w.__statuses.push(s);
      }).observe(document.body, { childList: true, characterData: true, subtree: true });
    });
  });
  await page.goto(`${BASE}/streams/`);
}

const chip = (page: Page) => page.locator(".chip");
const cursor = (page: Page) => page.locator(".story .cursor");
const errorLine = (page: Page) => page.locator(".error-line");
const storyText = (page: Page) => page.locator(".story > span:first-child").evaluate((el) => el.textContent ?? "");
const samples = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__samples.slice());
const statuses = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__statuses.slice());
const resetSamples = (page: Page) => page.evaluate(() => { (window as any).__samples = []; (window as any).__statuses = []; });

/** 記録した本文の列が、`final` の接頭辞として単調に伸びたことを確かめる（"" は除く）。 */
function expectGrewToward(seq: string[], final: string, minSteps: number) {
  const nonEmpty = seq.filter((s) => s !== "");
  expect(nonEmpty.length).toBeGreaterThanOrEqual(minSteps);
  for (let i = 0; i < nonEmpty.length; i++) {
    expect(final.startsWith(nonEmpty[i]), `sample ${i} is a prefix of the final text`).toBe(true);
    if (i > 0) expect(nonEmpty[i].length).toBeGreaterThan(nonEmpty[i - 1].length);
  }
}

async function expectDone(page: Page, text: string) {
  await expect(chip(page)).toHaveText("done", { timeout: 20_000 });
  await expect(chip(page)).toHaveClass(/\bdone\b/);
  await expect(chip(page)).not.toHaveClass(/\bactive\b/);
  await expect(cursor(page)).toHaveCount(0);
  await expect(errorLine(page)).toHaveCount(0);
  expect(await storyText(page)).toBe(text);
  await expect(page.locator(".meta")).toHaveText(`${text.length} chars`);
}

// 想定内のコンソール出力: 途中で切られたチャンク転送（ERR_INCOMPLETE_CHUNKED_ENCODING）や
// 注入した 500 に対して Chromium 自身が出す "Failed to load resource"。
function appErrors(errors: string[]): string[] {
  return errors.filter((e) => !/Failed to load resource/.test(e));
}

test.describe("packages/state/examples/streams", () => {
  test("初回は既定の prompt の物語がチャンクごとに伸び、active → done で全文になる", async ({ page }) => {
    const errors = collectErrors(page);
    const expected = await serverStory(DEFAULT_PROMPT, 0);
    expect(expected.complete).toBe(true);

    await openDemo(page);
    await expect(page.locator(".controls input")).toHaveValue(DEFAULT_PROMPT);

    // 走っている間: chip は active、カーソルが出て、本文は全文の途中まで
    await expect(chip(page)).toHaveText("active");
    await expect(chip(page)).toHaveClass(/\bactive\b/);
    await expect(cursor(page)).toBeVisible();
    await expect.poll(async () => (await storyText(page)).length).toBeGreaterThan(0);
    const partial = await storyText(page);
    expect(partial.length).toBeLessThan(expected.text.length);
    expect(expected.text.startsWith(partial)).toBe(true);

    await expectDone(page, expected.text);
    // 1 語ずつ届くので、本文は何度にも分けて伸びている（一括で描かれたのではない）
    expectGrewToward(await samples(page), expected.text, 10);
    const seen = await statuses(page);
    expect(seen.slice(-2)).toEqual(["active", "done"]);

    expect(errors).toEqual([]);
  });

  test("走っている最中に prompt を編集すると、前の run を中断して新しい prompt の物語を最初から畳む", async ({ page }) => {
    const errors = collectErrors(page);
    // /api/story の要求ごとに、始まりと終わり（requestfinished / requestfailed）の時刻を取る。
    // Chromium は getReader() で最後まで読んだ本文も net::ERR_ABORTED で報告するので、
    // 失敗の文言では中断を見分けられない。代わりに、終わるまでの時間で見分ける: 物語は
    // 約 60ms ごとに 1 語で数秒かかるので、すぐに終わった要求は途中で取り消されたもの。
    const story: Array<{ prompt: string; start: number; end: number | null }> = [];
    const promptOf = (url: string) => new URL(url).searchParams.get("prompt")!;
    page.on("request", (r) => {
      if (r.url().includes("/api/story")) story.push({ prompt: promptOf(r.url()), start: Date.now(), end: null });
    });
    const ended = (url: string) => {
      const hit = story.find((s) => s.prompt === promptOf(url) && s.end === null);
      if (hit) hit.end = Date.now();
    };
    page.on("requestfinished", (r) => { if (r.url().includes("/api/story")) ended(r.url()); });
    page.on("requestfailed", (r) => { if (r.url().includes("/api/story")) ended(r.url()); });
    // i 番目の要求が、次の要求（それを置き換えた run）が始まってから終わるまでの時間
    const cutAfterNext = (i: number) => story[i].end! - story[i + 1].start;
    const duration = (i: number) => story[i].end! - story[i].start;

    const cat = await serverStory("a brave cat", 0);
    const catNow = await serverStory("a brave cat now", 0);

    await openDemo(page);
    // 既定の prompt の run が途中まで進んだところで編集する
    await expect.poll(async () => (await storyText(page)).length).toBeGreaterThan(0);
    await expect(chip(page)).toHaveText("active");
    await resetSamples(page);
    await page.locator(".controls input").fill("a brave cat");

    await expectDone(page, cat.text);
    // 編集の後、本文はいったん initial（""）に戻り、そこからは新しい物語の接頭辞だけを通る。
    // 中断した run のチャンクはもう届かない（混ざらない）
    const after = await samples(page);
    const reset = after.indexOf("");
    expect(reset).toBeGreaterThanOrEqual(0);
    expectGrewToward(after.slice(reset), cat.text, 10);
    // 前の run の要求は、fetch(url, { signal }) の中断ですぐに取り消されている。
    // done まで走った要求は物語の長さぶん（数秒）かかっている
    expect(story.map((s) => s.prompt)).toEqual([DEFAULT_PROMPT, "a brave cat"]);
    await expect.poll(() => story[1].end).not.toBeNull();
    expect(cutAfterNext(0)).toBeLessThan(1000);
    expect(duration(0)).toBeLessThan(duration(1));
    expect(duration(1)).toBeGreaterThan(2000);

    // 1 打鍵ごとに再開する: 4 文字打つと 4 回再開し、最後の prompt の物語だけが残る
    await page.locator(".controls input").pressSequentially(" now", { delay: 50 });
    await expectDone(page, catNow.text);
    expect(story.map((s) => s.prompt)).toEqual([
      DEFAULT_PROMPT, "a brave cat", "a brave cat ", "a brave cat n", "a brave cat no", "a brave cat now",
    ]);
    await expect.poll(() => story[5].end).not.toBeNull();
    // 次の打鍵で置き換えられた 3 本は、置き換えた run が始まるとすぐに取り消された
    for (const i of [2, 3, 4]) expect(cutAfterNext(i), story[i].prompt).toBeLessThan(1000);
    expect(duration(5)).toBeGreaterThan(2000);

    expect(errors).toEqual([]);
  });

  test("Regenerate は seed を進め、done から再開して別の物語を畳む", async ({ page }) => {
    const errors = collectErrors(page);
    const s0 = await serverStory(DEFAULT_PROMPT, 0);
    const s1 = await serverStory(DEFAULT_PROMPT, 1);
    const s2 = await serverStory(DEFAULT_PROMPT, 2);
    expect(new Set([s0.text, s1.text, s2.text]).size).toBe(3);

    await openDemo(page);
    await expectDone(page, s0.text);

    await resetSamples(page);
    await page.getByRole("button", { name: "Regenerate" }).click();
    await expect(chip(page)).toHaveText("active");
    await expectDone(page, s1.text);
    const after = await samples(page);
    expect(after[0]).toBe("");
    expectGrewToward(after, s1.text, 10);

    await page.getByRole("button", { name: "Regenerate" }).click();
    await expectDone(page, s2.text);

    expect(errors).toEqual([]);
  });

  test("サーバーが途中で接続を切ると error になり、$streamError が出るが、畳んだ文は残る", async ({ page }) => {
    const errors = collectErrors(page);
    const cut = await serverStory("error bot", 0);
    expect(cut.complete).toBe(false);
    expect(cut.text.length).toBeGreaterThan(0);
    const calm = await serverStory("a calm bot", 0);

    await openDemo(page);
    await expect(chip(page)).toHaveText(/active|done/);
    await page.locator(".controls input").fill("error bot");

    await expect(chip(page)).toHaveText("error", { timeout: 20_000 });
    await expect(chip(page)).toHaveClass(/\berror\b/);
    await expect(cursor(page)).toHaveCount(0);
    // 切られるまでに届いた分がそのまま残る（initial に戻されない）
    expect(await storyText(page)).toBe(cut.text);
    await expect(page.locator(".meta")).toHaveText(`${cut.text.length} chars`);
    // $streamError.story（の String()）と案内文
    await expect(errorLine(page)).toBeVisible();
    await expect(errorLine(page)).toContainText("— the text folded so far is kept.");
    expect((await errorLine(page).textContent())!.split(" — ")[0].trim()).toMatch(/Error/);

    // Regenerate（seed を進める）で error からも再開する。prompt はまだ error を含むので
    // ふたたび途中で切られるが、本文はいったん "" に戻ってから新しい seed の分を畳む
    const cut1 = await serverStory("error bot", 1);
    await resetSamples(page);
    await page.getByRole("button", { name: "Regenerate" }).click();
    await expect(chip(page)).toHaveText("error", { timeout: 20_000 });
    await expect.poll(() => storyText(page)).toBe(cut1.text);
    expect((await samples(page))[0]).toBe("");

    // prompt から error を外すと、最後まで流れて done になり、エラーの行は消える
    // （$streamError は再開のたびに null に戻る）。seed は 1 のまま
    const calm1 = await serverStory("a calm bot", 1);
    await page.locator(".controls input").fill("a calm bot");
    await expectDone(page, calm1.text);
    expect(calm1.text).not.toBe(calm.text);

    expect(appErrors(errors)).toEqual([]);
  });

  test("source が HTTP エラーで throw すると、本文は空のまま error になり、Regenerate で回復する", async ({ page }) => {
    const errors = collectErrors(page);
    const s1 = await serverStory(DEFAULT_PROMPT, 1);

    // このテストだけ、最初の要求に 500 を返す（デモのサーバーはこの経路を持たない）
    await page.route("**/api/story*", (route) => route.fulfill({ status: 500, body: "injected" }), { times: 1 });
    await openDemo(page);

    await expect(chip(page)).toHaveText("error");
    await expect(errorLine(page)).toContainText("Error: HTTP 500 — the text folded so far is kept.");
    expect(await storyText(page)).toBe("");
    await expect(page.locator(".meta")).toHaveText("0 chars");

    await page.getByRole("button", { name: "Regenerate" }).click();
    await expectDone(page, s1.text);

    expect(appErrors(errors)).toEqual([]);
  });
});
