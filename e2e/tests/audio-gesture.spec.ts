import { test, expect, type Page } from "@playwright/test";

// @wcstack/audio の既定の AudioContext は最初のユーザー操作まで作らない（4.17）。
//
// 4.16 までは接続時に作っていたので、<wcs-audio> を置いたページを開いただけで、
// 操作の前にブラウザが警告を出していた（音楽室の継ぎ目アプリが見つけた）:
//   Chromium: "The AudioContext was not allowed to start. It must be resumed (or created)
//             after a user gesture on the page."（ライブグラフの oscillator が start した時）
//   Firefox:  "An AudioContext was prevented from starting automatically. It must be created
//             or resumed after a user gesture on the page."
// 今は最初の pointerdown / keydown の中で作るので、読み込みでは何も出ず、最初の押鍵は鳴る。
// fixture は /auto と既定の（共有・実時間の）context — 作者が書くままのページ。

declare global {
  interface Window {
    __audioGestureReady: boolean;
  }
}

/** Every console message that mentions an AudioContext, warnings included. */
function collectAudioContextMessages(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (msg) => {
    if (/AudioContext/.test(msg.text())) messages.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => messages.push(`pageerror: ${err.message}`));
  return messages;
}

const scopeSpread = (page: Page): Promise<number> => page.evaluate(() => {
  const frame = (document.getElementById("scope") as unknown as { sample(): Uint8Array | null }).sample();
  return frame ? Math.max(...frame) - Math.min(...frame) : -1;
});

test.describe("e2e/fixtures/audio-gesture", () => {
  test("ページを開いただけでは AudioContext を作らず、ブラウザの警告も出ない @browsers", async ({ page }) => {
    const messages = collectAudioContextMessages(page);
    await page.goto("/e2e/fixtures/audio-gesture/index.html");
    await page.waitForFunction(() => window.__audioGestureReady === true);
    // 4.16 では接続（とライブグラフの組み立て）の時点で警告が出ていた。少し待って何も来ないことを見る。
    await page.waitForTimeout(500);

    const before = await page.evaluate(() => {
      const synth = document.getElementById("synth") as unknown as { state: string; running: boolean; suspended: boolean };
      return {
        state: synth.state, running: synth.running, suspended: synth.suspended,
        created: (globalThis as Record<symbol, unknown>)[Symbol.for("@wcstack/audio.context")] !== undefined,
      };
    });
    expect(before).toEqual({ state: "suspended", running: false, suspended: true, created: false });
    expect(messages).toEqual([]);
  });

  // 出力デバイスの有無によらず成り立つことだけを見る — Firefox でも CI でも。
  test("最初のキー押下の中で context ができ、グラフが組まれ、その音が voices に届く @browsers", async ({ page }) => {
    const messages = collectAudioContextMessages(page);
    await page.goto("/e2e/fixtures/audio-gesture/index.html");
    await page.waitForFunction(() => window.__audioGestureReady === true);

    const read = () => page.evaluate(() => {
      const synth = document.getElementById("synth") as unknown as { voices: number };
      const scope = document.getElementById("scope") as unknown as { sample(): Uint8Array | null };
      return {
        created: (globalThis as Record<symbol, unknown>)[Symbol.for("@wcstack/audio.context")] !== undefined,
        graph: scope.sample() !== null,   // analyser のインスタンスがあれば（＝グラフがあれば）フレームが返る
        voices: synth.voices,
      };
    });
    expect(await read()).toEqual({ created: false, graph: false, voices: 0 });

    await page.locator("#key").hover();
    await page.mouse.down();
    await expect.poll(read, { timeout: 5_000 }).toEqual({ created: true, graph: true, voices: 1 });
    await page.mouse.up();
    expect(messages).toEqual([]);
  });

  // 4.17.0 は最初の pointerdown の中でグラフ（と context）を作ったので、running で消えるヒントがボタンの上がる前に
  // 消え、下の要素が上へずれて、ページで最初のクリックが別の要素に落ちた（音楽室の継ぎ目アプリの取り込み）。
  // 4.18 はそのジェスチャが終わってから作る。ずれるかどうか（context が動き出すか）は出力デバイスによるので、
  // 届いたことと context ができたことを見る。
  test("ページで最初のクリックは押した要素に届き、context はそのクリックの後にできる @browsers", async ({ page }) => {
    const messages = collectAudioContextMessages(page);
    await page.goto("/e2e/fixtures/audio-gesture/index.html");
    await page.waitForFunction(() => window.__audioGestureReady === true);
    const created = () => page.evaluate(() => (globalThis as Record<symbol, unknown>)[Symbol.for("@wcstack/audio.context")] !== undefined);
    await page.evaluate(() => {
      const option = document.getElementById("option")!;
      (window as any).__createdAtClick = null;
      option.addEventListener("click", () => {
        (window as any).__createdAtClick = (globalThis as Record<symbol, unknown>)[Symbol.for("@wcstack/audio.context")] !== undefined;
      });
    });

    await page.locator("#option").click();
    await expect(page.locator("#option")).toBeChecked();
    expect(await page.evaluate(() => (window as any).__createdAtClick)).toBe(false);
    await expect.poll(created).toBe(true);
    expect(messages).toEqual([]);
  });

  test("人の押し方（押して 150 ms で離す）でも最初のクリックは押した要素に届く", async ({ page }) => {
    await page.goto("/e2e/fixtures/audio-gesture/index.html");
    await page.waitForFunction(() => window.__audioGestureReady === true);
    const box = (await page.locator("#option").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect(page.locator("#option")).toBeChecked();
    // Chromium はデバイスが無くても動き出すので、ヒントはクリックの後で消える
    await expect(page.locator("#hint")).toBeHidden();
  });

  // 鳴ったことまで確かめるのは Chromium だけ（@browsers を付けないので Firefox の project では走らない）。
  //
  // Firefox は出力デバイスの無い環境では AudioContext を開始しない。CI の Linux ランナーで
  // この確認は Firefox だけ 3 回とも振れ幅 0 で落ちた。手元の Windows（デバイスあり）の Firefox
  // では鳴るが、デバイス無しを模すテスト用の pref（media.cubeb.force_null_context）を立てると、
  // 押下の後も state は "suspended"・currentTime は 0 のまま、analyser は無音を返し、警告も出ない
  // — CI と同じ姿になる（Linux そのものは手元で再現できないので、この pref での観察からの推定）。
  // Chromium はデバイスが無くても描画を進めるので、CI でも鳴る。
  test("最初のキー押下の音が実際に鳴る（Chromium）", async ({ page }) => {
    const messages = collectAudioContextMessages(page);
    await page.goto("/e2e/fixtures/audio-gesture/index.html");
    await page.waitForFunction(() => window.__audioGestureReady === true);

    // 無音なら analyser は全サンプル 128（振れ幅 0）
    expect(await scopeSpread(page)).toBe(-1);   // グラフはまだ無い（context を待っている）

    await page.locator("#key").hover();
    await page.mouse.down();
    await expect.poll(() => scopeSpread(page), { timeout: 5_000 }).toBeGreaterThan(10);

    const after = await page.evaluate(() => {
      const synth = document.getElementById("synth") as unknown as { state: string; voices: number };
      return { state: synth.state, voices: synth.voices };
    });
    await page.mouse.up();
    expect(after).toEqual({ state: "running", voices: 1 });
    expect(messages).toEqual([]);
  });
});
