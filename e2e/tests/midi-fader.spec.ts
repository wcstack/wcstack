import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// packages/midi/examples/midi-fader の実ブラウザスモーク。
//
// Web MIDI は Chromium でも実機が要るので、navigator.requestMIDIAccess を
// ページ読み込み前に差し替えて疑似デバイスを挿す。狙いは MIDI の実装検証では
// なく（それは packages/midi の unit test の仕事）、**example の data-wcs 配線が
// 実際に成立していること**の回帰: eventToken / command-token / パスゲッター /
// for ループが揃って動かないと以下の assert が落ちる。
const INSTALL_FAKE_MIDI = () => {
  class FakePort extends EventTarget {
    id: string; name: string; manufacturer = "wcstack"; state = "connected";
    onmidimessage: ((e: any) => void) | null = null;
    constructor(id: string, name: string) { super(); this.id = id; this.name = name; }
  }
  const input = new FakePort("in-1", "Fake Controller");
  const output = new FakePort("out-1", "Fake Synth");
  const access = {
    inputs: new Map([[input.id, input]]),
    outputs: new Map([[output.id, output]]),
    onstatechange: null,
  };
  (window as any).__fakeMidiInput = input;
  (navigator as any).requestMIDIAccess = () => Promise.resolve(access);
};

test.describe("packages/midi/examples/midi-fader", () => {
  test("MIDI 入力が data-wcs 経由でページに届く", async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(INSTALL_FAKE_MIDI);
    await page.goto("/packages/midi/examples/midi-fader/index.html");

    // 接続前: コマンドは撃たれておらず、デバイス一覧は空。
    await expect(page.locator("button")).toBeEnabled();
    await expect(page.locator("li")).toHaveCount(0);

    // command-token: クリック → state のメソッド → $command.requestMidi.emit()
    // → <wcs-midi>.request()。
    await page.locator("button").click();

    // devices は fresh array として publish され、for ループが2件描画する。
    await expect(page.locator("li")).toHaveCount(2);
    await expect(page.locator("li").first()).toHaveText("input — Fake Controller");
    await expect(page.locator("button")).toBeDisabled();

    // event-token: 実デバイスからのメッセージが $on を経て state を更新する。
    const emit = (data: number[]) =>
      page.evaluate((bytes) => {
        (window as any).__fakeMidiInput.onmidimessage?.({
          data: new Uint8Array(bytes),
          target: (window as any).__fakeMidiInput,
          timeStamp: 0,
        });
      }, data);

    await emit([0x90, 60, 127]);   // note on C4, full velocity
    await emit([0x90, 64, 127]);   // note on E4
    await expect(page.locator("output").first()).toHaveText("60, 64");

    await emit([0x80, 60, 0]);     // note off C4
    await expect(page.locator("output").first()).toHaveText("64");

    // velocity 0 の note on も note off として扱われる（正規化の回帰）。
    await emit([0x90, 64, 0]);
    await expect(page.locator("output").first()).toHaveText("—");

    // control change はコントローラ番号と値に分解される。
    await emit([0xb0, 7, 100]);
    await expect(page.locator(".panel").last().locator("output").first()).toHaveText("7");
    await expect(page.locator(".panel").last().locator("output").last()).toHaveText("100");

    expect(errors).toEqual([]);
  });
});
