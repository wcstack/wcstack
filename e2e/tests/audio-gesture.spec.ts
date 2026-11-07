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

  test("最初のキー押下で context ができて、その音が鳴る @browsers", async ({ page }) => {
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
