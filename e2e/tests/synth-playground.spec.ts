import { test, expect } from "@playwright/test";
import { collectErrors } from "./helpers";

// examples/synth-playground の実ブラウザスモーク。
//
// 音そのものは audio-offline.spec.ts が OfflineAudioContext で検証済み。ここで
// 見るのは **example の配線が成立していること**: data-wcs のスライダー束縛、
// eventToken 経由の MIDI、demo-ui.js のローカルコンポーネント、そして
// 「無関係な DOM がパッチの中にあっても音が切れない」という配置上の前提。
test.describe("examples/synth-playground", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/examples/synth-playground/index.html");
    await page.waitForFunction(() => customElements.get("wcs-audio") !== undefined);
    await page.waitForFunction(() => (document.getElementById("synth") as any)?.audioCore != null);
  });

  test("パッチがマークアップから組み上がる", async ({ page }) => {
    const errors = collectErrors(page);
    const patch = await page.evaluate(() => {
      const synth = document.getElementById("synth") as any;
      return {
        voices: synth.patch.voices.length,
        poly: synth.patch.voices[0].poly,
        voiceNodes: synth.patch.voices[0].nodes.map((n: any) => n.kind),
        topLevel: synth.patch.nodes.map((n: any) => n.kind),
        warnings: synth.warnings,
      };
    });

    expect(patch.voices).toBe(1);
    expect(patch.poly).toBe(8);
    // 3 osc + フィルタ（その子に LFO と env）
    expect(patch.voiceNodes).toEqual(["osc", "osc", "osc", "biquad"]);
    // バス（中に delay）とマスタータップの analyser
    expect(patch.topLevel).toEqual(["gain", "analyser"]);
    // 解決できない out / param があればここに出る
    expect(patch.warnings).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("スライダー → state → オーディオノードが繋がっている", async ({ page }) => {
    const errors = collectErrors(page);
    const slider = page.locator('input[data-wcs="value: cutoff"]');
    await slider.fill("3000");
    await slider.dispatchEvent("input");

    await expect
      .poll(() => page.evaluate(() => (document.getElementById("vcf") as any).frequency))
      .toBe(3000);

    expect(errors).toEqual([]);
  });

  test("ノートを鳴らすと voices が state に届く", async ({ page }) => {
    const errors = collectErrors(page);
    await page.evaluate(() => {
      const synth = document.getElementById("synth") as any;
      synth.noteOn(60, 0.9);
      synth.noteOn(64, 0.9);
      synth.noteOn(67, 0.9);
    });

    // wcs-audio の voices → data-wcs → 画面のテキスト
    await expect(page.locator(".status span").nth(1)).toHaveText("3");

    await page.evaluate(() => (document.getElementById("synth") as any).allNotesOff());
    await expect(page.locator(".status span").nth(1)).toHaveText("0");
    expect(errors).toEqual([]);
  });

  test("鍵盤コンポーネントがポインタ操作でノートを送る", async ({ page }) => {
    const errors = collectErrors(page);
    const keys = page.locator("demo-keys").first();
    await keys.click({ position: { x: 20, y: 100 } });

    // クリックで押して離すので、押鍵直後にリリースへ入る（テールは残る）
    await expect
      .poll(() => page.evaluate(() => (document.getElementById("synth") as any).audioCore.allocatedVoices))
      .toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("パッチの中に DOM を足しても発音中の音が切れない", async ({ page }) => {
    const errors = collectErrors(page);
    const voices = await page.evaluate(async () => {
      const synth = document.getElementById("synth") as any;
      synth.noteOn(60, 0.9);
      const before = synth.voices;

      // .controls と同じ階層に普通の DOM を足す
      const div = document.createElement("div");
      div.innerHTML = "<label><input type='range'></label>";
      synth.appendChild(div);
      await new Promise((r) => setTimeout(r, 50));

      return { before, after: synth.voices };
    });

    expect(voices.before).toBe(1);
    expect(voices.after).toBe(1);
    expect(errors).toEqual([]);
  });

  test("2つ目の <wcs-audio> は独立して動く", async ({ page }) => {
    const result = await page.evaluate(() => {
      const bass = document.getElementById("bass") as any;
      const synth = document.getElementById("synth") as any;
      bass.noteOn(36);
      // ページ内で AudioContext は 1 個を共有する。正本は audioContext.ts の
      // Symbol.for レジストリで、Core は公開 getter を持たないので、レジストリの
      // 実体と両ルートが掴んでいる context を突き合わせる。
      const shared = (globalThis as any)[Symbol.for("@wcstack/audio.context")] ?? null;
      return {
        bassWarnings: bass.warnings.length,
        // モノフォニック（voice 無し）なので voices は 0 のまま
        bassVoices: bass.voices,
        synthVoices: synth.voices,
        sharedIsAudioContext: shared instanceof BaseAudioContext,
        bassOnShared: shared !== null && bass.audioCore._ctx === shared,
        synthOnShared: shared !== null && synth.audioCore._ctx === shared,
      };
    });

    expect(result.bassWarnings).toBe(0);
    expect(result.bassVoices).toBe(0);
    expect(result.synthVoices).toBe(0);
    expect(result.sharedIsAudioContext).toBe(true);
    expect(result.bassOnShared).toBe(true);
    expect(result.synthOnShared).toBe(true);
  });
});
